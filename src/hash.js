import { createSHA256 } from 'hash-wasm';

/** Streaming SHA-256 in 4 MiB chunks, so large images never load into RAM at once.
 * @param {Blob} file @param {(fraction: number) => void} progress */
export async function checksum(file, progress = () => {}) {
  const hasher = await createSHA256();
  hasher.init();
  for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
    const chunk = new Uint8Array(await file.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer());
    hasher.update(chunk);
    progress(Math.min(1, (offset + chunk.length) / file.size));
  }
  return hasher.digest('hex');
}

/** Pre-flight for every recipe: hashes each pinned file and stops on a mismatch before anything is written.
 * sha256 '' = the user skipped verification for a newer file; hashed only with `all` (for a read-back).
 * `accept` (from selectFiles) lists every hash allowed for this file, else just sha256.
 * @param {{name:string,sha256:string,accept?:string[],file:Blob}[]} files @param {(message:string,fraction:number)=>void} report
 * @returns {Promise<Record<string,string>>} the computed sums by file name */
export async function verifyPins(files, report, all = false) {
  const sums = /** @type {Record<string, string>} */ ({});
  for (const file of files.filter(f => all || f.sha256)) {
    const label = `Checking SHA-256: ${file.name}`;
    report(label, 0);
    sums[file.name] = await checksum(file.file, fraction => report(label, fraction));
    if (file.sha256 && !(file.accept ?? [file.sha256]).includes(sums[file.name])) throw Error(`SHA-256 mismatch: ${file.name}. Nothing written.`);
  }
  return sums;
}
