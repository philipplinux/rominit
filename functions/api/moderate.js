// POST /api/moderate {comment, action: hide | show | approve}: owners, moderators and admins, within their scope only.
import { roleOver, romInfo, userOf } from '../_lib/auth.js';
import { json } from '../_lib/api.js';

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  const user = await userOf(env, request);
  if (!user) return json({ error: 'sign in first' }, 401);
  const { comment, action } = await request.json().catch(() => ({}));
  const row = Number.isSafeInteger(comment) ? await env.DB.prepare('SELECT rom FROM comments WHERE id = ?1').bind(comment).first() : null;
  if (!row) return json({ error: 'unknown comment' }, 404);
  const rom = await romInfo(env, request, row.rom);
  if (!rom || !roleOver(user.roles, rom)) return json({ error: 'not a moderator of this ROM' }, 403);
  const sql = { hide: 'UPDATE comments SET hidden = 1 WHERE id = ?1', show: 'UPDATE comments SET hidden = 0 WHERE id = ?1',
    approve: 'UPDATE comment_images SET approved = 1 WHERE comment_id = ?1' }[/** @type {string} */ (action)];
  if (!sql) return json({ error: 'action must be hide, show or approve' }, 400);
  await env.DB.prepare(sql).bind(comment).run();
  return json({ ok: true });
}
