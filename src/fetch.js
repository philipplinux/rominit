const MiB = 1024 * 1024;

/**
 * Downloads a pinned file from its first working mirror into a File, so it goes through the same name/size/SHA-256
 * checks as a picked one. Parts are folded into Blobs every 64 MiB so the browser can page them to disk.
 * @param {{name:string,size:number,urls:string[]}} pin @param {(fraction:number)=>void} progress @param {typeof fetch} get
 */
export async function fetchPinned(pin, progress = () => {}, get = fetch) {
  let response = null;
  for (const url of pin.urls) {
    response = await get(url).catch(() => null);
    if (response?.ok && response.body) break;
  }
  if (!response?.ok || !response.body) throw Error(`${pin.name} could not be downloaded (HTTP ${response?.status ?? 'error'}). Pick the file instead.`);
  const reader = response.body.getReader();
  /** @type {BlobPart[]} */ let parts = [];
  /** @type {Blob[]} */ const blobs = [];
  let got = 0, pending = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length; pending += value.length;
    if (got > pin.size) { await reader.cancel(); throw Error(`${pin.name} is larger than pinned.`); }
    if (pending >= 64 * MiB) { blobs.push(new Blob(parts)); parts = []; pending = 0; }
    progress(got / pin.size);
  }
  const file = new File([...blobs, new Blob(parts)], pin.name);
  if (file.size !== pin.size) throw Error(`${pin.name} download is ${file.size} bytes, pinned ${pin.size}.`);
  return file;
}
