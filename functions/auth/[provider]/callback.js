// GET /auth/<provider>/callback: check state, swap the code for a token, read the profile, start a session.
import { PROVIDERS, configured, cookie, randomToken, safeReturn, setCookie, sha256hex } from '../../_lib/auth.js';

/** id, display name and verified email from the provider. @param {string} name @param {string} token */
async function profile(name, token) {
  const headers = { authorization: `Bearer ${token}`, 'user-agent': 'rominit', accept: 'application/json' };
  if (name === 'google') {
    const p = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers })).json();
    return { subject: String(p.sub), name: p.name || p.email, email: p.email_verified ? p.email : null };
  }
  const p = await (await fetch('https://api.github.com/user', { headers })).json();
  const emails = await (await fetch('https://api.github.com/user/emails', { headers })).json().catch(() => []);
  return { subject: String(p.id), name: p.login, email: (Array.isArray(emails) ? emails : []).find(e => e.primary && e.verified)?.email ?? null };
}

/** @param {{request:Request, env:any, params:{provider:string}}} context */
export async function onRequestGet({ request, env, params }) {
  const name = params.provider, url = new URL(request.url);
  if (!configured(env, name)) return new Response('login not configured', { status: 404 });
  const [state, back] = decodeURIComponent(cookie(request, 'oauth')).split('|');
  if (!state || url.searchParams.get('state') !== state || !url.searchParams.get('code')) return new Response('login expired, try again', { status: 400 });
  const exchange = await fetch(PROVIDERS[name].token, { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams({
    client_id: env[`${name.toUpperCase()}_CLIENT_ID`], client_secret: env[`${name.toUpperCase()}_CLIENT_SECRET`], code: url.searchParams.get('code') ?? '',
    grant_type: 'authorization_code', redirect_uri: new URL(`/auth/${name}/callback`, request.url).href }) });
  const { access_token } = await exchange.json().catch(() => ({}));
  if (!access_token) return new Response('login failed at the provider', { status: 502 });
  const p = await profile(name, access_token);
  const user = await env.DB.prepare(`INSERT INTO users (provider, subject, name, email) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT (provider, subject) DO UPDATE SET name = excluded.name, email = excluded.email RETURNING id`).bind(name, p.subject, String(p.name).slice(0, 60), p.email).first();
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?1, ?2, datetime('now', '+30 days'))").bind(await sha256hex(token), user.id).run();
  const headers = new Headers({ location: safeReturn(back) });
  headers.append('set-cookie', setCookie(request, 'sid', token, 30 * 86400));
  headers.append('set-cookie', setCookie(request, 'oauth', '', 0, '/auth'));
  return new Response(null, { status: 302, headers });
}
