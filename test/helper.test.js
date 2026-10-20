import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { startHelper } from '../bin/helper.mjs';
import { main } from '../bin/cli.mjs';

const SITE = 'https://rominit.test';
const API_KEY = `rmi_${'k'.repeat(43)}`;
const validUser = { id: 7, name: 'Philipp' };
const DAY = 24 * 60 * 60_000;
const expiry = now => new Date(now + DAY).toISOString();
const pairBody = helper => ({ state: new URL(helper.pairingUrl).searchParams.get('state'), code: 'a'.repeat(43) });

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

  const badHost = await send(local, '/status', { headers: { Host: `localhost:${local.port}` } });
  assert.equal(badHost.status, 403);
  assert.equal(badHost.headers['access-control-allow-origin'], undefined);
  const badOrigin = await send(local, '/status', { headers: { Origin: 'https://attacker.test' } });
  assert.equal(badOrigin.status, 403);
  assert.equal(badOrigin.headers['access-control-allow-origin'], undefined);
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

test('web redemption stores the account key and returns only a short-lived local token', async t => {
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
  assert.equal(result.expiresAt, new Date(time + 60 * 60_000).toISOString());
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
  assert.deepEqual(JSON.parse(status.body), { user: validUser, expiresAt: result.expiresAt, capabilities: [] });
  const identityCall = calls.at(-1);
  assert.deepEqual(JSON.parse(identityCall[1].body), { action: 'identity' });
  assert.equal(identityCall[1].headers.authorization, `Bearer ${API_KEY}`);
  time += 60 * 60_000 + 1;
  const expired = await send(local, '/status', { headers: { Authorization: `Bearer ${result.token}` } });
  assert.equal(expired.status, 401);
});

test('saved credentials authorize browser pairing without another login and may reconnect after local expiry', async t => {
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
  assert.deepEqual(calls.map(init => JSON.parse(init.body).action), ['identity', 'redeem']);
  assert.deepEqual(saves, []);

  const busy = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  assert.equal(busy.status, 409);
  now += 60 * 60_000 + 1;
  const second = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  assert.equal(second.status, 200);
  assert.equal(second.body.includes(API_KEY), false);
  assert.deepEqual(calls.map(init => JSON.parse(init.body).action), ['identity', 'redeem', 'identity', 'redeem']);
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
      if (body.action === 'identity' && calls > 1) return new Response('remote secret detail', { status: 401 });
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

test('only one redemption runs at a time and a rejected exchange creates no session', async t => {
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
  assert.equal(failed.status, 502);
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

test('disconnect accepts no body, invalidates the session, and closes the helper', async t => {
  const local = await helper(t);
  const paired = await send(local, '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairBody(local)) });
  const token = JSON.parse(paired.body).token;
  const disconnected = await send(local, '/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(disconnected.status, 200);
  assert.deepEqual(JSON.parse(disconnected.body), { ok: true });
  await local.closed;
  assert.equal(local.server.listening, false);
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
