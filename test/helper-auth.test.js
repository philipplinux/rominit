import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sha = text => createHash('sha256').update(text).digest('hex');
const origin = 'https://rominit.test';
const expiresIso = value => new Date(`${value.replace(' ', 'T')}Z`).toISOString();

function addToken(db, userId, credential, name = 'Existing CLI key', expiry = '+30 days') {
  db.prepare("INSERT INTO api_tokens (user_id, name, hash, expires) VALUES (?, ?, ?, datetime('now', ?))")
    .run(userId, name, sha(credential), expiry);
}

async function setup() {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...values) => stmt(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  db.prepare('INSERT INTO users (id, provider, subject, name, email) VALUES (?, ?, ?, ?, ?)').run(1, 'github', 'ada', 'Ada', 'ada@example.org');
  db.prepare('INSERT INTO sessions VALUES (?, ?, datetime(\'now\', \'+1 day\'))').run(sha('ada-session'), 1);
  const { onRequest } = await import('../functions/api/helper.js');
  const env = { DB: {
    prepare: sql => stmt(sql),
    batch: async statements => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => ({ meta: { changes: Number(db.prepare(statement.sql).run(...statement.args).changes) } }));
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } };
  const send = (body, { sid, originHeader = origin, contentType = 'application/json', authorization, raw = false } = {}) => {
    const headers = new Headers();
    if (contentType !== null) headers.set('content-type', contentType);
    if (originHeader !== null) headers.set('origin', originHeader);
    if (sid) headers.set('cookie', `sid=${sid}`);
    if (authorization !== undefined) headers.set('authorization', authorization);
    return onRequest({ env, request: new Request(`${origin}/api/helper`, { method: 'POST', headers, body: raw ? body : JSON.stringify(body) }) });
  };
  return { db, send, onRequest, env };
}

test('helper grants require a signed-in same-origin browser approval', async () => {
  const { db, send } = await setup();
  const challenge = 'a'.repeat(64);
  assert.equal((await send({ action: 'approve', challenge })).status, 401);
  assert.equal((await send({ action: 'approve', challenge }, { sid: 'ada-session', originHeader: null })).status, 403);
  assert.equal((await send({ action: 'approve', challenge }, { sid: 'ada-session', originHeader: 'https://evil.test' })).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM helper_grants').get().n, 0);
  const response = await send({ action: 'approve', challenge }, { sid: 'ada-session' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.match(result.code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.expiresIn, 60);
  const row = db.prepare('SELECT code_hash, user_id, challenge, expires > datetime(\'now\') AS active FROM helper_grants').get();
  assert.deepEqual({ code_hash: row.code_hash, user_id: row.user_id, challenge: row.challenge, active: row.active },
    { code_hash: sha(result.code), user_id: 1, challenge, active: 1 });
});

test('helper endpoint bounds and validates JSON payloads and methods', async () => {
  const { send, onRequest, env } = await setup();
  for (const response of [
    await send({ action: 'approve', challenge: 'A'.repeat(64) }, { sid: 'ada-session' }),
    await send({ action: 'unknown' }),
    await send('{', { raw: true }),
    await send({ action: 'redeem' }, { contentType: 'text/plain' }),
    await send('x'.repeat(2049), { raw: true }),
  ]) {
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const get = await onRequest({ env, request: new Request(`${origin}/api/helper`) });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('cache-control'), 'no-store');
  assert.equal((await send({ action: 'redeem', code: 'x'.repeat(43), verifier: 'v'.repeat(42) })).status, 400);
});

test('CLI identity accepts active API tokens and rejects missing, expired, revoked, or unknown tokens', async () => {
  const { db, send } = await setup();
  const active = `rmi_${'a'.repeat(43)}`, expired = `rmi_${'e'.repeat(43)}`, revoked = `rmi_${'r'.repeat(43)}`;
  addToken(db, 1, active);
  addToken(db, 1, expired, 'Expired key', '-1 day');
  addToken(db, 1, revoked);
  db.prepare("UPDATE api_tokens SET revoked = datetime('now') WHERE hash = ?").run(sha(revoked));
  const identity = await send({ action: 'identity' }, { originHeader: null, authorization: `Bearer ${active}` });
  assert.equal(identity.status, 200);
  const expectedExpiry = expiresIso(db.prepare('SELECT expires FROM api_tokens WHERE hash = ?').get(sha(active)).expires);
  assert.deepEqual(await identity.json(), { user: { id: 1, name: 'Ada' }, expiresAt: expectedExpiry });
  assert.equal((await send({ action: 'identity' }, { originHeader: null })).status, 401);
  for (const credential of [expired, revoked, `rmi_${'x'.repeat(43)}`]) {
    const response = await send({ action: 'identity' }, { originHeader: null, authorization: credential && `Bearer ${credential}` });
    assert.equal(response.status, 401);
  }
});

test('web redemption issues one persistent credential only with a valid verifier and direct CLI request', async () => {
  const { db, send } = await setup();
  const verifier = 'v'.repeat(43), code = (await (await send({ action: 'approve', challenge: sha(verifier) }, { sid: 'ada-session' })).json()).code;
  assert.equal((await send({ action: 'redeem', code, verifier: 'w'.repeat(43) }, { originHeader: null })).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM helper_grants').get().n, 1);
  assert.equal((await send({ action: 'redeem', code, verifier })).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM helper_grants').get().n, 1);
  assert.equal((await send({ action: 'redeem', code, verifier }, { originHeader: null, authorization: 'Bearer invalid' })).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM helper_grants').get().n, 1);
  const exchanged = await send({ action: 'redeem', code, verifier }, { originHeader: null });
  assert.equal(exchanged.status, 200);
  const body = await exchanged.json();
  assert.deepEqual(Object.keys(body).sort(), ['credential', 'expiresAt', 'user']);
  assert.deepEqual(body.user, { id: 1, name: 'Ada' });
  assert.match(body.credential, /^rmi_[A-Za-z0-9_-]{43}$/);
  assert.match(body.expiresAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const issued = db.prepare("SELECT hash, name, expires FROM api_tokens WHERE name = 'ROMinit CLI'").get();
  assert.deepEqual({ hash: issued.hash, name: issued.name, expiresAt: expiresIso(issued.expires) },
    { hash: sha(body.credential), name: 'ROMinit CLI', expiresAt: body.expiresAt });
  assert.notEqual(issued.hash, body.credential);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM helper_grants').get().n, 0);
  assert.equal((await send({ action: 'redeem', code, verifier }, { originHeader: null })).status, 410);
});

test('valid same-user credentials reuse existing API keys; wrong-user keys leave grants available', async () => {
  const { db, send } = await setup();
  db.prepare('INSERT INTO users (id, provider, subject, name, email) VALUES (2, ?, ?, ?, ?)').run('github', 'bob', 'Bob', 'bob@example.org');
  const adaKey = `rmi_${'a'.repeat(43)}`, bobKey = `rmi_${'b'.repeat(43)}`;
  addToken(db, 1, adaKey);
  addToken(db, 2, bobKey);
  const verifier = 'v'.repeat(43);
  const approve = async () => (await (await send({ action: 'approve', challenge: sha(verifier) }, { sid: 'ada-session' })).json()).code;
  let code = await approve();
  assert.equal((await send({ action: 'redeem', code, verifier }, { originHeader: null, authorization: `Bearer ${bobKey}` })).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM helper_grants').get().n, 1);
  const reused = await send({ action: 'redeem', code, verifier }, { originHeader: null, authorization: `Bearer ${adaKey}` });
  assert.equal(reused.status, 200);
  const first = await reused.json();
  assert.deepEqual(Object.keys(first).sort(), ['expiresAt', 'user']);
  assert.deepEqual(first.user, { id: 1, name: 'Ada' });
  assert.ok(first.expiresAt);
  assert.equal(Object.hasOwn(first, 'credential'), false);
  code = await approve();
  assert.equal((await send({ action: 'redeem', code, verifier }, { originHeader: null, authorization: `Bearer ${adaKey}` })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM api_tokens').get().n, 2);
});

test('helper grants expire, reject cross-origin redemption, and cap active grants at ten', async () => {
  const { db, send } = await setup();
  const verifier = 'v'.repeat(43);
  const code = (await (await send({ action: 'approve', challenge: sha(verifier) }, { sid: 'ada-session' })).json()).code;
  assert.equal((await send({ action: 'redeem', code, verifier }, { originHeader: 'https://evil.test' })).status, 403);
  db.prepare("UPDATE helper_grants SET expires = datetime('now', '-1 second')").run();
  assert.equal((await send({ action: 'redeem', code, verifier }, { originHeader: null })).status, 410);
  for (let i = 0; i < 10; i++) assert.equal((await send({ action: 'approve', challenge: sha(verifier) }, { sid: 'ada-session' })).status, 200);
  const capped = await send({ action: 'approve', challenge: sha(verifier) }, { sid: 'ada-session' });
  assert.equal(capped.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM helper_grants').get().n, 10);
});

test('token-cap refusal preserves the helper grant until an active key is revoked', async () => {
  const { db, send } = await setup();
  for (let i = 0; i < 10; i++) addToken(db, 1, `rmi_${String(i).padStart(43, 'a')}`, `API key ${i}`);
  const verifier = 'v'.repeat(43);
  const { code } = await (await send({ action: 'approve', challenge: sha(verifier) }, { sid: 'ada-session' })).json();
  assert.equal((await send({ action: 'redeem', code, verifier }, { originHeader: null })).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM helper_grants').get().n, 1);
  db.prepare("UPDATE api_tokens SET revoked = datetime('now') WHERE name = 'API key 0'").run();
  const redeemed = await send({ action: 'redeem', code, verifier }, { originHeader: null });
  assert.equal(redeemed.status, 200);
  assert.equal((await redeemed.json()).credential.startsWith('rmi_'), true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE revoked IS NULL AND expires > datetime('now')").get().n, 10);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM helper_grants').get().n, 0);
});

test('concurrent redemptions of the same helper grant succeed exactly once', async () => {
  const { db, send } = await setup();
  const verifier = 'v'.repeat(43);
  const { code } = await (await send({ action: 'approve', challenge: sha(verifier) }, { sid: 'ada-session' })).json();
  const replies = await Promise.all([1, 2].map(() => send({ action: 'redeem', code, verifier }, { originHeader: null })));
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 410]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM api_tokens').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM helper_grants').get().n, 0);
});
