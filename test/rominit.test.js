import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { loadCatalog } from '../scripts/load-catalog.mjs';
import { CATEGORIES, CATEGORY_DIRS, FEATURES, USES, assertConsent, completeness, deviceLevel, osLevel, problems, recipes, selectFiles, stagesProblems, stepsFor, unlockStage } from '../src/catalog.js';
import { checksum, verifyPins } from '../src/hash.js';

const sha = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');
const { devices, errors } = await loadCatalog();
const device = (/** @type {string} */ codename) => devices.find(d => d.codename === codename);
const s9 = () => device('starlte').roms.find(r => r.id === 'philipplinux-pmos-server'); // pick by id: ROM file order is not a contract
/** Small fake images standing in for the stage's pinned files. */
const fakeFiles = stage => stage.files.map(pin => ({ ...pin, size: pin.name.length, sha256: sha(pin.name), file: new Blob([pin.name]) }));
const noop = () => {};

test('TV media boxes and sticks have an independent catalog category and device tree', () => {
  assert.equal(CATEGORIES.tvmedia, 'TV media boxes & sticks');
  assert.equal(CATEGORY_DIRS.tvmedia, 'tvmedia');
});

test('real catalog validates', () => {
  assert.deepEqual(errors, []);
  for (const codename of ['hero2lte', 'laurel_sprout', 'star2lte', 'starlte', 'oriole']) assert.ok(devices.some(d => d.codename === codename), codename);
  const supportOnly = devices.filter(d => d.supportOnly);
  assert.equal(supportOnly.length, 27);
  assert.ok(supportOnly.every(d => !d.roms.length && d.supportUrl.startsWith('https://')));
  // Link-only ROMs: the publisher's installer flashes; no stages allowed next to it.
  const external = device('oriole');
  assert.ok(external.roms[0].external && !external.roms[0].stages.length);
  const tablet = device('tangorpro');
  assert.equal(tablet.category, 'tablet');
  assert.equal(tablet.detect.fastboot.product, 'tangorpro');
  assert.equal(tablet.recovery.stockAndroid, '17');
  const tabletRom = tablet.roms[0];
  assert.equal(tabletRom.origin, 'official');
  assert.equal(tabletRom.vetting, 'curated');
  assert.equal(tabletRom.rating.features.wifi, 'works');
  assert.match(problems(tablet, { device: tablet.codename, roms: [{ ...tabletRom, rating: { ...tabletRom.rating, sources: [null] } }] }).join('\n'), /labelled https/);
  for (const feature of ['usb_net', 'otg', 'hdmi', 'gps']) assert.equal(tabletRom.rating.features[feature], 'works');
  assert.match(problems(tablet, { device: tablet.codename, roms: [{ ...tabletRom, rating: { ...tabletRom.rating, sources: [{ label: 'unsafe', url: 'javascript:alert(1)' }] } }] }).join('\n'), /labelled https/);
  assert.match(problems({ ...tablet, recovery: { stockAndroid: '17', url: 'http://example.com' } }, { device: tablet.codename, roms: tablet.roms }).join('\n'), /recovery.stockAndroid/);
  assert.ok(tablet.roms.every(r => r.external && !r.stages.length));
  const stick = device('mantis');
  assert.equal(stick.category, 'tvmedia');
  assert.ok(stick.models.includes('E9L29Y'));
  assert.equal(stick.roms[0].origin, 'unofficial');
  assert.equal(stick.roms[0].external.kind, 'guide');
  assert.equal(stick.roms[0].stages.length, 0);
  assert.equal(stick.unlock.fastboot, undefined, 'no generic unlock command for the Fire TV');
  assert.match(problems(stick, { device: 'mantis', roms: [{ ...stick.roms[0], external: { ...stick.roms[0].external, kind: 'command' } }] }).join('\n'), /external.kind/);
  assert.match(problems(external, { device: 'oriole', roms: [{ ...external.roms[0], stages: device('laurel_sprout').roms[0].stages }] }).join('\n'), /external needs/);
});

test('search level: approved phone test, then curated, scraped with recipe, support-only, link-only', () => {
  const rom = (/** @type {any} */ r) => ({ codename: 'x', supportOnly: false, roms: [r] }), tested = new Set(['t']);
  assert.equal(deviceLevel({ ...rom({ vetting: 'scraped' }), codename: 't' }, tested), 'tested');
  assert.equal(deviceLevel(rom({ vetting: 'curated', external: false }), tested), 'approved');
  assert.equal(deviceLevel(rom({ vetting: 'scraped', external: false }), tested), 'untested');
  assert.equal(deviceLevel({ codename: 's', supportOnly: true, roms: [] }, tested), 'supported');
  assert.equal(deviceLevel(rom({ vetting: 'scraped', external: true }), tested), 'placeholder');
  assert.equal(osLevel({ officialSupport: { status: 'dropped' } }), 'retired');
  assert.equal(osLevel({ officialSupport: { status: 'ongoing' } }), null);
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
    runCommand: async command => { log.push(command); return { text: command === 'flashing get_unlock_ability' ? `get_unlock_ability: ${vars.unlock_ability ?? 1}\n` : '' }; }, flashBlob: async (partition, blob) => { log.push(`flash:${partition}:${await blob.text()}`); } };
}

test('Mi A3 runs the catalog sequence', async () => {
  const dev = device('laurel_sprout'), stage = dev.roms[0].stages[0], fb = fastboot(), reports = [];
  await recipes.fastboot.run(fb, { device: dev, files: fakeFiles(stage), steps: stepsFor(stage) }, text => reports.push(text), noop);
  assert.deepEqual(fb.log, ['flash:vbmeta_b:vbmeta.img', 'erase:dtbo_b', 'flash:boot_b:boot.img', 'flash:userdata:rootfs.img', 'set_active:b', 'reboot']);
  assert.equal(reports.at(-1), 'Step 10/10: Done.');
});

test('fastboot: a timed-out write is retried twice, then stops; other errors stop at once', async () => {
  const dev = device('laurel_sprout'), stage = dev.roms[0].stages[0];
  const job = () => ({ device: dev, files: fakeFiles(stage), steps: stepsFor(stage) });
  const flaky = (/** @type {number} */ fails, message = 'Timeout of 15000 ms exceeded') => {
    const fb = fastboot(), flash = fb.flashBlob; let calls = 0;
    fb.flashBlob = async (partition, blob) => { if (partition === 'userdata' && fails-- > 0) { calls += 1; throw Error(message); } return flash(partition, blob); };
    return Object.assign(fb, { calls: () => calls });
  };
  const ok = flaky(2), reports = [];
  await recipes.fastboot.run(ok, job(), text => reports.push(text), noop);
  assert.ok(ok.log.includes('flash:userdata:rootfs.img') && ok.log.includes('reboot'));
  assert.ok(reports.some(r => /retrying \(2\/2\)/.test(r)));
  await assert.rejects(recipes.fastboot.run(flaky(3), job(), noop, noop), /Timeout/);
  const bad = flaky(5, 'FAIL: bad image');
  await assert.rejects(recipes.fastboot.run(bad, job(), noop, noop), /bad image/);
  assert.equal(bad.calls(), 1);
});

test('in-page download: streams the pinned file, checks its size', async () => {
  const { fetchPinned } = await import('../src/download.js');
  const get = async (/** @type {string} */ url) => new Response(url.endsWith('404') ? null : 'abcdef', { status: url.endsWith('404') ? 404 : 200 });
  const seen = [];
  const file = await fetchPinned({ name: 'boot.img', size: 6, url: 'https://x/boot.img' }, f => seen.push(f), get);
  assert.equal(await file.text(), 'abcdef');
  assert.equal(file.name, 'boot.img');
  assert.equal(seen.at(-1), 1);
  await assert.rejects(fetchPinned({ name: 'a', size: 5, url: 'https://x/a' }, undefined, get), /larger than/);
  await assert.rejects(fetchPinned({ name: 'a', size: 7, url: 'https://x/a' }, undefined, get), /6 bytes, the catalog pins 7/);
  await assert.rejects(fetchPinned({ name: 'a', size: 6, url: 'https://x/404' }, undefined, get), /HTTP 404/);
});

test('failure logs lose device serial numbers', async () => {
  const { redact } = await import('../src/debug.js');
  const log = redact('USB device: Google Android (18d1:d00d) serial c179ce7a1e3a\nUSB disconnect event (Android serial c179ce7a1e3a)\n← fastboot.getVariable("serialno") = "c179ce7a1e3a" (2 ms)');
  assert.ok(!log.includes('c179ce7a1e3a'), log);
  assert.match(log, /18d1:d00d/);
  assert.equal(redact('x'.repeat(300_000)).length, 200_000);
});

test('fastboot getvar: trims, FAIL means missing, times out instead of hanging', async () => {
  const { patientGetvar } = await import('../src/protocols/usb.js');
  assert.equal(await patientGetvar(async () => ({ text: ' b \n' }))('current-slot'), 'b');
  assert.equal(await patientGetvar(async () => { throw Object.assign(Error('x'), { status: 'FAIL' }); })('nope'), null);
  await assert.rejects(patientGetvar(() => new Promise(() => {}), 20)('slow'), /Timeout of 20 ms exceeded/);
  // After a timeout the next getvar waits for the owed answer instead of sending a second command.
  const sent = [];
  let answer;
  const slow = patientGetvar(command => { sent.push(command); return sent.length === 1 ? new Promise(r => { answer = r; }) : Promise.resolve({ text: 'yes' }); }, 20);
  await assert.rejects(slow('has-slot:boot'), /Timeout/);
  await assert.rejects(slow('has-slot:boot'), /Timeout/);
  assert.deepEqual(sent, ['getvar:has-slot:boot']);
  answer({ text: 'no' });
  assert.equal(await slow('has-slot:boot'), 'yes');
  assert.deepEqual(sent, ['getvar:has-slot:boot', 'getvar:has-slot:boot']);
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

test('fastboot verifies compressed XZ bytes, sizes and flashes the decoded image', async () => {
  const dev = device('laurel_sprout');
  const compressed = Buffer.from('/Td6WFoAAAFpIt42BMAWEiEBFgAAAAAAAAAAAKdRd54BABFkZWNvZGVkIGJvb3QgaW1hZ2UAAAAuT/5iAAEuEk/NONiQQpkNAQAAAAABWVo=', 'base64');
  const file = { name: 'boot.img.xz', sha256: createHash('sha256').update(compressed).digest('hex'), file: new Blob([compressed]) };
  const fb = fastboot({ 'partition-size:boot_b': '0x12' });
  await recipes.fastboot.run(fb, { device: dev, files: [file], steps: [['flash', 'boot_b', file.name]] }, noop, noop);
  assert.deepEqual(fb.log, ['flash:boot_b:decoded boot image']);

  const corrupt = Buffer.from(compressed); corrupt[corrupt.length - 1] ^= 1;
  const bad = { ...file, sha256: createHash('sha256').update(corrupt).digest('hex'), file: new Blob([corrupt]) };
  const untouched = fastboot();
  await assert.rejects(recipes.fastboot.run(untouched, { device: dev, files: [bad], steps: [['flash', 'boot_b', bad.name]] }, noop, noop), /Could not decode boot\.img\.xz/);
  assert.deepEqual(untouched.log, []);
});

test('XZ decoding stops at the target size and removes stale OPFS directories', async () => {
  const { decodeXzToOPFS } = await import('../src/recipes/fastboot-tgz.js');
  const bytes = Buffer.from('/Td6WFoAAAFpIt42BMAWEiEBFgAAAAAAAAAAAKdRd54BABFkZWNvZGVkIGJvb3QgaW1hZ2UAAAAuT/5iAAEuEk/NONiQQpkNAQAAAAABWVo=', 'base64');
  await assert.rejects(decodeXzToOPFS(new Blob([bytes]), 17), /exceeds target partition size/);

  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const removed = [];
  const root = {
    async *entries() {
      yield [`rominit-xz-${Date.now() - 25 * 60 * 60 * 1000}-stale`, {}];
      yield [`rominit-xz-${Date.now()}-active`, {}];
      yield ['rominit-xz-legacy-random-id', {}];
    },
    getDirectoryHandle: async () => ({ getFileHandle: async () => {
      const chunks = [];
      return { createWritable: async () => new WritableStream({ write: chunk => chunks.push(chunk) }), getFile: async () => new Blob(chunks) };
    } }),
    removeEntry: async name => { removed.push(name); },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => root } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  try {
    const decoded = await decodeXzToOPFS(new Blob([bytes]), 18);
    assert.equal(await decoded.file.text(), 'decoded boot image');
    await decoded.cleanup();
    assert.equal(removed.length, 2);
    assert.match(removed[0], /^rominit-xz-\d+-stale$/);
    assert.doesNotMatch(removed.join(' '), /active|legacy/);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('fastboot removes OPFS decoded images after a flash failure', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const removed = [];
  const root = {
    async *entries() {},
    getDirectoryHandle: async () => ({ getFileHandle: async () => {
      const chunks = [];
      return { createWritable: async () => new WritableStream({ write: chunk => chunks.push(chunk) }), getFile: async () => new Blob(chunks) };
    } }),
    removeEntry: async name => { removed.push(name); },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => root } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  try {
    const dev = device('laurel_sprout');
    const bytes = Buffer.from('/Td6WFoAAAFpIt42BMAWEiEBFgAAAAAAAAAAAKdRd54BABFkZWNvZGVkIGJvb3QgaW1hZ2UAAAAuT/5iAAEuEk/NONiQQpkNAQAAAAABWVo=', 'base64');
    const file = { name: 'boot.img.xz', sha256: createHash('sha256').update(bytes).digest('hex'), file: new Blob([bytes]) };
    const fb = fastboot(); fb.flashBlob = async () => { throw Error('flash failed'); };
    await assert.rejects(recipes.fastboot.run(fb, { device: dev, files: [file], steps: [['flash', 'boot_b', file.name]] }, noop, noop), /flash failed/);
    assert.equal(removed.length, 1);
    const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
    const bad = { ...file, sha256: createHash('sha256').update(corrupt).digest('hex'), file: new Blob([corrupt]) };
    await assert.rejects(recipes.fastboot.run(fastboot(), { device: dev, files: [bad], steps: [['flash', 'boot_b', bad.name]] }, noop, noop), /Could not decode boot\.img\.xz/);
    assert.equal(removed.length, 2);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('S9 TWRP stage checks the PIT and never reboots', async () => {
  const dev = device('starlte'), stage = s9().stages[0], log = [];
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
  const dev = device('starlte'), stage = s9().stages[1], shell = twrp();
  await recipes['twrp-dd'].run(shell, { device: dev, stage, files: fakeFiles(stage), steps: stepsFor(stage, { format: true }) }, noop, noop);
  const actions = shell.log.filter(c => /^(dd|umount|mke2fs|reboot)/.test(c));
  assert.deepEqual(actions.map(c => c.split(' ').slice(0, 2).join(' ')), [
    `dd of=${stage.by_name}/SYSTEM`, `dd of=${stage.by_name}/VENDOR`, `dd of=${stage.by_name}/BOOT`, 'umount /sdcard', 'umount /data', 'mke2fs -F', 'reboot']);
});

test('S4 ROM stage unmounts USERDATA before writing it; without the unmount step it fails closed', async () => {
  const dev = device('jfltexx'), stage = dev.roms.find(r => r.id === 'philipplinux-pmos-server').stages[1];
  const mounted = ['/dev/block/userdata /data ext4', '/dev/block/userdata /sdcard ext4'];
  const shell = twrp({ product: 'jflte', mounted });
  await recipes['twrp-dd'].run(shell, { device: dev, stage, files: fakeFiles(stage), steps: stepsFor(stage) }, noop, noop);
  assert.deepEqual(shell.log.filter(c => /^(dd|umount|reboot)/.test(c)).map(c => c.split(' ').slice(0, 2).join(' ')), [
    `dd of=${stage.by_name}/boot`, 'umount /sdcard', 'umount /data', `dd of=${stage.by_name}/userdata`, 'reboot']);
  const noUnmount = twrp({ product: 'jflte', mounted });
  const steps = stepsFor(stage).filter(([verb]) => verb !== 'unmount');
  await assert.rejects(recipes['twrp-dd'].run(noUnmount, { device: dev, stage, files: fakeFiles(stage), steps }, noop, noop), /userdata .* is mounted/);
  assert.ok(!noUnmount.log.some(c => c.startsWith('dd ')));
});

test('S9 ROM stage fails closed', async () => {
  const dev = device('starlte'), stage = s9().stages[1];
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
  const stage = s9().stages[1];
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

test('a re-uploaded revision of a pinned file is accepted, anything else stops', async () => {
  const stage = { files: [{ name: 'boot.img', size: 3, sha256: sha('abc'), revisions: [{ size: 4, sha256: sha('abcd') }] }] };
  for (const body of ['abc', 'abcd']) await verifyPins(selectFiles(stage, [new File([body], 'boot.img')]), noop);
  await assert.rejects(verifyPins(selectFiles(stage, [new File(['abce'], 'boot.img')]), noop), /SHA-256 mismatch/);
  assert.throws(() => selectFiles(stage, [new File(['ab'], 'boot.img')]), /wrong size/);
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

test('MCP: initialize, tools, search, recipe without confirm phrases, actionable errors', async () => {
  const { onRequestPost } = await import('../functions/mcp.js');
  const files = { index: devices.map(d => ({ ...d, roms: d.roms.filter(r => r.origin !== 'stock') })), ...Object.fromEntries(devices.map(d => [d.codename, d])) };
  let hits = 0;
  const env = { DB: { prepare: sql => ({ bind: () => ({ first: async () => sql.includes('api_tokens') ? { id: 1, token_id: 1, name: 'T' } : { n: hits ? ++hits : 1 }, run: async () => ({}) }) }) },
    ASSETS: { fetch: async url => { const f = files[new URL(url).pathname.slice(9, -5)]; return f ? Response.json(f) : new Response('', { status: 404 }); } } };
  let id = 0;
  const rpc = async (method, params, key = 'rmi_test-key-0123456789') => (await (await onRequestPost({ env, request: new Request('https://x/mcp', { method: 'POST', headers: key ? { authorization: `Bearer ${key}` } : {}, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }) })).json());
  const call = async (name, args, key) => (await rpc('tools/call', { name, arguments: args }, key)).result;
  assert.match((await rpc('initialize', {}, null)).result.instructions, /^No API token on this connection yet\..*view=agents/); // connect works, and says how to get a token
  for (const method of ['tools/list', 'tools/call']) assert.match((await rpc(method, {}, null)).error.message, /needs a free personal API token.*https:\/\/x\/\?view=agents/);
  const init = (await rpc('initialize', { protocolVersion: '2025-06-18' })).result;
  assert.equal(init.protocolVersion, '2025-06-18');
  assert.match(init.instructions, /https:\/\/x\/\?view=agents/);
  assert.equal((await rpc('tools/list')).result.tools.length, 6);
  assert.equal((await onRequestPost({ env, request: new Request('https://x/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }) })).status, 202);
  const found = (await call('rominit_find_devices', { query: 'mi a3' })).structuredContent;
  assert.ok(found.devices.some(d => d.codename === 'laurel_sprout'));
  const rom = device('laurel_sprout').roms[0];
  const recipe = (await call('rominit_get_rom', { codename: 'laurel_sprout', rom_id: rom.id })).structuredContent;
  assert.equal(recipe.stages.length, rom.stages.length);
  assert.ok(recipe.stages.every(s => s.confirm === undefined && s.destructive === true));
  assert.match((await call('rominit_get_device', { codename: '../x' })).content[0].text, /rominit_find_devices/);
  assert.match((await call('rominit_get_rom', { codename: 'laurel_sprout', rom_id: 'nope' })).content[0].text, new RegExp(rom.id));
  hits = 100; // count from here: the next call is the 101st this hour
  assert.match((await call('rominit_find_devices', { query: 'mi a3' })).content[0].text, /Rate limit: 100 tool calls per hour per token/);
});

test('agent API: token from the site, MCP report with it, admin inbox by outcome', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec((await import('node:fs')).readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  // D1 over node:sqlite: prepare(sql).bind(...).first/all/run
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }) });
  const files = Object.fromEntries(devices.map(d => [d.codename, d]));
  const env = { ADMINS: 'admin@example.org', DB: { prepare: sql => stmt(sql) },
    ASSETS: { fetch: async url => { const f = files[new URL(url).pathname.slice(9, -5)]; return f ? Response.json(f) : new Response('', { status: 404 }); } } };
  db.exec(`INSERT INTO users (id, provider, subject, name, email) VALUES (1, 'github', 'a', 'Ada', 'admin@example.org'), (2, 'github', 'b', 'Bob', 'bob@example.org');
    INSERT INTO sessions VALUES ('${sha('ada')}', 1, datetime('now', '+1 day')), ('${sha('bob')}', 2, datetime('now', '+1 day'))`);
  const tokens = await import('../functions/api/tokens.js');
  const site = (fn, sid, body) => fn({ env, request: new Request('https://x/api', { method: body ? 'POST' : 'GET', body: body && JSON.stringify(body), headers: { cookie: `sid=${sid}` } }) });
  assert.equal((await site(tokens.onRequestPost, 'nobody', { name: 'x' })).status, 401);
  assert.equal((await site(tokens.onRequestPost, 'bob', { name: 'x', days: 9999 })).status, 400);
  const reports = await import('../functions/api/reports.js'); // a report's page must be a same-site path: the admin inbox links it
  const report = page => reports.onRequestPost({ env: { ...env, SALT: 't' }, request: new Request('https://x/api', { method: 'POST', body: JSON.stringify({ page, text: 'x' }) }) });
  for (const page of ['javascript:alert(1)', '//evil.example', '/\\evil.example']) assert.equal((await report(page)).status, 400, page);
  assert.equal((await report('/?device=x')).status, 200);
  const { token } = await (await site(tokens.onRequestPost, 'bob', { name: 'laptop claude', days: 30 })).json();
  assert.equal(db.prepare("SELECT date(expires) = date('now', '+30 days') AS ok FROM api_tokens").get().ok, 1);
  assert.match(token, /^rmi_/);
  assert.equal(db.prepare('SELECT hash FROM api_tokens').get().hash, sha(token)); // only the hash is stored
  const { onRequestPost } = await import('../functions/mcp.js');
  let id = 0;
  const toolResult = reply => reply.result ?? { content: [{ text: reply.error.message }], isError: true };
  const call = async (name, args, auth = token) => toolResult(await (await onRequestPost({ env, request: new Request('https://x/mcp', { method: 'POST', headers: auth ? { authorization: `Bearer ${auth}` } : {},
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) }) })).json()); // a refused request comes back as a JSON-RPC error
  const rom = device('laurel_sprout').roms[0];
  assert.match((await call('rominit_start_run', { codename: 'laurel_sprout', rom_id: rom.id }, null)).content[0].text, /\?view=agents/);
  assert.match((await call('rominit_start_run', { codename: 'laurel_sprout', rom_id: rom.id, colour: 'red' })).content[0].text, /colour/);
  const { run_id } = (await call('rominit_start_run', { codename: 'laurel_sprout', rom_id: rom.id, host: 'linux', tools: 'fastboot 35' })).structuredContent;
  assert.equal((await call('rominit_log_step', { run_id, stage: 1, outcome: 'ok', detail: 'device 1a2b3c4d\tfastboot, ssh 172.16.42.1, see /home/ada/x.img' })).structuredContent.logged, 1); // personal data is stripped, not refused
  assert.equal((await call('rominit_log_step', { run_id, stage: 1, outcome: 'workaround', detail: 'needed a USB 2 port' })).structuredContent.logged, 2);
  assert.ok((await call('rominit_finish_run', { run_id, outcome: 'success', resolution: 'Use a USB 2 port for stage 1.' })).structuredContent.ok);
  assert.match((await call('rominit_log_step', { run_id, stage: 2, outcome: 'ok' })).content[0].text, /finished/);
  const inbox = await import('../functions/api/inbox.js');
  assert.equal((await site(inbox.onRequestGet, 'bob')).status, 403);
  const { agents } = await (await site(inbox.onRequestGet, 'ada')).json();
  assert.deepEqual([agents.success.length, agents.failed.length], [1, 0]);
  assert.deepEqual(agents.success[0].steps, [{ stage: 1, step: null, outcome: 'ok', detail: 'device [a serial number removed], ssh [an IPv4 address removed], see [a home path removed]/x.img' },
    { stage: 1, step: null, outcome: 'workaround', detail: 'needed a USB 2 port' }]);
  assert.equal(db.prepare('SELECT n FROM mcp_hits WHERE who LIKE ?').get('token:%').n, 6); // every tool call of this token counted
  // a revoked token stops reporting
  const listed = await (await site(tokens.onRequestGet, 'bob')).json(); // a plain array, as site/app.js reads it
  assert.deepEqual(listed.map(t => t.name), ['laptop claude']);
  const [{ id: tokenId }] = listed;
  assert.equal((await site(tokens.onRequestPost, 'ada', { revoke: tokenId })).status, 404); // not Ada's token
  assert.equal((await site(tokens.onRequestPost, 'bob', { revoke: tokenId })).status, 200);
  assert.match((await call('rominit_start_run', { codename: 'laurel_sprout', rom_id: rom.id })).content[0].text, /view=agents/);
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

test('untar reads a gzip tar with long names and skips unwanted entries', { skip: process.platform !== 'linux' && 'fixture needs GNU tar' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
  const dir = mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'rominit-tar-')), deep = `${'d'.repeat(120)}/images`;
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

test('fastboot max-download-size: decimal (Qualcomm ABL) and hex both parse', async () => {
  const { downloadSize } = await import('../src/protocols/usb.js');
  assert.equal(downloadSize('536870912'), 0x20000000); // Mi A3 answers decimal; hex-only parsing overshot the limit
  assert.equal(downloadSize('0x10000000'), 0x10000000);
  assert.equal(downloadSize(null), 0x20000000);
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

test('old TWRP without shell v2: images go over sync in chunks, dd writes each at its offset', async () => {
  const { adbShell } = await import('../src/protocols/usb.js');
  const commands = [], pushed = [];
  const adb = {
    subprocess: { shellProtocol: undefined, noneProtocol: { spawnWaitText: async command => {
      commands.push(command);
      return command.startsWith('false') ? 'boom\r\nROMINIT_RC=1\r\n' : 'ok\r\nROMINIT_RC=0\r\n';
    } } },
    sync: async () => ({ write: async ({ file }) => pushed.push(await new Response(file).text()), dispose: async () => {} })
  };
  assert.deepEqual(await adbShell(/** @type {any} */ (adb)).run('getprop x'), { code: 0, out: 'ok\n' });
  assert.equal((await adbShell(/** @type {any} */ (adb)).run('false')).code, 1);
  commands.length = 0;
  const { legacyShell } = await import('../src/protocols/usb.js');
  const result = await legacyShell(/** @type {any} */ (adb), 1024 * 1024).pipe('dd of=/dev/block/X bs=1048576', new Blob(['a'.repeat(2.5 * 1024 * 1024)]), noop);
  assert.equal(result.code, 0);
  assert.deepEqual(pushed.map(p => p.length), [1048576, 1048576, 524288]);
  assert.deepEqual(commands.map(c => c.match(/seek=(\d+)/)?.[1] ?? c.split(';')[0]), ['0', '1', '2', 'rm -f /tmp/rominit.chunk']);
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

test('ROMvault log rotation: oldest entries move verbatim to monthly archives, nothing lost, second run no-op', async () => {
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rotate, CAP } = await import('../scripts/romvault-log.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'romvault-log-'));
  try {
    const entries = Array.from({ length: 300 }, (_, i) => `## [2026-${i < 150 ? '09' : '10'}-${String(1 + i % 28).padStart(2, '0')}] update | p${i}.md: x (t)\n`);
    writeFileSync(join(dir, 'log.md'), `---\ntype: log\ntitle: ROMvault log\ndate: 2026-09-01\nupdated: 2026-09-01\n---\n\n# ROMvault log\n\n## For future agent\nRules.\n\n${entries.join('\n')}`);
    assert.ok(rotate(dir, '2026-10-27') > 0);
    const live = readFileSync(join(dir, 'log.md'), 'utf8'), sep = readFileSync(join(dir, 'logs/2026/log-2026-09.md'), 'utf8');
    assert.ok(live.split('\n').length <= 205 && live.split('\n').length < CAP);
    assert.match(live, /Rules\.\n\nOlder entries: \[2026-09\]\(logs\/2026\/log-2026-09\.md\)/);
    assert.match(live, /p299\.md/); assert.match(live, /^updated: 2026-10-27$/m);
    const oct = join(dir, 'logs/2026/log-2026-10.md'), archived = sep + (existsSync(oct) ? readFileSync(oct, 'utf8') : '');
    assert.equal((live.match(/^## \[/gm) ?? []).length + (archived.match(/^## \[/gm) ?? []).length, 300, 'every entry kept exactly once');
    assert.ok(sep.indexOf('p0.md') < sep.indexOf('p1.md'), 'archive is oldest first');
    assert.equal(rotate(dir, '2026-10-27'), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ROMvault is a private checkout (git-ignored); public CI has no copy.
test('ROMvault lint: frontmatter, tags, links, index and the full net are clean', { skip: !existsSync(new URL('../romvault/AGENTS.md', import.meta.url)) && 'private ROMvault checkout missing' }, async () => {
  const { lint } = await import('../scripts/romvault-lint.mjs');
  assert.deepEqual(lint(), []);
});

test('ROMvault net fix: rebuilds a deleted series page, a SoC page and their links, lint-clean', { skip: !existsSync(new URL('../romvault/AGENTS.md', import.meta.url)) && 'private ROMvault checkout missing' }, async () => {
  const { cpSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { lint } = await import('../scripts/romvault-lint.mjs');
  const { fix, tree } = await import('../scripts/romvault-net.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'romvault-')), vault = join(dir, 'romvault');
  try {
    const root = new URL('..', import.meta.url).pathname; // pages link ../../catalog/: mirror the repo around the copy
    for (const e of readdirSync(root)) if (e !== 'romvault') symlinkSync(join(root, e), join(dir, e));
    cpSync(new URL('../romvault', import.meta.url), vault, { recursive: true, dereference: true, filter: src => !src.includes('/.git') });
    assert.equal(lstatSync(vault).isSymbolicLink(), false, 'test fixture must never link to the real ROMvault');
    rmSync(join(vault, 'vendors/google/series/google-pixel-7.md'));
    rmSync(join(vault, 'socs/sdm670.md'));
    for (const f of ['vendors/google/lines/google-pixel.md', 'devices/phones/google/google-sargo/google-sargo.md', 'devices/phones/google/google-bonito/google-bonito.md']) {
      const p = join(vault, f);
      writeFileSync(p, readFileSync(p, 'utf8').split('\n').filter(l => !/series\/google-pixel-7\.md|socs\/sdm670\.md/.test(l)).join('\n'));
    }
    const pmos = join(vault, 'os/mobile/postmarketos.md'); // OS → device list is rebuilt from the device's ROM pages
    writeFileSync(pmos, readFileSync(pmos, 'utf8').split('\n').filter(l => !l.includes('fairphone-fp4/fairphone-fp4.md')).join('\n'));
    assert.ok(lint(vault).some(p => p.includes('postmarketos.md: does not list devices/phones/fairphone/fairphone-fp4')));
    const created = fix(vault, 'test').create;
    assert.ok(created.has('vendors/google/series/google-pixel-7.md') && created.has('socs/sdm670.md'));
    assert.deepEqual(lint(vault), []);
    assert.match(readFileSync(pmos, 'utf8'), /## Devices in ROMvault\n### Fairphone\n- \[Fairphone 4 \(fairphone-fp4\)\]/, 'OS device list is grouped by vendor');
    const tabletPage = join(vault, 'devices/tablets/google/tangorpro/tangorpro.md');
    const tabletText = readFileSync(tabletPage, 'utf8');
    writeFileSync(tabletPage, tabletText.replace('tags: [tablet,', 'tags: [phone,'));
    assert.ok(lint(vault).some(p => p.includes('tag tablet missing (catalog category)')));
    const unreviewed = (/** @type {string} */ t) => t.replace(/^reviewed: .*\n/m, ''); // the vault may already be backfilled
    writeFileSync(tabletPage, unreviewed(tabletText).replace(/^confidence: .*$/m, 'confidence: high').replace(/^updated: .*$/m, '$&\nreviewed: 2026-01-01'));
    assert.ok(lint(vault).some(p => p.includes('reviewed must fall between date and updated')));
    writeFileSync(tabletPage, unreviewed(tabletText).replace(/^updated: .*$/m, `$&\nreviewed: ${tabletText.match(/^date: (\d{4}-\d{2}-\d{2})$/m)[1]}`));
    const otherPage = join(vault, 'devices/phones/google/cheetah/cheetah.md'), otherText = readFileSync(otherPage, 'utf8');
    writeFileSync(otherPage, unreviewed(otherText));
    assert.ok(lint(vault).some(p => p.includes('missing reviewed')), 'one page with reviewed makes the field required for the rest');
    writeFileSync(otherPage, otherText.replace('\n## Links\n', '\n## Links\n- Vendor: [Google](../../../../vendors/google/google.md)\n'));
    assert.ok(lint(vault).some(p => p.includes('cheetah.md: ## Links skips up to vendors/google/google.md')), 'device links only its series');
    writeFileSync(otherPage, otherText);
    writeFileSync(tabletPage, tabletText);
    const ps5Series = join(vault, 'vendors/sony/series/sony-playstation-5.md'), ps5Text = readFileSync(ps5Series, 'utf8');
    writeFileSync(ps5Series, ps5Text.replace('\n## Links\n', '\n## Links\n- Homebrew: [PS5 homebrew](../../../devices/consoles/sony/ps5/ps5-homebrew.md)\n'));
    assert.ok(lint(vault).some(p => p.includes('sony-playstation-5.md: links devices/consoles/sony/ps5/ps5-homebrew.md: device topic pages')), 'topic pages hang under their device only');
    writeFileSync(ps5Series, ps5Text);
    assert.match(tree(vault), /Google Pixel 7 {2}\(vendors\/google\/series\/google-pixel-7\.md\)\n {8}Google Pixel 7 Pro \(cheetah\) {2}\[\w+ · \d+ turns · reviewed .+ · .+\]/);
    assert.equal(fix(vault, 'test').update.size, 0, 'second run changes nothing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ROMvault index.json is current and every net page has its parent', { skip: !existsSync(new URL('../romvault/index.json', import.meta.url)) && 'private ROMvault checkout missing' }, async () => {
  const { readFileSync } = await import('node:fs');
  const { index } = await import('../scripts/romvault-net.mjs');
  const built = index(new URL('../romvault', import.meta.url).pathname);
  assert.deepEqual(JSON.parse(readFileSync(new URL('../romvault/index.json', import.meta.url), 'utf8')), built, 'stale: run node scripts/romvault-net.mjs index');
  const up = (/** @type {string} */ rel) => [rel, ...(built.pages[rel].parent ? up(built.pages[rel].parent) : [])];
  assert.equal(up(built.catalog.starlte).at(-1), 'categories/phones.md');
  assert.deepEqual(up('os/pc/arch-linux-rolling.md'), ['os/pc/arch-linux-rolling.md', 'os/pc/arch-linux.md', 'os/pc/pc-os.md', 'categories/os.md'], 'OS tree: release › OS › group › category');
  assert.deepEqual(Object.entries(built.pages).filter(([rel, p]) => !p.parent && ['device', 'series', 'line', 'vendor', 'rom'].includes(p.type)).map(([rel]) => rel), []);
});

test('sources page lists every dependency', async () => {
  const { readFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const app = await readFile(new URL('../site/app.js', import.meta.url), 'utf8');
  const listed = app.slice(app.indexOf('const SOFTWARE'), app.indexOf('function sourcesView'));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (dep.startsWith('@types/')) continue;
    const short = dep.split('/').pop() ?? dep;
    assert.ok(listed.includes(dep) || listed.toLowerCase().includes(short.toLowerCase()), `${dep} missing from SOFTWARE in site/app.js`);
  }
});

test('one-click unlock: sends the command only on a locked phone; lock only as an opt-in option on a relockable ROM', async () => {
  const dev = device('laurel_sprout'), stage = unlockStage(dev);
  const locked = fastboot({ unlocked: 'no' });
  await recipes.fastboot.run(locked, { device: dev, files: [], steps: stage.steps }, noop, noop);
  assert.deepEqual(locked.log, ['flashing get_unlock_ability', 'flashing unlock']);
  const off = fastboot({ unlocked: 'no', unlock_ability: 0 });
  await assert.rejects(recipes.fastboot.run(off, { device: dev, files: [], steps: stage.steps }, noop, noop), /OEM unlocking is off/);
  assert.deepEqual(off.log, ['flashing get_unlock_ability']);
  const open = fastboot();
  await recipes.fastboot.run(open, { device: dev, files: [], steps: stage.steps }, noop, noop);
  assert.deepEqual(open.log, []);
  await assert.rejects(recipes.fastboot.run(fastboot({ unlocked: 'no' }), { device: dev, files: [], steps: [['unlock', 'flashing'], ['reboot']] }, noop, noop), /alone/);
  const stock = dev.roms.find(r => r.origin === 'stock'), restore = stock.stages[0];
  assert.deepEqual(stepsFor(restore).slice(-1), [['reboot']]);
  assert.deepEqual(stepsFor(restore, { lock: true }).slice(-2), [['lock', 'flashing'], ['reboot']]);
  const lockOn = { ...restore, options: [{ id: 'lock', label: 'x', default: true, steps: [['lock', 'flashing']] }] };
  assert.match(stagesProblems(dev, [lockOn], 'x', stock).join(), /default to off/);
  assert.match(stagesProblems(dev, [restore], 'x', { rating: { includes: { relock: 'no' } } }).join(), /relock is yes/);
  assert.match(stagesProblems(dev, [{ ...restore, steps: [...restore.steps, ['lock', 'flashing']] }], 'x', stock).join(), /only inside an option/);
  assert.match(stagesProblems(dev, [{ ...dev.roms[0].stages[0], steps: [['unlock', 'flashing']] }], 'x').join(), /unlock only in the unlock stage|section/);
  assert.deepEqual(stagesProblems(dev, [stage], 'x'), []);
});

test('amlogic stage: one burn step with a known wipe mode', () => {
  const dev = { modes: { 'usb-burn': 'Hold the reset button while plugging in USB.' } };
  const file = { name: 'aml_upgrade_package.img', size: 1, sha256: sha('x'), source: 'https://example.org/' };
  const stage = (/** @type {any[]} */ ...steps) => ({ title: 'Burn', warning: 'w', confirm: 'BURN BOX', section: 'rom', recipe: 'amlogic', mode: 'usb-burn', files: [file], steps });
  assert.deepEqual(stagesProblems(dev, [stage(['burn', file.name, 'keep_keys'])], 'x'), []);
  assert.match(stagesProblems(dev, [stage(['burn', file.name, 'nuke'])], 'x').join(), /wipe/);
});

test('requests API validates request kind, URLs, paths and ROMs', async () => {
  const { onRequestPost } = await import('../functions/api/requests.js');
  const saved = [];
  const env = { SALT: 'test', ASSETS: { fetch: async () => Response.json([{ codename: 'x', roms: [{ id: 'lineage' }] }]) },
    DB: { prepare: sql => ({ bind: (...args) => ({ first: async () => null, run: async () => (saved.push([sql, args]), { meta: { changes: 1 } }) }) }) } };
  const post = body => onRequestPost({ env, request: new Request('https://x/api/requests', { method: 'POST', body: JSON.stringify(body) }) });
  const common = { kind: 'update', page: '/?device=x', rom: 'x/lineage', url: 'https://example.org/rom', text: 'Please update this listing' };
  for (const body of [{ ...common, url: 'javascript:alert(1)' }, { ...common, page: '//evil.test' }, { ...common, rom: 'x/missing' }]) assert.equal((await post(body)).status, 400);
  assert.equal((await post({ ...common, kind: 'mirror', url: undefined })).status, 200);
  assert.equal((await post(common)).status, 200);
  assert.deepEqual(saved.map(([, args]) => args[0]), ['mirror', 'update']);
});
