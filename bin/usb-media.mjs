import { createHash, randomBytes } from 'node:crypto';
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { createReadStream, readdirSync } from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, stat, statfs, unlink } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve as resolveFilePath } from 'node:path';
import { arch as osArch, homedir, platform as osPlatform, release as osRelease } from 'node:os';
import { promisify } from 'node:util';
import { run as runVentoy } from '../src/recipes/ventoy.js';
import { run as runUsbImage } from '../src/recipes/usb-image.js';
import { USB_FORMATS, osImageEntry } from '../src/os/index.js';
import { validateUsbBrowser, validateUsbEnvironment } from '../src/usb-environment.js';

const execFile = promisify(nodeExecFile);
const PLAN_MS = 5 * 60_000;
const MIN_BYTES = 128 * 1024 * 1024;
// shortcut: reserve 64 MiB for Ventoy metadata, adequate for this installer; actual free space is checked before copy.
const VENTOY_OVERHEAD = 64 * 1024 * 1024;
const LSBLK_TIMEOUT = 10_000;
const COMMAND_TIMEOUT = 30_000;
const INSTALL_TIMEOUT = 15 * 60_000;
const DIRECT_MIN_TIMEOUT = 15 * 60_000; // room for the writer's stepped-up retries
const DIRECT_MAX_TIMEOUT = 2.5 * 60 * 60_000;
const DIRECT_BYTES_PER_MS = 1024;
const LOG_LINES = 100;
const LOG_BYTES = 16 * 1024;
const LOG_LINE_BYTES = 512;
const MAX_PLANS = 64;
const MAX_IMAGE_BYTES = 16 * 1024 ** 3; // full desktop ISOs (Omarchy is 6 GB+); Ventoy is exFAT and direct writes are raw, so no FAT32 4 GiB cap
const IMAGE_DOWNLOAD_TIMEOUT = 15 * 60_000; // floor; big images get 1 ms per KiB (about 1 MB/s)
const IMAGE_CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'rominit', 'images');
const BIN = { lsblk: '/usr/bin/lsblk', sudo: '/usr/bin/sudo', sh: '/usr/bin/sh', python: '/usr/bin/python3', udisksctl: '/usr/bin/udisksctl' };
const LSBLK_FIELDS = 'NAME,PATH,TYPE,RM,RO,SIZE,MODEL,TRAN,MAJ:MIN,FSTYPE,LABEL,MOUNTPOINTS,PKNAME';
const USB_VERSION_SOURCES = [new URL('./cli.mjs', import.meta.url), new URL('./helper.mjs', import.meta.url), new URL(import.meta.url),
  new URL('../src/recipes/usb-image.js', import.meta.url), new URL('../src/usb-environment.js', import.meta.url)];
let cachedUsbEnvironment;

function numericVersionPrefix(value) {
  if (typeof value !== 'string') return undefined;
  const match = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}(?=$|[^\d.])/.exec(value.trim());
  return match && match[0].length <= 32 ? match[0] : undefined;
}

function releaseField(contents, key) {
  if (typeof contents !== 'string') return '';
  const line = contents.split(/\r?\n/).find(value => value.startsWith(`${key}=`));
  if (!line) return '';
  const raw = line.slice(key.length + 1).trim();
  return raw.length >= 2 && ['"', "'"].includes(raw[0]) && raw.at(-1) === raw[0] ? raw.slice(1, -1) : raw;
}

function hostOsName(platform) {
  return ({ linux: 'linux', android: 'android', win32: 'windows', darwin: 'macos', ios: 'ios', chromeos: 'chromeos' })[platform] ?? 'unknown';
}

function hostArchitecture(value) {
  return ({ x64: 'x64', arm64: 'arm64', arm: 'arm', ia32: 'ia32', riscv64: 'riscv64', ppc64: 'ppc64', ppc64le: 'ppc64', s390x: 's390x' })[value] ?? 'other';
}

function hostDistroName(value) {
  return ({ fedora: 'fedora', ubuntu: 'ubuntu', debian: 'debian', alpine: 'alpine', arch: 'arch', manjaro: 'manjaro',
    opensuse: 'opensuse', 'opensuse-leap': 'opensuse', 'opensuse-tumbleweed': 'opensuse', nixos: 'nixos',
    linuxmint: 'linuxmint', centos: 'centos', rhel: 'rhel', rocky: 'rocky' })[value.toLowerCase()] ?? 'other';
}

/** Collect only bounded, allowlisted diagnostics. Raw os-release and kernel strings are never returned. */
export async function collectUsbEnvironment({ platform = osPlatform(), arch = osArch(), kernelRelease = osRelease(),
  nodeVersion = process.versions.node, readOsRelease = () => readFile('/etc/os-release', 'utf8'),
  readSource = path => readFile(path) } = {}) {
  let hostOs = hostOsName(platform);
  let release = '';
  if (platform === 'linux' || platform === 'android' || platform === 'chromeos') {
    try { release = await readOsRelease(); } catch { /* Host OS and kernel details remain useful without distro metadata. */ }
  }
  const id = releaseField(release, 'ID').toLowerCase();
  if (id === 'android') hostOs = 'android';
  else if (id === 'chromeos' || id === 'chromiumos') hostOs = 'chromeos';

  const value = {
    hostOs,
    hostArch: hostArchitecture(arch),
    ...(numericVersionPrefix(kernelRelease) ? { kernelVersion: numericVersionPrefix(kernelRelease) } : {}),
    ...(numericVersionPrefix(nodeVersion.replace(/^v/, '')) ? { nodeVersion: numericVersionPrefix(nodeVersion.replace(/^v/, '')) } : {}),
  };
  if (['linux', 'android', 'chromeos'].includes(hostOs)) {
    const version = numericVersionPrefix(releaseField(release, 'VERSION_ID'));
    if (version) value.hostOsVersion = version;
  }
  if (hostOs === 'linux') value.hostDistro = hostDistroName(id);

  try {
    const hash = createHash('sha256');
    for (const source of USB_VERSION_SOURCES) {
      hash.update(await readSource(source));
      hash.update('\0');
    }
    value.cliVersion = hash.digest('hex').slice(0, 12);
  } catch { /* Version fingerprint is optional if a packaged source file is unreadable. */ }
  return validateUsbEnvironment(value);
}

function getCachedUsbEnvironment() {
  cachedUsbEnvironment ??= collectUsbEnvironment().catch(() => null);
  return cachedUsbEnvironment;
}
const DIRECT_WRITER = String.raw`
import bz2, fcntl, hashlib, json, lzma, os, stat, struct, sys, time, zlib

source_path, device_id, expected_size, expected_sha, expected_major, expected_minor, expected_capacity, compression = sys.argv[1:]
# img.gz / img.bz2 / img.xz sources are unpacked while writing; '' writes the file as is
new_inflater = {'gz': lambda: zlib.decompressobj(31), 'bz2': bz2.BZ2Decompressor, 'xz': lzma.LZMADecompressor, '': None}[compression]
expected_size, expected_major, expected_minor, expected_capacity = map(int, (expected_size, expected_major, expected_minor, expected_capacity))
source_flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW
device_flags = os.O_RDWR | os.O_EXCL | os.O_CLOEXEC

def fail(message):
    print('ROMINIT_USB_ERROR ' + message, file=sys.stderr, flush=True)
    sys.exit(1)

progress_state = {'bytes': 0, 'time': time.monotonic()}
def report_progress(phase, completed_bytes, force=False, total=None):
    total = expected_size if total is None else total
    now = time.monotonic()
    if force or completed_bytes == total or completed_bytes - progress_state['bytes'] >= 8 * 1024 * 1024 or now - progress_state['time'] >= 1:
        value = {'phase': phase, 'completedBytes': completed_bytes, 'totalBytes': total}
        print('ROMINIT_USB_PROGRESS ' + json.dumps(value, separators=(',', ':')), flush=True)
        progress_state['bytes'] = completed_bytes
        progress_state['time'] = now

try:
    source_fd = os.open(source_path, source_flags)
    source_stat = os.fstat(source_fd)
    if not stat.S_ISREG(source_stat.st_mode) or source_stat.st_size != expected_size:
        fail('The reviewed ISO changed before writing.')
    digest = hashlib.sha256()
    checked = 0
    while True:
        chunk = os.read(source_fd, 4 * 1024 * 1024)
        if not chunk:
            break
        checked += len(chunk)
        digest.update(chunk)
    if checked != expected_size or digest.hexdigest() != expected_sha:
        fail('The reviewed ISO changed before writing.')
    os.lseek(source_fd, 0, os.SEEK_SET)

    # Open through the reviewed stable udev ID, then validate this exact fd before writing.
    device_fd = os.open(device_id, device_flags)
    device_stat = os.fstat(device_fd)
    if not stat.S_ISBLK(device_stat.st_mode) or os.major(device_stat.st_rdev) != expected_major or os.minor(device_stat.st_rdev) != expected_minor:
        fail('The selected USB disk identity changed before opening; no write was started.')
    capacity = struct.unpack('Q', fcntl.ioctl(device_fd, 0x80081272, struct.pack('Q', 0)))[0]
    if capacity != expected_capacity or expected_size > capacity:
        fail('The selected USB disk capacity changed or is too small; no write was started.')

    # Slow cards behind USB readers stall past the SCSI timeout and reset the reader. After an I/O error the whole write restarts
    # with a longer timeout and smaller transfers: (SCSI timeout s, max_sectors_kb). Needs root, which the writer has.
    PROFILES = [(None, None), (120, 64), (300, 32)]
    def tune(timeout, sectors):
        for name, value in (('device/timeout', timeout), ('queue/max_sectors_kb', sectors)):
            if value is None:
                continue
            try:
                with open('/sys/dev/block/%d:%d/%s' % (expected_major, expected_minor, name), 'w') as knob:
                    knob.write(str(value))
            except OSError:
                pass
    def reopen():
        for _ in range(30):
            time.sleep(2)
            try:
                fd = os.open(device_id, device_flags)
                info = os.fstat(fd)
                if stat.S_ISBLK(info.st_mode) and os.major(info.st_rdev) == expected_major and os.minor(info.st_rdev) == expected_minor and \
                        struct.unpack('Q', fcntl.ioctl(fd, 0x80081272, struct.pack('Q', 0)))[0] == expected_capacity:
                    return fd
                os.close(fd)
            except OSError:
                pass
        fail('The USB disk did not come back after an I/O error; the USB may be incomplete.')
    def attempt():
        os.lseek(source_fd, 0, os.SEEK_SET)
        progress_state['bytes'] = 0
        # A compressed source is unpacked while writing; its pinned hash covers the file, the readback covers the unpacked bytes.
        inflater = new_inflater() if new_inflater else None
        source_hash = hashlib.sha256()
        out_hash = hashlib.sha256()
        out_size = 0
        consumed = 0
        def emit(data):
            nonlocal out_size
            if out_size + len(data) > capacity:
                fail('The decompressed image is larger than the USB disk; the USB may be incomplete.')
            out_hash.update(data)
            offset = 0
            while offset < len(data):
                count = os.write(device_fd, data[offset:])
                if count <= 0:
                    fail('The USB write stopped early; the USB may be incomplete.')
                offset += count
            out_size += len(data)
        LIMIT = 16 * 1024 * 1024  # bounded output per step: a small compressed chunk can unpack to gigabytes
        def unpack(data):
            try:
                out = inflater.decompress(data, LIMIT)
            except (zlib.error, lzma.LZMAError, EOFError, OSError):  # bz2 reports corrupt data as OSError
                fail('The compressed image is corrupt; the USB may be incomplete.')
            return out, (inflater.unconsumed_tail if compression == 'gz' else b'')
        def feed(data):
            nonlocal inflater
            while True:
                out, data = unpack(data)
                if out:
                    emit(out)
                if inflater.eof:
                    data = inflater.unused_data + data  # multi-stream files (pigz, pbzip2, pixz) carry several streams
                    if not data:
                        return
                    inflater = new_inflater()
                elif not data and len(out) < LIMIT and (compression == 'gz' or inflater.needs_input):
                    return
        while consumed < expected_size:
            chunk = os.read(source_fd, min(4 * 1024 * 1024, expected_size - consumed))
            if not chunk:
                fail('The image ended early during writing; the USB may be incomplete.')
            source_hash.update(chunk)
            consumed += len(chunk)
            if inflater:
                feed(chunk)
            else:
                emit(chunk)
            report_progress('writing', consumed)
        if inflater:
            if compression == 'gz':
                try:
                    emit(inflater.flush())
                except zlib.error:
                    fail('The compressed image is corrupt; the USB may be incomplete.')
            if not inflater.eof:
                fail('The compressed image ended early; the USB may be incomplete.')
        if source_hash.hexdigest() != expected_sha:
            fail('The image changed during writing; the USB may be incomplete.')

        print('ROMINIT_USB_PHASE syncing', flush=True)
        os.fsync(device_fd)
        fcntl.ioctl(device_fd, 0x1261)
        print('ROMINIT_USB_PHASE verifying', flush=True)
        progress_state['bytes'] = 0
        progress_state['time'] = time.monotonic()
        report_progress('verifying', 0, True, out_size)
        os.lseek(device_fd, 0, os.SEEK_SET)
        read_hash = hashlib.sha256()
        read_size = 0
        while read_size < out_size:
            chunk = os.read(device_fd, min(4 * 1024 * 1024, out_size - read_size))
            if not chunk:
                fail('The USB readback ended early.')
            read_size += len(chunk)
            read_hash.update(chunk)
            report_progress('verifying', read_size, False, out_size)
        return {'size': read_size, 'sha256': read_hash.hexdigest(), 'matched': read_size == out_size and read_hash.hexdigest() == out_hash.hexdigest()}
    for number in range(len(PROFILES)):
        tune(*PROFILES[number])
        try:
            result = attempt()
            break
        except OSError:
            if number == len(PROFILES) - 1:
                fail('The USB reported I/O errors even with slower settings; the USB may be incomplete.')
            print('ROMINIT_USB_RETRY %d' % (number + 2), flush=True)
            os.close(device_fd)
            device_fd = reopen()
    print('ROMINIT_USB_RESULT ' + json.dumps(result, separators=(',', ':')), flush=True)
except SystemExit:
    raise
except Exception:
    fail('The USB writer could not safely complete the write and readback.')
finally:
    for name in ('device_fd', 'source_fd'):
        if name in locals():
            os.close(locals()[name])
`;

function fail(status, message, code) {
  const error = Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function safeText(value, max = LOG_LINE_BYTES) {
  return String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function errorText(error) {
  return safeText(error?.stderr || error?.message || error, 1000) || 'unknown error';
}

function ventoyDiskVersion(output) {
  const matches = [...String(output ?? '').matchAll(/^[\t ]*Ventoy Version(?:[\t ]+in Disk)?[\t ]*:[\t ]*([^\s,:]+)[\t ]*$/gim)];
  return matches.length === 1 ? matches[0][1] : null;
}

function field(node, name) {
  return node?.[name.toLowerCase()] ?? node?.[name];
}

function devicePath(node) {
  const value = field(node, 'PATH') ?? field(node, 'NAME');
  if (typeof value !== 'string' || !value) return null;
  const path = value.startsWith('/') ? value : `/dev/${value}`;
  return path.startsWith('/dev/') && !path.split('/').includes('..') ? path : null;
}

function flatNodes(roots) {
  const out = [];
  const seen = new Set();
  const visit = (node, parent = null) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    out.push({ node, parent });
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child, node);
  };
  for (const root of roots) visit(root);
  return out;
}

function mountpoints(node) {
  const values = field(node, 'MOUNTPOINTS');
  const list = Array.isArray(values) ? values : [values ?? field(node, 'MOUNTPOINT')];
  return [...new Set(list.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

function under(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function isUserMount(path, roots = ['/run/media', '/media']) {
  return roots.some(root => path.startsWith(`${root.replace(/\/$/, '')}/`));
}

function flag(value) {
  return value === true || value === 1 || value === '1';
}

function number(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function makeTree(records) {
  const parentOf = new Map(records.map(({ node, parent }) => [node, new Set(parent ? [parent] : [])]));
  const names = new Map();
  for (const { node } of records) {
    for (const name of [field(node, 'NAME'), field(node, 'PATH')]) if (typeof name === 'string') {
      names.set(name, node);
      names.set(name.split('/').pop(), node);
    }
  }
  for (const { node } of records) {
    const pkname = field(node, 'PKNAME');
    for (const name of typeof pkname === 'string' ? pkname.split(',').map(s => s.trim()).filter(Boolean) : []) {
      const parent = names.get(name) ?? names.get(name.split('/').pop());
      if (parent && parent !== node) parentOf.get(node).add(parent);
    }
  }
  const childrenOf = new Map(records.map(({ node }) => [node, new Set()]));
  for (const [node, parents] of parentOf) for (const parent of parents) childrenOf.get(parent)?.add(node);
  return childrenOf;
}

function descendants(root, childrenOf) {
  const result = [], seen = new Set([root]), queue = [root];
  while (queue.length) for (const child of childrenOf.get(queue.shift()) ?? []) {
    if (seen.has(child)) continue;
    seen.add(child);
    result.push(child);
    queue.push(child);
  }
  return result;
}

// A removable USB disk, or an SD card in a built-in reader (mmcblk, removable; internal eMMC is not).
function isRemovableMedia(root) {
  const tran = String(field(root, 'TRAN') ?? '').toLowerCase();
  return flag(field(root, 'RM')) && (tran === 'usb' || !tran && /^\/dev\/mmcblk\d+$/.test(devicePath(root) ?? ''));
}

function snapshotDrive(root, childrenOf, idsByPath, activeSwaps, mediaMountRoots) {
  const path = devicePath(root);
  const nodes = [root, ...descendants(root, childrenOf)];
  const paths = nodes.map(devicePath).filter(Boolean);
  const mounted = [...new Set(nodes.flatMap(mountpoints))].sort();
  const ids = path ? (idsByPath.get(path) ?? []) : [];
  const id = ids.length ? ids[0] : null;
  const size = number(field(root, 'SIZE'));
  const type = String(field(root, 'TYPE') ?? '').toLowerCase();
  const children = nodes.slice(1);
  const stacked = children.find(node => String(field(node, 'TYPE') ?? '').toLowerCase() !== 'part');
  const systemMount = mounted.find(value => !isUserMount(value, mediaMountRoots));
  const hasSwap = nodes.some(node => String(field(node, 'FSTYPE') ?? '').toLowerCase() === 'swap' || String(field(node, 'TYPE') ?? '').toLowerCase() === 'swap') ||
    paths.some(value => activeSwaps.devices.has(value)) || mounted.some(value => [...activeSwaps.files].some(file => under(file, value)));
  let reason = null;
  if (type !== 'disk') reason = 'This is not a whole disk.';
  else if (!path) reason = 'The device path is unavailable.';
  else if (!isRemovableMedia(root)) reason = 'This is not a removable USB disk or SD card.';
  else if (flag(field(root, 'RO'))) reason = 'The disk is read-only.';
  else if (size === null) reason = 'The disk capacity is unavailable.';
  else if (size < MIN_BYTES) reason = 'The disk is smaller than 128 MiB.';
  else if (!id) reason = 'A unique stable USB disk ID is unavailable.';
  else if (stacked) reason = `The disk has stacked device children (${String(field(stacked, 'TYPE') ?? 'unknown')}).`;
  else if (hasSwap) reason = 'The disk is used for swap.';
  else if (systemMount) reason = `The disk backs a system mount at ${systemMount}.`;
  return {
    public: { id, path, model: String(field(root, 'MODEL') ?? '').trim() || 'Unknown USB disk', size,
      mounted: mounted.length > 0, mounts: mounted, available: !reason, reason },
    internal: { id, path, majorMinor: String(field(root, 'MAJ:MIN') ?? ''), size, mounted, nodes, paths },
  };
}

function sameIdentity(a, b) {
  return a.id === b.id && a.path === b.path && a.majorMinor === b.majorMinor && a.size === b.size;
}

function sorted(values) {
  return [...new Set(values)].sort();
}

async function sha256File(path) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) { size += chunk.length; hash.update(chunk); }
  return { sha256: hash.digest('hex'), size };
}

function snapshotJob(job) {
  if (!job) return { state: 'idle', log: [] };
  const publicJob = { ...job };
  delete publicJob.reportEnvironment;
  return { ...publicJob, log: [...job.log], drive: { ...job.drive, mounts: [...job.drive.mounts] },
    ...(job.progress ? { progress: { ...job.progress } } : {}),
    ...(job.verification ? { verification: { ...job.verification,
      expected: { ...job.verification.expected }, actual: { ...job.verification.actual } } } : {}),
    ...(job.readback ? { readback: { ...job.readback } } : {}) };
}

/** Native Linux USB-media access. `runCommand` and `spawnProcess` are injection seams for tests. */
// Standard root-owned install spot, newest version wins; ROMINIT_VENTOY_DIR overrides. The trust checks in ventoy() still apply.
const VENTOY_HOME = '/var/lib/rominit/ventoy';
function findVentoyDir(home = VENTOY_HOME) {
  try {
    const found = readdirSync(home).flatMap(v => readdirSync(join(home, v)).filter(d => /^ventoy-/.test(d)).map(d => join(home, v, d)));
    return found.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  } catch { return undefined; }
}

export function createUsbMedia({ ventoyDir = process.env.ROMINIT_VENTOY_DIR || findVentoyDir(), ventoyVersion = process.env.ROMINIT_VENTOY_VERSION,
  imagePath = process.env.ROMINIT_ISO_PATH, imageSha256 = process.env.ROMINIT_ISO_SHA256, byIdDir = '/dev/disk/by-id',
  runCommand = (file, args, options) => execFile(file, args, options), spawnProcess = nodeSpawn,
  fetchImage = globalThis.fetch, imageCacheDir = IMAGE_CACHE_DIR, getImageEntry = osImageEntry,
  hostEnvironment,
  readText = readFile, listDir = readdir, resolvePath = realpath, fileStat = stat, fileStatFs = statfs,
  trustStat = lstat, installerOwnerUid = 0,
  mediaMountRoots = ['/run/media', '/media'], installTimeout = INSTALL_TIMEOUT,
  directWriteTimeout = size => Math.min(DIRECT_MAX_TIMEOUT, DIRECT_MIN_TIMEOUT + Math.ceil(2 * size / DIRECT_BYTES_PER_MS)),
  now = Date.now, makeId = () => randomBytes(32).toString('base64url'),
  makeJobId = () => randomBytes(32).toString('base64url'), reportOutcome } = {}) {
  const plans = new Map();
  let job = null;
  let writeBlocked = false;
  const hostEnvironmentPromise = hostEnvironment === undefined ? getCachedUsbEnvironment()
    : Promise.resolve(hostEnvironment).then(validateUsbEnvironment).catch(() => null);
  if (reportOutcome !== undefined && typeof reportOutcome !== 'function') throw Error('A USB outcome reporter must be a function.');

  const command = async (file, args, timeout = COMMAND_TIMEOUT) => runCommand(file, args,
    { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true });

  async function inventory() {
    let stdout;
    try {
      ({ stdout } = await command(BIN.lsblk, ['--json', '--bytes', '--paths', '--tree', '--merge', '--output', LSBLK_FIELDS], LSBLK_TIMEOUT));
    } catch (error) { throw fail(503, `Cannot inspect USB disks: ${errorText(error)}`); }
    let roots;
    try {
      roots = JSON.parse(stdout).blockdevices;
      if (!Array.isArray(roots)) throw Error('missing blockdevices');
    } catch { throw fail(503, 'The system returned an invalid USB disk inventory.'); }

    let names = [];
    try { names = await listDir(byIdDir); }
    catch (error) { if (error?.code !== 'ENOENT') throw fail(503, `Cannot read stable USB disk IDs: ${errorText(error)}`); }
    const idsByPath = new Map();
    await Promise.all(names.filter(name => /^(usb|mmc)-/.test(name)).map(async name => {
      const id = `${byIdDir.replace(/\/$/, '')}/${name}`;
      try {
        const target = await resolvePath(id);
        if (!idsByPath.has(target)) idsByPath.set(target, []);
        idsByPath.get(target).push(id);
      } catch { /* Ignore dangling or unreadable by-id links. */ }
    }));
    for (const ids of idsByPath.values()) ids.sort();

    let swaps;
    try { swaps = await readText('/proc/swaps', 'utf8'); }
    catch (error) { throw fail(503, `Cannot check active swap devices: ${errorText(error)}`); }
    const activeSwaps = { devices: new Set(), files: new Set() };
    for (const line of String(swaps).split('\n').slice(1)) {
      const source = line.trim().split(/\s+/, 1)[0];
      if (!source) continue;
      if (source.startsWith('/dev/')) {
        activeSwaps.devices.add(await resolvePath(source).catch(() => source));
        activeSwaps.devices.add(source);
      } else activeSwaps.files.add(source);
    }

    const records = flatNodes(roots);
    const childrenOf = makeTree(records);
    return roots.filter(root => String(field(root, 'TYPE') ?? '').toLowerCase() === 'disk' &&
      isRemovableMedia(root))
      .map(root => snapshotDrive(root, childrenOf, idsByPath, activeSwaps, mediaMountRoots));
  }

  async function ventoy() {
    if (typeof ventoyDir !== 'string' || !ventoyDir.startsWith('/')) throw fail(503, 'The pinned Ventoy directory is not configured.');
    let root, script;
    try {
      const configuredRoot = resolveFilePath(ventoyDir);
      // shortcut: trust root ownership and non-writable permissions because Ventoy rewrites support files; no per-file manifest is pinned.
      let currentPath = '/';
      const filesystemRoot = await trustStat(currentPath);
      if (filesystemRoot.isSymbolicLink() || !filesystemRoot.isDirectory() || filesystemRoot.uid !== installerOwnerUid || (filesystemRoot.mode & 0o022) !== 0)
        throw Error('untrusted Ventoy directory ancestor');
      for (const component of configuredRoot.split('/').filter(Boolean)) {
        currentPath = join(currentPath, component);
        const ancestor = await trustStat(currentPath);
        if (ancestor.isSymbolicLink() || !ancestor.isDirectory() || ancestor.uid !== installerOwnerUid || (ancestor.mode & 0o022) !== 0)
          throw Error('untrusted Ventoy directory ancestor');
      }
      root = await resolvePath(configuredRoot);
      if (root !== configuredRoot) throw Error('Ventoy directory resolves through a symbolic link');
      const inspectTree = async directory => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (!entry.name || entry.name === '.' || entry.name === '..' || entry.name.includes('/')) throw Error('invalid Ventoy tree entry');
          const entryPath = join(directory, entry.name);
          const info = await trustStat(entryPath);
          if (info.isSymbolicLink() || info.uid !== installerOwnerUid || (info.mode & 0o022) !== 0)
            throw Error('untrusted Ventoy installer tree entry');
          if (info.isDirectory()) await inspectTree(entryPath);
          else if (!info.isFile()) throw Error('unsupported Ventoy installer tree entry');
        }
      };
      await inspectTree(root);
      script = await resolvePath(`${root}/Ventoy2Disk.sh`);
      const info = await fileStat(script);
      if (!info.isFile() || !script.startsWith(`${root}/`)) throw Error('invalid installer path');
    } catch { throw fail(503, 'The pinned Ventoy installer is unavailable or failed its root-owned trust check.'); }
    return { root, script, version: ventoyVersion || /(?:^|\/)ventoy-([^/]+)$/i.exec(root)?.[1] };
  }

  async function localImage() {
    if (!imagePath && !imageSha256) return null;
    if (typeof imagePath !== 'string' || !isAbsolute(imagePath) || typeof imageSha256 !== 'string' || !/^[\da-f]{64}$/i.test(imageSha256))
      throw fail(503, 'The pinned local ISO path and SHA-256 are not configured correctly.');
    let sourcePath, info;
    try {
      sourcePath = await resolvePath(imagePath);
      info = await fileStat(sourcePath);
    } catch { throw fail(503, 'The pinned local ISO is unavailable.'); }
    const name = basename(sourcePath);
    if (!info.isFile() || info.size <= 0 || !/\.iso$/i.test(name) || name === '.' || name === '..') throw fail(503, 'The configured image must be a non-empty regular ISO file.');
    const sha256 = imageSha256.toLowerCase();
    let actual;
    try { actual = await sha256File(sourcePath); }
    catch (error) { throw fail(503, `Cannot read the pinned local ISO: ${errorText(error)}`); }
    if (actual.size !== info.size) throw fail(503, 'The pinned local ISO changed size while it was being checked.');
    return { sourcePath, name, size: info.size, sha256, actual,
      verification: { status: actual.sha256 === sha256 ? 'verified' : 'mismatch',
        expected: { size: info.size, sha256 }, actual: { ...actual } } };
  }

  function imagePin(id, method) {
    const entry = typeof id === 'string' && getImageEntry(id);
    const image = entry?.image;
    const osName = entry?.os?.name ?? 'the operating system';
    if (!image || image.id !== id || method === 'ventoy' && image.usb !== true || !USB_FORMATS.includes(String(image.format).toLowerCase()) || method === 'ventoy' && image.format !== 'iso' ||
        typeof image.arch !== 'string' || !image.arch || !Number.isSafeInteger(image.size) || image.size <= 0 || image.size > MAX_IMAGE_BYTES ||
        typeof image.sha256 !== 'string' || !/^[\da-f]{64}$/i.test(image.sha256))
      throw fail(400, method === 'direct' ? `Choose a bundled ${osName} image in ISO, img.gz, img.bz2 or img.xz format for direct USB writing.` : `Choose a bundled ${osName} ISO that supports Ventoy USB booting.`);
    let url;
    try { url = new URL(image.url); } catch { throw fail(503, `The bundled ${osName} image URL is invalid.`); }
    const name = basename(url.pathname);
    if (url.protocol !== 'https:' || url.username || url.password || !/^[\w.+-]+\.(iso|img\.(gz|bz2|xz))$/i.test(name))
      throw fail(503, `The bundled ${osName} image is not a downloadable ISO or compressed disk image.`);
    return { id: image.id, arch: image.arch, format: image.format, name, url: url.href,
      sha256: image.sha256.toLowerCase(), size: image.size, osName: entry.os.name };
  }

  async function fetchCatalogImage(pin) {
    if (typeof fetchImage !== 'function') throw fail(503, 'Image downloads are unavailable in this CLI.');
    const osName = pin.osName ?? 'the operating system';
    const cacheDir = resolveFilePath(imageCacheDir);
    const sourcePath = join(cacheDir, `${pin.sha256}-${pin.name}`);
    try { await mkdir(cacheDir, { recursive: true, mode: 0o700 }); }
    catch (error) { throw fail(503, `Could not prepare the ${osName} image cache: ${errorText(error)}`); }
    try {
      const cached = await lstat(sourcePath);
      if (cached.isFile() && !cached.isSymbolicLink()) {
        const actual = await sha256File(sourcePath);
        if (actual.size === pin.size && actual.sha256 === pin.sha256) return { ...pin, sourcePath, actual,
          verification: { status: 'verified', expected: { size: pin.size, sha256: pin.sha256 }, actual: { ...actual } } };
      }
    } catch (error) { if (error?.code !== 'ENOENT') throw fail(503, `Could not inspect the ${osName} image cache: ${errorText(error)}`); }

    let response;
    try {
      response = await fetchImage(pin.url, { redirect: 'error', signal: AbortSignal.timeout(Math.max(IMAGE_DOWNLOAD_TIMEOUT, Math.ceil(pin.size / DIRECT_BYTES_PER_MS))) });
    } catch { throw fail(502, `Could not download the selected ${osName} ISO. Check the network and try again.`); }
    if (!response?.ok || !response.body || response.redirected) throw fail(502, `The selected ${osName} ISO download failed or redirected.`);
    const contentLengthHeader = response.headers?.get?.('content-length');
    const contentLength = contentLengthHeader === null || contentLengthHeader === undefined || contentLengthHeader === ''
      ? null : Number(contentLengthHeader);
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0))
      throw fail(502, `The selected ${osName} ISO has an invalid download length.`);
    if (contentLength !== null && contentLength > MAX_IMAGE_BYTES) throw fail(502, `The ${osName} ISO download exceeds the 16 GiB safety limit.`);
    const contentEncoding = String(response.headers?.get?.('content-encoding') ?? '').trim().toLowerCase();
    const expectedTransferLength = contentLength !== null && (!contentEncoding || contentEncoding === 'identity')
      ? contentLength : null;

    const partPath = `${sourcePath}.${randomBytes(12).toString('hex')}.part`;
    let file;
    try {
      file = await open(partPath, 'wx', 0o600);
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_IMAGE_BYTES) throw Error(`The ${osName} ISO download exceeds the 16 GiB safety limit.`);
        hash.update(buffer);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset);
          if (!bytesWritten) throw Error(`Could not write the downloaded ${osName} ISO.`);
          offset += bytesWritten;
        }
      }
      if (size <= 0) throw Error(`The ${osName} ISO download is empty.`);
      if (expectedTransferLength !== null && size !== expectedTransferLength) throw Error(`The ${osName} ISO download ended before its advertised size.`);
      const actual = { size, sha256: hash.digest('hex') };
      await file.sync();
      await file.close(); file = null;
      const matchesPin = actual.size === pin.size && actual.sha256 === pin.sha256;
      const destination = matchesPin ? sourcePath : join(cacheDir, `candidate-${actual.sha256}-${pin.name}`);
      if (!matchesPin) {
        try {
          const cachedCandidate = await lstat(destination);
          if (!cachedCandidate.isFile() || cachedCandidate.isSymbolicLink()) throw Error('unsafe cached candidate');
          const cachedActual = await sha256File(destination);
          if (cachedActual.size !== actual.size || cachedActual.sha256 !== actual.sha256) throw Error('candidate cache collision');
          await unlink(partPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
          await rename(partPath, destination);
        }
      } else await rename(partPath, destination);
      return { ...pin, sourcePath: destination, actual,
        verification: { status: matchesPin ? 'verified' : 'mismatch',
          expected: { size: pin.size, sha256: pin.sha256 }, actual: { ...actual } } };
    } catch (error) {
      await file?.close().catch(() => {});
      await unlink(partPath).catch(() => {});
      throw fail(502, [`The ${osName} ISO download exceeds the 16 GiB safety limit.`, `The ${osName} ISO download is empty.`,
        `The ${osName} ISO download ended before its advertised size.`, `The selected ${osName} ISO has an invalid download length.`].includes(error?.message)
        ? error.message : `Could not download the selected ${osName} ISO completely.`);
    }
  }

  async function planImage(plan) {
    if (!plan.image) return null;
    let sourcePath, info;
    try {
      sourcePath = await resolvePath(plan.imageSource);
      info = await fileStat(sourcePath);
    } catch { throw fail(409, 'The pinned ISO is unavailable. Create a new plan.'); }
    if (sourcePath !== plan.imageSource) throw fail(409, 'The pinned ISO path changed after review. Create a new plan.');
    if (!info.isFile()) throw fail(409, 'The pinned ISO is no longer a regular file. Create a new plan.');
    let actual;
    try { actual = await sha256File(sourcePath); }
    catch { throw fail(409, 'The pinned ISO is unavailable. Create a new plan.'); }
    if (actual.size !== info.size || actual.size !== plan.imageActual?.size || actual.sha256 !== plan.imageActual?.sha256)
      throw fail(409, 'The reviewed ISO download changed size or SHA-256 after review.');
    return { sourcePath, name: plan.image.name, ...actual };
  }

  function prunePlans() {
    for (const [id, plan] of plans) if (now() >= plan.expires) plans.delete(id);
    while (plans.size >= MAX_PLANS) plans.delete(plans.keys().next().value);
  }

  function append(jobState, text) {
    const line = safeText(text);
    if (!line) return;
    jobState.log.push(line);
    while (jobState.log.length > LOG_LINES || jobState.log.reduce((sum, item) => sum + Buffer.byteLength(item), 0) > LOG_BYTES)
      jobState.log.shift();
  }

  async function currentFor(plan, expectedMounted, requireAvailable = true) {
    const current = await inventory();
    const found = current.find(value => value.public.id === plan.drive.id);
    if (!found || !sameIdentity(found.internal, plan.identity) ||
        JSON.stringify(sorted(found.internal.mounted)) !== JSON.stringify(sorted(expectedMounted)))
      throw fail(409, 'The USB disk identity or mount state changed. Create a new plan.');
    if (requireAvailable && !found.public.available) throw fail(409, found.public.reason ?? 'The USB disk is no longer available.');
    return found;
  }

  function existingVentoyLayout(found, status = 409) {
    const partitions = found.internal.nodes.filter(node => String(field(node, 'TYPE') ?? '').toLowerCase() === 'part');
    const data = partitions.filter(node => String(field(node, 'LABEL') ?? '') === 'Ventoy');
    const efi = partitions.filter(node => String(field(node, 'LABEL') ?? '') === 'VTOYEFI');
    if (!data.length && !efi.length) return null;
    if (data.length !== 1 || !field(data[0], 'FSTYPE') || efi.length !== 1 || !field(efi[0], 'FSTYPE'))
      throw fail(status, 'The existing Ventoy layout is incomplete or ambiguous; the USB will not be reformatted.');
    return { data: data[0], efi: efi[0] };
  }

  function ventoyLayout(found) {
    const layout = existingVentoyLayout(found, 500);
    if (!layout) throw fail(500, 'Ventoy installer finished, but its Ventoy and VTOYEFI filesystems were not verified.');
    return layout;
  }

  async function verifyVentoyVersion(target, path, status) {
    if (!target.version) throw fail(status, 'The existing Ventoy version could not be verified; the USB was not changed.');
    let output;
    try { output = String((await command(BIN.sudo, ['-n', BIN.sh, target.script, '-l', path])).stdout ?? ''); }
    catch { throw fail(status, 'The existing Ventoy version could not be verified; the USB was not changed.'); }
    const version = ventoyDiskVersion(output);
    if (!version || /^NA$/i.test(version) || version !== target.version)
      throw fail(status, 'The existing Ventoy version could not be verified; the USB was not changed.');
    return version;
  }

  async function copyImage(plan, expectedMounted) {
    const image = await planImage(plan);
    if (!image) throw fail(409, 'The pinned ISO is unavailable. Create a new plan.');
    let found = expectedMounted === undefined
      ? (await inventory()).find(value => value.public.id === plan.drive.id)
      : await currentFor(plan, expectedMounted);
    if (!found || !sameIdentity(found.internal, plan.identity)) throw fail(409, 'The USB disk changed before the ISO copy.');
    let { data } = ventoyLayout(found);
    let mounts = mountpoints(data);
    if (!mounts.length) {
      const partition = devicePath(data);
      if (!partition) throw fail(500, 'The Ventoy data partition has no device path.');
      append(job, `Mounting Ventoy data partition ${partition}.`);
      try { await command(BIN.udisksctl, ['mount', '--block-device', partition]); }
      catch (error) { throw fail(500, `Could not mount the Ventoy data partition: ${errorText(error)}`); }
      found = (await inventory()).find(value => value.public.id === plan.drive.id);
      if (!found || !sameIdentity(found.internal, plan.identity)) throw fail(409, 'The USB disk changed while mounting the Ventoy partition.');
      ({ data } = ventoyLayout(found));
      mounts = mountpoints(data);
    }
    if (mounts.length !== 1 || !isUserMount(mounts[0], mediaMountRoots)) throw fail(409, 'The Ventoy data partition did not mount at one user media path.');
    const mountpoint = mounts[0];
    const directory = await open(mountpoint, 'r');
    try {
      const directoryInfo = await directory.stat();
      const partition = devicePath(data);
      const partitionInfo = partition ? await fileStat(partition) : null;
      if (!partitionInfo?.isBlockDevice() || directoryInfo.dev !== partitionInfo.rdev)
        throw fail(409, 'The Ventoy mount does not belong to the selected USB data partition.');
      const fdPath = `/proc/self/fd/${directory.fd}`;
      const capacity = await fileStatFs(fdPath);
      if (Number(capacity.bavail) * Number(capacity.bsize) < image.size) throw fail(409, 'There is not enough free space on the Ventoy partition for this ISO.');
      const beforeCopy = (await inventory()).find(value => value.public.id === plan.drive.id);
      if (!beforeCopy || !sameIdentity(beforeCopy.internal, plan.identity) || !mountpoints(ventoyLayout(beforeCopy).data).includes(mountpoint))
        throw fail(409, 'The USB disk or Ventoy mount changed before the ISO copy.');
      const destination = join(fdPath, image.name);
      job.phase = 'copying';
      append(job, `Copying ${image.name} (${image.size} bytes).`);
      try { await copyFile(image.sourcePath, destination, fsConstants.COPYFILE_EXCL); }
      catch (error) {
        throw fail(error?.code === 'EEXIST' ? 409 : 500,
          error?.code === 'EEXIST' ? `${image.name} already exists on the Ventoy USB.` : `Could not copy ${image.name}: ${errorText(error)}`);
      }
      const file = await open(destination, 'r+');
      try { await file.sync(); } finally { await file.close(); }
      await directory.sync();
      job.phase = 'verifying';
      append(job, 'Copy finished. Checking the USB file SHA-256 again.');
      const copied = await sha256File(destination);
      if (copied.size !== image.size || copied.sha256 !== image.sha256) throw fail(500, 'The copied ISO does not match the exact download reviewed before writing.');
      const checked = (await inventory()).find(value => value.public.id === plan.drive.id);
      if (!checked || !sameIdentity(checked.internal, plan.identity)) throw fail(409, 'The USB disk changed during the ISO copy.');
      const finalLayout = ventoyLayout(checked);
      if (!mountpoints(finalLayout.data).includes(mountpoint)) throw fail(409, 'The Ventoy USB mount changed during the ISO copy.');
      job.readback = { size: copied.size, sha256: copied.sha256, matched: true };
      if (plan.verification?.status === 'mismatch')
        append(job, `USB copy complete: readback SHA-256 ${copied.sha256} matches the reviewed download; the publisher size/SHA-256 mismatch was explicitly accepted.`);
      else append(job, `USB copy complete: readback SHA-256 ${copied.sha256} matches the reviewed ISO.`);
    } finally { await directory.close(); }
  }

  async function unmountDrive(plan) {
    job.phase = 'unmounting';
    const original = await currentFor(plan, plan.identity.mounted);
    const mountedNodes = original.internal.nodes.filter(node => mountpoints(node).length && devicePath(node))
      .reverse().filter((node, index, all) => all.findIndex(other => devicePath(other) === devicePath(node)) === index);
    let expected = [...plan.identity.mounted];
    for (const node of mountedNodes) {
      const path = devicePath(node);
      const mounts = mountpoints(node);
      append(job, `Unmounting ${path}: ${mounts.join(', ')}.`);
      await planImage(plan);
      try { await command(BIN.udisksctl, ['unmount', '--block-device', path]); }
      catch (error) { throw fail(500, `Could not unmount ${path}: ${errorText(error)}`); }
      expected = expected.filter(value => !mounts.includes(value));
      await currentFor(plan, expected);
      await planImage(plan);
    }
    await currentFor(plan, []);
    await planImage(plan);
  }

  async function runDirectWriter(plan, image, jobState, timeoutMs) {
    const match = /^(\d+):(\d+)$/.exec(plan.identity.majorMinor);
    if (!match) throw fail(409, 'The selected USB disk has no stable kernel identity. Create a new plan.');
    if (!new RegExp(`^${byIdDir.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(usb|mmc)-`).test(plan.drive.id))
      throw fail(409, 'The selected USB disk has no trusted stable ID. Create a new plan.');
    const args = ['-n', BIN.python, '-c', DIRECT_WRITER, image.sourcePath, plan.drive.id,
      String(image.size), image.sha256, match[1], match[2], String(plan.identity.size), /\.(gz|bz2|xz)$/i.exec(image.name)?.[1].toLowerCase() ?? ''];
    jobState.phase = 'writing';
    delete jobState.progress;
    jobState.deadlineAt = new Date(now() + timeoutMs).toISOString();
    append(jobState, `Writing ${image.name} (${image.size} bytes) to the whole USB disk.`);
    await new Promise((resolve, reject) => {
      let child, settled = false, timedOut = false, stderr = '';
      let killTimer, settleTimer;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        clearTimeout(settleTimer);
        if (error) reject(error); else resolve();
      };
      const signalChild = signal => {
        try {
          if (process.platform === 'linux' && child?.pid) process.kill(-child.pid, signal);
          else child?.kill(signal);
        } catch { /* The writer may already have exited. */ }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        writeBlocked = true;
        signalChild('SIGTERM');
        killTimer = setTimeout(() => signalChild('SIGKILL'), 2_000);
        settleTimer = setTimeout(() => finish(fail(500,
          'Direct USB writing timed out; the USB may be incomplete. Restart the helper before another write.')), 4_000);
      }, timeoutMs);
      timer.unref?.();
      try {
        child = spawnProcess(BIN.sudo, args, { cwd: '/', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform === 'linux' });
      } catch (error) { finish(fail(503, `The direct USB writer could not start: ${errorText(error)}`)); return; }
      const lines = (stream, onLine) => {
        let pending = '';
        stream?.on('data', chunk => {
          pending += String(chunk);
          const split = pending.split(/\r?\n/);
          pending = split.pop() ?? '';
          for (const line of split) onLine(line);
        });
        stream?.on('end', () => { if (pending) onLine(pending); });
      };
      let protocolPhase = 'writing';
      const acceptProgress = value => {
        let progress;
        try { progress = JSON.parse(value.slice('ROMINIT_USB_PROGRESS '.length)); }
        catch { return; }
        if (!progress || !['writing', 'verifying'].includes(progress.phase) || progress.phase !== protocolPhase ||
          !Number.isSafeInteger(progress.completedBytes) || !Number.isSafeInteger(progress.totalBytes) ||
          progress.completedBytes < 0 || progress.completedBytes > progress.totalBytes ||
          (progress.phase === 'writing' || !/\.gz$/i.test(image.name)) && progress.totalBytes !== image.size) return;
        const previous = jobState.progress?.phase === progress.phase ? jobState.progress.completedBytes : -1;
        if (progress.completedBytes < previous) return;
        jobState.progress = { phase: progress.phase, completedBytes: progress.completedBytes, totalBytes: progress.totalBytes };
      };
      lines(child.stdout, line => {
        const value = safeText(line, 2048);
        if (value === 'ROMINIT_USB_PHASE syncing' && protocolPhase === 'writing') {
          protocolPhase = 'syncing';
          jobState.phase = 'syncing';
          delete jobState.progress;
          append(jobState, 'Image bytes written. Flushing USB writes before readback.');
        } else if (value === 'ROMINIT_USB_PHASE verifying' && protocolPhase === 'syncing') {
          protocolPhase = 'verifying';
          jobState.phase = 'verifying';
          jobState.progress = { phase: 'verifying', completedBytes: 0, totalBytes: image.size };
          append(jobState, 'Write finished and synced. Checking the USB readback SHA-256.');
        } else if (value.startsWith('ROMINIT_USB_RETRY ')) {
          protocolPhase = 'writing';
          jobState.phase = 'writing';
          jobState.retries = (jobState.retries ?? 0) + 1;
          delete jobState.progress;
          append(jobState, 'The USB reader reported errors. Restarting the write with a longer timeout and smaller transfers (a slow card is likely).');
        } else if (value.startsWith('ROMINIT_USB_PROGRESS ')) {
          acceptProgress(value);
        } else if (value.startsWith('ROMINIT_USB_RESULT ')) {
          try {
            const result = JSON.parse(value.slice('ROMINIT_USB_RESULT '.length));
            if (Number.isSafeInteger(result.size) && result.size >= 0 && typeof result.sha256 === 'string' && /^[\da-f]{64}$/.test(result.sha256) && typeof result.matched === 'boolean')
              jobState.readback = { size: result.size, sha256: result.sha256, matched: result.matched };
          } catch { append(jobState, 'The USB writer returned an invalid readback result.'); }
        } else if (value) append(jobState, value);
      });
      lines(child.stderr, line => {
        const value = safeText(line, 1024);
        if (value) { stderr = value; append(jobState, value.startsWith('ROMINIT_USB_ERROR ') ? value.slice('ROMINIT_USB_ERROR '.length) : value); }
      });
      child.once('error', error => finish(fail(error?.code === 'ENOENT' ? 503 : 500,
        error?.code === 'ENOENT' ? 'Python 3 is required for direct USB writing but /usr/bin/python3 is unavailable.' : `The direct USB writer could not start: ${errorText(error)}`)));
      child.once('close', code => {
        if (timedOut) return finish(fail(500, 'Direct USB writing timed out; the USB may be incomplete. Restart the helper before another write.'));
        if (code !== 0) return finish(fail(/identity changed|capacity changed|reviewed ISO changed/i.test(stderr) ? 409 : 500,
          stderr.startsWith('ROMINIT_USB_ERROR ') ? stderr.slice('ROMINIT_USB_ERROR '.length) : 'The direct USB writer failed; the USB may be incomplete.'));
        finish();
      });
      // The fixed helper has no input channel; closing it avoids keeping subprocesses alive.
      child.stdin?.end();
    });
  }

  async function writeDirect(plan) {
    if (!plan.image) throw fail(409, 'The direct-write plan has no selected ISO. Create a new plan.');
    const initial = await currentFor(plan, plan.identity.mounted);
    if (initial.internal.mounted.some(path => under(plan.imageSource, path)))
      throw fail(409, 'The pinned ISO is stored on the USB disk being erased.');
    await planImage(plan);
    try { await command(BIN.sudo, ['-n', '/usr/bin/true']); }
    catch { throw fail(503, 'Noninteractive sudo is unavailable for this user.'); }
    try { await command(BIN.sudo, ['-n', BIN.python, '-c', 'pass']); }
    catch { throw fail(503, 'Python 3 at /usr/bin/python3 and noninteractive sudo are required for direct USB writing.'); }

    await runUsbImage({
      assertPlanned: async () => {
        const current = await currentFor(plan, plan.identity.mounted);
        if (current.internal.mounted.some(path => under(plan.imageSource, path)))
          throw fail(409, 'The pinned ISO is stored on the USB disk being erased.');
        await planImage(plan);
      },
      unmount: async () => unmountDrive(plan),
      assertUnmounted: async () => {
        await currentFor(plan, []);
        await planImage(plan);
      },
      write: async () => {
        const image = await planImage(plan);
        const current = await currentFor(plan, []);
        if (image.size > current.public.size) throw fail(409, 'The selected ISO no longer fits on the USB disk. Create a new plan.');
        if (under(image.sourcePath, '/dev')) throw fail(409, 'The ISO source path is invalid.');
        await runDirectWriter(plan, image, job, plan.directTimeoutMs);
      },
      verify: async () => {
        const actual = plan.imageActual;
        // A .gz image is inflated by the writer; its readback hash is of the inflated bytes, checked there against what was written.
        const inflated = /\.gz$/i.test(plan.image.name);
        if (!job.readback?.matched || !inflated && (job.readback.size !== actual.size || job.readback.sha256 !== actual.sha256))
          throw fail(500, 'The USB readback size or SHA-256 does not match the reviewed download.');
        const afterWrite = (await inventory()).find(value => value.public.id === plan.drive.id);
        if (!afterWrite || !sameIdentity(afterWrite.internal, plan.identity))
          throw fail(409, 'The USB disk identity changed during the direct write.');
        append(job, plan.verification?.status === 'mismatch'
          ? `Direct USB write complete: readback SHA-256 ${job.readback.sha256} matches the downloaded ISO; the publisher checksum mismatch was explicitly accepted.`
          : `Direct USB write complete: readback SHA-256 ${job.readback.sha256} matches the reviewed ISO.`);
      },
    }, plan, message => append(job, message));
  }

  async function runInstaller(target, path, jobState) {
    jobState.phase = 'installing';
    append(jobState, `Running Ventoy installer for ${path}.`);
    await new Promise((resolve, reject) => {
      let child, timedOut = false, settled = false, inputError = null, killTimer, settleTimer;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        clearTimeout(settleTimer);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        writeBlocked = true;
        try {
          if (process.platform === 'linux' && child?.pid) process.kill(-child.pid, 'SIGTERM');
          else child?.kill('SIGTERM');
        } catch { /* The process may already have exited. */ }
        killTimer = setTimeout(() => {
          try {
            if (process.platform === 'linux' && child?.pid) process.kill(-child.pid, 'SIGKILL');
            else child?.kill('SIGKILL');
          } catch { /* The process may already have exited. */ }
        }, 2_000);
        settleTimer = setTimeout(() => finish(fail(500,
          'Ventoy installer timed out; the USB may be incomplete. Restart the helper before another write.')), 4_000);
      }, installTimeout);
      timer.unref?.();
      try {
        child = spawnProcess(BIN.sudo, ['-n', BIN.sh, target.script, '-i', path], {
          cwd: target.root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform === 'linux',
        });
      } catch (error) { finish(fail(500, `Could not start Ventoy: ${errorText(error)}`)); return; }
      const collect = stream => stream?.on('data', chunk => {
        for (const line of String(chunk).split(/\r?\n/)) append(jobState, line);
      });
      collect(child.stdout);
      collect(child.stderr);
      child.once('error', error => finish(fail(500, `Ventoy could not start: ${errorText(error)}`)));
      child.once('close', (code, signal) => {
        if (timedOut) return finish(fail(500, 'Ventoy installer timed out; the USB may be incomplete. Restart the helper before another write.'));
        if (inputError) return finish(fail(500, `Ventoy prompt input failed; restart the helper before another write: ${errorText(inputError)}`));
        if (code !== 0) return finish(fail(500, `Ventoy installer exited with ${signal ? `signal ${signal}` : `status ${code}`}.`));
        finish();
      });
      child.stdin.on('error', error => {
        inputError = error;
        writeBlocked = true;
        append(jobState, `Ventoy prompt input failed: ${errorText(error)}.`);
      });
      // The caller has already checked the exact typed phrase and consumed the plan.
      try { child.stdin.end('y\ny\n'); }
      catch (error) { writeBlocked = true; finish(fail(500, `Ventoy prompt input failed; restart the helper before another write: ${errorText(error)}`)); }
    });
  }

  function outcomePayload(plan, jobState) {
    const hasImage = !!plan.image;
    const image = hasImage ? {
      id: plan.image.id ?? 'local-configured',
      size: plan.imageActual?.size ?? plan.image.size,
    } : { id: 'none', size: 0 };
    const payload = {
      jobId: jobState.jobId,
      method: plan.method,
      action: plan.action,
      outcome: jobState.state === 'succeeded' ? 'success' : 'failed',
      image,
      drive: { capacityBytes: plan.drive.size },
      verification: { source: !hasImage ? 'none' : plan.verification?.status === 'mismatch' ? 'mismatch-accepted' : 'verified' },
      // A .gz image reads back as inflated bytes; the report keeps the pinned (compressed) size, which the inbox checks against the catalog.
      ...(jobState.readback ? { readback: { size: /\.gz$/i.test(plan.image?.name ?? '') ? image.size : jobState.readback.size, matched: jobState.readback.matched } } : {}),
      ...(jobState.retries ? { retries: Math.min(jobState.retries, 10) } : {}),
      ...(jobState.reportEnvironment ? { environment: { ...jobState.reportEnvironment } } : {}),
    };
    if (jobState.state === 'failed') {
      const error = String(jobState.error ?? '').toLowerCase();
      const phase = jobState.phase;
      const failureCode = /timed out/.test(error) ? 'timeout'
        : /identity changed|disk changed|device changed|no longer available|capacity changed/.test(error) ? 'device_changed'
          : phase === 'unmounting' || /could not unmount/.test(error) ? 'unmount'
            : phase === 'verifying' || /readback|verification failed|did not verify/.test(error) ? 'readback'
              : ['copying', 'installing', 'writing', 'syncing'].includes(phase) ? 'write'
                : !phase || phase === 'preflight' ? 'preflight' : 'unknown';
      payload.failureCode = failureCode;
    }
    return payload;
  }

  async function reportTerminal(plan, jobState) {
    if (!reportOutcome) return;
    jobState.reportStatus = 'pending';
    try {
      await reportOutcome(outcomePayload(plan, jobState));
      jobState.reportStatus = 'sent';
    } catch {
      // Reporting is a separate inbox side effect. It must not change the USB outcome or expose response details.
      jobState.reportStatus = 'failed';
    }
  }

  async function executePlan(plan) {
    const jobState = job;
    jobState.state = 'running';
    try {
      if (plan.method === 'direct') {
        await writeDirect(plan);
        jobState.state = 'succeeded';
        return;
      }
      const target = await ventoy();
      await currentFor(plan, plan.identity.mounted);
      if (plan.image) {
        const image = await planImage(plan);
        if (!image) throw fail(409, 'The pinned ISO is unavailable. Create a new plan.');
        if (plan.drive.mounts.some(path => under(image.sourcePath, path)))
          throw fail(409, `The pinned ISO is stored on the USB disk being ${plan.action === 'copy' ? 'copied to' : 'erased'}.`);
      }
      if (plan.action === 'copy') {
        if (!plan.image?.id) throw fail(409, 'The copy-only plan has no selected ISO. Create a new plan.');
        const current = await currentFor(plan, plan.identity.mounted);
        if (!existingVentoyLayout(current, 409)) throw fail(409, 'The existing Ventoy layout changed. Create a new plan.');
        await verifyVentoyVersion(target, current.public.path, 409);
        await copyImage(plan, plan.identity.mounted);
        jobState.state = 'succeeded';
        return;
      }
      try { await command(BIN.sudo, ['-n', '/usr/bin/true']); }
      catch { throw fail(503, 'Noninteractive sudo is unavailable for this user.'); }

      await runVentoy({
        assertPlanned: async () => {
          await currentFor(plan, plan.identity.mounted);
          if (plan.image) await planImage(plan);
        },
        unmount: async () => {
          const original = await currentFor(plan, plan.identity.mounted);
          const mountedNodes = original.internal.nodes.filter(node => mountpoints(node).length && devicePath(node))
            .reverse().filter((node, index, all) => all.findIndex(other => devicePath(other) === devicePath(node)) === index);
          let expected = [...plan.identity.mounted];
          for (const node of mountedNodes) {
            const path = devicePath(node);
            const mounts = mountpoints(node);
            append(job, `Unmounting ${path}: ${mounts.join(', ')}.`);
            try { await command(BIN.udisksctl, ['unmount', '--block-device', path]); }
            catch (error) { throw fail(500, `Could not unmount ${path}: ${errorText(error)}`); }
            expected = expected.filter(value => !mounts.includes(value));
            await currentFor(plan, expected);
          }
        },
        assertUnmounted: async () => {
          await currentFor(plan, []);
          if (plan.image) await planImage(plan);
        },
        install: async () => {
          const current = await currentFor(plan, []);
          if (plan.image) await planImage(plan);
          await runInstaller(target, current.public.path, job);
        },
        verify: async () => {
          const current = await inventory();
          const found = current.find(value => value.public.id === plan.drive.id);
          if (!found || !sameIdentity(found.internal, plan.identity)) throw fail(409, 'The USB disk changed during Ventoy installation.');
          if (!found.public.available) throw fail(409, found.public.reason ?? 'The USB disk became unavailable after installation.');
          const { data, efi } = ventoyLayout(found);
          append(job, `Verified ${field(data, 'LABEL')} (${field(data, 'FSTYPE')}) and ${field(efi, 'LABEL')} (${field(efi, 'FSTYPE')}).`);
          try {
            const result = await command(BIN.sudo, ['-n', BIN.sh, target.script, '-l', found.public.path]);
            const output = String(result.stdout ?? '');
            const version = ventoyDiskVersion(output);
            if (!version || /^NA$/i.test(version) || target.version && version !== target.version)
              throw fail(500, `Ventoy list did not verify the expected installation${target.version ? ` (${target.version})` : ''}.`);
            append(job, `Ventoy list check: version ${version}.`);
          } catch (error) { throw fail(500, `Ventoy list verification failed: ${errorText(error)}`); }
        },
        copyImage: async () => copyImage(plan),
      }, plan, message => append(job, message));
      jobState.state = 'succeeded';
    } catch (error) {
      jobState.state = 'failed';
      jobState.error = safeText(error?.message || error, 1000) || 'USB operation failed.';
      append(jobState, jobState.error);
    } finally {
      await reportTerminal(plan, jobState);
    }
  }

  return {
    directSupported: process.platform === 'linux',
    async listDrives() {
      return (await inventory()).map(value => ({ ...value.public, mounts: [...value.public.mounts] }));
    },
    async plan({ driveId, method, imageId } = {}) {
      if (typeof driveId !== 'string' || !driveId || !['ventoy', 'direct'].includes(method) || imageId !== undefined &&
          (typeof imageId !== 'string' || !imageId || imageId !== imageId.trim()))
        throw fail(400, 'A USB drive ID and method "ventoy" or "direct" are required.');
      if (method === 'direct' && process.platform !== 'linux') throw fail(503, 'Direct USB writing is available only on Linux.');
      const target = method === 'ventoy' ? await ventoy() : null;
      let found = (await inventory()).find(value => value.public.id === driveId);
      if (!found || !found.public.available) throw fail(409, found?.public.reason ?? 'The USB disk is no longer available.');
      const pin = imageId === undefined ? null : imagePin(imageId, method);
      let action = method === 'direct' ? 'direct' : 'install';
      if (pin && method === 'ventoy' && existingVentoyLayout(found)) {
        await verifyVentoyVersion(target, found.public.path, 409);
        action = 'copy';
      }
      let image = pin ? { ...pin } : await localImage();
      if (method === 'direct' && !image) throw fail(400, 'Select a bundled ISO or configure a pinned local ISO before direct writing.');
      if (pin) {
        const cachePath = join(resolveFilePath(imageCacheDir), `${pin.sha256}-${pin.name}`);
        if (found.public.mounts.some(path => under(cachePath, path)))
          throw fail(409, 'The image cache is on the USB disk being prepared.');
        image = await fetchCatalogImage(pin);
      }
      const actualSize = image?.actual?.size ?? image?.size;
      if (method === 'direct' && image && actualSize > MAX_IMAGE_BYTES)
        throw fail(409, 'The selected ISO exceeds the 16 GiB direct-write safety limit.');
      if (image && actualSize + (action === 'install' ? VENTOY_OVERHEAD : 0) > found.public.size)
        throw fail(409, `The selected ISO (${actualSize} bytes) does not fit on this USB disk${action === 'install' ? ' with Ventoy partition space reserved' : ''}.`);
      if (image && found.public.mounts.some(path => under(image.sourcePath, path)))
        throw fail(409, 'The pinned ISO is stored on the USB disk being erased.');
      if (pin) {
        found = await currentFor({ drive: found.public, identity: found.internal }, found.internal.mounted);
        if (action === 'copy' && !existingVentoyLayout(found, 409))
          throw fail(409, 'The existing Ventoy layout changed; the USB was not changed.');
      }
      prunePlans();
      const id = makeId();
      const expires = now() + PLAN_MS;
      const imageReview = image ? pin
        ? { id: pin.id, arch: pin.arch, format: pin.format, name: pin.name, size: pin.size, sha256: pin.sha256, url: pin.url }
        : { name: image.name, size: image.size, sha256: image.sha256 }
        : undefined;
      const imageActual = image ? { size: image.actual?.size ?? image.size, sha256: image.actual?.sha256 ?? image.sha256 } : undefined;
      const verification = image ? image.verification ?? { status: 'verified',
        expected: { size: image.size, sha256: image.sha256 }, actual: { ...imageActual } } : undefined;
      const directTimeoutMs = method === 'direct' ? directWriteTimeout(imageActual.size) : undefined;
      if (method === 'direct' && (!Number.isSafeInteger(directTimeoutMs) || directTimeoutMs <= 0 || directTimeoutMs > DIRECT_MAX_TIMEOUT))
        throw fail(503, 'The direct USB write timeout is unavailable.');
      const confirm = action === 'copy' ? 'COPY' : 'ERASE';
      const warning = action === 'copy'
        ? `Copies ${image.name} to the existing Ventoy USB at ${found.public.path}. Existing files and partitions are preserved; the drive will not be reformatted.${verification?.status === 'mismatch' ? ' The ISO size or SHA-256 differs from the publisher catalog.' : ''} Boot has not been tested.`
        : action === 'direct'
          ? `Directly writes ${image.name} across the entire USB disk at ${found.public.path}, erasing all existing data. Firmware boot compatibility is not guaranteed; boot has not been tested.${verification?.status === 'mismatch' ? ' The ISO size or SHA-256 differs from the publisher catalog.' : ''}`
          : `Installing Ventoy erases all data on ${found.public.path}${image ? `, then copies ${image.name}` : ''}.${verification?.status === 'mismatch' ? ' The ISO size or SHA-256 differs from the publisher catalog.' : ''} Boot has not been tested.`;
      const value = { id, drive: found.public, method, action, ...(imageReview ? { image: imageReview } : {}),
        ...(verification ? { verification: { status: verification.status, expected: { ...verification.expected }, actual: { ...verification.actual } } } : {}),
        confirm, warning,
        expiresAt: new Date(expires).toISOString() };
      plans.set(id, { ...value, ...(imageReview ? { image: { ...imageReview } } : {}),
        ...(verification ? { verification: { status: verification.status, expected: { ...verification.expected }, actual: { ...verification.actual } } } : {}),
        expires, identity: found.internal, imageSource: image?.sourcePath, imageActual, directTimeoutMs });
      return { ...value, ...(imageReview ? { image: { ...imageReview } } : {}),
        ...(verification ? { verification: { status: verification.status, expected: { ...verification.expected }, actual: { ...verification.actual } } } : {}),
        drive: { ...value.drive, mounts: [...value.drive.mounts] } };
    },
    async execute({ planId, confirm, allowUnverified = false, browser } = {}) {
      if (typeof planId !== 'string' || !planId || typeof confirm !== 'string' || typeof allowUnverified !== 'boolean')
        throw fail(400, 'A USB plan, exact confirmation phrase, and optional boolean checksum override are required.');
      const normalizedBrowser = browser === undefined ? undefined : validateUsbBrowser(browser);
      if (browser !== undefined && !normalizedBrowser) throw fail(400, 'Browser diagnostics are invalid.');
      const hostEnvironment = await hostEnvironmentPromise;
      const plan = plans.get(planId);
      if (!plan || now() >= plan.expires) { plans.delete(planId); throw fail(409, 'The USB plan is missing or expired. Create a new plan.'); }
      if (writeBlocked) throw fail(409, 'A previous USB write timed out or has an unknown result. Restart the helper before another write.');
      if (job?.state === 'pending' || job?.state === 'running') throw fail(409, 'A USB operation is already in progress.');
      if (confirm !== plan.confirm) { plans.delete(planId); throw fail(400, `Confirmation must exactly match ${plan.confirm}.`); }
      if (plan.verification?.status === 'mismatch' && allowUnverified !== true)
        throw fail(409, 'This ISO does not match the publisher size or SHA-256. Explicitly allow the checksum mismatch to continue.', 'USB_UNVERIFIED');
      const reportEnvironment = validateUsbEnvironment({ ...(hostEnvironment ?? {}), ...(normalizedBrowser ?? {}) });
      const jobId = makeJobId();
      if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(jobId)) throw fail(503, 'Could not create the USB outcome report ID.');
      plans.delete(planId);
      const verification = plan.verification ? { ...plan.verification, accepted: plan.verification.status === 'mismatch' } : undefined;
      const deadlineAt = plan.method === 'direct' ? new Date(now() + plan.directTimeoutMs).toISOString() : undefined;
      job = { state: 'pending', jobId, log: [], drive: { id: plan.drive.id, path: plan.drive.path, model: plan.drive.model,
        size: plan.drive.size, mounted: plan.drive.mounted, mounts: [...plan.drive.mounts] }, method: plan.method,
        ...(reportEnvironment ? { reportEnvironment } : {}),
        ...(verification ? { verification } : {}), ...(deadlineAt ? { deadlineAt } : {}) };
      setImmediate(() => { void executePlan(plan); });
      return snapshotJob(job);
    },
    status() { return snapshotJob(job); },
  };
}
