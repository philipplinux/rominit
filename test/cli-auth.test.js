import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { main, sendUsbOutcome } from '../bin/cli.mjs';
import { identifyCredential } from '../bin/helper.mjs';
import { credentialFingerprint } from '../bin/credentials.mjs';

const SITE = 'https://rominit.test';
const API_KEY = `rmi_${'m'.repeat(43)}`;
const user = { id: 23, name: 'Philipp\u001b[31m' };
const identity = { user, expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() };

function streams() {
  const stdin = Object.assign(new PassThrough(), { isTTY: false });
  const stdout = new PassThrough(), stderr = new PassThrough();
  let output = '';
  stdout.on('data', chunk => { output += chunk.toString(); });
  stderr.on('data', chunk => { output += chunk.toString(); });
  return { io: { stdin, stdout, stderr }, text: () => output };
}

function liveHelper(port = 18787) {
  let finish;
  const closed = new Promise(resolve => { finish = resolve; });
  return { host: '127.0.0.1', port, pairingUrl: `${SITE}/?view=helper&port=${port}&state=${'s'.repeat(43)}&challenge=${'a'.repeat(64)}`,
    closed, close: async () => finish() };
}

async function untilReady(args, io, deps) {
  let buffered = '';
  let ready;
  const found = new Promise(resolve => { ready = resolve; });
  io.stdout.on('data', chunk => {
    buffered += chunk.toString();
    for (;;) {
      const end = buffered.indexOf('\n');
      if (end < 0) break;
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      try {
        const event = JSON.parse(line);
        if (event.type === 'ready') ready(event);
      } catch { /* Reporter output is newline-delimited JSON in these tests. */ }
    }
  });
  const running = main(args, io, deps);
  return { event: await found, running, stop: async () => { process.emit('SIGINT'); return running; } };
}

test('manual auth stores the key before readiness; serve reloads and revalidates it; logout clears keyring', async () => {
  const stored = new Map();
  const browserSessions = new Map();
  const order = [];
  const { io, text } = streams();
  const authDeps = {
    site: SITE,
    readApiKey: async () => API_KEY,
    identifyCredential: async (site, key) => { order.push('identity'); assert.equal(site, SITE); assert.equal(key, API_KEY); return identity; },
    saveCredential: async (site, key) => { order.push('save'); stored.set(site, key); },
    loadBrowserSession: async (site, key) => { order.push('load-session'); assert.equal(key, API_KEY); return browserSessions.get(site) ?? null; },
    startHelper: async options => {
      order.push('start');
      assert.equal(options.credential, API_KEY);
      assert.deepEqual(options.identity, identity);
      assert.equal(options.port, 18787);
      assert.equal(options.browserSession, null);
      return liveHelper();
    },
  };
  const auth = await untilReady(['auth', '--api-key', '--json'], io, authDeps);
  try {
    assert.deepEqual(order, ['identity', 'save', 'load-session', 'start']);
    assert.equal(auth.event.data.name, 'Philipp [31m');
    assert.doesNotMatch(text(), /\u001b|\r/);
    assert.equal(text().includes(API_KEY), false);
    assert.equal(stored.get(SITE), API_KEY);
  } finally { assert.equal(await auth.stop(), 0); }

  const persisted = { version: 1, token: 'b'.repeat(43), port: 18787, user: identity.user,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(), credentialFingerprint: credentialFingerprint(API_KEY) };
  browserSessions.set(SITE, persisted);
  const serveOrder = [];
  const { io: serveIo, text: serveText } = streams();
  const serve = await untilReady(['serve', '--json'], serveIo, {
    site: SITE,
    loadCredential: async site => { serveOrder.push('load'); return stored.get(site); },
    identifyCredential: async (site, key) => { serveOrder.push('identity'); assert.equal(key, API_KEY); return identity; },
    loadBrowserSession: async (site, key) => { serveOrder.push('load-session'); assert.equal(key, API_KEY); return browserSessions.get(site) ?? null; },
    startHelper: async options => {
      serveOrder.push('start'); assert.equal(options.credential, API_KEY); assert.equal(options.port, 18787);
      assert.deepEqual(options.browserSession, persisted); return liveHelper(options.port);
    },
  });
  try {
    assert.deepEqual(serveOrder, ['load', 'identity', 'load-session', 'start']);
    assert.equal(serve.event.data.name, 'Philipp [31m');
    assert.equal(serveText().includes(API_KEY), false);
  } finally { assert.equal(await serve.stop(), 0); }

  const { io: logoutIo, text: logoutText } = streams();
  const loggedOut = await main(['logout', '--json'], logoutIo, {
    site: SITE,
    deleteBrowserSession: async site => { assert.equal(site, SITE); browserSessions.delete(site); },
    deleteCredential: async site => { assert.equal(site, SITE); stored.delete(site); },
  });
  assert.equal(loggedOut, 0);
  assert.equal(stored.has(SITE), false);
  assert.equal(browserSessions.has(SITE), false);
  assert.match(logoutText(), /Close any running helper/);
  assert.match(logoutText(), /does not revoke the key/);
});

test('serve preserves remembered browser pairing on temporary site failure and clears it only on an actual rejected key', async () => {
  const browserSessions = new Map([[SITE, { version: 1, token: 'b'.repeat(43), port: 18787, user: identity.user,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(), credentialFingerprint: credentialFingerprint(API_KEY) }]]);
  let deleted = 0, started = 0;
  const deps = { site: SITE, loadCredential: async () => API_KEY,
    loadBrowserSession: async site => browserSessions.get(site) ?? null,
    deleteBrowserSession: async site => { deleted++; browserSessions.delete(site); },
    startHelper: async () => { started++; return liveHelper(); } };
  const { io: networkIo, text: networkText } = streams();
  const unavailable = await main(['serve', '--json'], networkIo, { ...deps,
    identifyCredential: async () => { throw Object.assign(Error('ROMinit is temporarily unavailable. Keep the CLI open and retry.'), { code: 'ROMINIT_TRANSIENT' }); } });
  assert.equal(unavailable, 1);
  assert.match(networkText(), /temporarily unavailable/);
  assert.equal(deleted, 0);
  assert.equal(browserSessions.has(SITE), true);
  assert.equal(started, 0);

  const { io: revokedIo, text: revokedText } = streams();
  const revoked = await main(['serve', '--json'], revokedIo, { ...deps,
    identifyCredential: async () => { throw Object.assign(Error('ROMinit API key was rejected or expired. Run "rominit auth".'), { code: 'ROMINIT_AUTH_REJECTED' }); } });
  assert.equal(revoked, 1);
  assert.match(revokedText(), /API key was rejected or expired/);
  assert.equal(deleted, 1);
  assert.equal(browserSessions.has(SITE), false);
  assert.equal(started, 0);
});

test('web auth persists the first redeemed credential through its callback without logging it', async () => {
  const { io, text } = streams();
  let options, stored, pairedName;
  const runningAuth = await untilReady(['auth', '--json'], io, {
    site: SITE,
    startHelper: async value => { options = value; return liveHelper(); },
    saveCredential: async (_site, key) => { stored = key; },
  });
  try {
    await options.saveCredential(API_KEY);
    options.onPair({ name: 'Pair\n\u001b[31m' });
    assert.equal(stored, API_KEY);
    const events = text().trim().split('\n').map(line => JSON.parse(line));
    const paired = events.find(event => event.type === 'paired');
    assert.equal(paired.data.name, 'Pair  [31m');
    assert.equal(text().includes(API_KEY), false);
  } finally { assert.equal(await runningAuth.stop(), 0); }
});

test('the USB report uses the saved CLI key only in Authorization and retries a transient response with the same job ID', async () => {
  const calls = [];
  let attempts = 0;
  const payload = {
    jobId: 'j'.repeat(43), method: 'direct', action: 'direct', outcome: 'success',
    image: { id: 'alpine-standard-aarch64', size: 1024 }, drive: { capacityBytes: 4096 },
    verification: { source: 'verified' }, readback: { size: 1024, matched: true },
  };
  const result = await sendUsbOutcome(SITE, API_KEY, payload, async (url, options) => {
    calls.push({ url, options });
    attempts++;
    if (attempts === 1) throw Error('temporary network failure');
    return Response.json({ ok: true, duplicate: true });
  }, 0);
  assert.deepEqual(result, { ok: true, duplicate: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${SITE}/api/os-usb`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, `Bearer ${API_KEY}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
  assert.deepEqual(JSON.parse(calls[1].options.body), payload);
  assert.equal(calls[0].options.body.includes(API_KEY), false);
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal);
});

test('USB report does not retry rejected 4xx responses or expose response text', async () => {
  let calls = 0;
  await assert.rejects(sendUsbOutcome(SITE, API_KEY, { jobId: 'j'.repeat(43) }, async () => {
    calls++;
    return new Response('private server details', { status: 409 });
  }, 0), /OS USB outcome report failed/);
  assert.equal(calls, 1);
});

test('USB report retries rate-limit and server errors once with the same opaque job ID', async () => {
  const payload = { jobId: 'q'.repeat(43) };
  for (const status of [429, 503]) {
    let calls = 0;
    await sendUsbOutcome(SITE, API_KEY, payload, async (_url, options) => {
      calls++;
      assert.deepEqual(JSON.parse(options.body), payload);
      return calls === 1 ? new Response('{}', { status }) : Response.json({ ok: true, duplicate: true });
    }, 0);
    assert.equal(calls, 2);
  }
});

test('native USB reporter drops invalid environment diagnostics instead of forwarding custom fields', async () => {
  let sent;
  const payload = { jobId: 'v'.repeat(43), method: 'direct', action: 'direct', outcome: 'failed',
    image: { id: 'none', size: 0 }, drive: { capacityBytes: 4096 }, verification: { source: 'none' },
    failureCode: 'preflight', environment: { hostOs: 'linux', hostDistro: 'private-acme-build', rawHost: 'workstation-philipp' } };
  await sendUsbOutcome(SITE, API_KEY, payload, async (_url, options) => {
    sent = JSON.parse(options.body);
    return Response.json({ ok: true, duplicate: false });
  }, 0);
  assert.equal(Object.hasOwn(sent, 'environment'), false);
  assert.doesNotMatch(JSON.stringify(sent), /private-acme-build|workstation-philipp|rawHost/);
});

test('a web-paired key becomes available to the USB reporter without entering its body', { skip: process.platform !== 'linux' && 'USB is Linux-only' }, async () => {
  const { io } = streams();
  let mediaOptions, helperOptions, stored;
  const payload = {
    jobId: 'k'.repeat(43), method: 'ventoy', action: 'copy', outcome: 'success',
    image: { id: 'alpine-standard-x86_64', size: 80 }, drive: { capacityBytes: 100 },
    verification: { source: 'verified' }, readback: { size: 80, matched: true },
  };
  let sent;
  const running = await untilReady(['auth', '--json'], io, {
    site: SITE,
    createUsbMedia: options => { mediaOptions = options; return {}; },
    startHelper: async options => { helperOptions = options; return liveHelper(); },
    saveCredential: async (_site, key) => { stored = key; },
    get: async (url, options) => { sent = { url, options }; return Response.json({ ok: true, duplicate: false }); },
  });
  try {
    await assert.rejects(mediaOptions.reportOutcome(payload), /No saved ROMinit API key/);
    await helperOptions.saveCredential(API_KEY);
    await mediaOptions.reportOutcome(payload);
    assert.equal(stored, API_KEY);
    assert.equal(sent.url, `${SITE}/api/os-usb`);
    assert.equal(sent.options.headers.authorization, `Bearer ${API_KEY}`);
    assert.deepEqual(JSON.parse(sent.options.body), payload);
    assert.equal(sent.options.body.includes(API_KEY), false);
  } finally { assert.equal(await running.stop(), 0); }
});

test('serve binds USB reports to the key loaded from the OS credential store', { skip: process.platform !== 'linux' && 'USB is Linux-only' }, async () => {
  const { io } = streams();
  let mediaOptions, helperOptions, sent;
  const payload = {
    jobId: 's'.repeat(43), method: 'ventoy', action: 'install', outcome: 'failed',
    image: { id: 'none', size: 0 }, drive: { capacityBytes: 2 * 1024 ** 3 },
    verification: { source: 'none' }, failureCode: 'preflight',
  };
  const running = await untilReady(['serve', '--json'], io, {
    site: SITE,
    loadCredential: async () => API_KEY,
    identifyCredential: async () => identity,
    createUsbMedia: options => { mediaOptions = options; return {}; },
    startHelper: async options => { helperOptions = options; return liveHelper(); },
    get: async (url, options) => { sent = { url, options }; return Response.json({ ok: true, duplicate: false }); },
  });
  try {
    assert.equal(helperOptions.credential, API_KEY);
    await mediaOptions.reportOutcome(payload);
    assert.equal(sent.url, `${SITE}/api/os-usb`);
    assert.equal(sent.options.headers.authorization, `Bearer ${API_KEY}`);
    assert.deepEqual(JSON.parse(sent.options.body), payload);
    assert.equal(sent.options.body.includes(API_KEY), false);
  } finally { assert.equal(await running.stop(), 0); }
});

test('manual key entry refuses non-interactive input and never stores or sends anything', async () => {
  const { io, text } = streams();
  let touched = false;
  const code = await main(['auth', '--api-key'], io, {
    site: SITE,
    identifyCredential: async () => { touched = true; return identity; },
    saveCredential: async () => { touched = true; },
    startHelper: async () => { touched = true; return liveHelper(); },
  });
  assert.equal(code, 1);
  assert.equal(touched, false);
  assert.match(text(), /requires an interactive terminal/);
  assert.doesNotMatch(text(), /rmi_[A-Za-z0-9_-]{43}/);
});

test('manual API key validation rejects malformed keys without contacting the site or saving', async () => {
  const { io, text } = streams();
  let fetched = 0, saved = 0;
  const code = await main(['auth', '--api-key'], io, {
    site: SITE,
    readApiKey: async () => 'not-an-api-key',
    get: async () => { fetched++; return Response.json(identity); },
    saveCredential: async () => { saved++; },
  });
  // The helper validates the key shape before making any network request.
  assert.equal(await identifyCredential(SITE, 'not-an-api-key', async () => { fetched++; return Response.json(identity); }).catch(() => null), null);
  assert.equal(code, 1);
  assert.equal(fetched, 0);
  assert.equal(saved, 0);
  assert.match(text(), /API key was rejected or expired/);
});

test('serve fails closed if the keyring has no saved credential', async () => {
  const { io, text } = streams();
  let started = false;
  const code = await main(['serve'], io, { site: SITE, loadCredential: async () => null, startHelper: async () => { started = true; return liveHelper(); } });
  assert.equal(code, 1);
  assert.equal(started, false);
  assert.match(text(), /No saved ROMinit API key/);
});
