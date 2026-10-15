// GET /auth/<google|github>/login?return=/path: off to the provider, with a one-time state cookie.
import { PROVIDERS, configured, randomToken, safeReturn, setCookie } from '../../_lib/auth.js';

/** @param {{request:Request, env:any, params:{provider:string}}} context */
export async function onRequestGet({ request, env, params }) {
  const name = params.provider;
  if (!configured(env, name)) return new Response('login not configured', { status: 404 });
  const state = randomToken(), back = safeReturn(new URL(request.url).searchParams.get('return'));
  const url = new URL(PROVIDERS[name].authorize);
  url.search = new URLSearchParams({ client_id: env[`${name.toUpperCase()}_CLIENT_ID`], redirect_uri: new URL(`/auth/${name}/callback`, request.url).href,
    response_type: 'code', scope: PROVIDERS[name].scope, state }).toString();
  return new Response(null, { status: 302, headers: { location: url.href, 'set-cookie': setCookie(request, 'oauth', encodeURIComponent(`${state}|${back}`), 600, '/auth') } });
}
