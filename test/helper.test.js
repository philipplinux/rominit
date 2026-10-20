import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { startHelper } from '../bin/helper.mjs';
import { main } from '../bin/cli.mjs';
import { credentialFingerprint } from '../bin/credentials.mjs';

const SITE = 'https://rominit.test';
const API_KEY = `rmi_${'k'.repeat(43)}`;
const validUser = { id: 7, name: 'Philipp' };
const DAY = 24 * 60 * 60_000;
const expiry = now => new Date(now + DAY).toISOString();
const pairBody = helper => ({ state: new URL(helper.pairingUrl).searchParams.get('state'), code: 'a'.repeat(43) });

function send(helper, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: helper.port, method, path,
      headers: { Connection: 'close', Origin: SITE, ...headers } }, res => {
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

async function helper(t, options = {}) {
  const now = options.now ?? Date.now;
  const fetch = options.fetch ?? (async (_url, init) => {
    const body = JSON.parse(init.body);
    const response = { user: validUser, expiresAt: expiry(now()) };
    if (body.action === 'redeem' && !init.headers.authorization) response.credential = API_KEY;
    return Response.json(response);
  });
  const instance = await startHelper({ site: SITE, fetch, saveCredential: async () => {}, ...options });
  t.after(() => instance.close());
  return instance;
}

test('origin and Host are exact, and preflight allows only the needed request with private network access', async t => {
  const local = await helper(t);
  const good = await send(local, '/pair', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
    'Access-Control-Request-Private-Network': 'true',
  } });
  assert.equal(good.status, 204);
  assert.equal(good.headers['access-control-allow-origin'], SITE);
  assert.equal(good.headers['access-control-allow-methods'], 'POST');
  assert.equal(good.headers['access-control-allow-private-network'], 'true');
  assert.notEqual(good.headers['access-control-allow-origin'], '*');
  const benchPreflight = await send(local, '/bench', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type',
    'Access-Control-Request-Private-Network': 'true',
  } });
  assert.equal(benchPreflight.status, 204);
  assert.equal(benchPreflight.headers['access-control-allow-headers'], 'authorization, content-type');
  const discoverPreflight = await send(local, '/discover', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Private-Network': 'true',
  } });
  assert.equal(discoverPreflight.status, 204);
  assert.equal(discoverPreflight.headers['access-control-allow-origin'], SITE);

  const badHost = await send(local, '/status', { headers: { Host: `localhost:${local.port}` } });
  assert.equal(badHost.status, 403);
  assert.equal(badHost.headers['access-control-allow-origin'], undefined);
  const badBenchHost = await send(local, '/bench', { method: 'POST', headers: { Host: `localhost:${local.port}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(badBenchHost.status, 403);
  const badOrigin = await send(local, '/status', { headers: { Origin: 'https://attacker.test' } });
  assert.equal(badOrigin.status, 403);
  assert.equal(badOrigin.headers['access-control-allow-origin'], undefined);
  const badBenchOrigin = await send(local, '/bench', { method: 'POST', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(badBenchOrigin.status, 403);
  const badHeaders = await send(local, '/pair', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, x-extra',
  } });
  assert.equal(badHeaders.status, 403);
});

test('site URL must be public HTTPS or loopback HTTP and must have no path, query, hash, or userinfo', async t => {
  const fetch = async () => Response.json({ user: validUser, expiresAt: expiry(Date.now()) });
  for (const site of ['http://rominit.test', 'https://rominit.test/path', 'https://user@rominit.test',
    'https://rominit.test/?x=1', 'https://rominit.test/#x'])
    await assert.rejects(startHelper({ site, fetch }), /bare HTTPS origin/);
  const local = await startHelper({ site: 'http://localhost:4173', fetch });
  t.after(() => local.close());
  assert.match(local.pairingUrl, /^http:\/\/localhost:4173\//);
});

test('pair rejects malformed and oversized JSON, including a chunked body, before remote access', async t => {
  let calls = 0;
  const local = await helper(t, { fetch: async () => { calls++; return Response.json({ user: validUser, expiresAt: expiry(Date.now()), credential: API_KEY }); } });
  const malformed = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const largeBody = JSON.stringify({ ...pairBody(local), padding: 'x'.repeat(3000) });
  const large = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(largeBody)) }, body: largeBody });
  assert.equal(large.status, 413);
  const chunked = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' }, body: largeBody });
  assert.equal(chunked.status, 413);
  const wrongType = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(pairBody(local)) });
  assert.equal(wrongType.status, 415);
  const unknown = await send(local, '/not-an-api', { method: 'POST', body: 'anything' });
  assert.equal(unknown.status, 404);
  assert.equal(calls, 0);
});

test('state mismatch and expired initial pairing are rejected before redemption', async t => {
  let calls = 0, now = 1000;
  const local = await helper(t, { now: () => now, fetch: async () => { calls++; return Response.json({ user: validUser, expiresAt: expiry(now), credential: API_KEY }); } });
  const mismatch = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...pairBody(local), state: 'b'.repeat(43) }) });
  assert.equal(mismatch.status, 403);
  now += 10 * 60_000;
  const expired = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  assert.equal(expired.status, 410);
  assert.equal(calls, 0);
});

test('web redemption stores the account key and returns a local token bounded by API-key expiry', async t => {
  let time = Date.UTC(2026, 9, 17);
  const calls = [], saved = [];
  const local = await helper(t, { now: () => time, fetch: async (url, init) => {
    calls.push([url, init]);
    const body = JSON.parse(init.body);
    return Response.json({ user: validUser, expiresAt: expiry(time), ...(body.action === 'redeem' ? { credential: API_KEY } : {}) });
  }, saveCredential: async key => saved.push(key) });
  const noSession = await send(local, '/status', { headers: { Authorization: `Bearer ${'x'.repeat(43)}` } });
  assert.equal(noSession.status, 401);
  const paired = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  assert.equal(paired.status, 200);
  const result = JSON.parse(paired.body);
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.user.name, validUser.name);
  assert.equal(result.expiresAt, expiry(time));
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'token', 'user']);
  assert.equal(paired.body.includes(API_KEY), false);
  assert.deepEqual(saved, [API_KEY]);

  const [url, init] = calls[0];
  const redeem = JSON.parse(init.body);
  assert.equal(url, `${SITE}/api/helper`);
  assert.equal(init.redirect, 'error');
  assert.deepEqual(Object.keys(redeem).sort(), ['action', 'code', 'verifier']);
  assert.deepEqual(redeem, { action: 'redeem', code: 'a'.repeat(43), verifier: redeem.verifier });
  assert.match(redeem.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(init.headers.authorization, undefined);
  assert.equal(new URL(local.pairingUrl).searchParams.get('challenge'), createHash('sha256').update(redeem.verifier).digest('hex'));

  const status = await send(local, '/status', { headers: { Authorization: `Bearer ${result.token}` } });
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.body), { user: validUser, expiresAt: result.expiresAt, capabilities: ['bench', 'bench-targets', 'bench-sound'] });
  const identityCall = calls.at(-1);
  assert.deepEqual(JSON.parse(identityCall[1].body), { action: 'identity' });
  assert.equal(identityCall[1].headers.authorization, `Bearer ${API_KEY}`);
  time += DAY + 1;
  const expired = await send(local, '/status', { headers: { Authorization: `Bearer ${result.token}` } });
  assert.equal(expired.status, 401);
});

test('bench requires a paired session, revalidates identity, validates its body, and advertises the capability', async t => {
  const calls = [];
  const local = await helper(t, { runBench: async input => { calls.push(input); return { ok: true, model: 'Samsung Galaxy S4', features: 30 }; } });
  const noSession = await send(local, '/bench', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noSession.status, 401);

  const paired = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  const token = JSON.parse(paired.body).token;
  const status = await send(local, '/status', { headers: { Authorization: `Bearer ${token}` } });
  assert.deepEqual(JSON.parse(status.body).capabilities, ['bench', 'bench-targets', 'bench-sound']);

  const input = { code: 'abcd2345', rom: 'jfltexx/pmos-server', host: 'fe80::1%usb0', user: 'user', password: 'generic-pass' };
  for (const bad of [{ ...input, extra: true }, { ...input, host: 'phone.local' }, { ...input, sound: 1 }]) {
    const response = await send(local, '/bench', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(bad) });
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);

  const response = await send(local, '/bench', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, model: 'Samsung Galaxy S4', features: 30 });
  assert.deepEqual(Object.keys(calls[0]).sort(), ['authorize', 'code', 'fetch', 'host', 'origin', 'password', 'rom', 'signal', 'sound', 'user']);
  for (const key of Object.keys(input)) assert.equal(calls[0][key], input[key]);
  assert.equal(calls[0].sound, false, 'omitted sound is passed to the runner as a silent default');
  assert.equal(calls[0].origin, SITE);
  assert.equal(typeof calls[0].fetch, 'function');
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(typeof calls[0].authorize, 'function');

  const soundResponse = await send(local, '/bench', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, sound: true }) });
  assert.equal(soundResponse.status, 200);
  assert.equal(calls[1].sound, true, 'the explicit sound opt-in reaches the runner');
});

test('benchmark targets require a paired session, revalidate identity, and call only the read-only backend', async t => {
  const calls = [], remoteActions = [];
  const targetResult = {
    targets: [{ host: '172.16.42.1', interface: 'usb0', label: 'usb0 · postmarketOS conventional address (not verified)' }],
    interfaces: [{ name: 'usb0', state: 'UP', addresses: ['172.16.42.2'] }],
  };
  const local = await helper(t, { fetch: async (_url, init) => {
    const action = JSON.parse(init.body).action;
    remoteActions.push(action);
    return Response.json({ user: validUser, expiresAt: expiry(Date.now()), ...(action === 'redeem' ? { credential: API_KEY } : {}) });
  }, benchTargets: async () => { calls.push('read'); return targetResult; } });
  assert.equal((await send(local, '/bench/targets')).status, 401);
  assert.deepEqual(calls, []);

  const paired = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  const token = JSON.parse(paired.body).token;
  const preflight = await send(local, '/bench/targets', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization',
    'Access-Control-Request-Private-Network': 'true',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-headers'], 'authorization');
  const response = await send(local, '/bench/targets', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), targetResult);
  assert.deepEqual(remoteActions, ['redeem', 'identity']);
  assert.deepEqual(calls, ['read']);
});

test('bench revalidates the account and hides unexpected runner errors', async t => {
  let identities = 0, started = 0;
  const local = await helper(t, { credential: API_KEY, identity: { user: validUser, expiresAt: expiry(Date.now()) },
    fetch: async (_url, init) => {
      const action = JSON.parse(init.body).action;
      if (action === 'identity' && ++identities > 1) return Response.json({ error: 'valid API token required' }, { status: 401 });
      return Response.json({ user: validUser, expiresAt: expiry(Date.now()) });
    }, runBench: async () => { started++; } });
  const paired = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  const token = JSON.parse(paired.body).token;
  const input = { code: 'abcd2345', rom: 'jfltexx/pmos-server', host: '172.16.42.1', user: 'user', password: 'secret' };
  const request = () => send(local, '/bench', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const revoked = await request();
  assert.equal(revoked.status, 401);
  assert.doesNotMatch(revoked.body, /private revocation detail|secret/);
  assert.equal(started, 0);

  const failing = await helper(t, { runBench: async () => { throw Error('private rmi_key and password detail'); } });
  const anotherPair = await send(failing, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(failing)) });
  const anotherToken = JSON.parse(anotherPair.body).token;
  const failed = await send(failing, '/bench', { method: 'POST', headers: { Authorization: `Bearer ${anotherToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(failed.status, 502);
  assert.equal(JSON.parse(failed.body).error, 'Benchmark failed.');
  assert.doesNotMatch(failed.body, /private|password|rmi_key/);
});

test('bench rejects concurrent runs and helper close aborts the active run', async t => {
  let begin, started;
  started = new Promise(resolve => { begin = resolve; });
  let runSignal;
  const local = await helper(t, { runBench: ({ signal }) => {
    runSignal = signal;
    begin();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('stopped')), { once: true }));
  } });
  const paired = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  const token = JSON.parse(paired.body).token;
  const input = JSON.stringify({ code: 'abcd2345', rom: 'jfltexx/pmos-server', host: '172.16.42.1', user: 'user', password: 'password' });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const pending = send(local, '/bench', { method: 'POST', headers, body: input }).catch(() => {});
  await started;
  const concurrent = await send(local, '/bench', { method: 'POST', headers, body: input });
  assert.equal(concurrent.status, 409);
  await local.close();
  await pending;
  assert.equal(runSignal.aborted, true);
});

test('saved credentials allow same-account reconnection and preserve the existing bearer token', async t => {
  let now = Date.UTC(2026, 9, 17);
  const calls = [], saves = [];
  const remote = async (_url, init) => {
    calls.push(init);
    const body = JSON.parse(init.body);
    assert.equal(init.headers.authorization, `Bearer ${API_KEY}`);
    if (body.action === 'identity') return Response.json({ user: validUser, expiresAt: expiry(now) });
    return Response.json({ user: validUser, expiresAt: expiry(now) });
  };
  const local = await helper(t, { now: () => now, credential: API_KEY, identity: { user: validUser, expiresAt: expiry(now) },
    fetch: remote, saveCredential: async key => saves.push(key) });
  const first = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  assert.equal(first.status, 200);
  assert.equal(first.body.includes(API_KEY), false);
  const token = JSON.parse(first.body).token;
  assert.deepEqual(calls.map(init => JSON.parse(init.body).action), ['identity', 'redeem']);
  assert.deepEqual(saves, []);

  const replay = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  assert.equal(replay.status, 403);
  const discovery = await send(local, '/discover');
  assert.equal(discovery.status, 200);
  const pending = JSON.parse(discovery.body);
  const second = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: pending.state, code: 'c'.repeat(43) }) });
  assert.equal(second.status, 200);
  assert.equal(second.body.includes(API_KEY), false);
  assert.equal(JSON.parse(second.body).token, token);
  assert.deepEqual(calls.map(init => JSON.parse(init.body).action), ['identity', 'redeem', 'identity', 'redeem']);
});

test('browser session survives helper restart and discovery refreshes its one-use PKCE challenge', async t => {
  let now = Date.UTC(2026, 9, 17), storedSession;
  const LONG_EXPIRY = () => new Date(now + 365 * DAY).toISOString();
  const actions = [];
  const remote = async (_url, init) => {
    const body = JSON.parse(init.body);
    actions.push({ action: body.action, authorization: init.headers.authorization });
    return Response.json({ user: validUser, expiresAt: LONG_EXPIRY(),
      ...(body.action === 'redeem' && !init.headers.authorization ? { credential: API_KEY } : {}) });
  };
  const firstHelper = await helper(t, { now: () => now, fetch: remote,
    saveSession: async (session, credential) => { assert.equal(credential, API_KEY); storedSession = session; } });
  const firstPair = await send(firstHelper, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(firstHelper)) });
  assert.equal(firstPair.status, 200);
  const bearer = JSON.parse(firstPair.body).token;
  assert.equal(storedSession.token, bearer);
  assert.equal(storedSession.port, firstHelper.port);
  assert.equal(storedSession.expiresAt, new Date(now + 30 * DAY).toISOString());
  assert.equal(storedSession.credentialFingerprint, credentialFingerprint(API_KEY));
  await firstHelper.close();

  const restarted = await startHelper({ site: SITE, port: firstHelper.port, now: () => now, fetch: remote,
    credential: API_KEY, identity: { user: validUser, expiresAt: LONG_EXPIRY() }, browserSession: storedSession,
    saveSession: async (session, credential) => { storedSession = session; assert.equal(credential, API_KEY); }, deleteSession: async () => { storedSession = null; } });
  t.after(() => restarted.close());
  assert.equal(restarted.port, firstHelper.port);
  const status = await send(restarted, '/status', { headers: { Authorization: `Bearer ${bearer}` } });
  assert.equal(status.status, 200);
  assert.equal(JSON.parse(status.body).expiresAt, storedSession.expiresAt);

  const oldDiscovery = JSON.parse((await send(restarted, '/discover')).body);
  assert.deepEqual(Object.keys(oldDiscovery).sort(), ['challenge', 'expiresAt', 'state']);
  assert.doesNotMatch(JSON.stringify(oldDiscovery), new RegExp(`${bearer}|${API_KEY}`));
  now += 11 * 60_000;
  const stale = await send(restarted, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: oldDiscovery.state, code: 'c'.repeat(43) }) });
  assert.equal(stale.status, 410);
  const refreshed = JSON.parse((await send(restarted, '/discover')).body);
  assert.notEqual(refreshed.challenge, oldDiscovery.challenge);
  assert.equal(refreshed.expiresAt, new Date(now + 10 * 60_000).toISOString());
  const reconnect = await send(restarted, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: refreshed.state, code: 'd'.repeat(43) }) });
  assert.equal(reconnect.status, 200);
  assert.equal(JSON.parse(reconnect.body).token, bearer);
  assert.equal(actions.filter(item => item.action === 'redeem').length, 2);
  assert.equal(actions.at(-1).authorization, `Bearer ${API_KEY}`);
});

test('network failure preserves the saved browser session and does not report revoked credentials', async t => {
  let calls = 0, deleted = 0, notified = 0;
  const probe = await helper(t);
  const port = probe.port;
  await probe.close();
  const now = Date.now(), session = { version: 1, token: 'z'.repeat(43), port, user: validUser,
    expiresAt: new Date(now + 30 * DAY).toISOString(), credentialFingerprint: credentialFingerprint(API_KEY) };
  const local = await helper(t, { credential: API_KEY, identity: { user: validUser, expiresAt: expiry(now) },
    port, browserSession: session, fetch: async () => {
      if (++calls === 1) throw Error('network unreachable');
      return Response.json({ user: validUser, expiresAt: expiry(now) });
    }, deleteSession: async () => { deleted++; }, onCredentialError: () => notified++ });
  const first = await send(local, '/status', { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(first.status, 503);
  assert.equal(JSON.parse(first.body).error, 'ROMinit is temporarily unavailable. Keep the CLI open and retry.');
  assert.equal(deleted, 0);
  assert.equal(notified, 0);
  const retry = await send(local, '/status', { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(retry.status, 200);
  assert.equal(deleted, 0);
  assert.equal(notified, 0);
});

test('remote expiry caps the local session lifetime', async t => {
  const now = Date.UTC(2026, 9, 17);
  const local = await helper(t, { now: () => now, fetch: async (_url, init) => {
    const body = JSON.parse(init.body);
    return Response.json({ user: validUser, expiresAt: new Date(now + 20 * 60_000).toISOString(), ...(body.action === 'redeem' ? { credential: API_KEY } : {}) });
  }, saveCredential: async () => {} });
  const paired = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  assert.equal(JSON.parse(paired.body).expiresAt, new Date(now + 20 * 60_000).toISOString());
});

test('identity revocation clears the local session and reports only a safe reauthentication message', async t => {
  let calls = 0, notified = 0;
  const local = await helper(t, { credential: API_KEY, identity: { user: validUser, expiresAt: expiry(Date.now()) },
    fetch: async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      if (body.action === 'identity' && calls > 1) return Response.json({ error: 'valid API token required' }, { status: 401 });
      return Response.json({ user: validUser, expiresAt: expiry(Date.now()) });
    }, onCredentialError: () => notified++ });
  const paired = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  const token = JSON.parse(paired.body).token;
  const status = await send(local, '/status', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(status.status, 401);
  assert.doesNotMatch(status.body, /remote secret detail|rmi_[A-Za-z0-9_-]{43}/);
  assert.equal(notified, 1);
  assert.equal((await send(local, '/status', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  assert.equal(calls, 3); // startup, pairing identity, then failed status identity
});

test('keyring failure fails closed without creating or returning a local session', async t => {
  let pairedCallback = 0;
  const local = await helper(t, { saveCredential: async () => { throw Error('private keyring error'); }, onPair: () => pairedCallback++ });
  const response = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  assert.equal(response.status, 500);
  assert.doesNotMatch(response.body, /private keyring error|rmi_[A-Za-z0-9_-]{43}/);
  assert.equal(pairedCallback, 0);
  assert.equal((await send(local, '/status', { headers: { Authorization: `Bearer ${'x'.repeat(43)}` } })).status, 401);
});

test('only one redemption runs at a time and a transient exchange creates no session', async t => {
  let begin, finish;
  const started = new Promise(resolve => { begin = resolve; });
  const remote = new Promise(resolve => { finish = resolve; });
  const local = await helper(t, { fetch: async () => { begin(); return remote; } });
  const pair = pairBody(local);
  const first = send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pair) });
  await started;
  const concurrent = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pair) });
  assert.equal(concurrent.status, 409);
  finish(new Response('private remote detail', { status: 401 }));
  const failed = await first;
  assert.equal(failed.status, 503);
  assert.doesNotMatch(failed.body, /private remote detail|rmi_[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{43}/);
  assert.equal((await send(local, '/status', { headers: { Authorization: `Bearer ${'x'.repeat(43)}` } })).status, 401);
});

test('closing the helper cancels an in-flight remote redemption', async t => {
  let signal, begin;
  const started = new Promise(resolve => { begin = resolve; });
  const local = await helper(t, { fetch: async (_url, init) => {
    signal = init.signal;
    begin();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
  } });
  const pending = send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) }).catch(() => {});
  await started;
  await local.close();
  await pending;
  assert.equal(signal.aborted, true);
});

test('disconnect deletes the remembered pairing before success, invalidates the session, and closes the helper', async t => {
  let persisted = false;
  const local = await helper(t, { saveSession: async () => { persisted = true; }, deleteSession: async () => { persisted = false; } });
  const paired = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  const token = JSON.parse(paired.body).token;
  assert.equal(persisted, true);
  const disconnected = await send(local, '/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(disconnected.status, 200);
  assert.deepEqual(JSON.parse(disconnected.body), { ok: true });
  assert.equal(persisted, false);
  await local.closed;
  assert.equal(local.server.listening, false);
  const restarted = await helper(t, { port: local.port, credential: API_KEY,
    identity: { user: validUser, expiresAt: expiry(Date.now()) }, fetch: async () => Response.json({ user: validUser, expiresAt: expiry(Date.now()) }) });
  assert.equal((await send(restarted, '/status', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});

test('serve validates a saved key before readiness, stays running, and rejects phone flags', async () => {
  const io = { stdin: Object.assign(new PassThrough(), { isTTY: false }), stdout: new PassThrough(), stderr: new PassThrough() };
  let started = 0, closed = 0, release;
  const ready = new Promise(resolve => io.stdout.once('data', chunk => resolve(chunk.toString())));
  const deps = { site: SITE, loadCredential: async () => API_KEY, identifyCredential: async () => ({ user: validUser, expiresAt: expiry(Date.now()) }), startHelper: async options => {
    started++;
    assert.equal(options.credential, API_KEY);
    const closedSignal = new Promise(resolve => { release = resolve; });
    return { host: '127.0.0.1', port: 43129, pairingUrl: `${SITE}/?view=helper`, closed: closedSignal,
      close: async () => { closed++; release(); } };
  } };
  let done = false;
  const running = main(['serve', '--json'], io, deps).then(code => { done = true; return code; });
  const output = await ready;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(done, false);
  process.emit('SIGINT');
  assert.equal(await running, 0);
  assert.equal(started, 1);
  assert.ok(closed >= 1);
  assert.equal(JSON.parse(output).type, 'ready');
  assert.equal(await main(['serve', 'laurel_sprout'], io, deps), 1);
  assert.equal(await main(['serve', '--host', '127.0.0.1'], io, deps), 1);
  assert.equal(started, 1);
});
