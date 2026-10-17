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
}
