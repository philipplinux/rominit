import { checksum } from '../hash.js';

// Flashable zip (LineageOS and friends) through TWRP's ADB Sideload: the phone asks for numbered blocks, we send them.
export const protocol = 'sideload';
export const verbs = { sideload: 1 };
export const fileArg = { sideload: 0 };
const BLOCK = 64 * 1024;

/** @typedef {{banner:{device?:string,state?:string}, createSocket(service:string):Promise<{readable:ReadableStream<Uint8Array>, writable:WritableStream<Uint8Array>, close():any}>}} Sideload */

/**
 * Serves one zip over `sideload-host`: the phone sends 8 ASCII digits per wanted block and DONEDONE (or FAILFAIL) at the end.
 * The zip's own updater script checks the device again before it writes anything.
 * @param {Sideload} adb @param {{name:string,sha256:string,file:Blob}} zip @param {(fraction:number)=>void} progress
 */
export async function serve(adb, zip, progress) {
  const socket = await adb.createSocket(`sideload-host:${zip.file.size}:${BLOCK}`).catch(e => {
    throw Error(`Phone refused the sideload (${e.message}): start it in TWRP (Advanced › ADB Sideload, swipe), then connect again. Nothing written.`);
  });
  const reader = socket.readable.getReader(), writer = socket.writable.getWriter();
  const blocks = Math.ceil(zip.file.size / BLOCK);
  let buffer = '', sent = 0;
  try {
    for (;;) {
      while (buffer.length < 8) {
        const { done, value } = await reader.read();
        if (done) throw Error('Phone closed the sideload before finishing.');
        buffer += new TextDecoder().decode(value);
      }
      const ask = buffer.slice(0, 8); buffer = buffer.slice(8);
      if (ask === 'DONEDONE') return;
      if (ask === 'FAILFAIL') throw Error('TWRP reports the install failed; see the phone screen.');
      const block = Number(ask);
      if (!/^\d{8}$/.test(ask) || block >= blocks) throw Error(`Phone asked for block "${ask}" outside the zip.`);
      await writer.write(new Uint8Array(await zip.file.slice(block * BLOCK, (block + 1) * BLOCK).arrayBuffer()));
      progress(Math.min(1, ++sent / blocks)); // TWRP reads some blocks twice, so this can reach 100% before the end
    }
  } finally {
    await socket.close();
  }
}

/**
 * @param {Sideload} adb
 * @param {{device:any, files:{name:string,sha256:string,file:Blob}[], steps:any[][]}} job
 * @param {(message:string,fraction:number)=>void} report @param {()=>void} assertSession
 */
export async function run(adb, { device, files, steps }, report, assertSession) {
  const expected = device.detect?.adb?.device;
  if (adb.banner.device && !adb.banner.device.startsWith(expected)) // TWRP may report hero2ltexx for hero2lte
    throw Error(`Expected ${expected}; phone reports ${adb.banner.device}. Nothing written.`);
  // Normal TWRP/Android ADB has no sideload-host service; it answers the socket with a bare "Socket open failed".
  if (adb.banner.state && adb.banner.state !== 'sideload')
    throw Error(`Phone is in ${adb.banner.state} mode, not ADB sideload. In TWRP: Advanced › ADB Sideload, swipe, then connect again. Nothing written.`);
  const byName = Object.fromEntries(files.map(f => [f.name, f]));
  for (const file of files.filter(f => f.sha256)) { // '' = the user skipped verification for a newer file
    const digest = await checksum(file.file, fraction => report(`Checking SHA-256: ${file.name}`, fraction));
    if (digest !== file.sha256) throw Error(`SHA-256 mismatch: ${file.name}. Nothing written.`);
  }
  for (const [, name] of steps) {
    assertSession();
    report(`Sideloading ${name}`, 0);
    await serve(adb, byName[name], fraction => report(`Sideloading ${name}`, fraction));
  }
  report('Installed. TWRP shows the result on the phone.', 1);
}
