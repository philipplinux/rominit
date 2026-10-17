import { verifyPins } from '../hash.js';
import * as fastboot from './fastboot.js';

// Vendor fastboot package (.tgz, e.g. a Xiaomi stock ROM): one pinned archive; `flash` names an image inside it by file name.
export const protocol = 'fastboot';
export const verbs = fastboot.verbs;
export const archive = true;
const DIR = 'rominit-stock';
const XZ_DIR_AGE = 24 * 60 * 60 * 1000;

/** Streams XZ output to OPFS; without OPFS (Node) it falls back to an in-memory Blob. */
export async function decodeXzToOPFS(file, maxBytes) {
  if (!(maxBytes > 0)) throw Error('A target partition size is required to bound XZ output.');
  if (typeof self === 'undefined') globalThis.self = /** @type {Window & typeof globalThis} */ (globalThis);
  const { default: xz } = await import('xzwasm');
  const decoded = new xz.XzReadableStream(file.stream());
  let written = 0;
  const bounded = decoded.pipeThrough(new TransformStream({ transform(chunk, controller) {
    written += chunk.byteLength;
    if (written > maxBytes) throw Error(`Decoded XZ image exceeds target partition size (${maxBytes} bytes).`);
    controller.enqueue(chunk);
  } }));
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return { file: await new Response(bounded).blob(), cleanup: async () => {} };
  if (!navigator.storage?.getDirectory) throw Error('This browser cannot store decoded images on disk.');
  const root = await navigator.storage.getDirectory();
  for await (const [name] of /** @type {any} */ (root).entries()) {
    const created = /^rominit-xz-(\d+)-/.exec(name);
    if (created && Date.now() - Number(created[1]) > XZ_DIR_AGE) await root.removeEntry(name, { recursive: true }).catch(() => {});
  }
  const dirName = `rominit-xz-${Date.now()}-${crypto.randomUUID()}`;
  const dir = await root.getDirectoryHandle(dirName, { create: true });
  try {
    const handle = await dir.getFileHandle('image.img', { create: true });
    await bounded.pipeTo(await handle.createWritable());
    return { file: await handle.getFile(), cleanup: () => root.removeEntry(dirName, { recursive: true }).catch(() => {}) };
  } catch (error) {
    await root.removeEntry(dirName, { recursive: true }).catch(() => {});
    throw error;
  }
}

/** Reads a tar stream; calls `open(name, size)` per entry, which returns a writer or null to skip.
 * Handles ustar prefixes and GNU long names, which vendor archives use.
 * @param {ReadableStream<Uint8Array>} stream
 * @param {(name:string, size:number) => Promise<{write(chunk:Uint8Array):Promise<unknown>, close():Promise<unknown>}|null>} open */
export async function untar(stream, open) {
  const reader = stream.getReader();
  /** @type {Uint8Array} */ let buffer = new Uint8Array(0);
  /** Up to n bytes (at least one unless the stream ended); exact n when `exact` (headers). @param {number} n */
  const take = async (n, exact = true) => {
    while (buffer.length < n && (exact || !buffer.length)) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!buffer.length) { buffer = value; continue; }
      const joined = new Uint8Array(buffer.length + value.length);
      joined.set(buffer); joined.set(value, buffer.length); buffer = joined;
    }
    const out = buffer.subarray(0, n);
    buffer = buffer.subarray(out.length);
    return out;
  };
  const text = (/** @type {Uint8Array} */ bytes) => new TextDecoder().decode(bytes).replace(/\0.*$/s, '');
  let longName = '';
  for (;;) {
    const header = await take(512);
    if (header.length < 512 || header.every(b => b === 0)) break;
    const size = parseInt(text(header.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    const prefix = text(header.subarray(345, 500));
    const name = longName || (prefix ? `${prefix}/` : '') + text(header.subarray(0, 100));
    longName = '';
    const writer = type === 'L' ? null : ['0', '\0'].includes(type) ? await open(name, size) : null;
    const chunks = [];
    for (let left = size; left > 0;) {
      const chunk = (await take(left, false)).slice();
      if (!chunk.length) throw Error(`Archive ends inside ${name}.`);
      left -= chunk.length;
      if (type === 'L') chunks.push(chunk); else await writer?.write(chunk);
    }
    await writer?.close();
    if (type === 'L') longName = text(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    await take((512 - size % 512) % 512);
  }
}

/**
 * Checks the phone and the archive's SHA-256, unpacks the images the steps name into browser storage (OPFS, on disk),
 * then runs the steps like the fastboot recipe. The unpacked copies are deleted afterwards.
 * @param {fastboot.Fastboot} fb
 * @param {{device:any, stage:any, files:{name:string,sha256:string,file:Blob}[], steps:any[][]}} job
 * @param {(message:string,fraction:number)=>void} report @param {()=>void} assertSession
 */
export async function run(fb, { device, stage, files: [tgz], steps }, report, assertSession) {
  assertSession();
  const product = await fb.getVariable('product');
  if (product !== device.detect?.fastboot?.product) throw Error(`Phone reports product "${product}", expected ${device.detect?.fastboot?.product}. Nothing written.`);
  // Same guard as the vendor's flash_all.sh: never install a package older than the phone's anti-rollback level.
  const anti = Number(await fb.getVariable('anti') ?? 0) || 0;
  if (anti > stage.anti) throw Error(`Phone anti-rollback level ${anti} is newer than this package (${stage.anti}). Nothing written.`);
  await verifyPins([tgz], report);
  const wanted = new Set(steps.filter(([verb]) => verb === 'flash').map(([, , name]) => name));
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(DIR, { recursive: true }).catch(() => {});
  const dir = await root.getDirectoryHandle(DIR, { create: true });
  try {
    /** @type {Record<string, Blob>} */ const images = {};
    let done = 0;
    const counted = new TransformStream({ transform(chunk, out) { done += chunk.length; report(`Unpacking ${tgz.name}`, done / tgz.file.size); out.enqueue(chunk); } });
    await untar(tgz.file.stream().pipeThrough(counted).pipeThrough(new DecompressionStream('gzip')), async (path, size) => {
      const name = path.split('/').pop() ?? '';
      if (!wanted.has(name)) return null;
      if (name in images) throw Error(`${name} appears twice in the archive. Nothing written.`);
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      return { write: chunk => writable.write(/** @type {any} */ (chunk)), close: async () => { await writable.close(); images[name] = await handle.getFile(); if (images[name].size !== size) throw Error(`${name} unpacked short.`); } };
    });
    const missing = [...wanted].filter(name => !(name in images));
    if (missing.length) throw Error(`Not in the archive: ${missing.join(', ')}. Nothing written.`);
    // The archive's SHA-256 covers every image, so the unpacked copies carry no pin of their own.
    await fastboot.run(fb, { device, files: Object.entries(images).map(([name, file]) => ({ name, sha256: '', file })), steps }, report, assertSession);
  } finally {
    await root.removeEntry(DIR, { recursive: true }).catch(() => {});
  }
}
