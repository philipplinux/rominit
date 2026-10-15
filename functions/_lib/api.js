// Shared by the API routes: JSON replies, ROM check, salted address hash.

/** @param {any} body @param {number} status */
export const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** True when `<codename>/<rom id>` is in the deployed catalog. @param {any} env @param {Request} request @param {unknown} rom */
export async function knownRom(env, request, rom) {
  if (typeof rom !== 'string') return false;
  const index = await (await env.ASSETS.fetch(new URL('/catalog/index.json', request.url))).json();
  return index.some((/** @type {any} */ d) => d.roms.some((/** @type {any} */ r) => `${d.codename}/${r.id}` === rom));
}

/** SHA-256 of SALT + client address; the address itself is never stored. @param {any} env @param {Request} request */
export async function voterOf(env, request) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.SALT}|${request.headers.get('cf-connecting-ip') ?? ''}`));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
