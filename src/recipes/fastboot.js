import { verifyPins } from '../hash.js';

export const protocol = 'fastboot';
/** `unlock` / `lock` take the command family, `flashing` (newer bootloaders) or `oem` (older): `fastboot flashing unlock`. */
export const verbs = { flash: 2, erase: 1, set_active: 1, reboot: 0, unlock: 1, lock: 1 };
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
 * `job.progress.done` counts finished write steps; a retry with the same object re-checks everything, then skips those.
 * `job.pauseMs` (default 1 s) lets the bootloader settle between write steps.
 * @param {{device:any, files:{name:string,sha256:string,file:Blob}[], steps:any[][], progress?:{done:number}, pauseMs?:number}} job
 * @param {(message:string,fraction:number)=>void} report @param {()=>void} assertSession
 */
export async function run(fb, { device, files, steps, progress = { done: 0 }, pauseMs = 1000 }, report, assertSession) {
  const total = 4 + files.filter(f => f.name.endsWith('.img.xz')).length + steps.length;
  let step = 0;
  const say = (text, fraction = 0) => report(`Step ${step}/${total}: ${text}`, fraction);
  const next = text => { step += 1; assertSession(); say(text); };
  const byName = Object.fromEntries(files.map(f => [f.name, f]));
  /** Re-run a step up to twice when the phone only stopped answering (timeout) and USB is still attached. Safe: each
   * step rewrites its whole partition, or is an erase / set_active, so repeating gives the same result.
   * @param {string} text @param {()=>Promise<unknown>} action */
  const attempt = async (text, action) => {
    for (let tries = 1; ; tries += 1) {
      try { return await action(); } catch (error) {
        if (tries > 2 || !/Timeout of \d+ ms exceeded/.test(String(/** @type {any} */ (error)?.message ?? error))) throw error;
        assertSession();
        say(`${text}: phone did not answer, retrying (${tries}/2)`);
      }
    }
  };

  next('Checking the phone model');
  const product = await fb.getVariable('product');
  const expected = device.detect?.fastboot?.product;
  if (!expected || product !== expected) throw Error(`Phone reports product "${product}", expected ${expected} (${device.name}). Nothing written.`);
  next('Checking the bootloader is unlocked');
  const unlocked = await fb.getVariable('unlocked') === 'yes';
  // An unlock stage is that one step (the validator says so); every other stage needs an unlocked bootloader.
  if (steps.some(([verb]) => verb === 'unlock')) {
    if (steps.length !== 1) throw Error('An unlock stage is the unlock step alone. Nothing written.');
    if (unlocked) { report(`Step ${total}/${total}: Bootloader is already unlocked. Nothing to do.`, 1); return { nothing: true }; }
    // `flashing get_unlock_ability` answers `get_unlock_ability: 0` while OEM unlocking is off in Developer options.
    // Older bootloaders reject the command; then the phone itself is the check.
    if (steps[0][1] === 'flashing') {
      const ability = await fb.runCommand('flashing get_unlock_ability').then((/** @type {{text: string}} */ r) => /get_unlock_ability:\s*(\d)/.exec(r.text)?.[1], () => undefined);
      if (ability === '0') throw Error('OEM unlocking is off. Turn it on in Android: Settings → Developer options → OEM unlocking, then try again. Nothing written.');
    }
  } else if (!unlocked) throw Error('Bootloader is locked. Nothing written.');

  next('Checking SHA-256');
  await verifyPins(files, say); // unpacked archive members carry no pin: the archive's hash covers them

  // Check every target before decoding or writing; decoded XZ output is capped at its target size.
  next('Checking the partitions');
  const limits = new Map();
  const partitionSizes = new Map();
  for (const [verb, partition, name] of steps) {
    if (verb === 'set_active' && !['a', 'b'].includes(partition)) throw Error(`Invalid slot ${partition}. Nothing written.`);
    if ((verb === 'unlock' || verb === 'lock') && !['flashing', 'oem'].includes(partition)) throw Error(`Invalid ${verb} command ${partition}. Nothing written.`);
    if (verb !== 'flash' && verb !== 'erase') continue;
    const size = parseInt(await fb.getVariable(`partition-size:${partition}`) ?? '', 16);
    if (!(size > 0)) throw Error(`Phone has no ${partition} partition. Nothing written.`);
    partitionSizes.set(partition, size);
    // flashBlob() would resize a logical partition; logical (super) layouts need their own steps.
    if (await fb.getVariable(`is-logical:${partition}`) === 'yes') throw Error(`${partition} is a logical partition. Nothing written.`);
    if (verb === 'flash') {
      if (name.endsWith('.img.xz')) limits.set(name, Math.max(limits.get(name) ?? 0, size));
    }
  }
  for (const file of files.filter(f => f.name.endsWith('.img.xz'))) {
    if (!limits.has(file.name)) throw Error(`${file.name} has no flash target. Nothing written.`);
  }

  // Verify pins against the downloaded .xz bytes above; all later size checks and flashes use decoded bytes.
  const cleanups = [];
  try {
    for (const file of files.filter(f => f.name.endsWith('.img.xz'))) {
      next(`Decoding ${file.name}`);
      try {
        const { decodeXzToOPFS } = await import('./fastboot-tgz.js');
        const decoded = await decodeXzToOPFS(file.file, limits.get(file.name));
        byName[file.name] = { ...file, file: decoded.file };
        cleanups.push(decoded.cleanup);
      } catch (error) { throw Error(`Could not decode ${file.name}: ${error.message}. Nothing written.`); }
    }
    for (const [verb, partition, name] of steps) {
      if (verb === 'flash' && await expandedSize(byName[name].file) > partitionSizes.get(partition)) throw Error(`${name} is larger than ${partition}. Nothing written.`);
    }

    for (const [index, [verb, arg, name]] of steps.entries()) {
      if (index < progress.done) { step += 1; say(`already done, skipped`); continue; }
      if (index > 0) await new Promise(ok => setTimeout(ok, pauseMs));
      if (verb === 'flash') {
        const text = `Writing ${name} → ${arg}`;
        next(text);
        await attempt(text, () => fb.flashBlob(arg, byName[name].file, fraction => say(text, fraction)));
      } else if (verb === 'erase') {
        next(`Erasing ${arg}`);
        await attempt(`Erasing ${arg}`, () => fb.runCommand(`erase:${arg}`));
      } else if (verb === 'set_active') {
        next(`Switching to slot ${arg}`);
        await attempt(`Switching to slot ${arg}`, () => fb.runCommand(`set_active:${arg}`));
      } else if (verb === 'unlock' || verb === 'lock') {
        // The phone asks on its own screen; confirming there wipes it (and on most phones restarts it).
        next(`${verb === 'unlock' ? 'Unlocking' : 'Locking'} the bootloader: confirm on the phone with the volume keys, then Power`);
        await fb.runCommand(`${arg} ${verb}`);
      } else if (verb === 'reboot') {
        next('Rebooting');
        // The phone may drop USB before it answers; everything is already written.
        await fb.runCommand('reboot').catch(() => {});
      }
      progress.done = index + 1;
    }
    report(`Step ${total}/${total}: Done.`, 1);
  } finally {
    await Promise.all(cleanups.map(cleanup => cleanup()));
  }
}
