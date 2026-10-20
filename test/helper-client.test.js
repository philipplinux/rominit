import assert from 'node:assert/strict';
import test from 'node:test';
import { disconnectHelper, helperRequest, helperSession, pairHelper, validHelperSession } from '../site/helper.js';

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

test('helper pairing exchanges a one-use web grant, keeps only the local token, and forgets it on disconnect failure', async () => {
  const oldFetch = globalThis.fetch, oldStorage = globalThis.sessionStorage;
  const values = new Map(), calls = [];
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
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
    await assert.rejects(disconnectHelper(), /offline/);
    assert.equal(helperSession(), null);
    const before = calls.length;
    await assert.rejects(pairHelper(new URLSearchParams({ port: 'https://evil.example' }), 7), /Invalid pairing/);
    assert.equal(calls.length, before, 'invalid pairing links must never reach a network');
    await assert.rejects(pairHelper(pairing(), 99), /account changed/);
    assert.equal(helperSession(), null);
    assert(calls.some(([url]) => url.endsWith('/disconnect')));
  } finally { globalThis.fetch = oldFetch; if (oldStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = oldStorage; }
});
