// Admin inbox. GET: unsorted page reports, unsorted flash failures, and phone tests split into new / review / approved / rejected.
// POST {inbox: 'reports' | 'failures', ref, label}: file a report or failure (it leaves the inbox; scripts/inbox.mjs files from the CLI).
// POST {inbox: 'benchmarks', ref, action: new | review | approve | reject}: approved results show on the ROM page.
import { userOf } from '../_lib/auth.js';
import { json } from '../_lib/api.js';

const LABELS = ['script-fix', 'recipe-fix', 'user-side', 'catalog-update', 'site-bug', 'device-report', 'spam', 'other'];
/** @param {any} env @param {Request} request */
const isAdmin = async (env, request) => (await userOf(env, request))?.roles.some(r => r.role === 'admin');

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  if (!await isAdmin(env, request)) return json({ error: 'admins only' }, 403);
  const reports = await env.DB.prepare("SELECT r.id, r.page, r.section, r.text, r.at FROM reports r LEFT JOIN triage t ON t.inbox = 'reports' AND t.ref = CAST(r.id AS TEXT) WHERE t.ref IS NULL ORDER BY r.at DESC LIMIT 500").all();
  // new: untouched · review: review set · approved: accepted · rejected: triaged without being accepted. Decided ones: newest 50 each.
  const runs = await env.DB.prepare(`SELECT b.code AS ref, b.submitted AS at, b.rom, b.note, b.final, b.output, b.accepted, b.flash,
      CASE WHEN b.accepted IS NOT NULL THEN 'approved' WHEN t.ref IS NOT NULL THEN 'rejected' WHEN b.review IS NOT NULL THEN 'review' ELSE 'new' END AS state
    FROM bench_runs b LEFT JOIN triage t ON t.inbox = 'benchmarks' AND t.ref = b.code WHERE b.submitted IS NOT NULL ORDER BY b.submitted DESC LIMIT 300`).all();
  const benchmarks = { new: [], review: [], approved: [], rejected: [] };
  for (const run of runs.results) if (['new', 'review'].includes(run.state) || benchmarks[run.state].length < 50) benchmarks[run.state].push(run);
  const failures = await env.DB.prepare("SELECT f.id, f.rom, f.stage, f.error, f.log, f.at FROM flash_failures f LEFT JOIN triage t ON t.inbox = 'failures' AND t.ref = CAST(f.id AS TEXT) WHERE t.ref IS NULL ORDER BY f.at DESC LIMIT 200").all();
  return json({ reports: reports.results, benchmarks, failures: failures.results, labels: LABELS });
}

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  if (!await isAdmin(env, request)) return json({ error: 'admins only' }, 403);
  const { inbox, ref, label, action } = await request.json().catch(() => ({}));
  if (typeof ref !== 'string' || !ref || ref.length > 64) return json({ error: 'needs ref' }, 400);
  if (inbox === 'benchmarks' && ['new', 'review', 'approve', 'reject'].includes(action)) {
    const { meta } = await env.DB.prepare(`UPDATE bench_runs SET accepted = ${action === 'approve' ? "datetime('now')" : 'NULL'}, review = ${action === 'new' ? 'NULL' : "coalesce(review, datetime('now'))"} WHERE code = ?1 AND submitted IS NOT NULL`).bind(ref).run();
    if (!meta.changes) return json({ error: 'unknown test' }, 404);
    if (action === 'new' || action === 'review') await env.DB.prepare("DELETE FROM triage WHERE inbox = 'benchmarks' AND ref = ?1").bind(ref).run();
    else await env.DB.prepare("INSERT OR REPLACE INTO triage (inbox, ref, label, summary) VALUES ('benchmarks', ?1, ?2, ?3)")
      .bind(ref, ...{ approve: ['catalog-update', 'approved: shown on the ROM page'], reject: ['other', 'rejected on the site'] }[action]).run();
    return json({ ok: true });
  }
  if (!['reports', 'failures'].includes(inbox) || !LABELS.includes(label)) return json({ error: 'needs inbox and a known label or action' }, 400);
  await env.DB.prepare("INSERT OR REPLACE INTO triage (inbox, ref, label, summary) VALUES (?1, ?2, ?3, 'filed on the site')").bind(inbox, ref, label).run();
  return json({ ok: true });
}
