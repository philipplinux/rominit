import { execFile as execFileProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isIP } from 'node:net';
import { basename, dirname, join, relative, sep } from 'node:path';

const COMMAND_MS = 1500;
const OUTPUT_BYTES = 256 * 1024;
const IFNAME = /^[A-Za-z0-9_.:-]{1,15}$/;

function runIp(execFile, args) {
  return new Promise(resolve => {
    try {
      execFile('ip', args, { encoding: 'utf8', timeout: COMMAND_MS, maxBuffer: OUTPUT_BYTES, shell: false, windowsHide: true },
        (error, stdout) => resolve(error ? [] : parseArray(stdout)));
    } catch { resolve([]); }
  });
}

function parseArray(output) {
  try {
    const value = JSON.parse(output);
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function ipHost(value) {
  if (typeof value !== 'string') return null;
  const host = value.split('/', 1)[0].split('%', 1)[0];
  const family = isIP(host);
  return family === 6 ? new URL(`http://[${host}]/`).hostname.slice(1, -1) : family === 4 ? host : null;
}

function linkLocal(host) {
  return isIP(host) === 6 && /^fe[89ab][0-9a-f]:/.test(host);
}

function usableTarget(host) {
  if (isIP(host) === 4) {
    const [first, ...rest] = host.split('.').map(Number);
    return first !== 0 && first !== 127 && first < 224 && !(first === 255 && rest.every(octet => octet === 255));
  }
  if (isIP(host) !== 6 || host === '::' || host === '::1' || host.startsWith('ff')) return false;
  const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/.exec(host);
  if (!mapped) return true;
  const [a, b] = mapped.slice(1).map(value => Number.parseInt(value, 16));
  return usableTarget(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
}

async function usbDevice(devicePath, sysfsRoot) {
  try {
    const root = await realpath(sysfsRoot);
    let current = await realpath(devicePath);
    const relativePath = relative(root, current);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`)) return false;
    for (let depth = 0; depth < 64 && current !== root; depth++, current = dirname(current)) {
      if (/^usb\d+$/.test(basename(current))) return true;
      try {
        const subsystem = await realpath(join(current, 'subsystem'));
        if (basename(subsystem) === 'usb' && basename(dirname(subsystem)) === 'bus') return true;
      } catch { /* no subsystem link at this ancestor */ }
    }
  } catch { /* no sysfs device entry */ }
  return false;
}

/** Read literal peers from USB-backed Linux interfaces; this never probes or changes the network. */
export function createBenchTargets({ platform = process.platform, execFile = execFileProcess, sysfsRoot = '/sys' } = {}) {
  return async () => {
    if (platform !== 'linux') return { targets: [], interfaces: [] };
    const commands = [
      runIp(execFile, ['-j', 'address', 'show']),
      runIp(execFile, ['-j', 'route', 'show']),
      runIp(execFile, ['-j', '-6', 'route', 'show']),
      runIp(execFile, ['-j', 'neigh', 'show']),
      runIp(execFile, ['-j', '-6', 'neigh', 'show']),
    ];
    const [addresses, ...network] = await Promise.all(commands);
    const usb = new Map(), ownAddresses = new Set();
    for (const link of addresses.slice(0, 256)) {
      const local = new Set();
      const addrInfo = Array.isArray(link?.addr_info) ? link.addr_info.slice(0, 64) : [];
      for (const item of addrInfo) {
        const host = ipHost(item?.local);
        if (host) { local.add(host); if (!linkLocal(host)) ownAddresses.add(host); }
      }
      if (typeof link?.ifname !== 'string' || !IFNAME.test(link.ifname) || usb.has(link.ifname)) continue;
      if (!await usbDevice(join(sysfsRoot, 'class', 'net', link.ifname, 'device'), sysfsRoot)) continue;
      const state = typeof link.operstate === 'string' && /^[A-Za-z_-]{1,20}$/.test(link.operstate) ? link.operstate : 'unknown';
      usb.set(link.ifname, { local, state, addresses: [...local], pmosSubnet: addrInfo.some(item => {
        const host = ipHost(item?.local);
        return item?.prefixlen === 24 && host?.startsWith('172.16.42.');
      }) });
    }
    const interfaces = [...usb].map(([name, value]) => ({ name, state: value.state, addresses: value.addresses }));
    if (!usb.size) return { targets: [], interfaces };

    const candidates = new Map();
    const add = (iface, value, evidence) => {
      const host = ipHost(value), networkInfo = usb.get(iface);
      if (!host || !usableTarget(host) || !networkInfo || (linkLocal(host) ? networkInfo.local.has(host) : ownAddresses.has(host))) return;
      const key = `${iface}\0${host}`;
      if (!candidates.has(key)) candidates.set(key, { host, interface: iface, evidence: new Set() });
      candidates.get(key).evidence.add(evidence);
    };
    const [routes4, routes6, neighbors4, neighbors6] = network;
    for (const route of [...routes4, ...routes6]) {
      if (route?.dst === '172.16.42.0/24' && usb.has(route.dev)) usb.get(route.dev).pmosSubnet = true;
      const isDefault = route?.dst === 'default' || route?.dst === '0.0.0.0/0' || route?.dst === '::/0';
      if (isDefault && route?.gateway) add(route.dev, route.gateway, 'default gateway');
    }
    for (const link of addresses.slice(0, 256)) {
      if (!usb.has(link?.ifname)) continue;
      for (const item of Array.isArray(link.addr_info) ? link.addr_info.slice(0, 64) : [])
        if (item?.peer) add(link.ifname, item.peer, 'point-to-point peer');
      const info = usb.get(link.ifname);
      if (info.pmosSubnet && !ownAddresses.has('172.16.42.1')) add(link.ifname, '172.16.42.1', 'postmarketOS conventional address (not verified)');
    }
    for (const neighbor of [...neighbors4, ...neighbors6]) {
      const states = Array.isArray(neighbor?.state) ? neighbor.state : [neighbor?.state];
      if (states.some(state => typeof state === 'string' && ['FAILED', 'INCOMPLETE'].includes(state.toUpperCase()))) continue;
      add(neighbor.dev, neighbor.dst, 'neighbor');
    }
    return {
      targets: [...candidates.values()].slice(0, 100).map(({ host, interface: iface, evidence }) => ({
        host, interface: iface, label: `${iface} · ${[...evidence].join(' · ')}`,
      })),
      interfaces,
    };
  };
}

export const listBenchTargets = createBenchTargets();
