// Comments per ROM: Cloudflare Pages Function with D1 binding `DB` and secret `SALT`.
// Plain text only (the page renders it with textContent), plus an optional WebP screenshot the browser
// re-encoded (strips EXIF). Remove one with:
//   npx wrangler d1 execute rominit --remote --command "DELETE FROM comment_images WHERE comment_id = <id>; DELETE FROM comments WHERE id = <id>"
import { json, knownRom, voterOf } from '../_lib/api.js';

/** Newest 100 comments of one ROM. @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  const rom = new URL(request.url).searchParams.get('rom') ?? '';
  const { results } = await env.DB.prepare(`SELECT c.id, c.name, c.text, c.at, i.comment_id IS NOT NULL AS image FROM comments c
    LEFT JOIN comment_images i ON i.comment_id = c.id WHERE c.rom = ?1 ORDER BY c.id DESC LIMIT 100`).bind(rom).all();
  return json(results);
}

/**
 * One comment per address per minute, 2000 characters max, optional WebP screenshot up to 400 KB (base64 `image`).
 * ponytail: address rate limit only; add Turnstile if spam shows up.
 * @param {{request:Request, env:any}} context
 */
export async function onRequestPost({ request, env }) {
  if (!env.SALT) return json({ error: 'comments not configured' }, 503);
  const { rom, name, text, image } = await request.json().catch(() => ({}));
  const body = typeof text === 'string' ? text.trim() : '';
  const author = (typeof name === 'string' ? name.trim() : '').slice(0, 40) || 'anonymous';
  if (!body || body.length > 2000) return json({ error: 'comment needs 1-2000 characters' }, 400);
  /** @type {Uint8Array|null} */ let webp = null;
  if (image !== undefined && image !== null) {
    try { webp = Uint8Array.from(atob(image), c => c.charCodeAt(0)); } catch { webp = null; }
    const magic = webp && new TextDecoder().decode(webp.subarray(0, 4)) + new TextDecoder().decode(webp.subarray(8, 12));
    if (!webp || webp.length > 400_000 || magic !== 'RIFFWEBP') return json({ error: 'screenshot must be a WebP under 400 KB' }, 400);
  }
  if (!await knownRom(env, request, rom)) return json({ error: 'unknown rom' }, 404);
  const voter = await voterOf(env, request);
  const recent = await env.DB.prepare("SELECT 1 FROM comments WHERE voter = ?1 AND at > datetime('now', '-1 minute')").bind(voter).first();
  if (recent) return json({ error: 'one comment per minute' }, 429);
  const { meta } = await env.DB.prepare('INSERT INTO comments (rom, voter, name, text) VALUES (?1, ?2, ?3, ?4)').bind(rom, voter, author, body).run();
  if (webp) await env.DB.prepare('INSERT INTO comment_images (comment_id, data) VALUES (?1, ?2)').bind(meta.last_row_id, webp).run();
  return json({ ok: true });
}
