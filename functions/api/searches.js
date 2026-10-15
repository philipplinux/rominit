// Device searches, to see which phones people look for and we lack. POST {q, hits} from the device list (debounced);
// GET (admins): searches ranked by how many different addresses tried them in the last 90 days, misses first.
import { json, voterOf } from '../_lib/api.js';
import { userOf } from '../_lib/auth.js';

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  if (!env.SALT) return json({ error: 'not configured' }, 503);
  const { q, hits } = await request.json().catch(() => ({}));
  const text = typeof q === 'string' ? q.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  if (text.length < 2 || text.length > 60 || !Number.isInteger(hits) || hits < 0) return json({ error: 'bad search' }, 400);
  const voter = await voterOf(env, request);
  // one row per address per search text per day
  if (!await env.DB.prepare("SELECT 1 FROM searches WHERE q = ?1 AND voter = ?2 AND at > datetime('now', '-1 day')").bind(text, voter).first())
    await env.DB.prepare('INSERT INTO searches (q, hits, voter) VALUES (?1, ?2, ?3)').bind(text, hits, voter).run();
  return json({ ok: true });
}

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  if (!(await userOf(env, request))?.roles.some(r => r.role === 'admin')) return json({ error: 'admins only' }, 403);
  const { results } = await env.DB.prepare(`SELECT q, MIN(hits) AS hits, COUNT(DISTINCT voter) AS people, MAX(at) AS last FROM searches
    WHERE at > datetime('now', '-90 days') GROUP BY q ORDER BY hits > 0, people DESC, last DESC LIMIT 200`).all();
  return json(results);
}
