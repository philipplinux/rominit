import { FastbootDevice } from 'android-fastboot/dist/fastboot.mjs';
import libmjolnir from '@lineageos-infra/libmjolnir';
import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';

/** Samsung Download Mode: pick the phone and do the Odin handshake. */
export async function connectOdin() {
  const odin = await libmjolnir.requestDevice({ timeout: 10000 });
  await odin.initialize();
  return odin;
}

/** ADB (TWRP or Android): pick the phone and authenticate (accept the prompt on the phone if shown). */
export async function connectAdb() {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!manager) throw Error('WebUSB is not available in this browser.');
  const device = await manager.requestDevice();
  if (!device) throw Error('No device selected.');
  return openAdb(device);
}

/** @param {import('@yume-chan/adb-daemon-webusb').AdbDaemonWebUsbDevice} device */
async function openAdb(device) {
  const connection = await device.connect();
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial, connection, credentialStore: new AdbWebCredentialStore('ROMinit') });
  return { adb: new Adb(transport), usb: device.raw };
}

/**
 * Next move to bring an ADB phone into the state a recipe needs: TWRP's normal ADB (`recovery`) or ADB sideload.
 * @param {string|undefined} state banner state @param {'recovery'|'sideload'} want
 * @returns {{done:true}|{send:string, wait:string, seconds:number, say:string}|{error:string}}
 */
export function adbMove(state, want) {
  if (state === want) return { done: true };
  if (state === 'device') return { send: 'reboot:recovery', wait: 'recovery', seconds: 120, say: 'Android: rebooting into TWRP' };
  if (state === 'recovery' && want === 'sideload') return { send: 'shell:twrp sideload', wait: 'sideload', seconds: 45, say: 'TWRP: starting ADB Sideload' };
  if (state === 'sideload') return { error: "Phone is in ADB sideload, but this step needs TWRP's normal ADB. Tap Cancel in TWRP, then connect again." };
  return { error: `Phone is in ${state ?? 'an unknown'} mode. Boot TWRP first.` };
}

/** Connects over ADB and moves the phone into `want` itself (Android → TWRP → sideload), reconnecting to the
 * same serial each time (same browser permission, no second picker). @param {'recovery'|'sideload'} want @param {(line:string)=>void} log */
async function connectAdbIn(want, log) {
  const state = (/** @type {Adb} */ adb) => /** @type {string|undefined} */ (adb.banner.state); // raw banner word; the lib's type lists fewer
  const manager = /** @type {NonNullable<typeof AdbDaemonWebUsbDeviceManager.BROWSER>} */ (AdbDaemonWebUsbDeviceManager.BROWSER);
  let current = await connectAdb();
  const serial = current.usb.serialNumber;
  for (let moves = 0; ; moves++) {
    log(`ADB banner: ${JSON.stringify(current.adb.banner)}`);
    const move = adbMove(state(current.adb), want);
    if ('done' in move) return current;
    if ('error' in move) throw Error(move.error);
    if (moves === 3) throw Error(`Phone did not reach ${want} mode. Boot TWRP by hand, then connect again.`);
    log(`${move.say} (${move.send})`);
    const socket = await current.adb.createSocket(move.send);
    const reader = socket.readable.getReader(); // let the phone take the command before the link drops
    await Promise.race([(async () => { while (!(await reader.read()).done); })().catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
    await current.adb.close().catch(() => {});
    let next = null;
    for (let i = 0; i < move.seconds && !next; i++) { // the phone re-enumerates with the same serial once adbd is back
      await new Promise(r => setTimeout(r, 1000));
      const device = (await manager.getDevices()).find(d => d.serial === serial);
      if (!device) continue;
      next = await openAdb(device).catch(e => (log(`Reconnect failed: ${e?.message ?? e}`), null));
      if (next && state(next.adb) !== move.wait) { log(`Phone back in ${state(next.adb)}, waiting for ${move.wait}`); await next.adb.close().catch(() => {}); next = null; }
    }
    if (!next) throw Error(want === 'sideload'
      ? 'Phone did not come back in ADB sideload mode. In TWRP: Advanced › ADB Sideload, swipe, then connect again.'
      : 'Phone did not come back in TWRP. Boot TWRP by hand, then connect again.');
    current = next;
  }
}

/**
 * Shell runner for the twrp-dd recipe. Needs the shell v2 protocol: the legacy shell may
 * mangle binary stdin, which would silently corrupt the written partition.
 * @param {Adb} adb @returns {import('../recipes/twrp-dd.js').Shell}
 */
export function adbShell(adb) {
  const shell = adb.subprocess.shellProtocol;
  if (!shell) throw Error('Phone ADB lacks shell protocol v2; refusing binary writes.');
  /** @param {{getReader():{read():Promise<{done:boolean,value?:Uint8Array}>}}} stream */
  async function text(stream) {
    const chunks = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }
    return chunks.join('');
  }
  return {
    async run(command) {
      const result = await shell.spawnWaitText(command);
      return { code: result.exitCode, out: result.stdout + result.stderr };
    },
    async pipe(command, file, progress) {
      const process = await shell.spawn(command);
      const output = Promise.all([text(process.stdout), text(process.stderr)]);
      const writer = process.stdin.getWriter();
      const chunk = 1024 * 1024;
      for (let offset = 0; offset < file.size; offset += chunk) {
        await writer.write(new Uint8Array(await file.slice(offset, offset + chunk).arrayBuffer()));
        progress(Math.min(1, (offset + chunk) / file.size));
      }
      await writer.close();
      const [stdout, stderr] = await output;
      return { code: await process.exited, out: stdout + stderr };
    }
  };
}

/** max-download-size as AOSP fastboot reads it: `0x` hex, else decimal; missing or bad = 512 MiB, capped at 1 GiB like the library.
 * @param {string|null} value */
export function downloadSize(value) {
  const n = Number(value?.trim());
  return Math.min(n > 0 ? n : 512 * 1024 * 1024, 1024 * 1024 * 1024);
}

/** @type {FastbootDevice|undefined} */
let fastboot;

/**
 * getvar with a 15 s timeout instead of the library's fixed 10 s: right after a 1.4 GB userdata write the Mi A3
 * bootloader answers slowly. The fastboot recipe retries a timed-out step twice. A retry never sends a new command
 * while the phone still owes the old answer: the abandoned USB read would take the next reply and every later command
 * would wait for nothing. It waits for that answer first (another 15 s each try). Same FAIL → null and trim as the library.
 * @param {(command:string)=>Promise<{text:string}>} run @param {number} ms
 */
export function patientGetvar(run, ms = 15000) {
  /** @type {Promise<unknown>|null} */
  let owed = null;
  const within = (/** @type {Promise<any>} */ promise) => {
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timeout of ${ms} ms exceeded`)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };
  return async (/** @type {string} */ name) => {
    if (owed) { await within(owed); owed = null; }
    const call = run(`getvar:${name}`);
    try {
      const { text } = await within(call);
      return text?.trim() || null;
    } catch (error) {
      if (/** @type {any} */ (error)?.status === 'FAIL') return null;
      if (/^Timeout of/.test(/** @type {any} */ (error)?.message)) owed = call.then(() => {}, () => {});
      throw error;
    }
  };
}

/** One USB connection per catalog protocol. `usb` is the raw device, watched for disconnects.
 * @param {string} protocol @param {(line:string)=>void} [log] connect steps and the phone's identity, for the debug log
 * @returns {Promise<{session:any, usb:USBDevice|undefined}>} */
export async function connect(protocol, log = () => {}) {
  const found = await open(protocol, log);
  const u = found.usb;
  log(`USB device: ${u?.manufacturerName ?? '?'} ${u?.productName ?? '?'} (${u?.vendorId?.toString(16).padStart(4, '0')}:${u?.productId?.toString(16).padStart(4, '0')}) serial ${u?.serialNumber ?? '?'}`);
  return found;
}

/** @param {string} protocol @param {(line:string)=>void} log @returns {Promise<{session:any, usb:USBDevice|undefined}>} */
async function open(protocol, log) {
  if (protocol === 'fastboot') {
    // One instance per page: each FastbootDevice keeps a USB "connect" listener that re-claims the phone on replug,
    // so a second instance (Retry connect) would find the interface taken.
    const fb = fastboot ??= new FastbootDevice();
    fb.getVariable = patientGetvar(command => fb.runCommand(command));
    // android-fastboot reads max-download-size as hex only; Qualcomm ABL (Mi A3) answers in decimal, so the
    // library over-reads it (capped at 1 GiB) and the phone refuses the split. Parse it like AOSP fastboot.
    fb._getDownloadSize = async () => downloadSize(await fb.getVariable('max-download-size').catch(() => null));
    await fb.connect();
    return { session: fb, usb: fb.device ?? undefined };
  }
  if (protocol === 'odin') {
    const odin = await connectOdin();
    return { session: odin, usb: odin.usbDevice };
  }
  if (protocol === 'sideload') return connectAdbIn('sideload', log).then(({ adb, usb }) => ({ session: adb, usb }));
  if (protocol === 'adb') {
    const { adb, usb } = await connectAdbIn('recovery', log);
    return { session: adbShell(adb), usb };
  }
  throw Error(`Unknown USB protocol ${protocol}.`);
}
