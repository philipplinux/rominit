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
  const connection = await device.connect();
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial, connection, credentialStore: new AdbWebCredentialStore('ROMinit') });
  return { adb: new Adb(transport), usb: device.raw };
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
 * @param {string} protocol @returns {Promise<{session:any, usb:USBDevice|undefined}>} */
export async function connect(protocol) {
  if (protocol === 'fastboot') {
    const fb = new FastbootDevice();
    await fb.connect();
    return { session: fb, usb: fb.device ?? undefined };
  }
  if (protocol === 'odin') {
    const odin = await connectOdin();
    return { session: odin, usb: odin.usbDevice };
  }
  if (protocol === 'adb') {
    const { adb, usb } = await connectAdb();
    return { session: adbShell(adb), usb };
  }
  throw Error(`Unknown USB protocol ${protocol}.`);
}
