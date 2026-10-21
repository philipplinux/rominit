import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBenchTargets } from '../bin/bench-targets.mjs';

const argsKey = args => args.join(' ');

async function sysfs(t, interfaces) {
  const root = await mkdtemp(join(tmpdir(), 'rominit-bench-targets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'bus', 'usb'), { recursive: true });
  for (const [name, { path, subsystem = false }] of Object.entries(interfaces)) {
    const device = join(root, 'devices', ...path.split('/'));
    const net = join(root, 'class', 'net', name);
    await mkdir(device, { recursive: true });
    await mkdir(net, { recursive: true });
    await symlink(device, join(net, 'device'), 'dir');
    if (subsystem) await symlink(join(root, 'bus', 'usb'), join(device, 'subsystem'), 'dir');
  }
  return root;
}

function fakeIp(fixtures, calls = []) {
  return (file, args, options, callback) => {
    calls.push({ file, args, options });
    const output = fixtures[argsKey(args)];
    queueMicrotask(() => output === undefined ? callback(Error('unavailable'), '') : callback(null, JSON.stringify(output), ''));
  };
}

const emptyNetwork = {
  '-j route show': [], '-j -6 route show': [], '-j neigh show': [], '-j -6 neigh show': [],
};

test('discovers only USB peers and the labeled postmarketOS conventional candidate', async t => {
  const root = await sysfs(t, {
    usb0: { path: 'platform/soc/usb1/1-1/1-1:1.0' },
    usb1: { path: 'platform/usb-ethernet', subsystem: true },
    eth0: { path: 'platform/usbnet' },
  });
  const calls = [];
  const outputs = {
    '-j address show': [
      { ifname: 'usb0', operstate: 'UP', addr_info: [{ local: '172.16.42.2', prefixlen: 24 }] },
      { ifname: 'usb1', operstate: 'DOWN', addr_info: [{ local: '10.99.0.2', prefixlen: 24, peer: '10.99.0.3/32' }] },
      { ifname: 'eth0', addr_info: [{ local: '192.0.2.2', prefixlen: 24 }] },
    ],
    ...emptyNetwork,
    '-j route show': [
      { dst: 'default', dev: 'usb0', gateway: '172.16.42.3' },
      { dst: 'default', dev: 'eth0', gateway: '192.0.2.1' },
      { dst: '10.99.0.0/24', dev: 'usb1', gateway: '10.99.0.1' },
    ],
    '-j neigh show': [
      { dst: '172.16.42.99', dev: 'usb0', state: ['REACHABLE'] },
      { dst: '172.16.42.2', dev: 'usb0', state: ['REACHABLE'] },
      { dst: '192.0.2.99', dev: 'eth0', state: ['REACHABLE'] },
      { dst: '10.99.0.88', dev: 'usb1', state: ['FAILED'] },
    ],
  };
  const discover = createBenchTargets({ platform: 'linux', execFile: fakeIp(outputs, calls), sysfsRoot: root });
  const { targets, interfaces } = await discover();
  assert.deepEqual(targets, [
    { host: '172.16.42.3', interface: 'usb0', label: 'usb0 · default gateway' },
    { host: '172.16.42.1', interface: 'usb0', label: 'usb0 · postmarketOS conventional address (not verified)' },
    { host: '10.99.0.3', interface: 'usb1', label: 'usb1 · point-to-point peer' },
    { host: '172.16.42.99', interface: 'usb0', label: 'usb0 · neighbor' },
  ]);
  assert.deepEqual(interfaces, [
    { name: 'usb0', state: 'UP', addresses: ['172.16.42.2'] },
    { name: 'usb1', state: 'DOWN', addresses: ['10.99.0.2'] },
  ]);
  assert.deepEqual(calls.map(call => [call.file, argsKey(call.args)]), [
    ['ip', '-j address show'], ['ip', '-j route show'], ['ip', '-j -6 route show'],
    ['ip', '-j neigh show'], ['ip', '-j -6 neigh show'],
  ]);
  assert(calls.every(({ options }) => options.timeout === 1500 && options.maxBuffer === 256 * 1024 && options.shell === false));
});

test('does not guess the conventional host when that address belongs to the computer', async t => {
  const root = await sysfs(t, {
    usb0: { path: 'platform/soc/usb1/1-1/1-1:1.0' },
    eth0: { path: 'platform/ethernet' },
  });
  const outputs = {
    ...emptyNetwork,
    '-j address show': [
      { ifname: 'usb0', addr_info: [{ local: '172.16.42.2', prefixlen: 24 }] },
      { ifname: 'eth0', addr_info: [{ local: '172.16.42.1', prefixlen: 24 }] },
    ],
  };
  const result = await createBenchTargets({ platform: 'linux', execFile: fakeIp(outputs), sysfsRoot: root })();
  assert.deepEqual(result, { targets: [], interfaces: [{ name: 'usb0', state: 'unknown', addresses: ['172.16.42.2'] }] });
});

test('keeps IPv6 link-local scope per interface and filters non-unicast targets', async t => {
  const root = await sysfs(t, {
    usb0: { path: 'platform/soc/usb1/1-1/1-1:1.0' },
    usb1: { path: 'platform/soc/usb2/2-1/2-1:1.0' },
  });
  const outputs = {
    ...emptyNetwork,
    '-j address show': [
      { ifname: 'usb0', addr_info: [{ local: 'fe80::1', prefixlen: 64 }, { local: '10.0.0.2', prefixlen: 24 }] },
      { ifname: 'usb1', addr_info: [{ local: 'fe80::2', prefixlen: 64 }] },
    ],
    '-j neigh show': [
      { dst: 'fe80::1', dev: 'usb0', state: ['REACHABLE'] },
      { dst: 'fe80::2', dev: 'usb0', state: ['REACHABLE'] },
      { dst: 'fe80::3', dev: 'usb0', state: ['REACHABLE'] },
      { dst: '::1', dev: 'usb0', state: ['REACHABLE'] },
      { dst: '::', dev: 'usb0', state: ['REACHABLE'] },
      { dst: 'ff02::1', dev: 'usb0', state: ['REACHABLE'] },
      { dst: '0.0.0.0', dev: 'usb0', state: ['REACHABLE'] },
      { dst: '127.0.0.1', dev: 'usb0', state: ['REACHABLE'] },
      { dst: '224.0.0.1', dev: 'usb0', state: ['REACHABLE'] },
    ],
  };
  const result = await createBenchTargets({ platform: 'linux', execFile: fakeIp(outputs), sysfsRoot: root })();
  assert.deepEqual(result.targets, [
    { host: 'fe80::2', interface: 'usb0', label: 'usb0 · neighbor' },
    { host: 'fe80::3', interface: 'usb0', label: 'usb0 · neighbor' },
  ]);
});

test('caps candidates at 100 and does not probe on non-Linux platforms', async t => {
  const root = await sysfs(t, { usb0: { path: 'platform/soc/usb2/2-1/2-1:1.0' } });
  const calls = [];
  const neighbors = Array.from({ length: 110 }, (_, i) => ({ dst: `198.51.100.${i + 1}`, dev: 'usb0', state: ['STALE'] }));
  const outputs = { ...emptyNetwork, '-j address show': [{ ifname: 'usb0', addr_info: [{ local: '10.0.0.2', prefixlen: 24 }] }], '-j neigh show': neighbors };
  const { targets } = await createBenchTargets({ platform: 'linux', execFile: fakeIp(outputs, calls), sysfsRoot: root })();
  assert.equal(targets.length, 100);
  assert.deepEqual(targets[0], { host: '198.51.100.1', interface: 'usb0', label: 'usb0 · neighbor' });

  const unsupported = await createBenchTargets({ platform: 'darwin', execFile: () => assert.fail('must not inspect host networking') })();
  assert.deepEqual(unsupported, { targets: [], interfaces: [] });
});

test('reports a USB network adapter without addresses without inventing a target', async t => {
  const root = await sysfs(t, { enp2s0f0u4: { path: 'platform/soc/usb1/1-4/1-4:1.0' } });
  const outputs = {
    ...emptyNetwork,
    '-j address show': [{ ifname: 'enp2s0f0u4', operstate: 'DOWN', addr_info: [] }],
  };
  assert.deepEqual(await createBenchTargets({ platform: 'linux', execFile: fakeIp(outputs), sysfsRoot: root })(), {
    targets: [], interfaces: [{ name: 'enp2s0f0u4', state: 'DOWN', addresses: [] }],
  });
});

test('returns an empty target list when iproute2 is unavailable or emits invalid JSON', async () => {
  const failed = await createBenchTargets({ platform: 'linux', execFile: (_file, _args, _options, callback) => callback(Error('missing'), '') })();
  assert.deepEqual(failed, { targets: [], interfaces: [] });
  const invalid = await createBenchTargets({ platform: 'linux', execFile: (_file, _args, _options, callback) => callback(null, 'not-json', '') })();
  assert.deepEqual(invalid, { targets: [], interfaces: [] });
});
