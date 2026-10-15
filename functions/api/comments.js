// Comments per ROM: Cloudflare Pages Function with D1 binding `DB` and secret `SALT`. Posting needs a signed-in account.
// Plain text only (the page renders it with textContent), plus an optional WebP screenshot the browser
// re-encoded (strips EXIF). Screenshots stay hidden until an owner, moderator or admin of the ROM approves them
// on the page (or: UPDATE comment_images SET approved = 1 WHERE comment_id = <id>).
import { json, voterOf } from '../_lib/api.js';
import { roleOver, romInfo, userOf } from '../_lib/auth.js';

/**
 * Newest 100 comments of one ROM, each with the author's role over it. Hidden ones only reach people who can moderate.
 * @param {{request:Request, env:any}} context
 */
export async function onRequestGet({ request, env }) {
  const rom = await romInfo(env, request, new URL(request.url).searchParams.get('rom'));
  if (!rom) return json([]);
  const viewer = await userOf(env, request);
  const moderator = !!viewer && !!roleOver(viewer.roles, rom);
  const { results } = await env.DB.prepare(`SELECT c.id, c.name, c.text, c.at, c.user_id, c.hidden, u.provider, u.email,
    CASE WHEN i.comment_id IS NULL THEN NULL WHEN i.approved THEN 'approved' ELSE 'pending' END AS image FROM comments c
    LEFT JOIN users u ON u.id = c.user_id LEFT JOIN comment_images i ON i.comment_id = c.id
    WHERE c.rom = ?1 AND (c.hidden = 0 OR ?2) ORDER BY c.id DESC LIMIT 100`).bind(rom.key, moderator ? 1 : 0).all();
  const ids = [...new Set(results.map((/** @type {any} */ c) => c.user_id).filter(Boolean))];
  const roles = ids.length ? (await env.DB.prepare(`SELECT user_id, role, scope FROM roles WHERE user_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results : [];
  const admins = (env.ADMINS ?? '').split(',').map((/** @type {string} */ e) => e.trim().toLowerCase()).filter(Boolean);
  return json(results.map((/** @type {any} */ c) => ({ id: c.id, name: c.name, text: c.text, at: c.at, image: c.image, provider: c.provider ?? null,
    hidden: !!c.hidden, moderate: moderator, mine: !!viewer && viewer.id === c.user_id,
    role: c.email && admins.includes(c.email.toLowerCase()) ? 'admin' : roleOver(roles.filter((/** @type {any} */ r) => r.user_id === c.user_id), rom) })));
}

/**
 * Signed-in only. One comment per account per minute, 2000 characters max, optional WebP screenshot up to 400 KB (base64 `image`).
 * @param {{request:Request, env:any}} context
 */
export async function onRequestPost({ request, env }) {
  if (!env.SALT) return json({ error: 'comments not configured' }, 503);
  const user = await userOf(env, request);
  if (!user) return json({ error: 'sign in to comment' }, 401);
  const { rom, text, image } = await request.json().catch(() => ({}));
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body || body.length > 2000) return json({ error: 'comment needs 1-2000 characters' }, 400);
  /** @type {Uint8Array|null} */ let webp = null;
  if (image !== undefined && image !== null) {
    try { webp = Uint8Array.from(atob(image), c => c.charCodeAt(0)); } catch { webp = null; }
    const magic = webp && new TextDecoder().decode(webp.subarray(0, 4)) + new TextDecoder().decode(webp.subarray(8, 12));
    if (!webp || webp.length > 400_000 || magic !== 'RIFFWEBP') return json({ error: 'screenshot must be a WebP under 400 KB' }, 400);
  }
  if (!await romInfo(env, request, rom)) return json({ error: 'unknown rom' }, 404);
  const recent = await env.DB.prepare("SELECT 1 FROM comments WHERE user_id = ?1 AND at > datetime('now', '-1 minute')").bind(user.id).first();
  if (recent) return json({ error: 'one comment per minute' }, 429);
  const { meta } = await env.DB.prepare('INSERT INTO comments (rom, voter, name, text, user_id) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(rom, await voterOf(env, request), user.name, body, user.id).run();
  if (webp) await env.DB.prepare('INSERT INTO comment_images (comment_id, data) VALUES (?1, ?2)').bind(meta.last_row_id, webp).run();
  return json({ ok: true });
}
