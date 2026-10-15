// Favorites (♥, like a GitHub star) per signed-in user.
// GET ?rom=<codename>/<rom id>: {count, mine}. GET: the signed-in user's favorites, newest first. POST {rom, on}: add or remove.
import { userOf } from '../_lib/auth.js';
import { json, knownRom } from '../_lib/api.js';

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  const user = await userOf(env, request), rom = new URL(request.url).searchParams.get('rom');
  if (rom) {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count, SUM(user_id = ?2) AS mine FROM favorites WHERE rom = ?1').bind(rom, user?.id ?? -1).first();
    return json({ count: row.count, mine: !!row.mine });
  }
  if (!user) return json({ error: 'sign in first' }, 401);
  const { results } = await env.DB.prepare('SELECT rom, at FROM favorites WHERE user_id = ?1 ORDER BY at DESC').bind(user.id).all();
  return json(results);
}

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  const user = await userOf(env, request);
  if (!user) return json({ error: 'sign in first' }, 401);
  const { rom, on } = await request.json().catch(() => ({}));
  if (!await knownRom(env, request, rom) || typeof on !== 'boolean') return json({ error: 'need a known rom and on: true/false' }, 400);
  await env.DB.prepare(on ? 'INSERT OR IGNORE INTO favorites (user_id, rom) VALUES (?1, ?2)' : 'DELETE FROM favorites WHERE user_id = ?1 AND rom = ?2').bind(user.id, rom).run();
  return json({ ok: true });
}
