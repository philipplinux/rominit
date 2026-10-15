// GET /api/owners?rom=<codename>/<rom id>: names of the people who own (maintain) this ROM, directly or through its OS, vendor or device.
import { covers, romInfo } from '../_lib/auth.js';
import { json } from '../_lib/api.js';

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  const rom = await romInfo(env, request, new URL(request.url).searchParams.get('rom'));
  if (!rom) return json({ error: 'unknown rom' }, 404);
  const { results } = await env.DB.prepare("SELECT u.name, u.provider, r.scope FROM roles r JOIN users u ON u.id = r.user_id WHERE r.role = 'owner'").all();
  return json(results.filter((/** @type {any} */ r) => covers(r.scope, rom)).map((/** @type {any} */ r) => ({ name: r.name, provider: r.provider, scope: r.scope })));
}
