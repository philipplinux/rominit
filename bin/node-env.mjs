// Browser APIs the flashing libraries (android-fastboot, ya-webadb, libmjolnir) call, provided for Node.
// Adding a library to the CLI: its protocol goes into src/protocols/usb.js, its recipe into src/recipes/, and only the
// browser APIs it expects go here. Each shim fills a gap and never replaces what Node already has.
export function installBrowserShims() {
  // android-fastboot reads every image with FileReader.readAsArrayBuffer
  globalThis.FileReader ??= /** @type {any} */ (class {
    /** @param {Blob} blob */
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(result => { this.result = result; this.onload?.(); }, error => { this.error = error; this.onerror?.(); });
    }
  });
  // android-fastboot paces its progress callback with window.requestAnimationFrame
  const raf = (/** @type {(t:number)=>void} */ cb) => setTimeout(() => cb(performance.now()), 16);
  globalThis.requestAnimationFrame ??= /** @type {any} */ (raf);
  globalThis.window ??= /** @type {any} */ ({ requestAnimationFrame: raf });
  globalThis.USBConnectionEvent ??= /** @type {any} */ (class extends Event {
    /** @param {string} type @param {{device:USBDevice}} init */
    constructor(type, init) { super(type); this.device = init.device; }
  });
}

/** ADB auth key valid for this CLI process; TWRP may ask to authorize it again next run. */
export function ephemeralAdbCredentials() {
  const keys = [];
  return {
    async *iterateKeys() { yield* keys; },
    async generateKey() {
      const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' }, true, ['sign', 'verify']);
      const key = { buffer: new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey)), name: 'ROMinit@CLI' };
      keys.push(key);
      return key;
    }
  };
}
