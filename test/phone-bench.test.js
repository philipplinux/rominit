import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { runPhoneBench, validatePhoneBench } from '../bin/phone-bench.mjs';

const ORIGIN = 'https://rominit.test';
const input = { code: 'abcd2345', rom: 'jfltexx/pmos-server', host: 'fe80::1%usb0', user: 'user', password: 'private-pass' };
const device = { codename: 'jfltexx', vendor: 'Samsung', name: 'Galaxy S4', roms: [{ id: 'pmos-server', os: 'postmarketOS' }] };
const output = model => `@ script linux 2\n@ kernel Linux test\n@ model ${model}\n@ os postmarketOS\nflashing full booted this ROM\nstorage partial reads\n@ done\n`;
const bundled = await readFile(new URL('../site/bench/linux.sh', import.meta.url));
const remoteScript = bundled.toString('utf8');

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
    if (url === `${ORIGIN}/catalog/jfltexx.json`) return Response.json(catalog);
    if (url === `${ORIGIN}/b/${input.code}` && !init.method) return new Response(script, { status: codeStatus });
    if (url === `${ORIGIN}/b/${input.code}` && init.method === 'POST') {
      posts.push([url, init]);
      return new Response('ROMinit: results received.');
    }
    throw Error(`unexpected request ${url}`);
  };
}

test('strict inputs accept literal IPs and reject shell syntax, unsafe paths, and unbounded secrets', () => {
  assert.deepEqual(validatePhoneBench(input), input);
  assert.equal(validatePhoneBench({ ...input, host: '172.16.42.1' }).host, '172.16.42.1');
  assert.equal(validatePhoneBench({ ...input, rom: 'fairphone-fp4/pmos-server' }).rom, 'fairphone-fp4/pmos-server');
  for (const bad of [
    { ...input, code: 'ABCDEFGH' }, { ...input, rom: '../x' }, { ...input, rom: 'jfltexx/..' }, { ...input, rom: 'jfltexx/../../x' },
    { ...input, host: 'phone.local' }, { ...input, host: '192.168.1.5%eth0' }, { ...input, host: 'fe80::1%' },
    { ...input, user: '-oProxyCommand=bad' }, { ...input, user: 'user;id' }, { ...input, password: 'x'.repeat(257) },
    { ...input, password: 'bad\0value' }, { ...input, extra: 'rejected' },
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
  assert.equal(seen.args.includes(input.password), false);
  assert.ok(seen.args.includes('/dev/null'));
  assert.ok(seen.args.includes('PubkeyAuthentication=no'));
  assert.equal(seen.options.env.SSHPASS, input.password);
  assert.deepEqual(Object.keys(seen.options.env).sort(), ['PATH', 'SSHPASS']);
  assert.deepEqual(seen.script, bundled);
  assert.equal(seen.script.toString().includes('remote-only payload'), false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0][1].body, output('Samsung Galaxy S4 (jflte)'));
  assert.equal(posts[0][1].headers.authorization, undefined);
  assert.deepEqual(events, [
    `GET ${ORIGIN}/catalog/jfltexx.json`, `GET ${ORIGIN}/b/${input.code}`, 'authorized', `POST ${ORIGIN}/b/${input.code}`,
  ]);
});

test('rejects a different or missing phone model without uploading its results', async () => {
  for (const model of ['Samsung Galaxy S9 (starlte)', '']) {
    const posts = [];
    await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: fakeFetch({ posts }),
      spawn: fakeSpawn({ stdout: output(model) }) }), /does not match|no model name/);
    assert.equal(posts.length, 0);
  }
});

test('refuses non-Linux or expired browser codes and non-postmarketOS catalog entries before SSH', async () => {
  const android = { ...device, roms: [{ id: 'android', os: 'Android' }] };
  await assert.rejects(runPhoneBench({ ...input, rom: 'jfltexx/android', origin: ORIGIN,
    fetch: fakeFetch({ catalog: android }), spawn: () => assert.fail('must not spawn') }), /not a postmarketOS/);
  await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: fakeFetch({ script: 'echo android', codeStatus: 404 }),
    spawn: () => assert.fail('must not spawn') }), /expired or ROMinit rejected/);
  await assert.rejects(runPhoneBench({ ...input, origin: ORIGIN, fetch: fakeFetch({ script: 'echo android' }),
    spawn: () => assert.fail('must not spawn') }), /not an active Linux benchmark/);
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
