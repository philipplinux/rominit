import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { lstat, mkdtemp, mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createUsbMedia } from '../bin/usb-media.mjs';

const bytes = value => Buffer.from(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rominit-usb-media-'));
  const ventoyDir = join(root, 'ventoy-1.1.18');
  const mediaRoot = join(root, 'media');
  const mountpoint = join(mediaRoot, 'USB');
  const detached = join(mediaRoot, 'USB-detached');
  const imagePath = join(root, 'alpine.iso');
  const image = bytes('fixture Alpine ISO bytes');
  await mkdir(ventoyDir, { recursive: true });
  await mkdir(mountpoint, { recursive: true });
  await writeFile(join(ventoyDir, 'Ventoy2Disk.sh'), '#!/bin/sh\n');
  if (options.installerSymlink) await symlink(imagePath, join(ventoyDir, 'unexpected-link'));
  await writeFile(imagePath, image);

  const state = {
    size: 4_000_000_000,
    majorMinor: '8:48',
    layout: false,
    initialMount: options.initialMount === false ? null : mountpoint,
    dataMount: null,
    busyUnmount: Boolean(options.busyUnmount),
    installerExit: 0,
    listOutput: `**********************************************\n      Ventoy: 1.1.18  x86_64\n...banner...\nVentoy Version in Disk  : 1.1.18\nDisk Partition Style  : MBR\nSecure Boot Support   : YES\n`,
    promptInput: null,
    spawned: 0,
    unmounts: 0,
    raceOnStatfs: false,
    mountRaceCopyLocation: null,
  };

  function diskTree() {
    const disk = { name: 'sdz', path: '/dev/sdz', type: 'disk', rm: 1, ro: 0, size: state.size,
      model: 'Fixture USB', tran: 'usb', 'maj:min': state.majorMinor, children: [] };
    if (state.layout) {
      disk.children.push(
        { name: 'sdz1', path: '/dev/sdz1', type: 'part', rm: 0, ro: 0, size: state.size - 20_000_000,
          'maj:min': '8:49', fstype: 'exfat', label: 'Ventoy', mountpoints: state.dataMount ? [state.dataMount] : [] },
        { name: 'sdz2', path: '/dev/sdz2', type: 'part', rm: 0, ro: 0, size: 32_000_000,
          'maj:min': '8:50', fstype: 'vfat', label: 'VTOYEFI', mountpoints: [] },
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
  async function runCommand(file, args) {
    commands.push([file, [...args]]);
    if (file === '/usr/bin/lsblk') return { stdout: JSON.stringify({ blockdevices: diskTree() }), stderr: '' };
    if (file === '/usr/bin/sudo' && args[1] === '/usr/bin/true') return { stdout: '', stderr: '' };
    if (file === '/usr/bin/udisksctl' && args[0] === 'unmount') {
      state.unmounts++;
      if (state.busyUnmount) throw Object.assign(Error('device is busy'), { stderr: 'device is busy' });
      state.initialMount = null;
      state.dataMount = null;
      return { stdout: '', stderr: '' };
    }
    if (file === '/usr/bin/udisksctl' && args[0] === 'mount') {
      state.dataMount = mountpoint;
      return { stdout: '', stderr: '' };
    }
    if (file === '/usr/bin/sudo' && args.includes('-l')) return { stdout: state.listOutput, stderr: '' };
    throw Error(`unexpected command ${file} ${args.join(' ')}`);
  }
  function spawnProcess() {
    state.spawned++;
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
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
    ventoyDir, ventoyVersion: '1.1.18', imagePath, imageSha256: digest(image), byIdDir: idDir,
    runCommand, spawnProcess, resolvePath, fileStat, fileStatFs, mediaMountRoots: [mediaRoot],
    trustStat,
    readText: async path => path === '/proc/swaps' ? 'Filename Type Size Used Priority\n' : readFile(path, 'utf8'),
    listDir: async path => path === idDir ? [idPath.split('/').at(-1)] : [],
    makeId: () => `fixture-plan-${++nextId}`,
    ...(options.installTimeout ? { installTimeout: options.installTimeout } : {}),
  });
  return { root, ventoyDir, mediaRoot, mountpoint, detached, imagePath, image, state, commands, backend,
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

async function planned(fx) {
  return fx.backend.plan({ driveId: '/dev/disk/by-id/usb-fixture-disk', method: 'ventoy' });
}

test('Ventoy plan reports stable drive, mount review, pinned image, and exact erase phrase', async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const drives = await fx.backend.listDrives();
  assert.deepEqual(drives, [{ id: '/dev/disk/by-id/usb-fixture-disk', path: '/dev/sdz', model: 'Fixture USB',
    size: 4_000_000_000, mounted: true, mounts: [fx.mountpoint], available: true, reason: null }]);
  const plan = await planned(fx);
  assert.equal(plan.confirm, 'ERASE /dev/sdz');
  assert.deepEqual(plan.drive.mounts, [fx.mountpoint]);
  assert.deepEqual(plan.image, { name: 'alpine.iso', size: fx.image.length, sha256: digest(fx.image) });
  assert.match(plan.warning, /erases all data/);
  assert.equal(Object.hasOwn(plan, 'imageSource'), false);
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
  assert.match(result.error, /SHA-256 does not match/);
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
