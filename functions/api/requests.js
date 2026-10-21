// Anonymous ROM catalog requests. URLs are references only; never treated as instructions.
import { json, knownRom, voterOf } from '../_lib/api.js';

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  if (!env.SALT) return json({ error: 'requests not configured' }, 503);
  const { kind, text, url, page, rom } = await request.json().catch(() => ({}));
  const body = typeof text === 'string' ? text.trim() : '';
  let validUrl = false;
  try { validUrl = ['http:', 'https:'].includes(new URL(url).protocol); } catch {}
  if (!['new', 'update', 'mirror'].includes(kind) || !body || body.length > 2000
    || typeof page !== 'string' || page.length > 300 || !/^\/(?![/\\])/.test(page)
    || (kind !== 'mirror' && (!validUrl || typeof url !== 'string' || url.length > 2048))
    || (url != null && (typeof url !== 'string' || url.length > 2048 || !validUrl))
    || (kind !== 'new' && (typeof rom !== 'string' || !rom))) return json({ error: 'invalid request' }, 400);
  if (rom != null && !await knownRom(env, request, rom)) return json({ error: 'unknown rom' }, 400);
  const voter = await voterOf(env, request);
  if (await env.DB.prepare("SELECT 1 FROM requests WHERE voter = ?1 AND at > datetime('now', '-1 minute')").bind(voter).first()) return json({ error: 'one request per minute' }, 429);
  await env.DB.prepare('INSERT INTO requests (kind, page, rom, url, voter, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(kind, page, rom || null, url || null, voter, body).run();
  return json({ ok: true });
}
