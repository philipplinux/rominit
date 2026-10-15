// Admin inbox. GET: unsorted page reports and submitted phone tests. POST {inbox, ref, label}: file one; it leaves the inbox
// (scripts/inbox.mjs does the same from the CLI). Device searches have their own endpoint, /api/searches.
import { userOf } from '../_lib/auth.js';
import { json } from '../_lib/api.js';

const LABELS = ['script-fix', 'catalog-update', 'site-bug', 'device-report', 'spam', 'other'];
/** @param {any} env @param {Request} request */
const isAdmin = async (env, request) => (await userOf(env, request))?.roles.some(r => r.role === 'admin');
const UNSORTED = "LEFT JOIN triage t ON t.inbox = ?1 AND t.ref = i.ref WHERE t.ref IS NULL";

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  if (!await isAdmin(env, request)) return json({ error: 'admins only' }, 403);
  const reports = await env.DB.prepare(`SELECT i.id, i.page, i.section, i.text, i.at FROM (SELECT *, CAST(id AS TEXT) AS ref FROM reports) i ${UNSORTED} ORDER BY i.at DESC LIMIT 500`).bind('reports').all();
  const benchmarks = await env.DB.prepare(`SELECT i.ref, i.at, i.subject AS rom, i.body FROM inbox i ${UNSORTED} AND i.inbox = ?1 ORDER BY i.at DESC LIMIT 200`).bind('benchmarks').all();
  return json({ reports: reports.results, benchmarks: benchmarks.results, labels: LABELS });
}

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  if (!await isAdmin(env, request)) return json({ error: 'admins only' }, 403);
  const { inbox, ref, label } = await request.json().catch(() => ({}));
  if (!['reports', 'benchmarks'].includes(inbox) || typeof ref !== 'string' || !ref || ref.length > 64 || !LABELS.includes(label)) return json({ error: 'needs inbox, ref and a known label' }, 400);
  await env.DB.prepare("INSERT OR REPLACE INTO triage (inbox, ref, label, summary) VALUES (?1, ?2, ?3, 'filed on the site')").bind(inbox, ref, label).run();
  return json({ ok: true });
}
