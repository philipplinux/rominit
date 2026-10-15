// POST /auth/logout: end this session.
import { cookie, setCookie, sha256hex } from '../_lib/auth.js';

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  const token = cookie(request, 'sid');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(await sha256hex(token)).run();
  return new Response(null, { status: 204, headers: { 'set-cookie': setCookie(request, 'sid', '', 0) } });
}
