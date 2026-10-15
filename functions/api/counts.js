// Views and successful flashes per ROM. The page posts a view when a ROM is shown and a flash when its last stage
// finished without an error.
import { json, knownRom, voterOf } from '../_lib/api.js';

/** Dedupe window per kind: one view per address per ROM per day, one flash per hour, so reloads and retries do not inflate them. */
const WINDOW = { view: '-1 day', flash: '-1 hour' };

/** `{ "<codename>/<rom id>": { view, flash } }` @param {{env:any}} context */
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT rom, kind, COUNT(*) AS n FROM counts GROUP BY rom, kind').all();
  /** @type {Record<string, Record<string, number>>} */ const out = {};
  for (const r of results) (out[r.rom] ??= { view: 0, flash: 0 })[r.kind] = r.n;
  return Response.json(out, { headers: { 'cache-control': 'public, max-age=60' } });
}

/**
 * ponytail: the browser reports its own view or success; nothing proves a phone was attached. Good enough as a popularity hint.
 * @param {{request:Request, env:any}} context
 */
export async function onRequestPost({ request, env }) {
  if (!env.SALT) return json({ error: 'counter not configured' }, 503);
  const { rom, kind } = await request.json().catch(() => ({}));
  if (!(kind in WINDOW)) return json({ error: 'kind must be view or flash' }, 400);
  if (!await knownRom(env, request, rom)) return json({ error: 'unknown rom' }, 404);
  const voter = await voterOf(env, request);
  const recent = await env.DB.prepare("SELECT 1 FROM counts WHERE rom = ?1 AND kind = ?2 AND voter = ?3 AND at > datetime('now', ?4)").bind(rom, kind, voter, WINDOW[kind]).first();
  if (!recent) await env.DB.prepare('INSERT INTO counts (rom, kind, voter) VALUES (?1, ?2, ?3)').bind(rom, kind, voter).run();
  return json({ ok: true, counted: !recent });
}
