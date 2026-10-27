// Linux side of native USB media: lsblk inventory, /dev/disk/by-id names and the privileged direct writer.
import { errorText, fail } from './usb-media.mjs';

export const MIN_BYTES = 128 * 1024 * 1024;
const LSBLK_TIMEOUT = 10_000;
export const BIN = { lsblk: '/usr/bin/lsblk', sudo: '/usr/bin/sudo', sh: '/usr/bin/sh', python: '/usr/bin/python3', udisksctl: '/usr/bin/udisksctl' };
const LSBLK_FIELDS = 'NAME,PATH,TYPE,RM,RO,SIZE,MODEL,TRAN,MAJ:MIN,FSTYPE,LABEL,MOUNTPOINTS,PKNAME';

// Run by `sudo -n python3 -c`; args: source, by-id, size, sha256, major, minor, capacity, packing (gz|bz2|xz|empty).
export const DIRECT_WRITER = String.raw`
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

export function field(node, name) {
  return node?.[name.toLowerCase()] ?? node?.[name];
}

export function devicePath(node) {
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

export function mountpoints(node) {
  const values = field(node, 'MOUNTPOINTS');
  const list = Array.isArray(values) ? values : [values ?? field(node, 'MOUNTPOINT')];
  return [...new Set(list.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

export function under(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

export function isUserMount(path, roots = ['/run/media', '/media']) {
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

/** Removable USB disks and SD cards from lsblk, with by-id names, swap and mount checks. */
export async function inventory({ command, listDir, resolvePath, readText, byIdDir, mediaMountRoots }) {
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
