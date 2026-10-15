// The phone side of a test run, by its code: GET serves the probe script for the run's ROM, POST stores what it printed.
//   curl -fsSL https://rominit.pages.dev/b/<code> | sh | curl -fsS --data-binary @- https://rominit.pages.dev/b/<code>
import { romInfo } from '../_lib/auth.js';

const text = (/** @type {string} */ body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
/** Open run (under an hour old, not submitted) or null. @param {any} env @param {string} code */
const open = (env, code) => /^[a-z2-9]{8}$/.test(code)
  ? env.DB.prepare("SELECT rom FROM bench_runs WHERE code = ?1 AND submitted IS NULL AND created > datetime('now', '-1 hour')").bind(code).first() : null;

/** @param {{request:Request, env:any, params:{code:string}}} context */
export async function onRequestGet({ request, env, params }) {
  const run = await open(env, params.code);
  if (!run) return text('echo "ROMinit: this test code is unknown or expired. Start a new test on the page." >&2; exit 1\n', 404);
  const rom = await romInfo(env, request, run.rom);
  const family = rom?.os === 'postmarketOS' ? 'linux' : 'android';
  return text(await (await env.ASSETS.fetch(new URL(`/bench/${family}.sh`, request.url))).text());
}

/** @param {{request:Request, env:any, params:{code:string}}} context */
export async function onRequestPost({ request, env, params }) {
  if (!await open(env, params.code)) return text('ROMinit: this test code is unknown or expired.\n', 404);
  const output = (await request.text()).slice(0, 131072);
  if (!/^@ script /m.test(output)) return text('ROMinit: that does not look like test output; nothing saved.\n', 400);
  await env.DB.prepare('UPDATE bench_runs SET output = ?2 WHERE code = ?1').bind(params.code, output).run();
  return text('ROMinit: results received. Back to the browser.\n');
}
