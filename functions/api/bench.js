// Phone test runs. POST {rom} starts one ({code}); GET ?code= polls for the script output; POST {code, final, note} submits the corrected card.
import { json, voterOf } from '../_lib/api.js';
import { romInfo, userOf } from '../_lib/auth.js';

export const TIERS = ['full', 'partial', 'broken', 'blocked', 'untested', 'n/a', 'inconclusive'];
const code = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  const run = await env.DB.prepare('SELECT output, submitted FROM bench_runs WHERE code = ?1').bind(new URL(request.url).searchParams.get('code') ?? '').first();
  return run ? json({ output: run.output, submitted: !!run.submitted }) : json({ error: 'unknown code' }, 404);
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
  const { final, note } = body;
  const entries = final && typeof final === 'object' && !Array.isArray(final) ? Object.entries(final) : [];
  if (!entries.length || entries.length > 60 || !entries.every(([k, v]) => /^[a-z_]{1,24}$/.test(k) && TIERS.includes(/** @type {string} */ (v))))
    return json({ error: 'final must map features to ' + TIERS.join('/') }, 400);
  if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) return json({ error: 'note up to 2000 characters' }, 400);
  const { meta } = await env.DB.prepare("UPDATE bench_runs SET final = ?2, note = ?3, submitted = datetime('now') WHERE code = ?1 AND submitted IS NULL AND voter = ?4")
    .bind(String(body.code), JSON.stringify(final), note?.trim() || null, voter).run();
  return meta.changes ? json({ ok: true }) : json({ error: 'unknown or already submitted test' }, 404);
}
