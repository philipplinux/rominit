import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { startHelper } from '../bin/helper.mjs';

const SITE = 'https://rominit.test';
const API_KEY = `rmi_${'k'.repeat(43)}`;
const user = { id: 7, name: 'Philipp' };
const DAY = 24 * 60 * 60_000;
const expiry = now => new Date(now + DAY).toISOString();

function send(helper, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: helper.port, method, path,
      headers: { Origin: SITE, ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function start(t, { usbMedia, now = Date.now, fetch, onCredentialError = () => {} } = {}) {
  const remote = fetch ?? (async () => Response.json({ user, expiresAt: expiry(now()) }));
  const helper = await startHelper({ site: SITE, credential: API_KEY,
    identity: { user, expiresAt: expiry(now()) }, fetch: remote, usbMedia, now, onCredentialError });
  t.after(() => helper.close());
  const state = new URL(helper.pairingUrl).searchParams.get('state');
  const paired = await send(helper, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, code: 'c'.repeat(43) }) });
  assert.equal(paired.status, 200);
  return { helper, token: JSON.parse(paired.body).token };
}

const auth = token => ({ Authorization: `Bearer ${token}` });
const post = (token, body, headers = {}) => ({ method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('USB API revalidates sessions, rejects untrusted requests and payloads, and returns media jobs', async t => {
  const calls = [];
  const usbMedia = {
    listDrives: async () => { calls.push(['drives']); return [{ id: 'disk-1' }]; },
    plan: async value => { calls.push(['plan', value]); return { planId: 'plan-1', confirm: 'ERASE disk-1' }; },
    execute: async value => { calls.push(['execute', value]); return { state: 'pending', log: [], drive: 'disk-1', method: 'ventoy' }; },
    status: async () => { calls.push(['status']); return { state: 'idle' }; },
  };
  let credentialErrors = 0;
  const { helper, token } = await start(t, { usbMedia, onCredentialError: () => credentialErrors++ });

  const siteStatus = await send(helper, '/status', { headers: auth(token) });
  assert.equal(siteStatus.status, 200);
  assert.deepEqual(JSON.parse(siteStatus.body).capabilities, ['usb-media']);
  const preflight = await send(helper, '/usb/plan', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type',
    'Access-Control-Request-Private-Network': 'true',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-headers'], 'authorization, content-type');
  assert.equal((await send(helper, '/usb/drives')).status, 401);
  const wrongOrigin = await send(helper, '/usb/drives', { headers: { ...auth(token), Origin: 'https://attacker.test' } });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers['access-control-allow-origin'], undefined);

  for (const [path, body] of [
    ['/usb/plan', { driveId: 'disk-1', method: 'ventoy', extra: true }],
    ['/usb/plan', { driveId: 'disk-1', method: ['ventoy'] }],
    ['/usb/plan', { driveId: '', method: 'ventoy' }],
    ['/usb/write', { planId: 'plan-1', confirm: 'ERASE disk-1', extra: true }],
    ['/usb/write', { planId: 'plan-1', confirm: 7 }],
  ]) {
    assert.equal((await send(helper, path, post(token, body))).status, 400);
  }
  assert.equal((await send(helper, '/usb/plan', post(token, {
    driveId: 'disk-1', method: 'ventoy', padding: 'x'.repeat(3000),
  }))).status, 413);
  assert.deepEqual(calls, []);

  const drives = await send(helper, '/usb/drives', { headers: auth(token) });
  assert.equal(drives.status, 200);
  assert.deepEqual(JSON.parse(drives.body), [{ id: 'disk-1' }]);
  const plan = await send(helper, '/usb/plan', post(token, { driveId: 'disk-1', method: 'ventoy' }));
  assert.equal(plan.status, 200);
  assert.deepEqual(JSON.parse(plan.body), { planId: 'plan-1', confirm: 'ERASE disk-1' });
  const written = await send(helper, '/usb/write', post(token, { planId: 'plan-1', confirm: 'ERASE disk-1' }));
  assert.equal(written.status, 202);
  assert.deepEqual(JSON.parse(written.body), { state: 'pending', log: [], drive: 'disk-1', method: 'ventoy' });
  const status = await send(helper, '/usb/status', { headers: auth(token) });
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.body), { state: 'idle' });
  assert.deepEqual(calls, [
    ['drives'], ['plan', { driveId: 'disk-1', method: 'ventoy' }],
    ['execute', { planId: 'plan-1', confirm: 'ERASE disk-1' }], ['status'],
  ]);
  assert.equal(credentialErrors, 0);
});

test('a session that expires during identity revalidation cannot dispatch a USB read', async t => {
  let now = Date.UTC(2026, 9, 20), identityCalls = 0, releaseIdentity, identityStarted;
  const started = new Promise(resolve => { identityStarted = resolve; });
  const calls = [];
  const usbMedia = {
    listDrives: async () => { calls.push('drives'); return []; },
    plan: async () => { calls.push('plan'); return {}; },
    execute: async () => { calls.push('write'); return {}; },
    status: async () => { calls.push('status'); return {}; },
  };
  const fetch = async (_url, init) => {
    const action = JSON.parse(init.body).action;
    if (action === 'identity' && ++identityCalls === 2) {
      identityStarted();
      return new Promise(resolve => { releaseIdentity = () => resolve(Response.json({ user, expiresAt: expiry(now) })); });
    }
    return Response.json({ user, expiresAt: expiry(now) });
  };
  const { helper, token } = await start(t, { usbMedia, now: () => now, fetch });
  const request = send(helper, '/usb/drives', { headers: auth(token) });
  await started;
  now = Date.parse(JSON.parse((await send(helper, '/status', { headers: auth(token) })).body).expiresAt);
  releaseIdentity();
  const response = await request;
  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});

test('session expiry while a valid POST body is still arriving blocks dispatch after body parsing', async t => {
  let now = Date.UTC(2026, 9, 20), identityCalls = 0, releaseIdentity, identityStarted;
  const started = new Promise(resolve => { identityStarted = resolve; });
  const calls = [];
  const usbMedia = {
    listDrives: async () => { calls.push('drives'); return []; },
    plan: async value => { calls.push(value); return {}; },
    execute: async () => { calls.push('write'); return {}; },
    status: async () => { calls.push('status'); return {}; },
  };
  const fetch = async (_url, init) => {
    const action = JSON.parse(init.body).action;
    if (action === 'identity' && ++identityCalls === 2) {
      identityStarted();
      return new Promise(resolve => { releaseIdentity = () => resolve(Response.json({ user, expiresAt: expiry(now) })); });
    }
    return Response.json({ user, expiresAt: expiry(now) });
  };
  const { helper, token } = await start(t, { usbMedia, now: () => now, fetch });
  const pending = new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: helper.port, method: 'POST', path: '/usb/plan',
      headers: { Origin: SITE, ...auth(token), 'Content-Type': 'application/json' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write('{"driveId":"disk-1",');
    void (async () => {
      await started;
      releaseIdentity();
      await new Promise(resolve => setImmediate(resolve));
      now += 60 * 60_000 + 1;
      req.end('"method":"ventoy"}');
    })().catch(reject);
  });
  const response = await pending;
  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});

test('USB backend errors keep their HTTP meaning and never trigger credential failure', async t => {
  let credentialErrors = 0, driveCalls = 0;
  const usbMedia = {
    listDrives: async () => { throw Object.assign(Error('secret /dev/sda detail'), { status: driveCalls++ ? 409 : 503 }); },
    plan: async () => ({}), execute: async () => ({}), status: async () => ({ state: 'idle' }),
  };
  const { helper, token } = await start(t, { usbMedia, onCredentialError: () => credentialErrors++ });
  const unavailable = await send(helper, '/usb/drives', { headers: auth(token) });
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.body, /USB media support is unavailable/);
  assert.doesNotMatch(unavailable.body, /secret|dev\/sda/);
  const conflict = await send(helper, '/usb/drives', { headers: auth(token) });
  assert.equal(conflict.status, 409);
  assert.match(conflict.body, /another USB operation/);
  assert.doesNotMatch(conflict.body, /secret|dev\/sda/);
  assert.equal((await send(helper, '/usb/status', { headers: auth(token) })).status, 200);
  assert.equal(credentialErrors, 0);
});

test('remote identity failure invalidates the session before any USB dispatch', async t => {
  let identityCalls = 0, credentialErrors = 0;
  const calls = [];
  const usbMedia = {
    listDrives: async () => { calls.push('drives'); return []; },
    plan: async () => { calls.push('plan'); return {}; }, execute: async () => { calls.push('write'); return {}; },
    status: async () => { calls.push('status'); return {}; },
  };
  const fetch = async (_url, init) => {
    if (JSON.parse(init.body).action === 'identity' && ++identityCalls === 2) return new Response('', { status: 401 });
    return Response.json({ user, expiresAt: expiry(Date.now()) });
  };
  const { helper, token } = await start(t, { usbMedia, fetch, onCredentialError: () => credentialErrors++ });
  const response = await send(helper, '/usb/drives', { headers: auth(token) });
  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
  assert.equal(credentialErrors, 1);
  assert.equal((await send(helper, '/usb/drives', { headers: auth(token) })).status, 401);
  assert.deepEqual(calls, []);
});
