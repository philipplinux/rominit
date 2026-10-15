// GET /api/me: who is signed in (name, roles) and which logins exist. Never returns the email.
// POST /api/me {name}: pick the shown username (2-30 letters, digits, space . _ -; unique, case-insensitive).
import { PROVIDERS, configured, userOf } from '../_lib/auth.js';
import { json } from '../_lib/api.js';

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  const user = await userOf(env, request);
  return json({ user: user && { id: user.id, name: user.name, provider: user.provider, roles: user.roles }, providers: Object.keys(PROVIDERS).filter(p => configured(env, p)) });
}

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  const user = await userOf(env, request);
  if (!user) return json({ error: 'sign in first' }, 401);
  const { name } = await request.json().catch(() => ({}));
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!/^[\p{L}\p{N} ._-]{2,30}$/u.test(clean)) return json({ error: '2 to 30 letters, digits, spaces, dots, dashes or underscores' }, 400);
  // ponytail: check-then-write, two people racing for one name can both win; add a unique index if that ever matters
  if (await env.DB.prepare('SELECT 1 FROM users WHERE lower(name) = lower(?1) AND id != ?2').bind(clean, user.id).first()) return json({ error: 'that name is taken' }, 409);
  await env.DB.prepare('UPDATE users SET name = ?1, name_chosen = 1 WHERE id = ?2').bind(clean, user.id).run();
  return json({ name: clean });
}
