import { validateUsbEnvironment } from '../../src/usb-environment.js';
// Admin inbox. GET: unsorted page reports, failures, OS USB results, agent reports and phone tests split by state.
// POST {inbox: 'reports' | 'failures' | 'agents' | 'os-usb', ref, label}: triage an incoming item.
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
  const requests = { new: [], update: [], mirror: [] };
  for (const kind of Object.keys(requests)) requests[kind] = (await env.DB.prepare("SELECT r.id, r.kind, r.page, r.rom, r.url, r.text, r.at FROM requests r LEFT JOIN triage t ON t.inbox = 'requests-' || r.kind AND t.ref = CAST(r.id AS TEXT) WHERE r.kind = ?1 AND t.ref IS NULL LIMIT 500").bind(kind).all()).results;
  // new: untouched · review: review set · approved: accepted · rejected: triaged without being accepted. Decided ones: newest 50 each.
  const runs = await env.DB.prepare(`SELECT b.code AS ref, b.submitted AS at, b.rom, b.note, b.final, b.output, b.accepted, b.flash, b.via,
      CASE WHEN b.accepted IS NOT NULL THEN 'approved' WHEN t.ref IS NOT NULL THEN 'rejected' WHEN b.review IS NOT NULL THEN 'review' ELSE 'new' END AS state
    FROM bench_runs b LEFT JOIN triage t ON t.inbox = 'benchmarks' AND t.ref = b.code WHERE b.submitted IS NOT NULL ORDER BY b.submitted DESC LIMIT 300`).all();
  // site tests in benchmarks, rominit CLI tests (run + bench, or bench only) in cli
  const states = () => ({ new: [], review: [], approved: [], rejected: [] }), benchmarks = states(), cli = states();
  for (const run of runs.results) { const to = run.via === 'cli' ? cli : benchmarks; if (['new', 'review'].includes(run.state) || to[run.state].length < 50) to[run.state].push(run); }
  const failures = await env.DB.prepare("SELECT f.id, f.rom, f.stage, f.error, f.log, f.at FROM flash_failures f LEFT JOIN triage t ON t.inbox = 'failures' AND t.ref = CAST(f.id AS TEXT) WHERE t.ref IS NULL ORDER BY f.at DESC LIMIT 200").all();
  const runs2 = await env.DB.prepare(`SELECT r.id, r.rom, r.version, r.host, r.tools, r.outcome, r.resolution, r.finished AS at, u.name AS user,
      (SELECT json_group_array(json_object('stage', s.stage, 'step', s.step, 'outcome', s.outcome, 'detail', s.detail)) FROM agent_steps s WHERE s.run_id = r.id) AS steps
    FROM agent_runs r JOIN users u ON u.id = r.user_id LEFT JOIN triage t ON t.inbox = 'agents' AND t.ref = r.id
    WHERE r.finished IS NOT NULL AND t.ref IS NULL ORDER BY r.finished DESC LIMIT 400`).all();
  const agents = { success: [], partial: [], failed: [], abandoned: [] };
  for (const run of runs2.results) agents[run.outcome]?.push({ ...run, steps: JSON.parse(run.steps) });
  const usbRuns = await env.DB.prepare(`SELECT r.job_id, r.method, r.action, r.outcome, r.image_id, r.image_name, r.image_size,
      r.source_verification, r.drive_capacity, r.readback_size, r.readback_matched, r.failure_code, r.environment, r.at
    FROM os_usb_runs r LEFT JOIN triage t ON t.inbox = 'os-usb' AND t.ref = r.job_id
    WHERE t.ref IS NULL ORDER BY r.at DESC LIMIT 500`).all();
  const osUsb = { success: [], failed: [] };
  for (const row of usbRuns.results) {
    let environment = null;
    try { environment = row.environment ? validateUsbEnvironment(JSON.parse(row.environment)) : null; }
    catch { /* Older or malformed diagnostics are omitted. */ }
    const item = {
      ...(environment ? { environment } : {}),
      jobId: row.job_id, method: row.method, action: row.action, outcome: row.outcome,
      image: { id: row.image_id, name: row.image_name, size: row.image_size },
      verification: { source: row.source_verification },
      drive: { capacityBytes: row.drive_capacity }, at: row.at,
      ...(row.readback_size === null ? {} : { readback: { size: row.readback_size, matched: row.readback_matched === 1 } }),
      ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
    };
    osUsb[row.outcome]?.push(item);
  }
  return json({ reports: reports.results, requests, benchmarks, cli, failures: failures.results, agents, osUsb, labels: LABELS });
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
  if (!['reports', 'failures', 'agents', 'requests-new', 'requests-update', 'requests-mirror', 'os-usb'].includes(inbox) || !LABELS.includes(label)) return json({ error: 'needs inbox and a known label or action' }, 400);
  if (inbox === 'os-usb') {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ref)) return json({ error: 'invalid OS USB reference' }, 400);
    const exists = await env.DB.prepare('SELECT 1 FROM os_usb_runs WHERE job_id = ?1').bind(ref).first();
    if (!exists) return json({ error: 'unknown OS USB report' }, 404);
  }
  await env.DB.prepare("INSERT OR REPLACE INTO triage (inbox, ref, label, summary) VALUES (?1, ?2, ?3, 'filed on the site')").bind(inbox, ref, label).run();
  return json({ ok: true });
}
