// GET /api/me: who is signed in (name, roles) and which logins exist. Never returns the email.
import { PROVIDERS, configured, userOf } from '../_lib/auth.js';
import { json } from '../_lib/api.js';

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  const user = await userOf(env, request);
  return json({ user: user && { id: user.id, name: user.name, provider: user.provider, roles: user.roles }, providers: Object.keys(PROVIDERS).filter(p => configured(env, p)) });
}
