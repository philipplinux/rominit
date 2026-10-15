// Serves a comment screenshot: GET /api/image?id=<comment id>. Always WebP, never sniffed or scripted.
// Approved ones go to everyone; pending ones only to an owner, moderator or admin of that ROM, for review.
import { roleOver, romInfo, userOf } from '../_lib/auth.js';

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  const row = Number.isSafeInteger(id) ? await env.DB.prepare('SELECT i.data, i.approved, c.rom FROM comment_images i JOIN comments c ON c.id = i.comment_id WHERE i.comment_id = ?1').bind(id).first() : null;
  if (!row) return new Response('not found', { status: 404 });
  if (!row.approved) {
    const user = await userOf(env, request), rom = await romInfo(env, request, row.rom);
    if (!user || !rom || !roleOver(user.roles, rom)) return new Response('not found', { status: 404 });
  }
  return new Response(new Uint8Array(row.data), { headers: { 'content-type': 'image/webp', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'", 'cache-control': row.approved ? 'public, max-age=86400' : 'private, no-store' } });
}
