// Client-reported outcomes from the local OS USB writer. This inbox stores only bounded
// technical facts; API-token identity, paths, image hashes and free-form diagnostics are excluded.
import { tokenUser } from '../_lib/auth.js';
import { json } from '../_lib/api.js';
import { OSES } from '../../src/os/index.js';
import { validateUsbEnvironment } from '../../src/usb-environment.js';

const MAX_BODY = 2048;
const MAX_DRIVE_BYTES = 64 * 1024 ** 4;
const JOB_ID = /^[A-Za-z0-9_-]{43}$/;
const METHODS = ['ventoy', 'direct'];
const ACTIONS = ['install', 'copy', 'direct'];
const OUTCOMES = ['success', 'failed'];
const VERIFICATION = ['verified', 'mismatch-accepted', 'none'];
const FAILURE_CODES = ['preflight', 'device_changed', 'unmount', 'write', 'timeout', 'readback', 'unknown'];

const IMAGE_CATALOG = new Map(OSES.flatMap(os => os.editions.flatMap(edition => edition.images
  .filter(image => ['iso', 'img.gz'].includes(image.format.toLowerCase()))
  .map(image => [image.id, { name: `${os.name} ${os.version} · ${edition.name} · ${image.arch}`, size: image.size, ventoy: image.usb === true }]))));

function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key)) && keys.every(key => required.includes(key) || optional.includes(key));
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') || !request.body) return null;
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }
}

function canonicalImageName(id) {
  if (id === 'none') return 'No ISO';
  if (id === 'local-configured') return 'Local ISO';
  return IMAGE_CATALOG.get(id)?.name ?? null;
}

function validate(body) {
  if (!exactKeys(body, ['jobId', 'method', 'action', 'outcome', 'image', 'drive', 'verification'], ['readback', 'failureCode', 'retries', 'environment'])) return null;
  if (typeof body.jobId !== 'string' || !JOB_ID.test(body.jobId) || !METHODS.includes(body.method) ||
      !ACTIONS.includes(body.action) || !OUTCOMES.includes(body.outcome)) return null;
  if ((body.method === 'direct' && body.action !== 'direct') ||
      (body.method === 'ventoy' && !['install', 'copy'].includes(body.action))) return null;
  if (!exactKeys(body.image, ['id', 'size']) || typeof body.image.id !== 'string' ||
      !Number.isSafeInteger(body.image.size) || body.image.size < 0 || body.image.size > MAX_DRIVE_BYTES) return null;
  const imageName = canonicalImageName(body.image.id);
  if (!imageName || (body.image.id === 'none' ? body.image.size !== 0 : body.image.size <= 0)) return null;
  if (body.action === 'copy' && body.image.id === 'none') return null;
  if (body.method === 'direct' && body.image.id === 'none') return null;
  if (body.method === 'ventoy' && IMAGE_CATALOG.has(body.image.id) && !IMAGE_CATALOG.get(body.image.id).ventoy) return null;
  if (!exactKeys(body.drive, ['capacityBytes']) || !Number.isSafeInteger(body.drive.capacityBytes) ||
      body.drive.capacityBytes <= 0 || body.drive.capacityBytes > MAX_DRIVE_BYTES) return null;
  if (!exactKeys(body.verification, ['source']) || !VERIFICATION.includes(body.verification.source) ||
      (body.image.id === 'none') !== (body.verification.source === 'none')) return null;
  const catalogImage = IMAGE_CATALOG.get(body.image.id);
  if (catalogImage && body.verification.source === 'verified' && body.image.size !== catalogImage.size) return null;
  if (body.readback !== undefined && (!exactKeys(body.readback, ['size', 'matched']) ||
      !Number.isSafeInteger(body.readback.size) || body.readback.size < 0 || body.readback.size > MAX_DRIVE_BYTES ||
      typeof body.readback.matched !== 'boolean')) return null;
  if (body.retries !== undefined && (!Number.isInteger(body.retries) || body.retries < 1 || body.retries > 10)) return null;
  if (body.failureCode !== undefined && !FAILURE_CODES.includes(body.failureCode)) return null;
  if (body.outcome === 'success') {
    if (body.failureCode !== undefined) return null;
    if (body.image.id !== 'none' && body.image.size > body.drive.capacityBytes) return null;
    if (body.image.id !== 'none' && (!body.readback || body.readback.matched !== true || body.readback.size !== body.image.size)) return null;
    if (body.image.id === 'none' && body.readback !== undefined) return null;
  } else if (body.failureCode === undefined) return null;

  const environment = body.environment === undefined ? null : validateUsbEnvironment(body.environment);
  if (body.environment !== undefined && !environment) return null;
  return {
    environment: environment ? JSON.stringify(environment) : null,
    jobId: body.jobId,
    method: body.method,
    action: body.action,
    outcome: body.outcome,
    imageId: body.image.id,
    imageName,
    imageSize: body.image.size,
    sourceVerification: body.verification.source,
    driveCapacity: body.drive.capacityBytes,
    readbackSize: body.readback?.size ?? null,
    readbackMatched: body.readback === undefined ? null : Number(body.readback.matched),
    failureCode: body.failureCode ?? null,
    retries: body.retries ?? null,
  };
}

const equalReport = (row, report) => row.method === report.method && row.action === report.action && row.outcome === report.outcome &&
  row.image_id === report.imageId && row.image_size === report.imageSize && row.source_verification === report.sourceVerification &&
  row.drive_capacity === report.driveCapacity && row.readback_size === report.readbackSize &&
  row.readback_matched === report.readbackMatched && row.failure_code === report.failureCode && row.retries === report.retries && (row.environment ?? null) === report.environment;

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  const who = await tokenUser(env, request);
  if (!who) return json({ error: 'valid API token required' }, 401);
  const body = await readJson(request);
  const report = body && validate(body);
  if (!report) return json({ error: 'invalid OS USB outcome report' }, 400);

  const { meta } = await env.DB.prepare(`INSERT OR IGNORE INTO os_usb_runs
    (job_id, method, action, outcome, image_id, image_name, image_size, source_verification,
     drive_capacity, readback_size, readback_matched, failure_code, environment, retries)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
    .bind(report.jobId, report.method, report.action, report.outcome, report.imageId, report.imageName, report.imageSize,
      report.sourceVerification, report.driveCapacity, report.readbackSize, report.readbackMatched, report.failureCode, report.environment, report.retries).run();
  if (meta.changes) return json({ ok: true, duplicate: false });

  const existing = await env.DB.prepare(`SELECT method, action, outcome, image_id, image_size, source_verification,
    drive_capacity, readback_size, readback_matched, failure_code, environment, retries FROM os_usb_runs WHERE job_id = ?1`).bind(report.jobId).first();
  if (existing && equalReport(existing, report)) return json({ ok: true, duplicate: true });
  return json({ error: 'job ID already used' }, 409);
}
