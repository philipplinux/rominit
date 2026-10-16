// Downloads a pinned catalog file in the page, for hosts that allow it (CORS). Streams into 64 MiB Blob parts so the
// browser can page them to disk instead of holding a 1.4 GB image in RAM. Size is checked here, SHA-256 by the recipe.

const PART = 64 * 1024 * 1024;

/** @param {{name:string, size:number, url:string}} pin @param {(fraction:number)=>void} progress @param {typeof fetch} get */
export async function fetchPinned(pin, progress = () => {}, get = fetch) {
  const response = await get(pin.url);
  if (!response.ok || !response.body) throw Error(`${pin.name} could not be downloaded (HTTP ${response.status}). Use the download link and choose the file instead.`);
  const reader = response.body.getReader();
  /** @type {BlobPart[]} */ let parts = [];
  /** @type {Blob[]} */ const blobs = [];
  let got = 0, pending = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length; pending += value.length;
    if (got > pin.size) { await reader.cancel(); throw Error(`${pin.name} is larger than the catalog pins.`); }
    if (pending >= PART) { blobs.push(new Blob(parts)); parts = []; pending = 0; }
    progress(got / pin.size);
  }
  const file = new File([...blobs, new Blob(parts)], pin.name);
  if (file.size !== pin.size) throw Error(`${pin.name} download is ${file.size} bytes, the catalog pins ${pin.size}.`);
  return file;
}
