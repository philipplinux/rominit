import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { voterOf } from '../functions/_lib/api.js';
import { onRequestPost } from '../functions/api/bench.js';

const origin = 'https://rominit.test';
const ownerIp = '192.0.2.10', strangerIp = '192.0.2.11';

async function setup(t) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  const stmt = (sql, args = []) => ({
    bind: (...values) => stmt(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  const env = { SALT: 'autosave-test', DB: { prepare: sql => stmt(sql) } };
  const post = (body, ip = ownerIp) => onRequestPost({ env, request: new Request(`${origin}/api/bench`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body),
  }) });
  const voter = async ip => voterOf(env, new Request(origin, { headers: { 'cf-connecting-ip': ip } }));
  const seed = async (code, { ip = ownerIp, submitted = null, accepted = null, review = null } = {}) => {
    db.prepare(`INSERT INTO bench_runs (code, rom, voter, created, submitted, accepted, review)
      VALUES (?, 'laurel_sprout/pmos-server', ?, datetime('now'), ?, ?, ?)`).run(await Promise.resolve(code), await voter(ip), submitted, accepted, review);
  };
  return { db, post, seed };
}

const report = (code, gpu = 'partial', extra = {}) => ({ code, final: { gpu }, note: 'screen works', flash: 'elsewhere', ...extra });

test('initial arrival saves a report and later autosaves preserve its submitted time', async t => {
  const { db, post, seed } = await setup(t);
  await seed('autosave1');
  assert.equal((await post(report('autosave1'))).status, 200);
  assert.ok(db.prepare('SELECT submitted FROM bench_runs WHERE code = ?').get('autosave1').submitted);

  const submittedAt = '2001-02-03 04:05:06';
  db.prepare('UPDATE bench_runs SET submitted = ? WHERE code = ?').run(submittedAt, 'autosave1');
  assert.equal((await post(report('autosave1', 'full', { note: 'corrected after arrival', flash: 'verified' }))).status, 200);
  const saved = db.prepare('SELECT final, note, flash, submitted FROM bench_runs WHERE code = ?').get('autosave1');
  assert.deepEqual({ final: JSON.parse(saved.final), note: saved.note, flash: saved.flash, submitted: saved.submitted }, {
    final: { gpu: 'full' }, note: 'corrected after arrival', flash: 'verified', submitted: submittedAt,
  });
});

test('owners can discard unsubmitted and pending reports', async t => {
  const { db, post, seed } = await setup(t);
  await seed('unsent01');
  await seed('pending1', { submitted: '2001-02-03 04:05:06' });
  for (const code of ['unsent01', 'pending1']) {
    assert.equal((await post({ code, discard: true })).status, 200);
    assert.equal(db.prepare('SELECT 1 FROM bench_runs WHERE code = ?').get(code), undefined);
  }
});

test('wrong owners and missing codes get the same 404 for edit or discard', async t => {
  const { db, post, seed } = await setup(t);
  await seed('owned001', { submitted: '2001-02-03 04:05:06' });
  for (const body of [report('owned001'), { code: 'owned001', discard: true }]) {
    const wrong = await post(body, strangerIp);
    assert.equal(wrong.status, 404);
    assert.deepEqual(await wrong.json(), { error: 'unknown test' });
  }
  for (const body of [report('missing1'), { code: 'missing1', discard: true }]) {
    const missing = await post(body);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'unknown test' });
  }
  assert.ok(db.prepare('SELECT 1 FROM bench_runs WHERE code = ?').get('owned001'));
});

test('reviewed, accepted, or rejected reports cannot be edited or discarded', async t => {
  const { db, post, seed } = await setup(t);
  await seed('review01', { submitted: '2001-02-03 04:05:06', review: '2001-02-03 04:06:00' });
  await seed('accept01', { submitted: '2001-02-03 04:05:06', accepted: '2001-02-03 04:06:00' });
  await seed('reject01', { submitted: '2001-02-03 04:05:06' });
  db.prepare("INSERT INTO triage (inbox, ref, label, summary) VALUES ('benchmarks', 'reject01', 'other', 'rejected')").run();
  for (const code of ['review01', 'accept01', 'reject01']) {
    const edit = await post(report(code, 'full'));
    assert.equal(edit.status, 409);
    assert.match((await edit.json()).error, /Ask a reviewer/);
    const discard = await post({ code, discard: true });
    assert.equal(discard.status, 409);
    assert.match((await discard.json()).error, /cannot be discarded/);
    assert.ok(db.prepare('SELECT 1 FROM bench_runs WHERE code = ?').get(code));
  }
  assert.equal(db.prepare('SELECT final FROM bench_runs WHERE code = ?').get('review01').final, null);
});
