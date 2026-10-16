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

/** TWRP ADB sideload. Connecting in TWRP's normal ADB works too: it sends `twrp sideload` and reconnects
 * once the phone is back in sideload mode (same browser permission, no second picker). */
async function connectSideload(log = (/** @type {string} */ _) => {}) {
  const state = (/** @type {Adb} */ adb) => /** @type {string|undefined} */ (adb.banner.state); // raw banner word; the lib's type lists fewer
  const first = await connectAdb();
  log(`ADB banner: ${JSON.stringify(first.adb.banner)}`);
  if (state(first.adb) === 'sideload') return first;
  if (state(first.adb) !== 'recovery') throw Error(`Phone is in ${state(first.adb) ?? 'an unknown'} mode. Boot TWRP first.`);
  log('Sending "twrp sideload" to start ADB Sideload');
  const socket = await first.adb.createSocket('shell:twrp sideload');
  const reader = socket.readable.getReader(); // let TWRP take the command before the link drops
  await Promise.race([(async () => { while (!(await reader.read()).done); })().catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
  await first.adb.close().catch(() => {});
  const manager = /** @type {NonNullable<typeof AdbDaemonWebUsbDeviceManager.BROWSER>} */ (AdbDaemonWebUsbDeviceManager.BROWSER);
  for (let i = 0; i < 45; i++) { // adbd restarts as minadbd; the phone re-enumerates within a few seconds
    await new Promise(r => setTimeout(r, 1000));
    const device = (await manager.getDevices()).find(d => d.serial === first.usb.serialNumber);
    if (!device) continue;
    const next = await openAdb(device).catch(e => (log(`Reconnect failed: ${e?.message ?? e}`), null));
    log(`Phone back, state ${next && state(next.adb)}`);
    if (next && state(next.adb) === 'sideload') return next;
    await next?.adb.close().catch(() => {});
  }
  throw Error('Phone did not come back in ADB sideload mode. In TWRP: Advanced › ADB Sideload, swipe, then reload and connect again.');
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
    const fb = new FastbootDevice();
    await fb.connect();
    return { session: fb, usb: fb.device ?? undefined };
  }
  if (protocol === 'odin') {
    const odin = await connectOdin();
    return { session: odin, usb: odin.usbDevice };
  }
  if (protocol === 'sideload') return connectSideload(log).then(({ adb, usb }) => ({ session: adb, usb }));
  if (protocol === 'adb') {
    const { adb, usb } = await connectAdb();
    log(`ADB banner: ${JSON.stringify(adb.banner)}`);
    return { session: adbShell(adb), usb };
  }
  throw Error(`Unknown USB protocol ${protocol}.`);
}
