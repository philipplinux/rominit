import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { main } from '../bin/cli.mjs';
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
  const code = await main(['run', 'laurel_sprout', rom.id, '--stage', '1', '--dir', withFiles(), '--json'], t, { catalog, session: async () => fb });
  assert.equal(code, 0);
  assert.deepEqual(fb.log, ['flash:vbmeta_b:vbmeta.img', 'erase:dtbo_b', 'flash:boot_b:boot.img', 'flash:userdata:rootfs.img', 'set_active:b', 'reboot']); // same order as the site's Mi A3 test
  const ev = events(t.chunks.out);
  assert.equal(ev[0].type, 'step');
  assert.match(ev[0].text, /^WARNING/);
  assert.ok(ev.some(e => /Step \d+\/\d+: Checking the partitions/.test(e.text)));
  assert.equal(ev.at(-1).type, 'done');
  assert.ok(ev.every(e => typeof e.text === 'string' && ['step', 'progress', 'error', 'done'].includes(e.type)));
});

test('run refuses non-fastboot recipes', async () => {
  const other = structuredClone(mia3);
  other.roms[0].stages[0].recipe = 'odin';
  const t = io(true, 'ERASE MI A3');
  assert.equal(await main(['run', 'laurel_sprout', rom.id, '--stage', '1'], t, { catalog: { devices: [other] } }), 1);
  assert.match(t.chunks.out, /not supported by the CLI yet/);
});
