import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { main } from '../bin/cli.mjs';
import { identifyCredential } from '../bin/helper.mjs';

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

function liveHelper() {
  let finish;
  const closed = new Promise(resolve => { finish = resolve; });
  return { host: '127.0.0.1', port: 43129, pairingUrl: `${SITE}/?view=helper&port=43129&state=${'s'.repeat(43)}&challenge=${'a'.repeat(64)}`,
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
  const order = [];
  const { io, text } = streams();
  const authDeps = {
    site: SITE,
    readApiKey: async () => API_KEY,
    identifyCredential: async (site, key) => { order.push('identity'); assert.equal(site, SITE); assert.equal(key, API_KEY); return identity; },
    saveCredential: async (site, key) => { order.push('save'); stored.set(site, key); },
    startHelper: async options => {
      order.push('start');
      assert.equal(options.credential, API_KEY);
      assert.deepEqual(options.identity, identity);
      return liveHelper();
    },
  };
  const auth = await untilReady(['auth', '--api-key', '--json'], io, authDeps);
  try {
    assert.deepEqual(order, ['identity', 'save', 'start']);
    assert.equal(auth.event.data.name, 'Philipp [31m');
    assert.doesNotMatch(text(), /\u001b|\r/);
    assert.equal(text().includes(API_KEY), false);
    assert.equal(stored.get(SITE), API_KEY);
  } finally { assert.equal(await auth.stop(), 0); }

  const serveOrder = [];
  const { io: serveIo, text: serveText } = streams();
  const serve = await untilReady(['serve', '--json'], serveIo, {
    site: SITE,
    loadCredential: async site => { serveOrder.push('load'); return stored.get(site); },
    identifyCredential: async (site, key) => { serveOrder.push('identity'); assert.equal(key, API_KEY); return identity; },
    startHelper: async options => { serveOrder.push('start'); assert.equal(options.credential, API_KEY); return liveHelper(); },
  });
  try {
    assert.deepEqual(serveOrder, ['load', 'identity', 'start']);
    assert.equal(serve.event.data.name, 'Philipp [31m');
    assert.equal(serveText().includes(API_KEY), false);
  } finally { assert.equal(await serve.stop(), 0); }

  const { io: logoutIo, text: logoutText } = streams();
  const loggedOut = await main(['logout', '--json'], logoutIo, {
    site: SITE,
    deleteCredential: async site => { assert.equal(site, SITE); stored.delete(site); },
  });
  assert.equal(loggedOut, 0);
  assert.equal(stored.has(SITE), false);
  assert.match(logoutText(), /Close any running helper/);
  assert.match(logoutText(), /does not revoke the key/);
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
