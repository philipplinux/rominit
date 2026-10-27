import { createSHA256, createSHA512 } from 'hash-wasm';

/** The algorithms a pin may use; the label is what a mismatch message says. */
const DIGESTS = { sha256: { create: createSHA256, label: 'SHA-256' }, sha512: { create: createSHA512, label: 'SHA-512' } };
/** Streaming digest in 4 MiB chunks, so large images never load into RAM at once. The pin decides the algorithm.
 * @param {Blob} file @param {(fraction: number) => void} [progress] @param {'sha256'|'sha512'} [algorithm] */
export async function checksum(file, progress = () => {}, algorithm = 'sha256') {
  const hasher = await DIGESTS[algorithm].create();
  hasher.init();
  for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
    const chunk = new Uint8Array(await file.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer());
    hasher.update(chunk);
    progress(Math.min(1, (offset + chunk.length) / file.size));
  }
  return hasher.digest('hex');
}

/** Pre-flight for every recipe: hashes each pinned file and stops on a mismatch before anything is written.
 * An empty pin = the user skipped verification for a newer file; hashed only with `all` (for a read-back).
 * `accept` (from selectFiles) lists every hash allowed for this file, else just the pin.
 * @param {{name:string,sha256?:string,sha512?:string,accept?:string[],file:Blob}[]} files @param {(message:string,fraction:number)=>void} report
 * @returns {Promise<Record<string,string>>} the computed sums by file name */
export async function verifyPins(files, report, all = false) {
  const sums = /** @type {Record<string, string>} */ ({});
  for (const file of files.filter(f => all || f.sha256 || f.sha512)) {
    const algorithm = file.sha512 && !file.sha256 ? 'sha512' : 'sha256';
    const expected = file[algorithm];
    const label = `Checking ${DIGESTS[algorithm].label}: ${file.name}`;
    report(label, 0);
    sums[file.name] = await checksum(file.file, fraction => report(label, fraction), algorithm);
    if (expected && !(file.accept ?? [expected]).includes(sums[file.name])) throw Error(`${DIGESTS[algorithm].label} mismatch: ${file.name}. Nothing written.`);
  }
  return sums;
}
