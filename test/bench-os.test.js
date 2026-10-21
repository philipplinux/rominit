import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const androidPath = fileURLToPath(new URL('../site/bench/android.sh', import.meta.url));
const linuxPath = fileURLToPath(new URL('../site/bench/linux.sh', import.meta.url));
const android = await readFile(androidPath, 'utf8');
const linux = await readFile(linuxPath, 'utf8');
const androidMismatch = '@ failed os-mismatch: This test is for Android, but this phone is running Linux. Select the installed postmarketOS ROM and start a new test.';
const linuxMismatch = '@ failed os-mismatch: This test is for Linux, but this phone is running Android. Select the installed Android ROM and start a new test.';

function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `missing fixture section ${start}`);
  return source.slice(first, last);
}

function shellFunction(source, name) {
  const start = source.indexOf(`${name}() {`), end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `missing shell function ${name}`);
  return source.slice(start, end + 2);
}

function withFixturePaths(source, root) {
  return source.replaceAll('/sys/class/net', `${root}/sys/class/net`)
    .replaceAll('/dev/dri/', `${root}/dev/dri/`)
    .replaceAll('/dev/mali', `${root}/dev/mali`)
    .replaceAll('/dev/kgsl-3d', `${root}/dev/kgsl-3d`)
    .replaceAll('/sys/bus/iio/devices', `${root}/sys/bus/iio/devices`)
    .replaceAll('/proc/bus/input/devices', `${root}/proc/bus/input/devices`);
}

test('bench scripts reject the wrong OS before probes and accept their own OS guard', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rominit-bench-os-'));
  const emptyBin = join(root, 'empty');
  const mockBin = join(root, 'mock');
  await Promise.all([mkdir(emptyBin), mkdir(mockBin)]);
  const getprop = join(mockBin, 'getprop');
  await writeFile(getprop, '#!/bin/sh\n[ "$1" = ro.build.version.sdk ] && printf \'%s\\n\' "$ROMINIT_TEST_SDK"\n');
  await chmod(getprop, 0o755);
  t.after(() => rm(root, { recursive: true, force: true }));

  const runFile = (path, PATH, sdk) => spawnSync('/bin/sh', [path], {
    encoding: 'utf8', env: { PATH, ROMINIT_TEST_SDK: sdk ?? '', ROMINIT_SOUND: '' },
  });
  const runGuard = (source, marker, PATH, sdk) => {
    const markerAt = source.indexOf(marker);
    assert.notEqual(markerAt, -1, `missing script marker ${marker}`);
    const prologue = `${source.slice(0, markerAt)}printf 'guard-passed\\n'\nexit 0\n`;
    return spawnSync('/bin/sh', ['-c', prologue], {
      encoding: 'utf8', env: { PATH, ROMINIT_TEST_SDK: sdk ?? '', ROMINIT_SOUND: '' },
    });
  };

  for (const [result, expected] of [
    [runFile(androidPath, emptyBin), androidMismatch],
    [runFile(androidPath, mockBin, ''), androidMismatch],
    [runFile(linuxPath, mockBin, '34'), linuxMismatch],
  ]) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout.trim(), expected);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /^(?:@ script |(?:flashing|storage|battery) )/m);
  }

  const androidAccepted = runGuard(android, 'say "@ script android $VERSION"', mockBin, '34');
  assert.equal(androidAccepted.status, 0, androidAccepted.stderr);
  assert.equal(androidAccepted.stdout.trim(), 'guard-passed');
  const linuxAccepted = runGuard(linux, 'say "@ script linux $VERSION"', mockBin, '');
  assert.equal(linuxAccepted.status, 0, linuxAccepted.stderr);
  assert.equal(linuxAccepted.stdout.trim(), 'guard-passed');
});

test('Linux benchmark recognizes a down NCM interface and named IIO sensors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rominit-linux-probes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const net = join(root, 'sys/class/net/ncm0');
  const accel = join(root, 'sys/bus/iio/devices/iio:device0');
  const compass = join(root, 'sys/bus/iio/devices/iio:device1');
  await Promise.all([
    mkdir(net, { recursive: true }),
    mkdir(accel, { recursive: true }),
    mkdir(compass, { recursive: true }),
    mkdir(join(root, 'proc/bus/input'), { recursive: true }),
    mkdir(join(root, 'dev/dri'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(net, 'operstate'), 'down\n'),
    writeFile(join(accel, 'name'), 'accelerometer_sensor\n'),
    writeFile(join(accel, 'timestamp'), ''),
    writeFile(join(compass, 'name'), 'geomagnetic_sensor\n'),
    writeFile(join(compass, 'timestamp'), ''),
    writeFile(join(root, 'proc/bus/input/devices'), ''),
  ]);
  const helpers = section(linux, 'inputs() {', '\np_flashing() {');
  const probes = section(linux, 'p_usb_net() {', '\np_storage() {');
  const sensors = section(linux, 'p_accelerometer() {', '\np_light() {');
  const source = withFixturePaths(`${helpers}\np_flashing() { :; }\n${probes}\n${sensors}\np_usb_net\np_accelerometer\np_magnetometer\n`, root);
  const result = spawnSync('/bin/sh', ['-c', source], { encoding: 'utf8', env: { ...process.env, ROMINIT_SOUND: '' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), [
    'partial ncm0 present but down',
    'partial accelerometer_sensor registered; readable channels unavailable',
    'partial geomagnetic_sensor registered; readable channels unavailable',
  ]);
});

test('Linux GPU result requires a verified hardware renderer; software and device-only evidence stay partial', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rominit-gpu-probe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mockBin = join(root, 'bin');
  const dev = join(root, 'dev');
  await Promise.all([mkdir(mockBin), mkdir(join(dev, 'dri'), { recursive: true })]);
  await writeFile(join(mockBin, 'timeout'), '#!/bin/sh\n[ "$1" = 5 ] || exit 2\nshift\nexec "$@"\n');
  await writeFile(join(mockBin, 'glxinfo'), '#!/bin/sh\nprintf \'OpenGL renderer string: %s\\n\' "$ROMINIT_TEST_RENDERER"\n');
  await writeFile(join(mockBin, 'eglinfo'), '#!/bin/sh\nexit 1\n');
  await writeFile(join(mockBin, 'vulkaninfo'), '#!/bin/sh\n[ -n "$ROMINIT_TEST_VULKAN_DEVICE" ] || exit 1\nprintf \'GPU0:\\n    deviceName = %s\\n\' "$ROMINIT_TEST_VULKAN_DEVICE"\n');
  for (const tool of ['timeout', 'glxinfo', 'eglinfo', 'vulkaninfo']) await chmod(join(mockBin, tool), 0o755);
  const gpu = withFixturePaths(section(linux, 'gpu_probe() {', '\np_audio() {'), root);
  const run = (renderer, vulkanDevice = '') => spawnSync('/bin/sh', ['-c', `has() { command -v "$1" >/dev/null 2>&1; }\n${gpu}\np_gpu\n`], {
    encoding: 'utf8', env: { PATH: `${mockBin}:/usr/bin:/bin`, ROMINIT_TEST_RENDERER: renderer, ROMINIT_TEST_VULKAN_DEVICE: vulkanDevice, ROMINIT_SOUND: '' },
  });

  const hardware = run('Qualcomm Adreno 630');
  assert.equal(hardware.status, 0, hardware.stderr);
  assert.equal(hardware.stdout.trim(), 'full hardware renderer via glxinfo: Qualcomm Adreno 630');

  await writeFile(join(dev, 'mali0'), '');
  const software = run('llvmpipe (LLVM 18.1)');
  assert.equal(software.status, 0, software.stderr);
  assert.equal(software.stdout.trim(), 'partial GPU device detected; acceleration not verified');

  const vulkanOnly = run('llvmpipe (LLVM 18.1)', 'Qualcomm Adreno 630');
  assert.equal(vulkanOnly.status, 0, vulkanOnly.stderr);
  assert.equal(vulkanOnly.stdout.trim(), 'partial GPU device detected (vulkaninfo: Qualcomm Adreno 630); acceleration not verified');
});

test('Android and Linux storage rows require numeric df capacity and report failures as inconclusive', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rominit-storage-probe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mockBin = join(root, 'bin');
  await mkdir(mockBin);
  const df = join(mockBin, 'df');
  await writeFile(df, '#!/bin/sh\ncase "$ROMINIT_DF_CASE" in\n  header) printf \'Filesystem 1K-blocks Used Available Use%% Mounted on\\n\' ;;\n  valid) printf \'Filesystem 1K-blocks Used Available Use%% Mounted on\\n/dev/test 10000 6000 4000 60%% /\\n\' ;;\n  error) exit 1 ;;\nesac\n');
  await chmod(df, 0o755);

  for (const [script, filename] of [[android, 'android'], [linux, 'linux']]) {
    const source = `say() { echo "$*"; }\n${shellFunction(script, 't')}\n${shellFunction(script, 'p_storage')}\nt storage p_storage\n`;
    const run = mode => spawnSync('/bin/sh', ['-c', source], {
      encoding: 'utf8', env: { PATH: `${mockBin}:/usr/bin:/bin`, ROMINIT_DF_CASE: mode, ROMINIT_SOUND: '' },
    });
    for (const mode of ['header', 'error']) {
      const result = run(mode);
      assert.equal(result.status, 0, `${filename} ${mode}: ${result.stderr}`);
      assert.equal(result.stdout.trim(), 'storage inconclusive storage capacity unavailable');
    }
    const result = run('valid');
    assert.equal(result.status, 0, `${filename}: ${result.stderr}`);
    assert.equal(result.stdout.trim(), 'storage full 10000 KiB total, 4000 KiB free');
  }
});
