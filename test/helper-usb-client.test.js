import assert from 'node:assert/strict';
import test from 'node:test';
import { helperRequest } from '../site/helper.js';

const session = { url: 'http://127.0.0.1:49152', token: 't'.repeat(43), user: { id: 7, name: 'Test user' }, expiresAt: new Date(Date.now() + 60_000).toISOString() };

test('helper USB routes use only the allowlisted methods and JSON write payloads', async () => {
  const oldFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => { calls.push([url, init]); return Response.json({ ok: true }); };
  try {
    await helperRequest(session, '/usb/drives');
    await helperRequest(session, '/usb/plan', { driveId: '/dev/sdb', method: 'ventoy' });
    await helperRequest(session, '/usb/write', { planId: 'plan-1', confirm: 'ERASE /dev/sdb' });
    await helperRequest(session, '/usb/status');
    await helperRequest(session, '/disconnect');

    assert.deepEqual(calls.map(([url, init]) => [url, init.method, init.body]), [
      ['http://127.0.0.1:49152/usb/drives', 'GET', undefined],
      ['http://127.0.0.1:49152/usb/plan', 'POST', JSON.stringify({ driveId: '/dev/sdb', method: 'ventoy' })],
      ['http://127.0.0.1:49152/usb/write', 'POST', JSON.stringify({ planId: 'plan-1', confirm: 'ERASE /dev/sdb' })],
      ['http://127.0.0.1:49152/usb/status', 'GET', undefined],
      ['http://127.0.0.1:49152/disconnect', 'POST', undefined],
    ]);
    assert.equal(calls[1][1].headers['content-type'], 'application/json');
    assert.equal(calls[2][1].headers.authorization, `Bearer ${session.token}`);
    await assert.rejects(helperRequest(session, '/usb/other'), /Unsupported helper request/);
    await assert.rejects(helperRequest(session, '/usb/plan'), /Invalid helper request/);
    await assert.rejects(helperRequest(session, '/usb/status', {}), /Invalid helper request/);
    assert.equal(calls.length, 5, 'invalid requests must never reach the helper');
  } finally { globalThis.fetch = oldFetch; }
});
