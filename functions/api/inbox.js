// Admin inbox of page reports. GET: unsorted reports. POST {ref, label}: file one (it leaves the inbox; see scripts/inbox.mjs for the CLI).
import { userOf } from '../_lib/auth.js';
import { json } from '../_lib/api.js';

const LABELS = ['script-fix', 'catalog-update', 'site-bug', 'device-report', 'spam', 'other'];
/** @param {any} env @param {Request} request */
const isAdmin = async (env, request) => (await userOf(env, request))?.roles.some(r => r.role === 'admin');

/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  if (!await isAdmin(env, request)) return json({ error: 'admins only' }, 403);
  const { results } = await env.DB.prepare("SELECT r.id, r.page, r.section, r.text, r.at FROM reports r LEFT JOIN triage t ON t.inbox = 'reports' AND t.ref = CAST(r.id AS TEXT) WHERE t.ref IS NULL ORDER BY r.at DESC LIMIT 500").all();
  return json({ reports: results, labels: LABELS });
}

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  if (!await isAdmin(env, request)) return json({ error: 'admins only' }, 403);
  const { ref, label } = await request.json().catch(() => ({}));
  if (!Number.isInteger(ref) || !LABELS.includes(label)) return json({ error: 'needs ref and a known label' }, 400);
  await env.DB.prepare("INSERT OR REPLACE INTO triage (inbox, ref, label, summary) VALUES ('reports', ?1, ?2, 'filed on the site')").bind(String(ref), label).run();
  return json({ ok: true });
}
