import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { loadCatalog } from '../scripts/load-catalog.mjs';
import { FEATURES, USES, assertConsent, completeness, problems, recipes, selectFiles, stepsFor } from '../src/catalog.js';
import { checksum } from '../src/hash.js';

const sha = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');
const { devices, errors } = await loadCatalog();
const device = (/** @type {string} */ codename) => devices.find(d => d.codename === codename);
/** Small fake images standing in for the stage's pinned files. */
const fakeFiles = stage => stage.files.map(pin => ({ ...pin, size: pin.name.length, sha256: sha(pin.name), file: new Blob([pin.name]) }));
const noop = () => {};

test('real catalog validates', () => {
  assert.deepEqual(errors, []);
  for (const codename of ['hero2lte', 'laurel_sprout', 'star2lte', 'starlte', 'oriole']) assert.ok(devices.some(d => d.codename === codename), codename);
  // Link-only ROMs: the publisher's installer flashes; no stages allowed next to it.
  const external = device('oriole');
  assert.ok(external.roms[0].external && !external.roms[0].stages.length);
  assert.match(problems(external, { device: 'oriole', roms: [{ ...external.roms[0], stages: device('laurel_sprout').roms[0].stages }] }).join('\n'), /external needs/);
});

test('validator rejects bad entries', () => {
  const dev = device('laurel_sprout');
  const good = { device: 'laurel_sprout', roms: structuredClone(dev.roms) };
  assert.deepEqual(problems(dev, good), []);
  const bad = structuredClone(good);
  const stage = bad.roms[0].stages[0];
  stage.steps.push(['flash', 'boot;reboot', 'boot.img'], ['format', 'userdata']);
  stage.files[0].url = 'http://example.com/x';
  stage.files[1].sha256 = 'nope';
  stage.confirm = 'yes';
  bad.roms[0].rating.features.wifi = 'great';
  delete bad.roms[0].rating.includes.root;
  bad.roms[0].rating.kernel.type = 'vendor';
  delete bad.roms[0].rating.support;
  bad.roms[0].id = `pmos-${bad.roms[0].version}`;
  bad.roms[0].supersedes = 'nope';
  bad.roms[0].pick = { text: 'XDA top pick' };
  bad.roms[0].risk = { level: 'low', why: 'x' }; bad.roms[0].source = null; bad.roms[0].recommended = true;
  const found = problems(dev, bad).join('\n');
  for (const text of ['id must start with its publisher', 'id must not contain the version', 'supersedes must name another ROM', 'pick needs text', 'no source code published means risk high', 'recommended only on official', 'unsafe arguments', 'format(userdata) not allowed', 'https source page', 'needs size and sha256', 'confirm phrase', 'rating needs a checked date', 'rating.includes needs', 'rating.kernel needs', 'support']) assert.match(found, new RegExp(text.replace(/[()]/g, '\\$&')));
});

/** Fake fastboot that records commands. */
function fastboot(vars = {}) {
  const log = [];
  return { log, getVariable: async name => vars[name] ?? ({ product: 'laurel_sprout', unlocked: 'yes' })[name] ?? (name.startsWith('partition-size:') ? '0x10000000' : 'no'),
    runCommand: async command => { log.push(command); }, flashBlob: async (partition, blob) => { log.push(`flash:${partition}:${await blob.text()}`); } };
}

test('Mi A3 runs the catalog sequence', async () => {
  const dev = device('laurel_sprout'), stage = dev.roms[0].stages[0], fb = fastboot(), reports = [];
  await recipes.fastboot.run(fb, { device: dev, files: fakeFiles(stage), steps: stepsFor(stage) }, text => reports.push(text), noop);
  assert.deepEqual(fb.log, ['flash:vbmeta_b:vbmeta.img', 'erase:dtbo_b', 'flash:userdata:rootfs.img', 'flash:boot_b:boot.img', 'set_active:b', 'reboot']);
  assert.equal(reports.at(-1), 'Step 12/12: Done.');
});

test('Mi A3 fails closed before writing', async () => {
  const dev = device('laurel_sprout'), stage = dev.roms[0].stages[0];
  for (const [vars, files, pattern] of [
    [{ product: 'starlte' }, fakeFiles(stage), /expected laurel_sprout/],
    [{ unlocked: 'no' }, fakeFiles(stage), /locked/],
    [{ 'partition-size:boot_b': '0x1' }, fakeFiles(stage), /larger than boot_b/],
    [{ 'is-logical:userdata': 'yes' }, fakeFiles(stage), /logical/],
    [{}, fakeFiles(stage).map((f, i) => i ? f : { ...f, sha256: sha('other') }), /SHA-256 mismatch/],
  ]) {
    const fb = fastboot(vars);
    await assert.rejects(recipes.fastboot.run(fb, { device: dev, files, steps: stepsFor(stage) }, noop, noop), pattern);
    assert.deepEqual(fb.log, []);
  }
});

test('S9 TWRP stage checks the PIT and never reboots', async () => {
  const dev = device('starlte'), stage = dev.roms[0].stages[0], log = [];
  const pit = names => ({ findEntryByName: n => names.includes(n) ? { partitionSize: 1e6 } : undefined });
  const odin = names => ({ beginSession: async () => {}, getPitData: async () => pit(names), flashPartition: async (p, f) => { log.push(`${p}:${await f.text()}`); } });
  const job = { device: dev, stage, files: fakeFiles(stage), steps: stepsFor(stage) };
  await recipes.odin.run(odin(['BOOT', 'SYSTEM', 'VENDOR', 'USERDATA', 'RECOVERY']), job, noop, noop);
  assert.deepEqual(log, [`RECOVERY:${stage.files[0].name}`]);
  await assert.rejects(recipes.odin.run(odin(['BOOT', 'RECOVERY']), job, noop, noop), /does not look like/);
  assert.equal(log.length, 1);
});

/** Fake TWRP shell: by-name links resolve to /dev/block/<name>; `/data` mounts USERDATA. */
function twrp({ product = 'starlte', mounted = ['/dev/block/USERDATA /data ext4', '/dev/block/USERDATA /sdcard ext4'], files = {} } = {}) {
  const log = [];
  let mounts = [...mounted];
  const run = async command => {
    log.push(command);
    if (command === 'getprop ro.product.device') return { code: 0, out: product };
    if (command === 'getprop ro.twrp.version') return { code: 0, out: '3.7.0' };
    if (command === 'cat /proc/mounts') return { code: 0, out: mounts.join('\n') };
    if (command.startsWith('readlink -f ')) return { code: 0, out: `/dev/block/${command.split('/').pop()}` };
    if (command.startsWith('blockdev ')) return { code: 0, out: '1000000' };
    if (command.startsWith('umount ')) { mounts = mounts.filter(m => m.split(' ')[1] !== command.slice(7)); return { code: 0, out: '' }; }
    const head = command.match(/^head -c \d+ \S+\/(\w+) \| sha256sum$/);
    if (head) return { code: 0, out: `${sha(files[head[1]] ?? '')}  -` };
    return { code: 0, out: '' };
  };
  return { log, run, pipe: async (command, blob) => { log.push(command); files[command.split('/').pop().split(' ')[0]] = await blob.text(); return { code: 0, out: '' }; } };
}

test('S9 ROM stage writes, verifies, formats after unmounting, reboots', async () => {
  const dev = device('starlte'), stage = dev.roms[0].stages[1], shell = twrp();
  await recipes['twrp-dd'].run(shell, { device: dev, stage, files: fakeFiles(stage), steps: stepsFor(stage, { format: true }) }, noop, noop);
  const actions = shell.log.filter(c => /^(dd|umount|mke2fs|reboot)/.test(c));
  assert.deepEqual(actions.map(c => c.split(' ').slice(0, 2).join(' ')), [
    `dd of=${stage.by_name}/SYSTEM`, `dd of=${stage.by_name}/VENDOR`, `dd of=${stage.by_name}/BOOT`, 'umount /sdcard', 'umount /data', 'mke2fs -F', 'reboot']);
});

test('S9 ROM stage fails closed', async () => {
  const dev = device('starlte'), stage = dev.roms[0].stages[1];
  const job = { device: dev, stage, files: fakeFiles(stage), steps: stepsFor(stage) };
  const wrong = twrp({ product: 'star2lte' });
  await assert.rejects(recipes['twrp-dd'].run(wrong, job, noop, noop), /Expected starlte/);
  const mounted = twrp({ mounted: ['/dev/block/SYSTEM /system ext4'] });
  await assert.rejects(recipes['twrp-dd'].run(mounted, job, noop, noop), /SYSTEM .* is mounted/);
  for (const shell of [wrong, mounted]) assert.ok(!shell.log.some(c => c.startsWith('dd ')));
  // Read-back mismatch stops before the next write.
  const bad = twrp();
  bad.pipe = async command => { bad.log.push(command); return { code: 0, out: '' }; };
  await assert.rejects(recipes['twrp-dd'].run(bad, job, noop, noop), /read back wrong data/);
  assert.equal(bad.log.filter(c => c.startsWith('dd ')).length, 1);
});

test('file selection, consent and options', () => {
  const stage = device('starlte').roms[0].stages[1];
  const files = stage.files.map(pin => ({ name: pin.name, size: pin.size }));
  assert.equal(selectFiles(stage, files).length, 3);
  assert.throws(() => selectFiles(stage, files.slice(1)), /Select exactly/);
  assert.throws(() => selectFiles(stage, [...files.slice(1), { ...files[0], size: 1 }]), /wrong size/);
  const loose = selectFiles(stage, [...files.slice(1), { ...files[0], size: 1 }], true);
  assert.ok(loose.every(f => f.sha256 === '') && loose.some(f => f.size === 1));
  assert.throws(() => selectFiles(stage, [...files.slice(1), { ...files[0], name: 'other.img' }], true), /names must match/);
  assert.throws(() => assertConsent(stage, { consent: true, confirmation: 'erase s9' }));
  assertConsent(stage, { consent: true, confirmation: stage.confirm });
  assert.ok(!stepsFor(stage).some(([verb]) => verb === 'mkfs_ext4'));
  assert.ok(!stepsFor(stage, { reboot: false }).some(([verb]) => verb === 'reboot'));
});

test('completeness counts partial as half and skips n/a', () => {
  const features = Object.fromEntries(FEATURES.map((f, i) => [f, ['works', 'partial', 'broken', 'n/a'][i % 4]]));
  const present = FEATURES.filter((_, i) => i % 4 !== 3).length, worth = FEATURES.reduce((sum, _, i) => sum + [1, 0.5, 0, 0][i % 4], 0);
  assert.equal(completeness({ features }), Math.round(100 * worth / present));
  for (const list of Object.values(USES)) assert.ok(list.every(f => FEATURES.includes(f)));
});

test('checksum streams to the right digest', async () => {
  assert.equal(await checksum(new Blob(['abc'])), sha('abc'));
});

test('ratings API validates votes and stores only a hashed address', async () => {
  const { onRequestPost } = await import('../functions/api/ratings.js');
  const runs = [];
  const env = { SALT: 'test', DB: { prepare: () => ({ bind: (...args) => ({ run: async () => runs.push(args) }) }) },
    ASSETS: { fetch: async () => Response.json(devices.map(d => ({ codename: d.codename, roms: d.roms }))) } };
  const post = body => onRequestPost({ env, request: new Request('https://x/api/ratings', { method: 'POST', body: JSON.stringify(body), headers: { 'cf-connecting-ip': '203.0.113.9' } }) });
  assert.equal((await post({ rom: 'starlte/pmos-server', stars: 6 })).status, 400);
  assert.equal((await post({ rom: 'starlte/nope', stars: 5 })).status, 404);
  assert.equal((await onRequestPost({ env: { ...env, SALT: '' }, request: new Request('https://x', { method: 'POST', body: '{}' }) })).status, 503);
  const rom = `starlte/${device('starlte').roms[0].id}`;
  assert.equal((await post({ rom, stars: 4 })).status, 200);
  assert.deepEqual(runs.map(([r, voter, stars]) => [r, /^[0-9a-f]{64}$/.test(voter), stars]), [[rom, true, 4]]);
});

test('comments API needs an account, checks length, ROM and rate limit', async () => {
  const { onRequestPost } = await import('../functions/api/comments.js');
  let recent = null; const inserts = [];
  const user = { id: 7, provider: 'github', name: 'Ada', email: 'ada@example.org' };
  const env = { SALT: 'test', ASSETS: { fetch: async () => Response.json(devices.map(d => ({ codename: d.codename, vendor: d.vendor, roms: d.roms }))) },
    DB: { prepare: sql => ({ bind: (...args) => ({
      first: async () => sql.includes('FROM sessions') ? (args[0] === sha('good') ? user : null) : recent,
      all: async () => ({ results: [] }),
      run: async () => (inserts.push([sql, args]), { meta: { last_row_id: 1 } }) }) }) } };
  const post = (body, sid = 'good') => onRequestPost({ env, request: new Request('https://x/api/comments', { method: 'POST', body: JSON.stringify(body), headers: { cookie: `sid=${sid}` } }) });
  const rom = `starlte/${device('starlte').roms[0].id}`;
  assert.equal((await post({ rom, text: 'hi' }, 'bad')).status, 401);
  assert.equal((await post({ rom, text: '  ' })).status, 400);
  assert.equal((await post({ rom, text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await post({ rom: 'starlte/nope', text: 'hi' })).status, 404);
  assert.equal((await post({ rom, text: 'hi', image: btoa('<svg onload=alert(1)>') })).status, 400);
  assert.equal((await post({ rom, text: ' works great ' })).status, 200);
  assert.deepEqual(inserts[0][1].filter((_, i) => i !== 1), [rom, 'Ada', 'works great', 7]);
  recent = { 1: 1 };
  assert.equal((await post({ rom, text: 'again' })).status, 429);
});

test('role scopes and return paths', async () => {
  const { covers, roleOver, safeReturn } = await import('../functions/_lib/auth.js');
  const rom = { key: 'starlte/pmos', codename: 'starlte', vendor: 'Samsung', os: 'postmarketOS' };
  assert.deepEqual(['*', 'os:postmarketOS', 'vendor:Samsung', 'device:starlte', 'rom:starlte/pmos', 'os:LineageOS', 'rom:starlte/other', 'device:'].map(s => covers(s, rom)),
    [true, true, true, true, true, false, false, false]);
  assert.equal(roleOver([{ role: 'moderator', scope: '*' }, { role: 'owner', scope: 'rom:starlte/pmos' }], rom), 'owner');
  assert.equal(roleOver([{ role: 'owner', scope: 'device:hero2lte' }], rom), null);
  assert.deepEqual(['/x?y=1', '//evil.com', '/\\evil', 'https://evil.com', 5].map(safeReturn), ['/x?y=1', '/', '/', '/', '/']);
});

test('untar reads a gzip tar with long names and skips unwanted entries', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
  const dir = mkdtempSync('/tmp/rominit-tar-'), deep = `${'d'.repeat(120)}/images`;
  mkdirSync(`${dir}/${deep}`, { recursive: true });
  writeFileSync(`${dir}/${deep}/boot.img`, 'x'.repeat(70000));
  writeFileSync(`${dir}/${deep}/skip.img`, 'skip');
  writeFileSync(`${dir}/flash_all.sh`, 'fastboot flash boot boot.img');
  execFileSync('tar', ['--format=gnu', '-czf', `${dir}/a.tgz`, '-C', dir, deep, 'flash_all.sh']);
  const got = {};
  const { untar } = await import('../src/recipes/fastboot-tgz.js');
  await untar(new Blob([readFileSync(`${dir}/a.tgz`)]).stream().pipeThrough(new DecompressionStream('gzip')), async (name, size) => {
    if (name.endsWith('skip.img')) return null;
    const parts = [];
    return { write: async chunk => parts.push(chunk), close: async () => { got[name] = [size, Buffer.concat(parts).toString()]; } };
  });
  assert.deepEqual(got[`${deep}/boot.img`], [70000, 'x'.repeat(70000)]);
  assert.deepEqual(got['flash_all.sh'], [28, 'fastboot flash boot boot.img']);
  assert.equal(Object.keys(got).filter(n => n.endsWith('.img')).length, 1);
  execFileSync('rm', ['-rf', dir]);
});

test('stock archive recipe refuses a newer anti-rollback level before reading the archive', async () => {
  const dev = device('laurel_sprout'), stock = dev.roms.find(r => r.origin === 'stock'), stage = stock.stages[0];
  const fb = fastboot({ anti: '1' });
  await assert.rejects(recipes['fastboot-tgz'].run(fb, { device: dev, stage, files: fakeFiles(stage), steps: stepsFor(stage) }, noop, noop), /anti-rollback level 1/);
  assert.deepEqual(fb.log, []);
  assert.ok(!stage.steps.some(([verb, arg]) => /lock/.test(`${verb}${arg}`)), 'stock restore must never lock');
});

test('every ROM has a known origin and status', () => {
  for (const d of devices) for (const r of d.roms) assert.ok(r.origin && r.status, `${d.codename}/${r.id}`);
  const dev = device('laurel_sprout');
  assert.deepEqual(problems(dev, { device: dev.codename, roms: [{ ...dev.roms[0], status: 'great' }] }).filter(p => /status/.test(p)).length, 1);
});

test('sideload serves the blocks the phone asks for and stops at DONEDONE', async () => {
  const zip = new Blob([new Uint8Array(65536 + 10).fill(7)]);
  const sent = [];
  /** @type {string} */ let service = '';
  const asks = ['00000001', '0000000000000000DONEDONE'];
  const adb = { banner: { device: 'hero2ltexx' }, async createSocket(/** @type {string} */ s) {
    service = s;
    return { readable: new ReadableStream({ pull(c) { const a = asks.shift(); a ? c.enqueue(new TextEncoder().encode(a)) : c.close(); } }),
      writable: new WritableStream({ write(chunk) { sent.push(chunk.length); } }), close() {} };
  } };
  await recipes['twrp-sideload'].serve(adb, { name: 'z.zip', sha256: '', file: zip }, () => {});
  assert.equal(service, 'sideload-host:65546:65536');
  assert.deepEqual(sent, [10, 65536, 65536]);
  const bad = { ...adb, banner: { device: 'starlte' } };
  await assert.rejects(recipes['twrp-sideload'].run(bad, { device: { detect: { adb: { device: 'hero2lte' } } }, files: [], steps: [] }, () => {}, () => {}), /phone reports starlte/);
  const recovery = { banner: { device: 'hero2lte', state: 'recovery' }, createSocket: async () => { throw Error('Socket open failed'); } };
  await assert.rejects(recipes['twrp-sideload'].run(recovery, { device: { detect: { adb: { device: 'hero2lte' } } }, files: [], steps: [] }, () => {}, () => {}), /recovery mode, not ADB sideload/);
  await assert.rejects(recipes['twrp-sideload'].serve({ banner: {}, createSocket: recovery.createSocket }, { name: 'z.zip', sha256: '', file: new Blob([]) }, () => {}), /refused the sideload/);
});

test('counter counts views and flashes once per window', async () => {
  const { onRequestPost } = await import('../functions/api/counts.js');
  let recent = null; const inserts = [];
  const env = { SALT: 'test', ASSETS: { fetch: async () => Response.json(devices.map(d => ({ codename: d.codename, roms: d.roms }))) },
    DB: { prepare: () => ({ bind: (...args) => ({ first: async () => recent, run: async () => inserts.push(args) }) }) } };
  const post = body => onRequestPost({ env, request: new Request('https://x/api/flashes', { method: 'POST', body: JSON.stringify(body) }) });
  const rom = `starlte/${device('starlte').roms[0].id}`;
  assert.equal((await post({ rom: 'starlte/nope', kind: 'view' })).status, 404);
  assert.equal((await post({ rom, kind: 'download' })).status, 400);
  assert.deepEqual(await (await post({ rom, kind: 'flash' })).json(), { ok: true, counted: true });
  recent = { 1: 1 };
  assert.deepEqual(await (await post({ rom, kind: 'view' })).json(), { ok: true, counted: false });
  assert.equal(inserts.length, 1);
});

test('debug trace logs calls, results and errors without changing them', async () => {
  const { traced } = await import('../src/debug.js');
  const lines = /** @type {string[]} */ ([]);
  const fb = traced({ banner: { state: 'sideload' }, async getVariable(/** @type {string} */ k) { return k === 'product' ? 'laurel_sprout' : null; },
    async flash() { throw Error('boom'); } }, line => lines.push(line), 'fastboot');
  assert.equal(fb.banner.state, 'sideload');
  assert.equal(await fb.getVariable('product'), 'laurel_sprout');
  await assert.rejects(fb.flash('boot', new Blob(['xy'])), /boom/);
  assert.match(lines.join('\n'), /← fastboot\.getVariable\("product"\) = "laurel_sprout"/);
  assert.match(lines.join('\n'), /✗ fastboot\.flash\("boot", Blob\(2 B\)\) threw Error: boom/);
});

test('ADB phones are moved into the mode the recipe needs', async () => {
  const { adbMove } = await import('../src/protocols/usb.js');
  assert.deepEqual(adbMove('sideload', 'sideload'), { done: true });
  assert.equal(adbMove('device', 'sideload').send, 'reboot:recovery');
  assert.equal(adbMove('device', 'recovery').wait, 'recovery');
  assert.equal(adbMove('recovery', 'sideload').send, 'shell:twrp sideload');
  assert.deepEqual(adbMove('recovery', 'recovery'), { done: true });
  assert.match(adbMove('sideload', 'recovery').error, /Cancel/);
  assert.match(adbMove('bootloader', 'sideload').error, /Boot TWRP/);
});

test('host OS: detected from the browser, setup lines per protocol, errors mapped to the fix', async () => {
  const { detectHost, prereqsFor, fixFor, browserProblem } = await import('../src/hosts.js');
  assert.equal(detectHost({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140' }), 'windows');
  assert.equal(detectHost({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140' }), 'android');
  assert.equal(detectHost({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }), 'mac');
  assert.equal(detectHost({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', userAgentData: { platform: 'Linux' } }), 'linux');
  assert.deepEqual(prereqsFor('windows', 'odin').map(p => p.id), ['zadig', 'samsung-driver', 'busy']);
  assert.deepEqual(prereqsFor('mac', 'fastboot').map(p => p.id), ['busy']);
  assert.match(fixFor('Unable to claim interface.', 'linux', 'fastboot') ?? '', /udev/);
  assert.match(fixFor('No device selected.', 'windows', 'adb') ?? '', /Zadig/);
  assert.equal(fixFor('Checksum mismatch', 'linux', 'fastboot'), null);
  assert.equal(browserProblem({ usb: {}, secure: true, host: 'linux' }), null);
  assert.match(browserProblem({ secure: true, host: 'windows' }) ?? '', /Edge/);
});

test('ROMvault lint: frontmatter, tags, links, index and the full net are clean', async () => {
  const { lint } = await import('../scripts/romvault-lint.mjs');
  assert.deepEqual(lint(), []);
});
