// Phone test runs. GET ?device= lists accepted results. POST {rom} starts one ({code}); GET ?code= polls for the script output, and once sent returns the card and its review state; POST {code, final, note} submits the corrected card.
import { json, voterOf } from '../_lib/api.js';
import { romInfo, userOf } from '../_lib/auth.js';

export const TIERS = ['full', 'partial', 'broken', 'blocked', 'untested', 'n/a', 'inconclusive'];
const code = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  const device = new URL(request.url).searchParams.get('device'), mine = new URL(request.url).searchParams.get('mine');
  if (mine) { // the signed-in user's sent cards for one ROM, newest first; codes: null tells the page to use this browser's own list
    const user = await userOf(env, request);
    if (!user) return json({ codes: null });
    const { results } = await env.DB.prepare('SELECT code FROM bench_runs WHERE user_id = ?1 AND rom = ?2 AND submitted IS NOT NULL ORDER BY submitted DESC LIMIT 20').bind(user.id, mine).all();
    return json({ codes: results.map((/** @type {any} */ r) => r.code) });
  }
  if (device) { // accepted results per ROM of this device, newest wins: { "<codename>/<rom id>": { final, accepted } }
    const { results } = await env.DB.prepare("SELECT rom, final, accepted FROM bench_runs WHERE accepted IS NOT NULL AND rom LIKE ?1 || '/%' ORDER BY accepted").bind(device).all();
    return Response.json(Object.fromEntries(results.map((/** @type {any} */ r) => [r.rom, { final: JSON.parse(r.final), accepted: r.accepted }])), { headers: { 'cache-control': 'public, max-age=60' } });
  }
  // state as in the admin inbox: new · review · approved · rejected (not counted). The code is the sender's secret.
  const run = await env.DB.prepare(`SELECT b.output, b.submitted, b.final, b.flash,
      CASE WHEN b.accepted IS NOT NULL THEN 'approved' WHEN t.ref IS NOT NULL THEN 'rejected' WHEN b.review IS NOT NULL THEN 'review' ELSE 'new' END AS state
    FROM bench_runs b LEFT JOIN triage t ON t.inbox = 'benchmarks' AND t.ref = b.code WHERE b.code = ?1`).bind(new URL(request.url).searchParams.get('code') ?? '').first();
  if (!run) return json({ error: 'unknown code' }, 404);
  return json(run.submitted ? { output: run.output, submitted: true, at: run.submitted, final: JSON.parse(run.final), state: run.state, flash: run.flash } : { output: run.output, submitted: false });
}

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  if (!env.SALT) return json({ error: 'tests not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const voter = await voterOf(env, request);
  if (body.code === undefined) {
    if (!await romInfo(env, request, body.rom)) return json({ error: 'unknown rom' }, 404);
    const recent = await env.DB.prepare("SELECT count(*) AS n FROM bench_runs WHERE voter = ?1 AND created > datetime('now', '-1 hour')").bind(voter).first();
    if (recent.n >= 20) return json({ error: 'too many tests this hour' }, 429);
    const run = { code: code() };
    await env.DB.prepare('INSERT INTO bench_runs (code, rom, voter, user_id) VALUES (?1, ?2, ?3, ?4)').bind(run.code, body.rom, voter, (await userOf(env, request))?.id ?? null).run();
    return json(run);
  }
  const { final, note, flash = null } = body;
  const entries = final && typeof final === 'object' && !Array.isArray(final) ? Object.entries(final) : [];
  if (!entries.length || entries.length > 60 || !entries.every(([k, v]) => /^[a-z_]{1,24}$/.test(k) && TIERS.includes(/** @type {string} */ (v))))
    return json({ error: 'final must map features to ' + TIERS.join('/') }, 400);
  if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) return json({ error: 'note up to 2000 characters' }, 400);
  if (![null, 'verified', 'unmatched', 'elsewhere'].includes(flash)) return json({ error: 'flash must be verified, unmatched, elsewhere or null' }, 400);
  const { meta } = await env.DB.prepare("UPDATE bench_runs SET final = ?2, note = ?3, flash = ?5, submitted = datetime('now') WHERE code = ?1 AND submitted IS NULL AND voter = ?4")
    .bind(String(body.code), JSON.stringify(final), note?.trim() || null, voter, flash).run();
  return meta.changes ? json({ ok: true }) : json({ error: 'unknown or already submitted test' }, 404);
}
