import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { lstat, mkdtemp, mkdir, readFile, rename, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectUsbEnvironment, createUsbMedia } from '../bin/usb-media.mjs';

const bytes = value => Buffer.from(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rominit-usb-media-'));
  const ventoyDir = join(root, 'ventoy-1.1.18');
  const mediaRoot = join(root, 'media');
  const mountpoint = join(mediaRoot, 'USB');
  const detached = join(mediaRoot, 'USB-detached');
  const cacheDir = join(root, 'cache');
  const imagePath = join(root, 'alpine.iso');
  const image = bytes('fixture Alpine ISO bytes');
  await mkdir(ventoyDir, { recursive: true });
  await mkdir(mountpoint, { recursive: true });
  await writeFile(join(ventoyDir, 'Ventoy2Disk.sh'), '#!/bin/sh\n');
  if (options.installerSymlink) await symlink(imagePath, join(ventoyDir, 'unexpected-link'));
  await writeFile(imagePath, image);
  if (options.imageSize) await truncate(imagePath, options.imageSize);

  const state = {
    size: options.diskSize ?? 4_000_000_000,
    majorMinor: '8:48',
    layout: Boolean(options.existingVentoy || options.ambiguousVentoy),
    initialMount: options.initialMount === false ? null : mountpoint,
    dataMount: options.existingVentoy && options.mountedVentoy !== false ? mountpoint : null,
    busyUnmount: Boolean(options.busyUnmount),
    installerExit: 0,
    listOutput: options.listOutput ?? `**********************************************\n      Ventoy: 1.1.18  x86_64\n...banner...\nVentoy Version in Disk  : 1.1.18\nDisk Partition Style  : MBR\nSecure Boot Support   : YES\n`,
    promptInput: null,
    spawned: 0,
    unmounts: 0,
    raceOnStatfs: false,
    mountRaceCopyLocation: null,
    directWritten: false,
    directArgs: null,
  };

  function diskTree() {
    const disk = { name: 'sdz', path: '/dev/sdz', type: 'disk', rm: 1, ro: 0, size: state.size,
      model: 'Fixture USB', tran: 'usb', 'maj:min': state.majorMinor, children: [] };
    if (state.layout) {
      disk.children.push(
        { name: 'sdz1', path: '/dev/sdz1', type: 'part', rm: 0, ro: 0, size: state.size - 20_000_000,
          'maj:min': '8:49', fstype: 'exfat', label: 'Ventoy', mountpoints: state.dataMount ? [state.dataMount] : [] },
        ...(options.ambiguousVentoy ? [] : [{ name: 'sdz2', path: '/dev/sdz2', type: 'part', rm: 0, ro: 0, size: 32_000_000,
          'maj:min': '8:50', fstype: 'vfat', label: 'VTOYEFI', mountpoints: [] }]),
      );
    } else if (options.stacked) {
      disk.children.push({ name: 'dm-0', path: '/dev/dm-0', type: 'crypt', rm: 0, ro: 0, size: state.size,
        'maj:min': '253:0', pkname: 'sdz' });
    } else {
      disk.children.push({ name: 'sdz1', path: '/dev/sdz1', type: 'part', rm: 0, ro: 0, size: state.size,
        'maj:min': '8:49', fstype: options.swap ? 'swap' : 'vfat', label: 'FIXTURE',
        mountpoints: [options.systemMount ?? state.initialMount].filter(Boolean) });
    }
    return [disk];
  }

  const idDir = '/dev/disk/by-id';
  const idPath = `${idDir}/usb-fixture-disk`;
  const defaultRealpath = (await import('node:fs/promises')).realpath;
  const resolvePath = path => path === idPath ? Promise.resolve('/dev/sdz') : defaultRealpath(path);
  const mountDevice = await stat(mountpoint);
  const fileStat = path => path === '/dev/sdz1'
    ? Promise.resolve({ isBlockDevice: () => true, isFile: () => false, rdev: mountDevice.dev, size: 0 })
    : stat(path);
  const fileStatFs = async path => {
    if (state.raceOnStatfs) {
      state.raceOnStatfs = false;
      await rename(mountpoint, detached);
      await mkdir(mountpoint);
      state.mountRaceCopyLocation = detached;
    }
    const { statfs } = await import('node:fs/promises');
    return statfs(path);
  };
  const trustStat = async path => {
    const info = await lstat(path);
    return new Proxy(info, { get(target, key) {
      if (key === 'uid') return 0;
      if (key === 'mode') return options.untrustedInstaller && path === ventoyDir ? target.mode | 0o020 : target.mode & ~0o022;
      return Reflect.get(target, key, target);
    } });
  };
  const commands = [];
  let inventoryCount = 0;
  async function runCommand(file, args) {
    commands.push([file, [...args]]);
    if (file === '/usr/bin/lsblk') {
      inventoryCount++;
      if (inventoryCount === options.mutateOnInventoryCount)
        await options.mutateOnInventory?.({ imagePath, cacheDir, state, inventoryCount });
      return { stdout: JSON.stringify({ blockdevices: diskTree() }), stderr: '' };
    }
    if (file === '/usr/bin/sudo' && args[1] === '/usr/bin/true') {
      await options.mutateOnSudoPreflight?.({ imagePath, cacheDir, state });
      return { stdout: '', stderr: '' };
    }
    if (file === '/usr/bin/sudo' && args[1] === '/usr/bin/python3' && args[3] === 'pass') {
      if (options.pythonUnavailable) throw Error('python3 is unavailable');
      return { stdout: '', stderr: '' };
    }
    if (file === '/usr/bin/udisksctl' && args[0] === 'unmount') {
      state.unmounts++;
      if (state.busyUnmount) throw Object.assign(Error('device is busy'), { stderr: 'device is busy' });
      state.initialMount = null;
      state.dataMount = null;
      await options.mutateOnUnmount?.({ imagePath, cacheDir, state });
      return { stdout: '', stderr: '' };
    }
    if (file === '/usr/bin/udisksctl' && args[0] === 'mount') {
      state.dataMount = mountpoint;
      return { stdout: '', stderr: '' };
    }
    if (file === '/usr/bin/sudo' && args.includes('-l')) return { stdout: state.listOutput, stderr: '' };
    throw Error(`unexpected command ${file} ${args.join(' ')}`);
  }
  function spawnProcess(file, args = []) {
    state.spawned++;
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('close', null, 'SIGTERM'));
    if (args[1] === '/usr/bin/python3') {
      state.directArgs = [...args];
      child.stdin.end = () => {};
      setImmediate(async () => {
        await options.mutateOnDirectSpawn?.({ imagePath, cacheDir, state });
        if (options.hangDirect) return;
        const [sourcePath, deviceId, sizeText, expectedHash, majorText, minorText, capacityText] = args.slice(4);
        const expectedSize = Number(sizeText), expectedCapacity = Number(capacityText);
        if (`${majorText}:${minorText}` !== state.majorMinor) {
          child.stderr.emit('data', 'ROMINIT_USB_ERROR The selected USB disk identity changed before opening; no write was started.\n');
          child.emit('close', 1, null);
          return;
        }
        if (expectedCapacity !== state.size || expectedSize > state.size) {
          child.stderr.emit('data', 'ROMINIT_USB_ERROR The selected USB disk capacity changed or is too small; no write was started.\n');
          child.emit('close', 1, null);
          return;
        }
        const source = await readFile(sourcePath);
        if (source.length !== expectedSize || digest(source) !== expectedHash) {
          child.stderr.emit('data', 'ROMINIT_USB_ERROR The reviewed ISO changed before writing.\n');
          child.emit('close', 1, null);
          return;
        }
        state.directWritten = true;
        state.directBytes = source;
        const output = line => child.stdout.emit('data', `${line}\n`);
        const progress = (phase, completedBytes, totalBytes = expectedSize) => output(`ROMINIT_USB_PROGRESS ${JSON.stringify({ phase, completedBytes, totalBytes })}`);
        progress('writing', expectedSize);
        output('ROMINIT_USB_PHASE syncing');
        const finishReadback = () => {
          output('ROMINIT_USB_PHASE verifying');
          progress('verifying', 0);
          progress('verifying', expectedSize);
          for (const line of options.extraDirectProgressLines ?? []) output(`ROMINIT_USB_PROGRESS ${line}`);
          const readback = options.readbackMismatch ? bytes('corrupted readback') : source;
          const result = { size: readback.length, sha256: digest(readback), matched: readback.length === expectedSize && digest(readback) === expectedHash };
          output(`ROMINIT_USB_RESULT ${JSON.stringify(result)}`);
          child.stderr.emit('end');
          child.stdout.emit('end');
          child.emit('close', 0, null);
        };
        if (options.holdDirectAtSync) {
          state.finishDirect = finishReadback;
          return;
        }
        if (options.holdDirectAfterProgress) {
          output('ROMINIT_USB_PHASE verifying');
          progress('verifying', 0);
          progress('verifying', expectedSize);
          for (const line of options.extraDirectProgressLines ?? []) output(`ROMINIT_USB_PROGRESS ${line}`);
          const readback = options.readbackMismatch ? bytes('corrupted readback') : source;
          const result = { size: readback.length, sha256: digest(readback), matched: readback.length === expectedSize && digest(readback) === expectedHash };
          output(`ROMINIT_USB_RESULT ${JSON.stringify(result)}`);
          state.finishDirect = () => {
            child.stderr.emit('end');
            child.stdout.emit('end');
            child.emit('close', 0, null);
          };
          return;
        }
        finishReadback();
      });
      return child;
    }
    child.stdin.end = value => {
      state.promptInput = value;
      if (options.hangInstaller) return;
      setImmediate(() => {
        state.layout = true;
        child.emit('close', state.installerExit, null);
      });
    };
    child.kill = () => setImmediate(() => child.emit('close', null, 'SIGTERM'));
    return child;
  }

  let nextId = 0;
  const backend = createUsbMedia({
    ventoyDir: options.noVentoy ? null : ventoyDir, ventoyVersion: '1.1.18', imagePath, imageSha256: options.imageSha256 ?? digest(image), byIdDir: idDir,
    runCommand, spawnProcess, resolvePath, fileStat, fileStatFs, mediaMountRoots: [mediaRoot],
    imageCacheDir: cacheDir, fetchImage: options.fetchImage,
    hostEnvironment: options.hostEnvironment ?? null,
    ...(options.alpineImage ? { getAlpineImage: id => id === options.alpineImage.id ? options.alpineImage : undefined } : {}),
    trustStat,
    readText: async path => path === '/proc/swaps' ? 'Filename Type Size Used Priority\n' : readFile(path, 'utf8'),
    listDir: async path => path === idDir ? [idPath.split('/').at(-1)] : [],
    makeId: () => `fixture-plan-${++nextId}`,
    makeJobId: options.makeJobId ?? (() => 'j'.repeat(43)),
    ...(options.reportOutcome ? { reportOutcome: options.reportOutcome } : {}),
    ...(options.installTimeout ? { installTimeout: options.installTimeout } : {}),
    ...(options.directWriteTimeoutMs ? { directWriteTimeout: () => options.directWriteTimeoutMs } : {}),
  });
  return { root, ventoyDir, mediaRoot, mountpoint, detached, imagePath, image, cacheDir, state, commands, backend,
    cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function terminalJob(backend, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = backend.status();
    if (result.state === 'succeeded' || result.state === 'failed') return result;
    await sleep(5);
  }
  throw Error(`USB job did not finish: ${backend.status().state}`);
}

async function planned(fx, imageId) {
  return fx.backend.plan({ driveId: '/dev/disk/by-id/usb-fixture-disk', method: 'ventoy', ...(imageId ? { imageId } : {}) });
}

async function directPlanned(fx, imageId) {
  return fx.backend.plan({ driveId: '/dev/disk/by-id/usb-fixture-disk', method: 'direct', ...(imageId ? { imageId } : {}) });
}

test('Ventoy plan reports stable drive, mount review, pinned image, and exact erase phrase', async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const drives = await fx.backend.listDrives();
  assert.deepEqual(drives, [{ id: '/dev/disk/by-id/usb-fixture-disk', path: '/dev/sdz', model: 'Fixture USB',
    size: 4_000_000_000, mounted: true, mounts: [fx.mountpoint], available: true, reason: null }]);
  const plan = await planned(fx);
  assert.equal(plan.confirm, 'ERASE');
  assert.deepEqual(plan.drive.mounts, [fx.mountpoint]);
  assert.deepEqual(plan.image, { name: 'alpine.iso', size: fx.image.length, sha256: digest(fx.image) });
  assert.match(plan.warning, /erases all data/);
  assert.equal(Object.hasOwn(plan, 'imageSource'), false);
});

test('selected Alpine ISO downloads with redirects disabled, is cached, pinned in the plan, and copied from that pin', async t => {
  const data = bytes('selected Alpine ISO');
  const alpineImage = { id: 'fixture-standard-x86_64', arch: 'x86_64', format: 'iso', url: 'https://images.test/alpine-standard.iso',
    sha256: digest(data), size: data.length, usb: true };
  let downloads = 0;
  const fx = await fixture({ alpineImage, fetchImage: async (url, init) => {
    downloads++;
    assert.equal(url, alpineImage.url);
    assert.equal(init.redirect, 'error');
    return new Response(data);
  } });
  t.after(fx.cleanup);
  const plan = await planned(fx, alpineImage.id);
  assert.deepEqual(plan.image, { id: alpineImage.id, arch: alpineImage.arch, format: 'iso', name: 'alpine-standard.iso',
    size: data.length, sha256: digest(data), url: alpineImage.url });
  assert.deepEqual(plan.verification, { status: 'verified', expected: { size: data.length, sha256: digest(data) },
    actual: { size: data.length, sha256: digest(data) } });
  assert.equal(Object.hasOwn(plan, 'imageSource'), false);
  assert.equal(downloads, 1);
  const accepted = await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  assert.equal(accepted.state, 'pending');
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'succeeded', result.error);
  assert.deepEqual(result.verification, { status: 'verified', expected: { size: data.length, sha256: digest(data) },
    actual: { size: data.length, sha256: digest(data) }, accepted: false });
  assert.equal((await readFile(join(fx.mountpoint, 'alpine-standard.iso'))).toString(), data.toString());
  assert.equal(downloads, 1, 'the verified cached file is reused rather than fetched again');
});

test('verified existing Ventoy gets a copy-only plan and copies without unmounting or running the installer', async t => {
  const data = bytes('selected Alpine ISO');
  const alpineImage = { id: 'fixture-standard-x86_64', arch: 'x86_64', format: 'iso', url: 'https://images.test/alpine.iso',
    sha256: digest(data), size: data.length, usb: true };
  const fx = await fixture({ existingVentoy: true, alpineImage, fetchImage: async () => new Response(data) });
  t.after(fx.cleanup);
  const plan = await planned(fx, alpineImage.id);
  assert.equal(plan.action, 'copy');
  assert.equal(plan.confirm, 'COPY');
  assert.match(plan.warning, /Existing files and partitions are preserved; the drive will not be reformatted/);
  assert.doesNotMatch(plan.warning, /erases all data/i);
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'succeeded', result.error);
  assert.equal((await readFile(join(fx.mountpoint, 'alpine.iso'))).toString(), data.toString());
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);
  assert.equal(fx.commands.filter(([file, args]) => file === '/usr/bin/sudo' && args.includes('-l')).length, 2,
    'Ventoy version is listed during planning and rechecked before copying');
});

test('copy-only plan never overwrites an existing ISO file', async t => {
  const data = bytes('selected Alpine ISO');
  const old = bytes('original file contents');
  const alpineImage = { id: 'fixture-standard-x86_64', arch: 'x86_64', format: 'iso', url: 'https://images.test/alpine.iso',
    sha256: digest(data), size: data.length, usb: true };
  const fx = await fixture({ existingVentoy: true, alpineImage, fetchImage: async () => new Response(data) });
  t.after(fx.cleanup);
  const destination = join(fx.mountpoint, 'alpine.iso');
  await writeFile(destination, old);
  const plan = await planned(fx, alpineImage.id);
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /already exists/);
  assert.deepEqual(await readFile(destination), old);
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);
});

test('ambiguous existing Ventoy layout is refused before download or disk changes', async t => {
  let downloads = 0;
  const alpineImage = { id: 'fixture-standard-x86_64', arch: 'x86_64', format: 'iso', url: 'https://images.test/alpine.iso',
    sha256: digest('selected Alpine ISO'), size: Buffer.byteLength('selected Alpine ISO'), usb: true };
  const fx = await fixture({ ambiguousVentoy: true, alpineImage, fetchImage: async () => { downloads++; return new Response('selected Alpine ISO'); } });
  t.after(fx.cleanup);
  await assert.rejects(planned(fx, alpineImage.id), error => error.status === 409);
  assert.equal(downloads, 0);
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);
});

test('mismatched installed Ventoy version fails closed before download or erase', async t => {
  let downloads = 0;
  const alpineImage = { id: 'fixture-standard-x86_64', arch: 'x86_64', format: 'iso', url: 'https://images.test/alpine.iso',
    sha256: digest('selected Alpine ISO'), size: Buffer.byteLength('selected Alpine ISO'), usb: true };
  const fx = await fixture({ existingVentoy: true, listOutput: 'Ventoy Version in Disk : 1.1.17\n', alpineImage,
    fetchImage: async () => { downloads++; return new Response('selected Alpine ISO'); } });
  t.after(fx.cleanup);
  await assert.rejects(planned(fx, alpineImage.id), error => error.status === 409);
  assert.equal(downloads, 0);
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);
});

test('selected Alpine download rejects non-USB records and redirects before issuing a plan', async t => {
  const data = bytes('verified ISO');
  const base = { id: 'fixture-iso', arch: 'x86_64', format: 'iso', url: 'https://images.test/alpine.iso',
    sha256: digest(data), size: data.length, usb: true };
  for (const item of [
    { pin: { ...base, usb: false, format: 'tar.gz', url: 'https://images.test/alpine.tar.gz' }, response: () => new Response(data), status: 400 },
    { pin: base, response: () => new Response('', { status: 302, headers: { location: 'https://other.test/alpine.iso' } }), status: 502 },
  ]) {
    let downloads = 0;
    const fx = await fixture({ alpineImage: item.pin, fetchImage: async () => { downloads++; return item.response(); } });
    try {
      await assert.rejects(planned(fx, item.pin.id), error => error.status === item.status);
      assert.equal(fx.state.unmounts, 0);
      assert.equal(fx.state.spawned, 0);
      if (item.status === 400) assert.equal(downloads, 0);
      else assert.equal(downloads, 1);
    } finally { await fx.cleanup(); }
  }
});

test('completed checksum mismatch is reviewed, kept separate, blocked by default, and copied only after explicit acceptance', async t => {
  const expected = bytes('publisher catalog ISO bytes');
  const downloaded = bytes('completed alternate ISO bytes');
  const alpineImage = { id: 'fixture-standard-x86_64', arch: 'x86_64', format: 'iso', url: 'https://images.test/alpine.iso',
    sha256: digest(expected), size: expected.length, usb: true };
  const fx = await fixture({ alpineImage, fetchImage: async () => new Response(downloaded) });
  t.after(fx.cleanup);
  const plan = await planned(fx, alpineImage.id);
  assert.deepEqual(plan.image, { id: alpineImage.id, arch: alpineImage.arch, format: 'iso', name: 'alpine.iso',
    size: expected.length, sha256: digest(expected), url: alpineImage.url });
  assert.deepEqual(plan.verification, { status: 'mismatch', expected: { size: expected.length, sha256: digest(expected) },
    actual: { size: downloaded.length, sha256: digest(downloaded) } });
  assert.match(plan.warning, /differs from the publisher catalog/);
  const expectedCache = join(fx.cacheDir, `${alpineImage.sha256}-alpine.iso`);
  const candidateCache = join(fx.cacheDir, `candidate-${digest(downloaded)}-alpine.iso`);
  await assert.rejects(lstat(expectedCache), error => error.code === 'ENOENT');
  assert.deepEqual(await readFile(candidateCache), downloaded);

  await assert.rejects(fx.backend.execute({ planId: plan.id, confirm: plan.confirm }), error => error.status === 409 && error.code === 'USB_UNVERIFIED');
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);

  const accepted = await fx.backend.execute({ planId: plan.id, confirm: plan.confirm, allowUnverified: true });
  assert.equal(accepted.state, 'pending');
  assert.deepEqual(accepted.verification, { status: 'mismatch', expected: { size: expected.length, sha256: digest(expected) },
    actual: { size: downloaded.length, sha256: digest(downloaded) }, accepted: true });
  await assert.rejects(fx.backend.execute({ planId: plan.id, confirm: plan.confirm, allowUnverified: true }), error => error.status === 409);
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'succeeded', result.error);
  assert.deepEqual(result.verification, accepted.verification);
  assert.deepEqual(result.readback, { size: downloaded.length, sha256: digest(downloaded), matched: true });
  assert.equal((await readFile(join(fx.mountpoint, 'alpine.iso'))).toString(), downloaded.toString(),
    'Ventoy copy readback must match the actual bytes accepted for this plan');
  assert.match(result.log.join('\n'), /Copy finished\. Checking the USB file SHA-256 again\./);
  assert.match(result.log.join('\n'), /USB copy complete: readback SHA-256 .* publisher size\/SHA-256 mismatch was explicitly accepted/);
  assert.doesNotMatch(result.log.join('\n'), /Verified alpine\.iso SHA-256/);
});

test('changed mismatch candidate is rejected before erase even when checksum mismatch was accepted', async t => {
  const expected = bytes('publisher expected ISO');
  const downloaded = bytes('actual reviewed ISO');
  const alpineImage = { id: 'fixture-standard-x86_64', arch: 'x86_64', format: 'iso', url: 'https://images.test/alpine.iso',
    sha256: digest(expected), size: expected.length, usb: true };
  const fx = await fixture({ alpineImage, fetchImage: async () => new Response(downloaded) });
  t.after(fx.cleanup);
  const plan = await planned(fx, alpineImage.id);
  await writeFile(join(fx.cacheDir, `candidate-${digest(downloaded)}-alpine.iso`), bytes('modified after review'));
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm, allowUnverified: true });
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /changed size or SHA-256 after review/);
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);
});

test('reviewed candidate is rehashed immediately before unmount, after unmount, and before installer', async t => {
  const expected = bytes('publisher expected ISO bytes');
  const downloaded = bytes('reviewed candidate ISO bytes');
  const modified = bytes('changed candidate after review');
  const alpineImage = { id: 'fixture-standard-x86_64', arch: 'x86_64', format: 'iso', url: 'https://images.test/alpine.iso',
    sha256: digest(expected), size: expected.length, usb: true };
  for (const phase of ['preflight', 'unmount', 'installer-preflight']) {
    const mutate = async ({ cacheDir }) => writeFile(join(cacheDir, `candidate-${digest(downloaded)}-alpine.iso`), modified);
    const fx = await fixture({ alpineImage, fetchImage: async () => new Response(downloaded),
      ...(phase === 'preflight' ? { mutateOnSudoPreflight: mutate }
        : phase === 'unmount' ? { mutateOnUnmount: mutate }
          : { mutateOnInventoryCount: 8, mutateOnInventory: mutate }) });
    try {
      const plan = await planned(fx, alpineImage.id);
      await fx.backend.execute({ planId: plan.id, confirm: plan.confirm, allowUnverified: true });
      const result = await terminalJob(fx.backend);
      assert.equal(result.state, 'failed');
      assert.match(result.error, /changed size or SHA-256 after review/);
      assert.equal(fx.state.unmounts, phase === 'preflight' ? 0 : 1);
      assert.equal(fx.state.spawned, 0, `${phase}: installer must not start after the reviewed source changes`);
    } finally { await fx.cleanup(); }
  }
});

test('legacy helper-configured ISO checksum mismatch uses the same explicit override contract', async t => {
  const expectedSha256 = digest(bytes('configured publisher pin'));
  const fx = await fixture({ imageSha256: expectedSha256 });
  t.after(fx.cleanup);
  const plan = await planned(fx);
  assert.deepEqual(plan.image, { name: 'alpine.iso', size: fx.image.length, sha256: expectedSha256 });
  assert.deepEqual(plan.verification, { status: 'mismatch', expected: { size: fx.image.length, sha256: expectedSha256 },
    actual: { size: fx.image.length, sha256: digest(fx.image) } });
  await assert.rejects(fx.backend.execute({ planId: plan.id, confirm: plan.confirm }), error => error.status === 409 && error.code === 'USB_UNVERIFIED');
  const accepted = await fx.backend.execute({ planId: plan.id, confirm: plan.confirm, allowUnverified: true });
  assert.equal(accepted.verification.accepted, true);
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'succeeded', result.error);
  assert.equal(result.verification.status, 'mismatch');
  assert.equal(result.verification.accepted, true);
  assert.deepEqual(await readFile(join(fx.mountpoint, 'alpine.iso')), fx.image);
});

test('incomplete streams and downloads beyond the 4 GiB bound remain hard failures', async t => {
  const data = bytes('download stream');
  const alpineImage = { id: 'fixture-standard-x86_64', arch: 'x86_64', format: 'iso', url: 'https://images.test/alpine.iso',
    sha256: digest(data), size: data.length, usb: true };
  const cases = [
    { response: () => ({ ok: true, redirected: false, headers: { get: () => null }, body: { async *[Symbol.asyncIterator]() { yield data; throw Error('network ended unexpectedly'); } } }) },
    { response: () => ({ ok: true, redirected: false, headers: { get: name => name === 'content-length' ? String(4 * 1024 ** 3 + 1) : null }, body: { async *[Symbol.asyncIterator]() { throw Error('must not read oversized response'); } } }) },
  ];
  for (const { response } of cases) {
    const fx = await fixture({ alpineImage, fetchImage: async () => response() });
    try {
      await assert.rejects(planned(fx, alpineImage.id), error => error.status === 502);
      assert.equal(fx.state.unmounts, 0);
      assert.equal(fx.state.spawned, 0);
    } finally { await fx.cleanup(); }
  }
});

test('selected Alpine ISO is rehashed from its cached source before any unmount', async t => {
  const data = bytes('selected Alpine ISO');
  const alpineImage = { id: 'fixture-standard-x86_64', arch: 'x86_64', format: 'iso', url: 'https://images.test/alpine.iso',
    sha256: digest(data), size: data.length, usb: true };
  const fx = await fixture({ alpineImage, fetchImage: async () => new Response(data) });
  t.after(fx.cleanup);
  const plan = await planned(fx, alpineImage.id);
  const cached = join(fx.cacheDir, `${alpineImage.sha256}-alpine.iso`);
  await writeFile(cached, bytes('tampered Alpine ISO'));
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /changed size or SHA-256 after review/);
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);
});

test('system mounts, stacked descendants, and swap make the USB disk unavailable', async t => {
  for (const options of [{ systemMount: '/home' }, { stacked: true }, { swap: true }]) {
    const fx = await fixture(options);
    try {
      const drive = (await fx.backend.listDrives())[0];
      assert.equal(drive.available, false);
      await assert.rejects(planned(fx), error => error.status === 409);
    } finally { await fx.cleanup(); }
  }
});

test('untrusted installer permissions and symlinks fail before a plan is issued', async t => {
  for (const options of [{ untrustedInstaller: true }, { installerSymlink: true }]) {
    const fx = await fixture(options);
    try {
      await assert.rejects(planned(fx), error => error.status === 503 && /trust check/.test(error.message));
      assert.equal(fx.state.unmounts, 0);
      assert.equal(fx.state.spawned, 0);
    } finally { await fx.cleanup(); }
  }
});

test('wrong confirmation consumes the reviewed plan without unmounting', async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const plan = await planned(fx);
  await assert.rejects(fx.backend.execute({ planId: plan.id, confirm: 'ERASE /dev/sdb' }), error => error.status === 400);
  await assert.rejects(fx.backend.execute({ planId: plan.id, confirm: plan.confirm }), error => error.status === 409);
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);
});

test('device identity changes after review fail before sudo or unmount', async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const plan = await planned(fx);
  fx.state.majorMinor = '8:99';
  const accepted = await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const result = await terminalJob(fx.backend);
  assert.equal(accepted.state, 'pending');
  assert.equal(result.state, 'failed');
  assert.match(result.error, /identity or mount state changed/);
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);
});

test('busy USB partitions stop before installer and duplicate writes are rejected', async t => {
  const fx = await fixture({ busyUnmount: true });
  t.after(fx.cleanup);
  const first = await planned(fx);
  const accepted = await fx.backend.execute({ planId: first.id, confirm: first.confirm });
  const second = await planned(fx);
  await assert.rejects(fx.backend.execute({ planId: second.id, confirm: second.confirm }), error => error.status === 409);
  const result = await terminalJob(fx.backend);
  assert.equal(accepted.state, 'pending');
  assert.equal(result.state, 'failed');
  assert.match(result.error, /Could not unmount/);
  assert.equal(fx.state.spawned, 0);
});

test('ISO source is rehashed before any unmount or destructive installer call', async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const plan = await planned(fx);
  await writeFile(fx.imagePath, 'changed after review');
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /changed size or SHA-256 after review/);
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);
});

test('Ventoy receives both accepted prompts and ISO copy remains bound to the opened mount directory', async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const plan = await planned(fx);
  fx.state.raceOnStatfs = true;
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'succeeded', result.error);
  assert.equal(fx.state.promptInput, 'y\ny\n');
  assert.equal((await readFile(join(fx.detached, 'alpine.iso'))).toString(), fx.image.toString());
  await assert.rejects(readFile(join(fx.mountpoint, 'alpine.iso')), error => error.code === 'ENOENT');
  assert.match(result.log.join('\n'), /boot has not been tested/);
});

test('Ventoy list output rejects NA and unexpected disk versions', async t => {
  for (const listOutput of [
    '**********************************************\nVentoy: 1.1.18 x86_64\nVentoy Version in Disk  : NA\n',
    '**********************************************\nVentoy: 1.1.18 x86_64\nVentoy Version in Disk  : 1.1.17\n',
  ]) {
    const fx = await fixture();
    try {
      fx.state.listOutput = listOutput;
      const plan = await planned(fx);
      await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
      const result = await terminalJob(fx.backend);
      assert.equal(result.state, 'failed');
      assert.match(result.error, /Ventoy list verification failed/);
    } finally { await fx.cleanup(); }
  }
});

test('installer timeout blocks subsequent writes until the helper restarts', async t => {
  const fx = await fixture({ hangInstaller: true, installTimeout: 15 });
  t.after(fx.cleanup);
  const plan = await planned(fx);
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const result = await terminalJob(fx.backend, 1_000);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /timed out/);
  const next = await planned(fx);
  await assert.rejects(fx.backend.execute({ planId: next.id, confirm: next.confirm }), error => error.status === 409);
});

test('direct method plans an unsupported Ventoy architecture, writes the whole USB, and verifies the opened device readback', async t => {
  const data = bytes('Alpine ISO for an architecture Ventoy does not boot');
  const alpineImage = { id: 'fixture-standard-armv7', arch: 'armv7', format: 'iso', url: 'https://images.test/alpine-armv7.iso',
    sha256: digest(data), size: data.length, usb: false };
  const fx = await fixture({ noVentoy: true, existingVentoy: true, alpineImage, fetchImage: async () => new Response(data) });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx, alpineImage.id);
  assert.equal(plan.method, 'direct');
  assert.equal(plan.action, 'direct');
  assert.equal(plan.confirm, 'ERASE');
  assert.equal(plan.image.arch, 'armv7');
  assert.match(plan.warning, /entire USB disk/);
  assert.match(plan.warning, /boot compatibility is not guaranteed/i);
  assert.equal(plan.verification.status, 'verified');

  const accepted = await fx.backend.execute({ planId: plan.id, confirm: 'ERASE' });
  assert.ok(Number.isFinite(Date.parse(accepted.deadlineAt)));
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'succeeded', result.error);
  assert.equal(result.method, 'direct');
  assert.equal(result.phase, 'verifying');
  assert.deepEqual(result.progress, { phase: 'verifying', completedBytes: data.length, totalBytes: data.length });
  assert.deepEqual(result.readback, { size: data.length, sha256: digest(data), matched: true });
  assert.equal(fx.state.directWritten, true);
  assert.deepEqual(fx.state.directBytes, data);
  assert.equal(fx.state.unmounts, 1);
  assert.equal(fx.state.spawned, 1);
  assert.equal(fx.commands.some(([, args]) => args.includes('-l') || args.includes('/usr/bin/sh')), false,
    'direct writing never invokes or falls back to Ventoy');

  const pythonArgs = fx.state.directArgs.slice(2);
  assert.equal(pythonArgs[0], '-c');
  assert.doesNotMatch(pythonArgs[1], /sys\.argv\[1:\].*--/);
  assert.match(pythonArgs[1], /O_RDWR \| os\.O_EXCL/);
  assert.match(pythonArgs[1], /O_NOFOLLOW/);
  assert.match(pythonArgs[1], /os\.fstat\(device_fd\)/);
  assert.match(pythonArgs[1], /os\.fsync\(device_fd\)/);
  assert.match(pythonArgs[1], /0x1261/);
  assert.match(pythonArgs[1], /ROMINIT_USB_PROGRESS/);
  assert.match(pythonArgs[1], /ROMINIT_USB_PHASE syncing/);

  const fakeDevice = join(fx.root, 'not-a-block-device');
  await writeFile(fakeDevice, 'leave this unchanged');
  pythonArgs[3] = fakeDevice;
  const probe = spawnSync('/usr/bin/python3', pythonArgs, { encoding: 'utf8' });
  assert.equal(probe.status, 1, probe.stderr);
  assert.match(probe.stderr, /changed before opening; no write was started/);
  assert.equal((await readFile(fakeDevice)).toString(), 'leave this unchanged');
});

test('accepted USB job reports only scrubbed technical outcome data and keeps report pending until POST completes', async t => {
  const expected = bytes('publisher bytes');
  const actual = bytes('accepted downloaded bytes after checksum override');
  const alpineImage = { id: 'fixture-report-image', arch: 's390x', format: 'iso', url: 'https://images.test/private-filename.iso',
    sha256: digest(expected), size: expected.length, usb: false };
  let captured, finishReport, reportCalls = 0, idCalls = 0;
  const fx = await fixture({ noVentoy: true, alpineImage, fetchImage: async () => new Response(actual),
    makeJobId: () => { idCalls++; return 'r'.repeat(43); },
    reportOutcome: payload => { reportCalls++; captured = payload; return new Promise(resolve => { finishReport = resolve; }); } });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx, alpineImage.id);
  const accepted = await fx.backend.execute({ planId: plan.id, confirm: plan.confirm, allowUnverified: true });
  assert.equal(accepted.jobId, 'r'.repeat(43));
  assert.equal(accepted.reportStatus, undefined, 'outcome reporting starts only after the USB operation is terminal');
  assert.equal(idCalls, 1);
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline && !captured) await sleep(5);
  assert.deepEqual(captured, {
    jobId: 'r'.repeat(43), method: 'direct', action: 'direct', outcome: 'success',
    image: { id: 'fixture-report-image', size: actual.length }, drive: { capacityBytes: 4_000_000_000 },
    verification: { source: 'mismatch-accepted' }, readback: { size: actual.length, matched: true },
  });
  assert.doesNotMatch(JSON.stringify(captured), /sha256|hash|private-filename|\/dev\/|Fixture USB|serial|user/i);
  assert.equal(fx.backend.status().state, 'succeeded');
  assert.equal(fx.backend.status().reportStatus, 'pending');
  finishReport();
  const sentDeadline = Date.now() + 1_000;
  while (Date.now() < sentDeadline && fx.backend.status().reportStatus !== 'sent') await sleep(5);
  assert.equal(fx.backend.status().state, 'succeeded');
  assert.equal(fx.backend.status().reportStatus, 'sent');
  assert.equal(reportCalls, 1);
});

test('failed USB outcome reports a fixed failure code without including raw error details', async t => {
  let captured;
  const fx = await fixture({ noVentoy: true, busyUnmount: true,
    reportOutcome: async payload => { captured = payload; } });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx);
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline && (fx.backend.status().state !== 'failed' || fx.backend.status().reportStatus === 'pending')) await sleep(5);
  const result = fx.backend.status();
  assert.equal(result.state, 'failed');
  assert.equal(result.reportStatus, 'sent');
  assert.equal(captured.outcome, 'failed');
  assert.equal(captured.failureCode, 'unmount');
  assert.equal(captured.verification.source, 'verified');
  assert.deepEqual(captured.image, { id: 'local-configured', size: fx.image.length });
  assert.equal(captured.drive.capacityBytes, 4_000_000_000);
  assert.equal(Object.hasOwn(captured, 'error'), false);
  assert.doesNotMatch(JSON.stringify(captured), /\/dev\/|Fixture USB|sha256|hash/i);
});

test('a failed outcome POST remains visible without changing a successful USB result', async t => {
  const fx = await fixture({ noVentoy: true,
    reportOutcome: async () => { throw Error('private path /dev/sdz and raw stderr'); } });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx);
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline && (fx.backend.status().state !== 'succeeded' || fx.backend.status().reportStatus === 'pending')) await sleep(5);
  const result = fx.backend.status();
  assert.equal(result.state, 'succeeded');
  assert.equal(result.reportStatus, 'failed');
  assert.equal(result.error, undefined);
});

test('native USB diagnostics are allowlisted, cached per helper, and can include validated browser details', async t => {
  const hostEnvironment = { hostOs: 'linux', hostOsVersion: '43', hostDistro: 'fedora', hostArch: 'x64',
    kernelVersion: '6.12.3', cliVersion: 'a1b2c3d4e5f6', nodeVersion: '24.18.0' };
  const browser = { browser: 'chrome', browserVersion: '128.0.1', browserOs: 'linux', browserOsVersion: '43' };
  let captured;
  const fx = await fixture({ noVentoy: true, hostEnvironment,
    reportOutcome: async payload => { captured = payload; } });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx);
  const accepted = await fx.backend.execute({ planId: plan.id, confirm: plan.confirm, browser });
  assert.equal(Object.hasOwn(accepted, 'reportEnvironment'), false);
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'succeeded');
  assert.deepEqual(captured.environment, { ...hostEnvironment, ...browser });
  assert.doesNotMatch(JSON.stringify(captured.environment), /hostname|custom distro|private string/i);
});

test('invalid browser data is rejected before consuming the USB plan and invalid injected diagnostics are omitted', async t => {
  let captured;
  const hostileEnvironment = { hostOs: 'linux', hostOsVersion: 'private host version', hostDistro: 'custom-private-distro',
    hostArch: 'x64', kernelVersion: '6.12.0', cliVersion: 'a1b2c3d4e5f6', nodeVersion: '24.18.0', hostname: 'private-host' };
  const fx = await fixture({ noVentoy: true, hostEnvironment: hostileEnvironment,
    reportOutcome: async payload => { captured = payload; } });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx);
  await assert.rejects(fx.backend.execute({ planId: plan.id, confirm: plan.confirm, browser: {
    browser: 'Chrome 128', browserVersion: '128.0', browserOs: 'linux', browserOsVersion: '6.12', rawUserAgent: 'private' } }),
  error => error.status === 400);
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  assert.equal((await terminalJob(fx.backend)).state, 'succeeded');
  assert.equal(Object.hasOwn(captured, 'environment'), false);
  assert.doesNotMatch(JSON.stringify(captured), /private host version|custom-private-distro|private-host|rawUserAgent/i);
});

test('asynchronous environment collection cannot allow two writes to accept the same USB plan', async t => {
  let finishEnvironment;
  const pendingEnvironment = new Promise(resolve => { finishEnvironment = resolve; });
  const fx = await fixture({ noVentoy: true, hostEnvironment: pendingEnvironment });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx);
  const write1 = fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const write2 = fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  finishEnvironment({ hostOs: 'linux', hostOsVersion: '43', hostDistro: 'fedora', hostArch: 'x64',
    kernelVersion: '6.12.3', cliVersion: 'a1b2c3d4e5f6', nodeVersion: '24.18.0' });
  const results = await Promise.allSettled([write1, write2]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  assert.equal((await terminalJob(fx.backend)).state, 'succeeded');
});

test('host environment maps whitelisted distro and numeric prefixes without retaining raw OS release strings', async () => {
  const fedora = await collectUsbEnvironment({ platform: 'linux', arch: 'x64', kernelRelease: '6.15.7-200.fc43.x86_64',
    nodeVersion: '24.18.0', readOsRelease: async () => 'NAME="Fedora Workstation Private Label"\nID="Fedora"\nVERSION_ID="43 (Private Label)"\n',
    readSource: async () => Buffer.from('fixture source') });
  assert.deepEqual(fedora, { hostOs: 'linux', hostOsVersion: '43', hostDistro: 'fedora', hostArch: 'x64',
    kernelVersion: '6.15.7', cliVersion: digest(Buffer.from('fixture source\0'.repeat(5))).slice(0, 12), nodeVersion: '24.18.0' });

  const custom = await collectUsbEnvironment({ platform: 'linux', arch: 'mips', kernelRelease: 'release-custom-private',
    nodeVersion: 'v24.18.0', readOsRelease: async () => 'NAME="Private Custom Linux"\nID="internal-acme-build"\nVERSION_ID="private-release-9"\n',
    readSource: async () => Buffer.from('fixture source') });
  assert.equal(custom.hostOs, 'linux');
  assert.equal(custom.hostDistro, 'other');
  assert.equal(custom.hostArch, 'other');
  assert.equal(custom.nodeVersion, '24.18.0');
  assert.equal(Object.hasOwn(custom, 'hostOsVersion'), false);
  assert.equal(Object.hasOwn(custom, 'kernelVersion'), false);
  assert.doesNotMatch(JSON.stringify(custom), /internal-acme|Private Custom|release-custom-private/);
});

test('direct progress is stage ordered, range checked, monotonic, and returned as a snapshot', async t => {
  const data = bytes('progress fixture ISO');
  const malformed = [
    JSON.stringify({ phase: 'writing', completedBytes: data.length, totalBytes: data.length }),
    JSON.stringify({ phase: 'verifying', completedBytes: data.length - 1, totalBytes: data.length }),
    JSON.stringify({ phase: 'verifying', completedBytes: data.length + 1, totalBytes: data.length }),
    JSON.stringify({ phase: 'unknown', completedBytes: data.length, totalBytes: data.length }),
    JSON.stringify({ phase: 'verifying', completedBytes: data.length, totalBytes: data.length + 1 }),
    'not json',
  ];
  const fx = await fixture({ noVentoy: true, holdDirectAfterProgress: true, extraDirectProgressLines: malformed,
    alpineImage: { id: 'fixture-progress', arch: 'x86_64', format: 'iso', url: 'https://images.test/progress.iso',
      sha256: digest(data), size: data.length, usb: true }, fetchImage: async () => new Response(data) });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx, 'fixture-progress');
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline && fx.backend.status().progress?.phase !== 'verifying') await sleep(5);
  const snapshot = fx.backend.status();
  assert.equal(snapshot.phase, 'verifying');
  assert.deepEqual(snapshot.progress, { phase: 'verifying', completedBytes: data.length, totalBytes: data.length });
  snapshot.progress.completedBytes = 0;
  assert.equal(fx.backend.status().progress.completedBytes, data.length, 'progress must not leak a mutable object from status()');
  fx.state.finishDirect();
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'succeeded', result.error);
  assert.deepEqual(result.progress, { phase: 'verifying', completedBytes: data.length, totalBytes: data.length });
});

test('direct syncing clears determinate progress until readback begins', async t => {
  const fx = await fixture({ noVentoy: true, holdDirectAtSync: true });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx);
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline && fx.backend.status().phase !== 'syncing') await sleep(5);
  const status = fx.backend.status();
  assert.equal(status.phase, 'syncing');
  assert.equal('progress' in status, false);
  fx.state.finishDirect();
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'succeeded', result.error);
  assert.equal(result.phase, 'verifying');
});

test('direct plan refuses non-ISO catalog downloads and images larger than the target', async t => {
  const archive = { id: 'fixture-archive', arch: 'armv7', format: 'tar.gz', url: 'https://images.test/alpine.tar.gz',
    sha256: digest(bytes('archive')), size: 7, usb: false };
  const archiveFx = await fixture({ noVentoy: true, alpineImage: archive, fetchImage: async () => { throw Error('must not download archives'); } });
  try {
    await assert.rejects(directPlanned(archiveFx, archive.id), error => error.status === 400 && /ISO or img\.gz format/.test(error.message));
    assert.equal(archiveFx.state.unmounts, 0);
    assert.equal(archiveFx.state.spawned, 0);
  } finally { await archiveFx.cleanup(); }

  const oversizedFx = await fixture({ noVentoy: true, diskSize: 128 * 1024 * 1024, imageSize: 128 * 1024 * 1024 + 1 });
  try {
    await assert.rejects(directPlanned(oversizedFx), error => error.status === 409 && /does not fit/.test(error.message));
    assert.equal(oversizedFx.state.unmounts, 0);
    assert.equal(oversizedFx.state.spawned, 0);
  } finally { await oversizedFx.cleanup(); }
});

test('direct requires ERASE, does not unmount on wrong text, and revalidates swapped drive before privileged open', async t => {
  const fx = await fixture({ noVentoy: true, mutateOnDirectSpawn: ({ state }) => { state.majorMinor = '8:99'; } });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx);
  await assert.rejects(fx.backend.execute({ planId: plan.id, confirm: 'ERASE /dev/sdz' }), error => error.status === 400);
  assert.equal(fx.state.unmounts, 0);
  await assert.rejects(fx.backend.execute({ planId: plan.id, confirm: 'ERASE' }), error => error.status === 409);

  const replacementPlan = await directPlanned(fx);
  await fx.backend.execute({ planId: replacementPlan.id, confirm: replacementPlan.confirm });
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /identity changed before opening/);
  assert.equal(fx.state.unmounts, 1);
  assert.equal(fx.state.directWritten, false);
});

test('direct checksum mismatch needs explicit acceptance and verifies readback against actual downloaded bytes', async t => {
  const expected = bytes('publisher expected ISO');
  const actual = bytes('downloaded but publisher hash mismatched');
  const alpineImage = { id: 'fixture-standard-s390x', arch: 's390x', format: 'iso', url: 'https://images.test/alpine-s390x.iso',
    sha256: digest(expected), size: expected.length, usb: false };
  const fx = await fixture({ noVentoy: true, alpineImage, fetchImage: async () => new Response(actual) });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx, alpineImage.id);
  assert.equal(plan.verification.status, 'mismatch');
  await assert.rejects(fx.backend.execute({ planId: plan.id, confirm: plan.confirm }), error => error.code === 'USB_UNVERIFIED');
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm, allowUnverified: true });
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'succeeded', result.error);
  assert.equal(result.verification.status, 'mismatch');
  assert.equal(result.verification.accepted, true);
  assert.deepEqual(result.readback, { size: actual.length, sha256: digest(actual), matched: true });
  assert.match(result.log.join('\n'), /publisher checksum mismatch was explicitly accepted/);
});

test('direct readback mismatch fails the job even after writing', async t => {
  const fx = await fixture({ noVentoy: true, readbackMismatch: true });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx);
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /USB readback size or SHA-256/);
  assert.equal(result.readback.matched, false);
  assert.equal(fx.state.directWritten, true);
});

test('direct writer prerequisites fail before unmount when Python 3 is unavailable', async t => {
  const fx = await fixture({ noVentoy: true, pythonUnavailable: true });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx);
  await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /Python 3 at \/usr\/bin\/python3/);
  assert.equal(fx.state.unmounts, 0);
  assert.equal(fx.state.spawned, 0);
});

test('direct write timeout blocks another write while the USB result is unknown', async t => {
  const fx = await fixture({ noVentoy: true, hangDirect: true, directWriteTimeoutMs: 15 });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx);
  const accepted = await fx.backend.execute({ planId: plan.id, confirm: plan.confirm });
  assert.ok(Number.isFinite(Date.parse(accepted.deadlineAt)));
  const result = await terminalJob(fx.backend);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /timed out; the USB may be incomplete/);
  const next = await directPlanned(fx);
  await assert.rejects(fx.backend.execute({ planId: next.id, confirm: next.confirm }), error => error.status === 409 && /previous USB write timed out/.test(error.message));
});

test('direct plan accepts a pinned img.gz (Raspberry Pi) but Ventoy still refuses it', async t => {
  const data = bytes('compressed Pi image');
  const alpineImage = { id: 'fixture-rpi', arch: 'aarch64', format: 'img.gz', url: 'https://images.test/alpine-rpi.img.gz',
    sha256: digest(data), size: data.length, usb: false };
  const fx = await fixture({ alpineImage, fetchImage: async () => new Response(data) });
  t.after(fx.cleanup);
  const plan = await directPlanned(fx, alpineImage.id);
  assert.equal(plan.image.name, 'alpine-rpi.img.gz');
  await assert.rejects(fx.backend.plan({ driveId: '/dev/disk/by-id/usb-fixture-disk', method: 'ventoy', imageId: alpineImage.id }), error => error.status === 400);
});

test('an SD card in a built-in reader (removable mmcblk) is listed; a non-removable mmcblk (internal eMMC) is not', async () => {
  const disk = (name, rm) => ({ name, path: `/dev/${name}`, type: 'disk', rm, ro: 0, size: 32_000_000_000, model: 'SD', tran: null, 'maj:min': '179:0', children: [] });
  const backend = createUsbMedia({
    runCommand: async () => ({ stdout: JSON.stringify({ blockdevices: [disk('mmcblk0', 1), disk('mmcblk1', 0)] }) }),
    listDir: async () => ['mmc-SD_0x1234'], resolvePath: async path => path.endsWith('mmc-SD_0x1234') ? '/dev/mmcblk0' : path,
    readText: async () => '' });
  const drives = await backend.listDrives();
  assert.deepEqual(drives.map(d => [d.path, d.available]), [['/dev/mmcblk0', true]]);
});

test('CLI build ID hashes the real packaged source files through file URLs', async () => {
  const environment = await collectUsbEnvironment({ platform: 'linux', arch: 'x64', kernelRelease: '6.15.7',
    nodeVersion: '24.18.0', readOsRelease: async () => 'ID=fedora\nVERSION_ID=44\n' });
  assert.match(environment.cliVersion, /^[a-f0-9]{12}$/);
});
