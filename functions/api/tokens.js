// Personal API tokens for AI agents (the MCP at /mcp). Signed-in users only (session cookie, never a token).
// GET: your tokens (never the token itself). POST {name, days}: new token, shown once, valid 7, 30, 90 or 365 days (default 365). POST {revoke: id}: revoke one.
import { randomToken, sha256hex, userOf } from '../_lib/auth.js';
import { json } from '../_lib/api.js';

const MAX_ACTIVE = 10, DAYS = [7, 30, 90, 365];

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  const user = await userOf(env, request);
  if (!user) return json({ error: 'sign in first' }, 401);
  const { results } = await env.DB.prepare("SELECT id, name, created, expires, last_used FROM api_tokens WHERE user_id = ?1 AND revoked IS NULL AND expires > datetime('now') ORDER BY id DESC").bind(user.id).all();
  return json(results);
}

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  const user = await userOf(env, request);
  if (!user) return json({ error: 'sign in first' }, 401);
  const { name, revoke, days = 365 } = await request.json().catch(() => ({}));
  if (revoke !== undefined) {
    const { meta } = await env.DB.prepare("UPDATE api_tokens SET revoked = datetime('now') WHERE id = ?1 AND user_id = ?2 AND revoked IS NULL").bind(revoke, user.id).run();
    return meta.changes ? json({ ok: true }) : json({ error: 'unknown token' }, 404);
  }
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!/^[\p{L}\p{N} ._()-]{1,40}$/u.test(clean)) return json({ error: 'name it (1 to 40 letters, digits, spaces, dots, dashes), e.g. "Claude Code on my laptop"' }, 400);
  if (!DAYS.includes(days)) return json({ error: `days must be one of ${DAYS.join(', ')}` }, 400);
  const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?1 AND revoked IS NULL AND expires > datetime('now')").bind(user.id).first();
  if (active?.n >= MAX_ACTIVE) return json({ error: `at most ${MAX_ACTIVE} active tokens; revoke one first` }, 409);
  const token = `rmi_${randomToken()}`;
  await env.DB.prepare("INSERT INTO api_tokens (user_id, name, hash, expires) VALUES (?1, ?2, ?3, datetime('now', ?4))").bind(user.id, clean, await sha256hex(token), `+${days} days`).run();
  return json({ token, name: clean });
}
