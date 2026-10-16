import { checksum } from '../hash.js';

export const protocol = 'fastboot';
export const verbs = { flash: 2, erase: 1, set_active: 1, reboot: 0 };
export const fileArg = { flash: 1 };

/** Bytes the image takes on the partition: the sparse header's block count, else the file size. @param {Blob} file */
export async function expandedSize(file) {
  const header = new DataView(await file.slice(0, 28).arrayBuffer());
  return header.byteLength === 28 && header.getUint32(0, true) === 0xed26ff3a
    ? header.getUint32(12, true) * header.getUint32(16, true) : file.size;
}

/** @typedef {{getVariable(name:string):Promise<string|null>, runCommand(command:string):Promise<unknown>,
 *   flashBlob(partition:string, blob:Blob, progress:(fraction:number)=>void):Promise<void>}} Fastboot */

/**
 * Runs a stage's step list over fastboot. Every file is SHA-256-checked and every target partition
 * size-checked before the first write; any mismatch or unexpected reply stops it (fail closed).
 * @param {Fastboot} fb
 * @param {{device:any, files:{name:string,sha256:string,file:Blob}[], steps:any[][]}} job
 * @param {(message:string,fraction:number)=>void} report @param {()=>void} assertSession
 */
export async function run(fb, { device, files, steps }, report, assertSession) {
  const total = 3 + files.filter(f => f.sha256).length + files.filter(f => f.name.endsWith('.img.xz')).length + steps.length;
  let step = 0;
  const say = (text, fraction = 0) => report(`Step ${step}/${total}: ${text}`, fraction);
  const next = text => { step += 1; assertSession(); say(text); };
  const byName = Object.fromEntries(files.map(f => [f.name, f]));

  next('Checking the phone model');
  const product = await fb.getVariable('product');
  const expected = device.detect?.fastboot?.product;
  if (!expected || product !== expected) throw Error(`Phone reports product "${product}", expected ${expected} (${device.name}). Nothing written.`);
  next('Checking the bootloader is unlocked');
  if (await fb.getVariable('unlocked') !== 'yes') throw Error('Bootloader is locked. Nothing written.');

  for (const file of files.filter(f => f.sha256)) { // unpacked archive members are covered by the archive's hash
    next(`Checking SHA-256: ${file.name}`);
    const digest = await checksum(file.file, fraction => say(`Checking SHA-256: ${file.name}`, fraction));
    if (digest !== file.sha256) throw Error(`SHA-256 mismatch: ${file.name}. Nothing written.`);
  }

  // Verify pins against the downloaded .xz bytes above; all later size checks and flashes use decoded bytes.
  const cleanups = [];
  try {
    for (const file of files.filter(f => f.name.endsWith('.img.xz'))) {
      next(`Decoding ${file.name}`);
      try {
        const { decodeXzToOPFS } = await import('./fastboot-tgz.js');
        const decoded = await decodeXzToOPFS(file.file);
        byName[file.name] = { ...file, file: decoded.file };
        cleanups.push(decoded.cleanup);
      } catch (error) { throw Error(`Could not decode ${file.name}: ${error.message}. Nothing written.`); }
    }

    next('Checking the partitions');
    for (const [verb, partition, name] of steps) {
      if (verb === 'set_active' && !['a', 'b'].includes(partition)) throw Error(`Invalid slot ${partition}. Nothing written.`);
      if (verb !== 'flash' && verb !== 'erase') continue;
      const size = parseInt(await fb.getVariable(`partition-size:${partition}`) ?? '', 16);
      if (!(size > 0)) throw Error(`Phone has no ${partition} partition. Nothing written.`);
      // flashBlob() would resize a logical partition; logical (super) layouts need their own steps.
      if (await fb.getVariable(`is-logical:${partition}`) === 'yes') throw Error(`${partition} is a logical partition. Nothing written.`);
      if (verb === 'flash' && await expandedSize(byName[name].file) > size) throw Error(`${name} is larger than ${partition}. Nothing written.`);
    }

    for (const [verb, arg, name] of steps) {
      if (verb === 'flash') {
        next(`Writing ${name} → ${arg}`);
        await fb.flashBlob(arg, byName[name].file, fraction => say(`Writing ${name} → ${arg}`, fraction));
      } else if (verb === 'erase') {
        next(`Erasing ${arg}`);
        await fb.runCommand(`erase:${arg}`);
      } else if (verb === 'set_active') {
        next(`Switching to slot ${arg}`);
        await fb.runCommand(`set_active:${arg}`);
      } else if (verb === 'reboot') {
        next('Rebooting');
        // The phone may drop USB before it answers; everything is already written.
        await fb.runCommand('reboot').catch(() => {});
      }
    }
    report(`Step ${total}/${total}: Done.`, 1);
  } finally {
    await Promise.all(cleanups.map(cleanup => cleanup()));
  }
}
