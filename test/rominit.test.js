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
  assert.deepEqual(devices.map(d => d.codename).sort(), ['laurel_sprout', 'star2lte', 'starlte']);
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
  const found = problems(dev, bad).join('\n');
  for (const text of ['unsafe arguments', 'format(userdata) not allowed', 'https source page', 'needs size and sha256', 'confirm phrase', 'rating needs a checked date', 'rating.includes needs', 'rating.kernel needs', 'support']) assert.match(found, new RegExp(text.replace(/[()]/g, '\\$&')));
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

test('comments API checks length, ROM and rate limit', async () => {
  const { onRequestPost } = await import('../functions/api/comments.js');
  let recent = null; const inserts = [];
  const env = { SALT: 'test', ASSETS: { fetch: async () => Response.json(devices.map(d => ({ codename: d.codename, roms: d.roms }))) },
    DB: { prepare: sql => ({ bind: (...args) => ({ first: async () => recent, run: async () => inserts.push([sql, args]) }) }) } };
  const post = body => onRequestPost({ env, request: new Request('https://x/api/comments', { method: 'POST', body: JSON.stringify(body) }) });
  const rom = `starlte/${device('starlte').roms[0].id}`;
  assert.equal((await post({ rom, text: '  ' })).status, 400);
  assert.equal((await post({ rom, text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await post({ rom: 'starlte/nope', text: 'hi' })).status, 404);
  assert.equal((await post({ rom, text: 'hi', image: btoa('<svg onload=alert(1)>') })).status, 400);
  assert.equal((await post({ rom, text: ' works great ' })).status, 200);
  assert.deepEqual(inserts[0][1].filter((_, i) => i !== 1), [rom, 'anonymous', 'works great']);
  recent = { 1: 1 };
  assert.equal((await post({ rom, text: 'again' })).status, 429);
});
