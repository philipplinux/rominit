import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { loadDevices, main } from '../bin/cli.mjs';
import { loadCatalog } from '../scripts/load-catalog.mjs';

const { devices } = await loadCatalog();
const sha = (/** @type {string} */ s) => createHash('sha256').update(s).digest('hex');

/** The real Mi A3 entry with tiny fake files (content = file name), so nothing big is read or written. */
const mia3 = structuredClone(devices.find(d => d.codename === 'laurel_sprout'));
const rom = mia3.roms[0];
for (const f of rom.stages[0].files) Object.assign(f, { size: f.name.length, sha256: sha(f.name) });
const catalog = { devices: [mia3] };

/** @param {boolean} tty @param {string} typed */
function io(tty, typed = '') {
  const stdin = Object.assign(new PassThrough(), { isTTY: tty });
  if (typed) stdin.end(typed + '\n');
  const chunks = { out: '', err: '' };
  const stdout = new PassThrough(), stderr = new PassThrough();
  stdout.on('data', d => chunks.out += d); stderr.on('data', d => chunks.err += d);
  return { stdin, stdout, stderr, chunks };
}
const events = (/** @type {string} */ text) => text.trim().split('\n').map(line => JSON.parse(line));
const withFiles = () => { const dir = mkdtempSync(join(tmpdir(), 'rominit-')); for (const f of rom.stages[0].files) writeFileSync(join(dir, f.name), f.name); return dir; };

/** Fake fastboot like test/rominit.test.js, recording commands. */
function fastboot() {
  const log = [];
  return { log, getVariable: async (/** @type {string} */ name) => ({ product: 'laurel_sprout', unlocked: 'yes' })[name] ?? (name.startsWith('partition-size:') ? '0x10000000' : 'no'),
    runCommand: async (/** @type {string} */ c) => { log.push(c); }, flashBlob: async (/** @type {string} */ p, /** @type {Blob} */ b) => { log.push(`flash:${p}:${await b.text()}`); } };
}

test('plan prints stages, files, steps and the confirm phrase', async () => {
  const t = io(false);
  assert.equal(await main(['plan', 'laurel_sprout', rom.id], t, { catalog }), 0);
  for (const text of ['Stage 1', 'confirm: ERASE MI A3', 'vbmeta.img', sha('vbmeta.img'), 'step flash boot_b boot.img']) assert.match(t.chunks.out, new RegExp(text));
});

test('--json emits one event per line with type, text and fraction', async () => {
  const t = io(false);
  await main(['plan', 'laurel_sprout', rom.id, '--json'], t, { catalog });
  const [done] = events(t.chunks.out);
  assert.equal(done.type, 'done');
  assert.equal(done.data.stages[0].confirm, 'ERASE MI A3');
  const bad = io(false);
  assert.equal(await main(['plan', 'nope', '--json'], bad, { catalog }), 1);
  assert.deepEqual(Object.keys(events(bad.chunks.out)[0]), ['type', 'text']);
  assert.equal(events(bad.chunks.out)[0].type, 'error');
});

test('fetch downloads pinned files, verifies them and skips present ones', async () => {
  const server = createServer((req, res) => res.end(req.url.slice(1))).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const local = structuredClone(rom);
  for (const f of local.stages[0].files) f.url = base + f.name;
  const dir = mkdtempSync(join(tmpdir(), 'rominit-'));
  try {
    const t = io(false);
    assert.equal(await main(['fetch', 'laurel_sprout', rom.id, '--dir', dir, '--json'], t, { catalog: { devices: [{ ...mia3, roms: [local] }] } }), 0);
    assert.equal(readFileSync(join(dir, 'boot.img'), 'utf8'), 'boot.img');
    const kinds = events(t.chunks.out).map(e => e.type);
    assert.ok(kinds.includes('progress') && kinds.at(-1) === 'done');
    const again = io(false);
    await main(['fetch', 'laurel_sprout', rom.id, '--dir', dir], again, { catalog: { devices: [{ ...mia3, roms: [local] }] } });
    assert.match(again.chunks.out, /boot.img: already present/);
    writeFileSync(join(dir, 'boot.img'), 'tampered'); // wrong size: refetched; server serving other bytes must fail closed
    const bad = structuredClone(local); bad.stages[0].files[0].sha256 = sha('other');
    const fail = io(false);
    assert.equal(await main(['fetch', 'laurel_sprout', rom.id, '--dir', mkdtempSync(join(tmpdir(), 'rominit-'))], fail, { catalog: { devices: [{ ...mia3, roms: [bad] }] } }), 1);
    assert.match(fail.chunks.out, /mismatch/);
  } finally { server.close(); }
});

test('run refuses without a TTY and on a wrong phrase, before touching USB', async () => {
  const dir = withFiles();
  const args = ['run', 'laurel_sprout', rom.id, '--stage', '1', '--dir', dir];
  const session = async () => { throw Error('USB must not be opened'); };
  const noTty = io(false, 'ERASE MI A3'); // a piped phrase must not count
  assert.equal(await main(args, noTty, { catalog, session }), 1);
  assert.match(noTty.chunks.out, /stdin is not a terminal/);
  const wrong = io(true, 'erase');
  assert.equal(await main(args, wrong, { catalog, session }), 1);
  assert.match(wrong.chunks.out, /type ERASE MI A3/);
  const flags = io(true, 'ERASE MI A3');
  assert.equal(await main([...args, '--confirm', 'ERASE MI A3'], flags, { catalog, session }), 1);
  assert.match(flags.chunks.out, /Unknown flag/);
});

test('run with the right phrase on a TTY drives the mocked fastboot through the catalog steps', async () => {
  const fb = fastboot();
  const t = io(true, 'ERASE MI A3');
  let benched = 0;
  const code = await main(['run', 'laurel_sprout', rom.id, '--stage', '1', '--dir', withFiles(), '--json'], t, { catalog, session: async () => fb, bench: async () => { benched += 1; } });
  assert.equal(code, 0);
  assert.equal(benched, 1); // postmarketOS stage ending in reboot: wait for boot, then benchmark
  assert.deepEqual(fb.log, ['flash:vbmeta_b:vbmeta.img', 'erase:dtbo_b', 'flash:boot_b:boot.img', 'flash:userdata:rootfs.img', 'set_active:b', 'reboot']); // same order as the site's Mi A3 test
  const ev = events(t.chunks.out);
  assert.equal(ev[0].type, 'step');
  assert.match(ev[0].text, /^WARNING/);
  assert.ok(ev.some(e => /Step \d+\/\d+: Checking the partitions/.test(e.text)));
  assert.equal(ev.at(-1).type, 'done');
  assert.ok(ev.every(e => typeof e.text === 'string' && ['step', 'progress', 'error', 'done'].includes(e.type)));
});

test('bench runs only the benchmark: no confirm, no USB, sent as flashed another way', async () => {
  /** @type {any[]} */ const calls = [];
  const t = io(false, '');
  assert.equal(await main(['bench', 'laurel_sprout', rom.id, '--host', '10.0.0.9', '--json'], t, { catalog, session: async () => { throw Error('no USB'); }, bench: async (...a) => { calls.push(a); } }), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], `laurel_sprout/${rom.id}`);
  assert.deepEqual({ host: calls[0][4].host, flashed: calls[0][4].flashed }, { host: '10.0.0.9', flashed: false });
});

test('run refuses non-fastboot recipes', async () => {
  const other = structuredClone(mia3);
  other.roms[0].stages[0].recipe = 'odin';
  const t = io(true, 'ERASE MI A3');
  assert.equal(await main(['run', 'laurel_sprout', rom.id, '--stage', '1'], t, { catalog: { devices: [other] } }), 1);
  assert.match(t.chunks.out, /not supported by the CLI yet/);
});

test('submitBench opens a code, uploads the output and sends the script verdicts as the card', async () => {
  const { submitBench } = await import('../bin/cli.mjs');
  const calls = [];
  const get = async (url, init) => (calls.push([url.replace(/^https?:\/\/[^/]+/, ''), init.body]), Response.json({ code: 'abcd2345' }));
  const rom = { rating: { features: { nfc: 'n/a' } } };
  assert.equal(await submitBench(rom, 'laurel_sprout/x', '@ script linux 1\nwifi full wlan0\nnfc broken none\ngps ask Does GPS work?', ['wifi full wlan0', 'nfc broken none', 'gps ask Does GPS work?'], get), 'abcd2345');
  assert.deepEqual(calls.map(c => c[0]), ['/api/bench', '/b/abcd2345', '/api/bench']);
  assert.deepEqual(JSON.parse(calls[0][1]), { rom: 'laurel_sprout/x', via: 'cli' });
  const card = JSON.parse(calls[2][1]);
  assert.deepEqual([card.code, card.flash, card.final], ['abcd2345', 'verified', { wifi: 'full', nfc: 'n/a', gps: 'untested' }]);
});

test('android-fastboot really flashes under Node once the browser shims are in (fake USB endpoint)', async () => {
  const { installBrowserShims } = await import('../bin/node-env.mjs');
  const { FastbootDevice } = await import('android-fastboot');
  installBrowserShims();
  const sent = [], replies = [];
  const fb = new FastbootDevice();
  fb.epIn = 1; fb.epOut = 1;
  fb.device = /** @type {any} */ ({ opened: true,
    transferOut: async (_, data) => {
      const bytes = new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
      const text = bytes.length < 64 ? new TextDecoder().decode(bytes) : `<${bytes.length} bytes>`;
      sent.push(text);
      replies.push(text === 'getvar:max-download-size' ? 'OKAY0x10000000' : text.startsWith('download:') ? `DATA${text.slice(9)}` : 'OKAY');
      return { status: 'ok', bytesWritten: bytes.length };
    },
    transferIn: async () => ({ status: 'ok', data: new DataView(new TextEncoder().encode(replies.shift() ?? 'OKAY').buffer) }) });
  await fb.flashBlob('vbmeta_b', new Blob([new Uint8Array(4096)]), () => {});
  assert.deepEqual(sent.slice(-3), ['download:00001000', '<4096 bytes>', 'flash:vbmeta_b']);
});

test('recover asks on a terminal and retries; without one it fails straight', async () => {
  const { recover, reporter } = await import('../bin/cli.mjs');
  let tries = 0;
  const flaky = async () => { if (++tries < 2) throw Error('Timeout of 5000 ms exceeded'); return 'ok'; };
  const t = io(true, 'r');
  assert.equal(await recover('Stage 1', flaky, t, reporter(false, t)), 'ok');
  assert.match(t.chunks.out, /Stage 1 stopped: Timeout.*\n.*Retrying: Stage 1/s);
  tries = 0;
  await assert.rejects(recover('Stage 1', flaky, io(false, ''), reporter(false, io(false, ''))), /Timeout/);
  const s = io(true, 's');
  assert.equal(await recover('Benchmark', async () => { throw Error('ssh exit 255'); }, s, reporter(false, s), true), undefined);
});

test('recover waits out a phone that dropped off USB without asking; the fastboot recipe resumes at the failed step', async () => {
  const { recover, reporter, USB_GONE } = await import('../bin/cli.mjs');
  const { run } = await import('../src/recipes/fastboot.js');
  const commands = [];
  let drops = 2;
  const fb = { getVariable: async (/** @type {string} */ v) => ({ product: 'p', unlocked: 'yes' })[v] ?? (v.startsWith('partition-size') ? '1000' : 'no'),
    runCommand: async (/** @type {string} */ c) => { if (c === 'erase:b' && drops-- > 0) throw Error(drops ? 'Cancelled' : 'No phone in fastboot mode found.'); commands.push(c); } };
  const job = { device: { detect: { fastboot: { product: 'p' } } }, files: [], steps: [['erase', 'a'], ['erase', 'b'], ['set_active', 'b']], progress: { done: 0 }, pauseMs: 0 };
  const t = io(false, ''); // no terminal: it must not need one for this
  await recover('Stage 1', () => run(/** @type {any} */ (fb), job, () => {}, () => {}), t, reporter(false, t), false, { match: USB_GONE, ms: 1000, every: 1 });
  assert.deepEqual(commands, ['erase:a', 'erase:b', 'set_active:b']);
  assert.match(t.chunks.out, /Stage 1: Cancelled; waiting for the phone to come back/);
});

test('catalog comes from the site per device, 404 = unknown, --local reads catalog/', async () => {
  const asked = [];
  const get = async (/** @type {string} */ url) => { asked.push(url); return url.endsWith('/laurel_sprout.json') ? Response.json(mia3) : new Response('', { status: 404 }); };
  assert.equal((await loadDevices('laurel_sprout', false, get))[0].codename, 'laurel_sprout');
  assert.match(asked[0], /\/catalog\/laurel_sprout\.json$/);
  await assert.rejects(loadDevices('nope', false, get), /Unknown device "nope"/);
  await assert.rejects(loadDevices('x', false, async () => { throw Error('offline'); }), /--local/);
  assert.ok((await loadDevices('ignored', true)).some(d => d.codename === 'laurel_sprout'));
  const t = io(false);
  assert.equal(await main(['plan', 'laurel_sprout', rom.id], t, { get }), 0);
  assert.match(t.chunks.out, /confirm: ERASE MI A3/);
});
