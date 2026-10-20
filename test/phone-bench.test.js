import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { benchmarkScript } from '../src/bench.js';
import { runPhoneBench, validatePhoneBench } from '../bin/phone-bench.mjs';

const ORIGIN = 'https://rominit.test';
const input = { code: 'abcd2345', rom: 'jfltexx/pmos-server', host: 'fe80::1%usb0', user: 'user', password: 'private-pass' };
const device = { codename: 'jfltexx', vendor: 'Samsung', name: 'Galaxy S4', roms: [{ id: 'pmos-server', os: 'postmarketOS' }] };
const output = model => `@ script linux 2\n@ kernel Linux test\n@ model ${model}\n@ os postmarketOS\nflashing full booted this ROM\nstorage partial reads\n@ done\n`;
const bundled = await readFile(new URL('../site/bench/linux.sh', import.meta.url));
const remoteScript = bundled.toString('utf8');
const androidInput = { ...input, rom: 'laurel_sprout/stock' };
const androidDevice = { codename: 'laurel_sprout', vendor: 'Xiaomi', name: 'Mi A3', roms: [{ id: 'stock', os: 'Android' }] };
const androidOutput = model => `@ script android 1\n@ kernel Linux test\n@ model ${model}\n@ os Android test\nflashing full booted this ROM\nstorage partial reads\n@ done\n`;
const androidBundled = await readFile(new URL('../site/bench/android.sh', import.meta.url));
const androidRemoteScript = androidBundled.toString('utf8');

function fakeSpawn({ stdout = output('Samsung Galaxy S4 (jflte)'), exitCode = 0, hang = false, stubborn = false } = {}, seen = {}) {
  return (command, args, options) => {
    seen.command = command;
    seen.args = args;
    seen.options = options;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin.on('data', chunk => { seen.script = Buffer.concat([seen.script ?? Buffer.alloc(0), chunk]); });
    child.kill = signal => {
      (seen.killed ??= []).push(signal);
      if (stubborn && signal === 'SIGTERM') return true;
      queueMicrotask(() => { child.stdout.end(); child.emit('close', null, signal); });
      return true;
    };
    child.once('error', () => {});
    if (!hang) {
      child.stdout.once('end', () => child.emit('close', exitCode, null));
      queueMicrotask(() => child.stdout.end(stdout));
    }
    return child;
  };
}

function fakeFetch({ catalog = device, script = remoteScript, codeStatus = 200, posts = [], events = [] } = {}) {
  return async (url, init = {}) => {
    events.push(`${init.method ?? 'GET'} ${url}`);
    if (url === `${ORIGIN}/catalog/${catalog.codename}.json`) return Response.json(catalog);
    if (url === `${ORIGIN}/b/${input.code}` && !init.method) return new Response(script, { status: codeStatus });
    if (url === `${ORIGIN}/b/${input.code}` && init.method === 'POST') {
      posts.push([url, init]);
      return new Response('ROMinit: results received.');
    }
    throw Error(`unexpected request ${url}`);
  };
}

test('strict inputs accept literal IPs and reject shell syntax, unsafe paths, and unbounded secrets', () => {
  assert.deepEqual(validatePhoneBench(input), { ...input, sound: false }, 'sound defaults off for older helper callers');
  assert.deepEqual(validatePhoneBench({ ...input, sound: true }), { ...input, sound: true });
  assert.equal(validatePhoneBench({ ...input, host: '172.16.42.1' }).host, '172.16.42.1');
  assert.equal(validatePhoneBench({ ...input, rom: 'fairphone-fp4/pmos-server' }).rom, 'fairphone-fp4/pmos-server');
  for (const bad of [
    { ...input, code: 'ABCDEFGH' }, { ...input, rom: '../x' }, { ...input, rom: 'jfltexx/..' }, { ...input, rom: 'jfltexx/../../x' },
    { ...input, host: 'phone.local' }, { ...input, host: '192.168.1.5%eth0' }, { ...input, host: 'fe80::1%' },
    { ...input, user: '-oProxyCommand=bad' }, { ...input, user: 'user;id' }, { ...input, password: 'x'.repeat(257) },
    { ...input, password: 'bad\0value' }, { ...input, extra: 'rejected' },
    { ...input, sound: 1 }, { ...input, sound: 'true' }, { ...input, sound: null },
  ]) assert.throws(() => validatePhoneBench(bad));
});

test('runs only the bundled script, checks device identity, and uploads output for browser review', async () => {
  const seen = {}, posts = [], events = [];
  const get = fakeFetch({ script: `${remoteScript}\n# remote-only payload\n`, posts, events });
  const result = await runPhoneBench({ ...input, origin: ORIGIN, fetch: get, spawn: fakeSpawn({}, seen),
    authorize: async () => events.push('authorized') });

  assert.deepEqual(result, { ok: true, model: 'Samsung Galaxy S4 (jflte)', features: 2 });
  assert.equal(seen.command, 'sshpass');
  assert.deepEqual(seen.args.slice(0, 2), ['-e', 'ssh']);
  assert.equal(seen.args.at(-1), 'env ROMINIT_SOUND=0 sh -s', 'default runner explicitly disables inherited sound opt-in');
  assert.equal(seen.args.includes(input.password), false);
  assert.ok(seen.args.includes('/dev/null'));
  assert.ok(seen.args.includes('PubkeyAuthentication=no'));
  assert.equal(seen.options.env.SSHPASS, input.password);
  assert.deepEqual(Object.keys(seen.options.env).sort(), ['PATH', 'SSHPASS']);
  assert.equal(seen.script.toString(), benchmarkScript(bundled.toString(), androidBundled.toString(), 'linux'));
  assert.equal(seen.script.toString().includes('remote-only payload'), false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0][1].body, output('Samsung Galaxy S4 (jflte)'));
  assert.equal(posts[0][1].headers.authorization, undefined);
  assert.deepEqual(events, [
    `GET ${ORIGIN}/catalog/jfltexx.json`, `GET ${ORIGIN}/b/${input.code}`, 'authorized', `POST ${ORIGIN}/b/${input.code}`,
  ]);
});

test('runs the bundled Android script for Android ROMs and validates Android output identity', async () => {
  const seen = {}, posts = [], events = [];
  const get = fakeFetch({ catalog: androidDevice, script: androidRemoteScript, posts, events });
  const result = await runPhoneBench({ ...androidInput, origin: ORIGIN, fetch: get,
    spawn: fakeSpawn({ stdout: androidOutput('Xiaomi Mi A3 (laurel_sprout)') }, seen) });

  assert.deepEqual(result, { ok: true, model: 'Xiaomi Mi A3 (laurel_sprout)', features: 2 });
  assert.equal(seen.script.toString(), benchmarkScript(bundled.toString(), androidBundled.toString(), 'android'));
  assert.equal(seen.args.includes(androidInput.password), false);
  assert.equal(seen.options.env.SSHPASS, androidInput.password);
  assert.equal(posts.length, 1);
  assert.equal(posts[0][1].body, androidOutput('Xiaomi Mi A3 (laurel_sprout)'));
  assert.deepEqual(events, [
    `GET ${ORIGIN}/catalog/laurel_sprout.json`, `GET ${ORIGIN}/b/${androidInput.code}`, `POST ${ORIGIN}/b/${androidInput.code}`,
  ]);
});

test('sound stays off by default and reaches the phone only as a fixed opt-in remote command', async () => {
  const seen = {};
  await runPhoneBench({ ...input, sound: true, origin: ORIGIN, fetch: fakeFetch(), spawn: fakeSpawn({}, seen) });
  assert.equal(seen.args.at(-1), 'env ROMINIT_SOUND=1 sh -s');
  assert.equal(seen.options.env.ROMINIT_SOUND, undefined, 'sound is not added to the local helper environment');
});

test('rejects a different or missing phone model without uploading its results', async () => {
  for (const model of ['Samsung Galaxy S9 (starlte)', '']) {
    const posts = [];
    await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: fakeFetch({ posts }),
      spawn: fakeSpawn({ stdout: output(model) }) }), /does not match|no model name/);
    assert.equal(posts.length, 0);
  }
});

test('refuses unsupported catalog systems or a mismatched browser script before SSH', async () => {
  const unsupported = { ...device, roms: [{ id: 'other', os: 'Ubuntu Touch' }] };
  await assert.rejects(runPhoneBench({ ...input, rom: 'jfltexx/other', origin: ORIGIN,
    fetch: fakeFetch({ catalog: unsupported }), spawn: () => assert.fail('must not spawn') }), /not a supported Android or postmarketOS/);
  await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: fakeFetch({ script: 'echo android', codeStatus: 404 }),
    spawn: () => assert.fail('must not spawn') }), /expired or ROMinit rejected/);
  await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: fakeFetch({ script: 'echo android' }),
    spawn: () => assert.fail('must not spawn') }), /not an active linux benchmark/);
  await assert.rejects(runPhoneBench({ ...androidInput, origin: ORIGIN, fetch: fakeFetch({ catalog: androidDevice, script: remoteScript }),
    spawn: () => assert.fail('must not spawn') }), /not an active android benchmark/);
});

test('rejects redirect responses instead of following them', async () => {
  const requests = [];
  const get = async (url, init) => {
    requests.push([url, init]);
    return url.endsWith('/catalog/jfltexx.json') ? Response.json(device)
      : new Response('', { status: 302, headers: { location: 'https://attacker.test/script' } });
  };
  await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: get, spawn: () => assert.fail('must not spawn') }), /expired or ROMinit rejected/);
  assert.ok(requests.every(([, init]) => init.redirect === 'error'));
});

test('nonzero SSH exit and invalid script output do not reach the upload endpoint', async () => {
  for (const options of [{ exitCode: 255 }, { stdout: 'arbitrary output' }]) {
    const posts = [];
    await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: fakeFetch({ posts }), spawn: fakeSpawn(options) }));
    assert.equal(posts.length, 0);
  }
});

test('Android output with a Linux marker is rejected without upload', async () => {
  const posts = [];
  await assert.rejects(runPhoneBench({ ...androidInput, origin: ORIGIN,
    fetch: fakeFetch({ catalog: androidDevice, script: androidRemoteScript, posts }),
    spawn: fakeSpawn({ stdout: output('Xiaomi Mi A3') }) }), /Detected phone OS|invalid benchmark output/);
  assert.equal(posts.length, 0);
});

test('SSH timeout and output cap kill the child and prevent upload', async () => {
  const posts = [], timeoutSeen = {};
  await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: fakeFetch({ posts }), spawn: fakeSpawn({ hang: true }, timeoutSeen), timeoutMs: 5 }), /timed out/);
  assert.deepEqual(timeoutSeen.killed, ['SIGTERM']);
  const stubbornSeen = {};
  await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: fakeFetch({ posts }), spawn: fakeSpawn({ hang: true, stubborn: true }, stubbornSeen), timeoutMs: 5 }), /timed out/);
  assert.deepEqual(stubbornSeen.killed, ['SIGTERM', 'SIGKILL']);
  const sizeSeen = {};
  await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: fakeFetch({ posts }), spawn: fakeSpawn({ stdout: output('Samsung Galaxy S4') }, sizeSeen), maxOutputBytes: 20 }), /size limit/);
  assert.ok(sizeSeen.killed.includes('SIGTERM'));
  assert.equal(posts.length, 0);
});

test('real Android catalog families are supported over SSH', async () => {
  for (const os of ['GrapheneOS', 'LineageOS', 'eOS']) {
    const catalog = { ...androidDevice, roms: [{ id: 'stock', os }] };
    const result = await runPhoneBench({ ...androidInput, origin: ORIGIN,
      fetch: fakeFetch({ catalog, script: androidRemoteScript }),
      spawn: fakeSpawn({ stdout: androidOutput('Xiaomi Mi A3 (laurel_sprout)') }) });
    assert.equal(result.ok, true);
  }
});

test('pmOS device identity accepts the S9 board name and rejects another device even with a matching name', async () => {
  const catalog = { codename: 'starlte', vendor: 'Samsung', name: 'Galaxy S9', roms: [{ id: 'pmos-server', os: 'postmarketOS' }] };
  for (const [detected, valid] of [['samsung-starlte', true], ['samsung-star2lte', false]]) {
    const posts = [];
    const run = () => runPhoneBench({ ...input, rom: 'starlte/pmos-server', origin: ORIGIN,
      fetch: fakeFetch({ catalog, posts }), spawn: fakeSpawn({ stdout: output('Samsung Star rev26 board based on EXYNOS9810').replace('@ done', `@ device ${detected}\n@ done`) }) });
    if (valid) assert.equal((await run()).ok, true);
    else await assert.rejects(run(), /does not match/);
    assert.equal(posts.length, valid ? 1 : 0);
  }
});

test('early OS guard failure explains the ROM mismatch rather than an SSH login failure', async () => {
  const posts = [];
  await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: fakeFetch({ posts }),
    spawn: fakeSpawn({ exitCode: 1, stdout: '@ failed os-mismatch: Wrong family.\n' }) }), /Detected phone OS differs/);
  assert.equal(posts.length, 0);
});
