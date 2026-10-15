// "Something wrong on this page?" reports. Read them with:
//   npx wrangler d1 execute rominit --remote --command "SELECT id, page, text, at FROM reports ORDER BY id DESC LIMIT 50"
import { json, voterOf } from '../_lib/api.js';

/** One report per address per minute. @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  if (!env.SALT) return json({ error: 'reports not configured' }, 503);
  const { page, text } = await request.json().catch(() => ({}));
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body || body.length > 2000 || typeof page !== 'string' || page.length > 300) return json({ error: 'report needs 1-2000 characters' }, 400);
  const voter = await voterOf(env, request);
  if (await env.DB.prepare("SELECT 1 FROM reports WHERE voter = ?1 AND at > datetime('now', '-1 minute')").bind(voter).first()) return json({ error: 'one report per minute' }, 429);
  await env.DB.prepare('INSERT INTO reports (page, voter, text) VALUES (?1, ?2, ?3)').bind(page, voter, body).run();
  return json({ ok: true });
}
