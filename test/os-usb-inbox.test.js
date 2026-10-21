import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';

const sha = value => createHash('sha256').update(value).digest('hex');
const jobId = char => char.repeat(43);
const imageId = 'alpine-standard-x86_64';
const imageSize = 370147328;

test('OS USB reports require a CLI API token, validate the strict privacy contract, and deduplicate safely', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
  // Exercise the deploy migration from a pre-migration schema snapshot.
  db.exec('DROP VIEW inbox; DROP TABLE os_usb_runs;');
  db.exec(await readFile(new URL('../migrations/2026-10-21-os-usb.sql', import.meta.url), 'utf8'));
  db.prepare(`INSERT INTO os_usb_runs
    (job_id, method, action, outcome, image_id, image_name, image_size, source_verification, drive_capacity, failure_code)
    VALUES (?, 'ventoy', 'install', 'failed', 'local-configured', 'Local ISO', 400, 'verified', ?, 'timeout')`)
    .run(jobId('L'), 2 * 1024 ** 3);
  db.exec(await readFile(new URL('../migrations/2026-10-21-os-usb-environment.sql', import.meta.url), 'utf8'));
  db.exec(await readFile(new URL('../migrations/2026-10-21-os-usb-retries.sql', import.meta.url), 'utf8'));
  assert.equal(db.prepare('SELECT environment FROM os_usb_runs WHERE job_id = ?').get(jobId('L')).environment, null,
    'the additive migration preserves pre-existing rows without environment data');
  const stmt = (sql, args = []) => ({
    bind: (...values) => stmt(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const result = db.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
  });
  const env = { ADMINS: 'admin@example.org', DB: { prepare: sql => stmt(sql) } };
  const token = `rmi_${'T'.repeat(43)}`;
  db.exec(`INSERT INTO users (id, provider, subject, name, email) VALUES
    (1, 'github', 'secret-admin-subject', 'Private Admin Name', 'admin@example.org'),
    (2, 'github', 'secret-cli-subject', 'Private CLI Name', 'cli@example.org');
    INSERT INTO sessions (token, user_id, expires) VALUES ('${sha('admin-cookie')}', 1, datetime('now', '+1 day'));
    INSERT INTO api_tokens (id, user_id, name, hash, expires) VALUES (8, 2, 'private CLI label', '${sha(token)}', datetime('now', '+1 day'));`);

  const { onRequestPost } = await import('../functions/api/os-usb.js');
  const inbox = await import('../functions/api/inbox.js');
  const post = (body, auth = token) => onRequestPost({ env, request: new Request('https://rominit.test/api/os-usb', {
    method: 'POST', headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) });
  const validSuccess = {
    jobId: jobId('A'), method: 'direct', action: 'direct', outcome: 'success',
    image: { id: imageId, size: imageSize }, drive: { capacityBytes: 2 * 1024 ** 3 },
    verification: { source: 'verified' }, readback: { size: imageSize, matched: true },
  };
  const environment = {
    hostOs: 'linux', hostOsVersion: '6.12.4', hostDistro: 'fedora', hostArch: 'x64',
    kernelVersion: '6.12.4', cliVersion: 'e7ac927798be', nodeVersion: '24.18.0',
    browser: 'chrome', browserVersion: '140.0.7339.0', browserOs: 'linux', browserOsVersion: '6.12.4',
  };

  const pi = { ...validSuccess, jobId: jobId('P'), image: { id: 'alpine-rpi-aarch64-img', size: 87470439 }, readback: { size: 87470439, matched: true }, retries: 2 };
  assert.equal((await post(pi)).status, 200, 'a Raspberry Pi img.gz write with slow-card retries is accepted');
  assert.equal((await post({ ...pi, jobId: jobId('Q'), method: 'ventoy', action: 'install' })).status, 400, 'Ventoy still refuses img.gz');
  assert.equal((await post({ ...pi, jobId: jobId('R'), retries: 99 })).status, 400, 'retries stay bounded');
  assert.equal((await post(validSuccess, null)).status, 401);
  assert.equal((await post({ ...validSuccess, image: { ...validSuccess.image, sha256: 'a'.repeat(64) } })).status, 400,
    'source hashes are rejected rather than stored');
  assert.equal((await post({ ...validSuccess, filename: '/home/ada/private.iso' })).status, 400,
    'paths and arbitrary user text are rejected');
  assert.equal((await post({ ...validSuccess, jobId: 'short' })).status, 400);
  assert.equal((await post({ ...validSuccess, outcome: 'success', readback: { size: 999, matched: true } })).status, 400,
    'a claimed success requires matched readback of the reported image size');
  assert.equal((await post({ ...validSuccess, image: { id: imageId, size: imageSize + 1 }, readback: { size: imageSize + 1, matched: true } })).status, 400,
    'verified catalog images must retain the canonical catalog size');
  assert.equal((await post({ ...validSuccess, method: 'ventoy' })).status, 400,
    'method and action must agree');
  assert.equal((await post({ ...validSuccess, image: { id: 'none', size: 0 }, verification: { source: 'none' }, readback: undefined })).status, 400,
    'a direct write cannot succeed without an image');
  assert.equal((await post({ ...validSuccess, method: 'ventoy', action: 'install', image: { id: 'alpine-standard-armv7', size: 1000 } })).status, 400,
    'Ventoy cannot report an ISO outside its catalog-supported architectures');
  assert.equal((await post({ ...validSuccess, jobId: jobId('E'), environment: 'linux' })).status, 400,
    'environment must be a normalized technical object');
  assert.equal((await post({ ...validSuccess, jobId: jobId('E'), environment: {} })).status, 400,
    'empty environment objects are rejected');
  assert.equal((await post({ ...validSuccess, jobId: jobId('E'), environment: { ...environment, localPath: '/home/ada/private.iso' } })).status, 400,
    'unknown fields such as local paths are rejected');
  assert.equal((await post({ ...validSuccess, jobId: jobId('E'), environment: { ...environment, browserVersion: 'Chrome /home/ada' } })).status, 400,
    'environment version strings cannot carry free text or PII');
  assert.equal((await post({ ...validSuccess, jobId: jobId('E'), environment: { ...environment, hostOs: 'Philipps Fedora workstation' } })).status, 400,
    'OS fields accept only known technical enums');

  const first = await post(validSuccess);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, duplicate: false });
  const duplicate = await post(validSuccess);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });
  assert.equal((await post({ ...validSuccess, outcome: 'failed', failureCode: 'timeout' })).status, 409,
    'a reused job ID cannot overwrite its original outcome');

  const reportedEnvironment = await post({ ...validSuccess, jobId: jobId('E'), environment });
  assert.equal(reportedEnvironment.status, 200, 'an allowlisted OS/CLI/browser environment is accepted');
  assert.deepEqual(await (await post({ ...validSuccess, jobId: jobId('E'), environment: Object.fromEntries(Object.entries(environment).reverse()) })).json(),
    { ok: true, duplicate: true }, 'equivalent normalized environment data deduplicates regardless of key order');

  const localFailure = {
    jobId: jobId('B'), method: 'ventoy', action: 'install', outcome: 'failed',
    image: { id: 'local-configured', size: 400 }, drive: { capacityBytes: 2 * 1024 ** 3 },
    verification: { source: 'mismatch-accepted' }, failureCode: 'timeout',
  };
  assert.equal((await post(localFailure)).status, 200);
  const noImageSuccess = {
    jobId: jobId('C'), method: 'ventoy', action: 'install', outcome: 'success',
    image: { id: 'none', size: 0 }, drive: { capacityBytes: 4 * 1024 ** 3 }, verification: { source: 'none' },
  };
  assert.equal((await post(noImageSuccess)).status, 200);
  const largeLocalSuccess = {
    jobId: jobId('D'), method: 'direct', action: 'direct', outcome: 'success',
    image: { id: 'local-configured', size: 6 * 1024 ** 3 }, drive: { capacityBytes: 8 * 1024 ** 3 },
    verification: { source: 'verified' }, readback: { size: 6 * 1024 ** 3, matched: true },
  };
  assert.equal((await post(largeLocalSuccess)).status, 200, 'large local ISOs remain reportable up to the drive bound');

  db.exec('PRAGMA ignore_check_constraints = ON');
  db.prepare('UPDATE os_usb_runs SET environment = ? WHERE job_id = ?')
    .run(JSON.stringify({ password: 'must-not-leak', privatePath: '/home/ada/secret.iso' }), jobId('L'));
  db.exec('PRAGMA ignore_check_constraints = OFF');

  const adminGet = request => inbox.onRequestGet({ env, request });
  assert.equal((await adminGet(new Request('https://rominit.test/api/inbox'))).status, 403);
  const response = await adminGet(new Request('https://rominit.test/api/inbox', { headers: { cookie: `sid=admin-cookie` } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.osUsb.success.length, 5);
  assert.equal(body.osUsb.failed.length, 2);
  assert.deepEqual(body.osUsb.success.find(item => item.jobId === jobId('A')).image,
    { id: imageId, name: 'Alpine Linux 3.24.2 · Standard · x86_64', size: imageSize });
  assert.equal(body.osUsb.failed.find(item => item.jobId === jobId('B')).image.name, 'Local ISO');
  assert.equal(body.osUsb.failed.find(item => item.jobId === jobId('B')).verification.source, 'mismatch-accepted');
  assert.equal(body.osUsb.success.find(item => item.jobId === jobId('C')).image.name, 'No ISO');
  assert.deepEqual(body.osUsb.success.find(item => item.jobId === jobId('E')).environment, environment,
    'admin inbox returns only the normalized environment fields');
  assert.equal(body.osUsb.success.find(item => item.jobId === jobId('A')).environment, undefined,
    'legacy API payloads without environment remain readable');
  assert.equal(body.osUsb.failed.find(item => item.jobId === jobId('L')).environment, undefined,
    'malformed or unknown stored environment JSON is omitted from the admin response');
  const exposed = JSON.stringify(body.osUsb);
  for (const privateValue of [token, 'private CLI label', 'Private CLI Name', 'admin@example.org', 'cli@example.org', 'secret-cli-subject', 'must-not-leak', '/home/ada/secret.iso'])
    assert.equal(exposed.includes(privateValue), false, `admin inbox must omit ${privateValue}`);
  assert.equal(/sha256|hash|serial|hostname|path/i.test(exposed), false);

  const { onRequestPost: triage } = inbox;
  const triagePost = (payload, cookie = 'admin-cookie') => triage({ env, request: new Request('https://rominit.test/api/inbox', {
    method: 'POST', headers: { cookie: `sid=${cookie}`, 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }) });
  assert.equal((await triagePost({ inbox: 'os-usb', ref: jobId('A'), label: 'device-report' })).status, 200);
  assert.equal((await triagePost({ inbox: 'os-usb', ref: '../private', label: 'other' })).status, 400);
  assert.equal((await triagePost({ inbox: 'os-usb', ref: jobId('Z'), label: 'other' })).status, 404);
  const afterTriage = await (await adminGet(new Request('https://rominit.test/api/inbox', { headers: { cookie: 'sid=admin-cookie' } }))).json();
  assert.equal(afterTriage.osUsb.success.some(item => item.jobId === jobId('A')), false);
  assert.equal(db.prepare("SELECT count(*) AS n FROM os_usb_runs WHERE job_id = ?").get(jobId('A')).n, 1);

  const columns = db.prepare('PRAGMA table_info(os_usb_runs)').all().map(column => column.name);
  assert.ok(columns.includes('environment'));
  assert.deepEqual(columns.filter(name => ['user_id', 'token_id', 'email', 'ip', 'path', 'serial', 'sha256'].includes(name)), []);
  const view = db.prepare("SELECT inbox, ref, subject, body FROM inbox WHERE inbox = 'os-usb' AND ref = ?").get(jobId('A'));
  assert.equal(view.subject, 'OS USB');
  assert.equal(JSON.parse(view.body).image.name, 'Alpine Linux 3.24.2 · Standard · x86_64');
  const viewWithEnvironment = db.prepare("SELECT body FROM inbox WHERE inbox = 'os-usb' AND ref = ?").get(jobId('E'));
  assert.deepEqual(JSON.parse(viewWithEnvironment.body).environment, environment,
    'the SQL inbox view carries validated environment data for scripts/inbox consumers');
  db.close();
});
