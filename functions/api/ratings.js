// User star ratings: Cloudflare Pages Function with D1 binding `DB` and secret `SALT`.
// Only small JSON passes through here; firmware never does.

/** @param {any} body @param {number} status */
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Average stars and vote count per ROM, keyed `<codename>/<rom id>`. @param {{env:any}} context */
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT rom, ROUND(AVG(stars), 1) AS stars, COUNT(*) AS votes FROM ratings GROUP BY rom').all();
  return Response.json(Object.fromEntries(results.map((/** @type {any} */ r) => [r.rom, { stars: r.stars, votes: r.votes }])),
    { headers: { 'cache-control': 'public, max-age=60' } });
}

/**
 * One vote per address per ROM; voting again replaces the old vote. Only a salted hash of the address is stored.
 * ponytail: address-based dedupe only; add Turnstile if spam shows up.
 * @param {{request:Request, env:any}} context
 */
export async function onRequestPost({ request, env }) {
  if (!env.SALT) return json({ error: 'ratings not configured' }, 503);
  const { rom, stars } = await request.json().catch(() => ({}));
  if (typeof rom !== 'string' || !Number.isInteger(stars) || stars < 1 || stars > 5) return json({ error: 'need rom and stars 1-5' }, 400);
  const index = await (await env.ASSETS.fetch(new URL('/catalog/index.json', request.url))).json();
  if (!index.some((/** @type {any} */ d) => d.roms.some((/** @type {any} */ r) => `${d.codename}/${r.id}` === rom))) return json({ error: 'unknown rom' }, 404);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.SALT}|${request.headers.get('cf-connecting-ip') ?? ''}`));
  const voter = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO ratings (rom, voter, stars) VALUES (?1, ?2, ?3) ON CONFLICT (rom, voter) DO UPDATE SET stars = ?3, at = CURRENT_TIMESTAMP')
    .bind(rom, voter, stars).run();
  return json({ ok: true });
}
