import assert from 'node:assert/strict';
import test from 'node:test';
import { disconnectHelper, ensureHelper, helperRequest, helperSession, pairHelper, validHelperSession } from '../site/helper.js';

const good = () => ({ url: 'http://127.0.0.1:49152', token: 't'.repeat(43), user: { id: 7, name: 'Test user' }, expiresAt: new Date(Date.now() + 60_000).toISOString() });
const pairing = () => new URLSearchParams({ port: '49152', state: 's'.repeat(43), challenge: 'a'.repeat(64) });

test('helper credentials accept only an unexpired loopback session', () => {
  assert.equal(validHelperSession(good()), true);
  for (const url of ['https://evil.example', 'http://localhost:49152', 'http://127.0.0.1:65536', 'http://127.0.0.1:49152/path', 'http://127.0.0.1:49152@evil.example'])
    assert.equal(validHelperSession({ ...good(), url }), false);
  assert.equal(validHelperSession({ ...good(), expiresAt: new Date(0).toISOString() }), false);
  assert.equal(validHelperSession({ ...good(), token: '' }), false);
  assert.equal(validHelperSession({ ...good(), user: { id: '7', name: 'Test' } }), false);
});

test('saved CLI sessions migrate from session storage to persistent local storage', () => {
  const oldLocal = globalThis.localStorage, oldSession = globalThis.sessionStorage;
  const local = new Map(), tab = new Map([['rominit.helper', JSON.stringify(good())]]);
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) };
  globalThis.sessionStorage = { getItem: key => tab.get(key) ?? null, setItem: (key, value) => tab.set(key, value), removeItem: key => tab.delete(key) };
  try {
    assert.equal(helperSession().user.id, 7);
    assert.equal(JSON.parse(local.get('rominit.helper')).user.id, 7);
    assert.equal(tab.has('rominit.helper'), false);
  } finally {
    if (oldLocal === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldLocal;
    if (oldSession === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = oldSession;
  }
});

test('a CLI action discovers and pairs the running fixed-port helper without an existing browser session', async () => {
  const oldFetch = globalThis.fetch, oldLocal = globalThis.localStorage, oldSession = globalThis.sessionStorage;
  const local = new Map(), tab = new Map(), calls = [];
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) };
  globalThis.sessionStorage = { getItem: key => tab.get(key) ?? null, setItem: (key, value) => tab.set(key, value), removeItem: key => tab.delete(key) };
  const discovered = { state: 's'.repeat(43), challenge: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, ...init });
    if (url === 'http://127.0.0.1:18787/discover') return Response.json(discovered);
    if (url === './api/helper') return Response.json({ code: 'c'.repeat(43), expiresIn: 60 });
    if (url === 'http://127.0.0.1:18787/pair') return Response.json(good());
    if (url === 'http://127.0.0.1:18787/status') return Response.json({ user: good().user, expiresAt: good().expiresAt, capabilities: ['usb-media'] });
    throw Error(`Unexpected fetch ${url}`);
  };
  try {
    const connected = await ensureHelper(7);
    assert.equal(connected.url, 'http://127.0.0.1:18787');
    assert.equal(JSON.parse(local.get('rominit.helper')).user.id, 7);
    assert.equal(tab.has('rominit.helper'), false);
    assert.equal(calls[0].url, 'http://127.0.0.1:18787/discover');
    assert.equal(calls[0].credentials, 'omit');
    assert.deepEqual(JSON.parse(calls[1].body), { action: 'approve-existing', challenge: discovered.challenge });
    assert.deepEqual(JSON.parse(calls[2].body), { state: discovered.state, code: 'c'.repeat(43) });
    assert.equal(calls[2].credentials, 'omit');
    assert(!JSON.stringify(calls).includes('rmi_'), 'the website must never send or store the CLI API key');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldLocal === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldLocal;
    if (oldSession === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = oldSession;
  }
});

test('a stale saved same-port token discovers a fresh challenge and never replays a USB write', async () => {
  const oldFetch = globalThis.fetch, oldLocal = globalThis.localStorage, oldSession = globalThis.sessionStorage;
  const local = new Map([['rominit.helper', JSON.stringify({ ...good(), url: 'http://127.0.0.1:18787' })]]), calls = [];
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) };
  globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const discovered = { state: 'q'.repeat(43), challenge: 'b'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, ...init });
    if (url === 'http://127.0.0.1:18787/status' && init.headers?.authorization === `Bearer ${'t'.repeat(43)}`) return Response.json({ error: 'expired' }, { status: 401 });
    if (url === 'http://127.0.0.1:18787/discover') return Response.json(discovered);
    if (url === './api/helper') return Response.json({ code: 'c'.repeat(43), expiresIn: 60 });
    if (url === 'http://127.0.0.1:18787/pair') return Response.json({ token: 'u'.repeat(43), user: good().user, expiresAt: good().expiresAt });
    if (url === 'http://127.0.0.1:18787/usb/write') throw Error('response lost after dispatch');
    throw Error(`Unexpected fetch ${url}`);
  };
  try {
    await assert.rejects(helperRequest(good(), '/usb/write', { planId: 'p', confirm: 'COPY' }), /Could not reach your local ROMinit CLI/);
    assert.deepEqual(calls.filter(call => call.url.endsWith('/discover')).map(call => call.url), ['http://127.0.0.1:18787/discover']);
    assert.equal(calls.filter(call => call.url.endsWith('/usb/write')).length, 1, 'an ambiguous lost response is never replayed');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldLocal === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldLocal;
    if (oldSession === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = oldSession;
  }
});

test('helper pairing exchanges a one-use web grant, keeps only the local token, and forgets it on disconnect failure', async () => {
  const oldFetch = globalThis.fetch, oldStorage = globalThis.sessionStorage, oldLocal = globalThis.localStorage;
  const values = new Map(), persistent = new Map(), calls = [];
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.localStorage = { getItem: key => persistent.get(key) ?? null, setItem: (key, value) => persistent.set(key, value), removeItem: key => persistent.delete(key) };
  globalThis.fetch = async (url, init) => {
    calls.push([url, init]);
    if (url === './api/helper') return Response.json({ code: 'c'.repeat(43) });
    if (url.endsWith('/pair')) { const { url: unused, ...session } = good(); return Response.json(session); }
    if (url.endsWith('/status')) return Response.json({ user: good().user, capabilities: [] });
    throw Error('offline');
  };
  try {
    await pairHelper(pairing(), 7);
    assert.equal(helperSession().user.id, 7);
    assert.deepEqual(JSON.parse(calls[0][1].body), { action: 'approve', challenge: 'a'.repeat(64) });
    assert.deepEqual(JSON.parse(calls[1][1].body), { state: 's'.repeat(43), code: 'c'.repeat(43) });
    assert.equal(calls[1][1].credentials, 'omit');
    assert.equal(calls[1][1].redirect, 'error');
    assert(!JSON.stringify([...values.values()]).includes('c'.repeat(43)), 'grant must not be stored');
    await helperRequest(helperSession(), '/status');
    assert.equal(calls[2][1].headers.authorization, `Bearer ${'t'.repeat(43)}`);
    const next = pairing(); next.set('port', '49153');
    await pairHelper(next, 7);
    assert.equal(helperSession().url, 'http://127.0.0.1:49153');
    assert(calls.some(([url]) => url === 'http://127.0.0.1:49152/disconnect'), 'replacing a helper closes the old connection');
    await assert.rejects(disconnectHelper(), /Could not reach your local ROMinit CLI/);
    assert.equal(helperSession(), null);
    const before = calls.length;
    await assert.rejects(pairHelper(new URLSearchParams({ port: 'https://evil.example' }), 7), /Invalid pairing/);
    assert.equal(calls.length, before, 'invalid pairing links must never reach a network');
    await assert.rejects(pairHelper(pairing(), 99), /different ROMinit account/);
    assert.equal(helperSession(), null);
    assert(calls.some(([url]) => url.endsWith('/disconnect')));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = oldStorage;
    if (oldLocal === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldLocal;
  }
});

test('CLI benchmark sends credentials only to the paired helper with a long request timeout', async () => {
  const oldFetch = globalThis.fetch, oldTimeout = AbortSignal.timeout, oldLocal = globalThis.localStorage, calls = [], timeouts = [];
  const persistent = new Map();
  globalThis.localStorage = { getItem: key => persistent.get(key) ?? null, setItem: (key, value) => persistent.set(key, value), removeItem: key => persistent.delete(key) };
  const input = { code: 'b'.repeat(12), rom: 'device/rom', host: '172.16.42.1', user: 'user', password: 'secret', sound: true };
  AbortSignal.timeout = ms => { timeouts.push(ms); return new AbortController().signal; };
  globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); return url.endsWith('/status') ? Response.json({ user: good().user, expiresAt: good().expiresAt, capabilities: [] }) : Response.json({ ok: true }); };
  try {
    await helperRequest(good(), '/status');
    await helperRequest(good(), '/bench/targets');
    await helperRequest(good(), '/bench', input);
    assert.deepEqual(timeouts, [10_000, 10_000, 10_000, 10_000, 10_000, 240_000]);
    const targets = calls.find(call => call.url.endsWith('/bench/targets'));
    const bench = calls.find(call => call.url.endsWith('/bench'));
    assert.equal(targets.url, 'http://127.0.0.1:49152/bench/targets');
    assert.equal(targets.method, 'GET');
    assert.equal(targets.body, undefined);
    assert.equal(targets.headers.authorization, `Bearer ${'t'.repeat(43)}`);
    assert.equal(bench.url, 'http://127.0.0.1:49152/bench');
    assert.equal(bench.method, 'POST');
    assert.equal(bench.credentials, 'omit');
    assert.equal(bench.redirect, 'error');
    assert.equal(bench.headers.authorization, `Bearer ${'t'.repeat(43)}`);
    assert.equal(bench.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(bench.body), input);
    assert(calls.every(({ url }) => new URL(url).hostname === '127.0.0.1'), 'phone credentials must stay on the paired local CLI');
    const before = calls.length;
    await assert.rejects(helperRequest(good(), '/bench/targets', {}), /Invalid helper request/);
    assert.equal(calls.length, before, 'target discovery only accepts the allowlisted GET without a payload');
  } finally { globalThis.fetch = oldFetch; AbortSignal.timeout = oldTimeout; if (oldLocal === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldLocal; }
});

test('USB media routes use only their allowlisted local methods and JSON payloads', async () => {
  const oldFetch = globalThis.fetch, oldLocal = globalThis.localStorage, persistent = new Map(), calls = [];
  globalThis.localStorage = { getItem: key => persistent.get(key) ?? null, setItem: (key, value) => persistent.set(key, value), removeItem: key => persistent.delete(key) };
  globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); return url === 'http://127.0.0.1:49152/status' ? Response.json({ user: good().user, expiresAt: good().expiresAt, capabilities: ['usb-media'] }) : Response.json({ ok: true }); };
  const session = good();
  const plan = { driveId: 'usb-1', method: 'ventoy' }, write = { planId: 'plan-1', confirm: 'ERASE USB-1' };
  try {
    await helperRequest(session, '/usb/drives');
    await helperRequest(session, '/usb/plan', plan);
    await helperRequest(session, '/usb/write', write);
    await helperRequest(session, '/usb/status');
    assert.deepEqual(calls.filter(({ url }) => new URL(url).pathname !== '/status').map(({ url, method }) => [new URL(url).pathname, method]), [
      ['/usb/drives', 'GET'], ['/usb/plan', 'POST'], ['/usb/write', 'POST'], ['/usb/status', 'GET'],
    ]);
    assert.deepEqual(JSON.parse(calls.find(call => call.url.endsWith('/usb/plan')).body), plan);
    assert.deepEqual(JSON.parse(calls.find(call => call.url.endsWith('/usb/write')).body), write);
    assert(calls.every(call => call.credentials === 'omit' && new URL(call.url).hostname === '127.0.0.1'));
    const before = calls.length;
    await assert.rejects(helperRequest(session, '/usb/plan'), /Invalid helper request/);
    await assert.rejects(helperRequest(session, '/usb/write', []), /Invalid helper request/);
    await assert.rejects(helperRequest(session, '/usb/status', {}), /Invalid helper request/);
    await assert.rejects(helperRequest(session, '/not-allowed', {}), /Invalid helper request/);
    assert.equal(calls.length, before, 'invalid routes and array payloads do not reach the network');
  } finally { globalThis.fetch = oldFetch; if (oldLocal === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldLocal; }
});

test('a failed local connection explains how to start the CLI instead of exposing a generic fetch error', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try { await assert.rejects(helperRequest(good(), '/status'), /Could not find a running ROMinit CLI at 127\.0\.0\.1:18787/); }
  finally { globalThis.fetch = previous; }
});
