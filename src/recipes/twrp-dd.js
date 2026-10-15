import { checksum } from '../hash.js';

export const protocol = 'adb';
export const verbs = { write: 2, mkfs_ext4: 2, reboot: 0 };
export const fileArg = { write: 1 };
const MiB = 1024 * 1024;

/** @typedef {{run(command:string):Promise<{code:number,out:string}>, pipe(command:string,file:Blob,progress:(fraction:number)=>void):Promise<{code:number,out:string}>}} Shell */

/** Catalog values are validated already; this guards the shell line anyway. @param {string} path */
function safePath(path) {
  if (!/^[A-Za-z0-9/._-]+$/.test(path)) throw Error(`Unsafe device path: ${path}`);
  return path;
}

/** @param {Shell} shell @param {string} command */
async function ok(shell, command) {
  const result = await shell.run(command);
  if (result.code !== 0) throw Error(`Command failed (${result.code}): ${command}`);
  return result.out.trim();
}

/** @param {Shell} shell @param {string} path */
async function blockSize(shell, path) {
  const direct = await shell.run(`blockdev --getsize64 ${safePath(path)}`);
  let size = Number(direct.out.trim());
  if (direct.code !== 0 || !/^\d+$/.test(direct.out.trim())) {
    const real = await ok(shell, `readlink -f ${safePath(path)}`);
    const sectors = await ok(shell, `cat /sys/class/block/${safePath(real).split('/').pop()}/size`);
    size = Number(sectors) * 512;
  }
  if (!Number.isSafeInteger(size) || size <= 0) throw Error(`Could not read the size of ${path}.`);
  return size;
}

/** Mount points of a block device. @param {string} mounts @param {string} device */
const mountsOf = (mounts, device) => mounts.split('\n').map(line => line.split(' ')).filter(f => f[0] === device).map(f => f[1]);

/**
 * Checks the phone is the catalog device in TWRP and every target is an unmounted block device.
 * Targets that only get formatted may be mounted (TWRP auto-mounts /data); they are unmounted at that step.
 * @param {Shell} shell @param {{device:any, stage:any, steps:any[][]}} job
 */
export async function inspect(shell, { device, stage, steps }) {
  const expected = device.detect?.adb?.device;
  const product = await ok(shell, 'getprop ro.product.device');
  if (!expected || product !== expected) throw Error(`Expected ${expected}; phone reports ${product || 'unknown'}. Pick the matching device.`);
  if (!await ok(shell, 'getprop ro.twrp.version')) throw Error('Phone does not report TWRP (ro.twrp.version). Boot into TWRP first.');
  const mounts = await ok(shell, 'cat /proc/mounts');
  /** @type {Record<string, number>} */ const sizes = {};
  for (const [verb, partition] of steps) {
    if (verb === 'reboot') continue;
    const path = `${stage.by_name}/${partition}`;
    if ((await shell.run(`test -b ${safePath(path)}`)).code !== 0) throw Error(`${path} is not a block device.`);
    const real = await ok(shell, `readlink -f ${path}`);
    if (verb === 'write' && mountsOf(mounts, real).length) throw Error(`${partition} (${real}) is mounted in TWRP. Unmount it first.`);
    sizes[partition] = await blockSize(shell, path);
  }
  if (steps.some(([verb]) => verb === 'mkfs_ext4') && (await shell.run('command -v mke2fs')).code !== 0) throw Error('TWRP has no mke2fs; cannot format.');
  return sizes;
}

/**
 * Streams images onto partitions from TWRP over ADB, reading each back with SHA-256 before the next step.
 * @param {Shell} shell
 * @param {{device:any, stage:any, files:{name:string,size:number,sha256:string,file:Blob}[], steps:any[][]}} job
 * @param {(message:string,fraction:number)=>void} report @param {()=>void} assertSession
 */
export async function run(shell, job, report, assertSession) {
  const { stage, files, steps } = job;
  const byName = Object.fromEntries(files.map(f => [f.name, f]));
  assertSession();
  const sizes = await inspect(shell, job);
  for (const [verb, partition, name] of steps) {
    if (verb === 'write' && byName[name].size > sizes[partition]) throw Error(`${name} is larger than ${partition}. Nothing written.`);
  }
  for (const file of files) {
    report(`Checking SHA-256: ${file.name}`, 0);
    const digest = await checksum(file.file, fraction => report(`Checking SHA-256: ${file.name}`, fraction));
    if (digest !== file.sha256) throw Error(`SHA-256 mismatch: ${file.name}. Nothing written.`);
  }
  // Catalog order, no retry, no rollback.
  for (const [verb, arg, extra] of steps) {
    assertSession();
    const path = verb === 'reboot' ? '' : safePath(`${stage.by_name}/${arg}`);
    if (verb === 'write') {
      const image = byName[extra];
      const label = `Writing ${image.name} → ${arg}`;
      report(label, 0);
      const result = await shell.pipe(`dd of=${path} bs=${MiB}`, image.file, fraction => report(label, fraction));
      if (result.code !== 0) throw Error(`dd to ${arg} failed (${result.code}): ${result.out.trim()}`);
      await ok(shell, 'sync');
      assertSession();
      report(`Verifying ${arg} on the phone`, 0);
      const sum = (await ok(shell, `head -c ${image.size} ${path} | sha256sum`)).split(/\s+/)[0];
      if (sum !== image.sha256) throw Error(`${arg} read back wrong data after writing (${sum}). Do not reboot; retry the write.`);
      report(`${arg} verified`, 1);
    } else if (verb === 'mkfs_ext4') {
      report(`Formatting ${arg} as ext4 (${extra})`, 0);
      const real = await ok(shell, `readlink -f ${path}`);
      for (const mount of mountsOf(await ok(shell, 'cat /proc/mounts'), real).reverse()) await shell.run(`umount ${safePath(mount)}`);
      if (mountsOf(await ok(shell, 'cat /proc/mounts'), real).length) throw Error(`${arg} (${real}) is still mounted; unmount it in TWRP and retry.`);
      await ok(shell, `mke2fs -F -t ext4 -L ${extra} ${path}`);
    } else if (verb === 'reboot') {
      report('Requesting reboot', 0);
      await shell.run('reboot').catch(() => {}); // the USB link drops as the phone restarts
    }
  }
  report('Done.', 1);
}
