import assert from 'node:assert/strict';
import nodeTest from 'node:test';
// bench scripts run under POSIX sh, which Windows lacks
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;
import { onRequestPost } from '../functions/b/[code].js';

test('OS mismatch is saved as a failed run and returned to the terminal instead of a report card', async () => {
  const writes = [];
  const env = { DB: { prepare: sql => ({ bind: (...args) => ({
    first: async () => ({ rom: 'starlte/official-a15' }),
    run: async () => writes.push({ sql, args }),
  }) }) } };
  const output = '@ failed os-mismatch: This test is for Android, but this phone is running Linux.\n';
  const response = await onRequestPost({ env, params: { code: 'abcd2345' }, request: new Request('https://rominit.test/b/abcd2345', { method: 'POST', body: output }) });
  assert.equal(response.status, 409);
  assert.equal(await response.text(), output.slice(2));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args, ['abcd2345', output]);
});

import { onRequestGet } from '../functions/b/[code].js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function environment(os = 'Android') {
  const writes = [];
  return { writes, DB: { prepare: sql => ({ bind: (...args) => ({
    first: async () => ({ rom: 'starlte/test' }), run: async () => writes.push({ sql, args }),
  }) }) }, ASSETS: { fetch: async url => url.pathname === '/catalog/index.json'
    ? Response.json([{ codename: 'starlte', vendor: 'Samsung', roms: [{ id: 'test', os }] }])
    : new Response(`VERSION=${url.pathname.includes('linux') ? 2 : 1}\necho '@ script ${url.pathname.includes('linux') ? 'linux 2' : 'android 1'}'\n`) } };
}

test('downloaded bootstrap chooses the actual OS without needing network on the phone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rominit-os-'));
  try {
    writeFileSync(join(dir, 'getprop'), '#!/bin/sh\nprintf "%s" "$TEST_SDK"\n');
    chmodSync(join(dir, 'getprop'), 0o755);
    for (const selected of ['Android', 'postmarketOS']) {
      const response = await onRequestGet({ env: environment(selected), params: { code: 'abcd2345' }, request: new Request('https://rominit.test/b/abcd2345') });
      const script = await response.text();
      assert.match(script, new RegExp(`^VERSION=${selected === 'Android' ? 1 : 2}$`, 'm'), 'existing CLI version check remains compatible');
      for (const [sdk, actual] of [['', 'linux 2'], ['35', 'android 1']]) {
        const run = spawnSync('/bin/sh', [], { input: script, encoding: 'utf8', env: { PATH: `${dir}:/usr/bin:/bin`, TEST_SDK: sdk } });
        assert.equal(run.status, 0, run.stderr);
        assert.equal(run.stdout.trim(), `@ script ${actual}`);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detected Linux results cannot be filed under a selected Android ROM', async () => {
  const env = environment();
  const response = await onRequestPost({ env, params: { code: 'abcd2345' }, request: new Request('https://rominit.test/b/abcd2345', {
    method: 'POST', body: '@ script linux 2\n@ model Samsung S9\nbattery full 69%\n@ done\n',
  }) });
  assert.equal(response.status, 409);
  assert.match(env.writes[0].args[1], /^@ failed os-mismatch: Detected Linux/);
  assert.doesNotMatch(env.writes[0].args[1], /battery full/);
});
