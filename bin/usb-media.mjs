import { createHash, randomBytes } from 'node:crypto';
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { copyFile, lstat, open, readFile, readdir, realpath, stat, statfs } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve as resolveFilePath } from 'node:path';
import { promisify } from 'node:util';
import { run as runVentoy } from '../src/recipes/ventoy.js';

const execFile = promisify(nodeExecFile);
const PLAN_MS = 5 * 60_000;
const MIN_BYTES = 128 * 1024 * 1024;
// shortcut: reserve 64 MiB for Ventoy metadata, adequate for this installer; actual free space is checked before copy.
const VENTOY_OVERHEAD = 64 * 1024 * 1024;
const LSBLK_TIMEOUT = 10_000;
const COMMAND_TIMEOUT = 30_000;
const INSTALL_TIMEOUT = 15 * 60_000;
const LOG_LINES = 100;
const LOG_BYTES = 16 * 1024;
const LOG_LINE_BYTES = 512;
const MAX_PLANS = 64;
const BIN = { lsblk: '/usr/bin/lsblk', sudo: '/usr/bin/sudo', sh: '/usr/bin/sh', udisksctl: '/usr/bin/udisksctl' };
const LSBLK_FIELDS = 'NAME,PATH,TYPE,RM,RO,SIZE,MODEL,TRAN,MAJ:MIN,FSTYPE,LABEL,MOUNTPOINTS,PKNAME';

function fail(status, message) {
  const error = Error(message);
  error.status = status;
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
  else if (!flag(field(root, 'RM')) || String(field(root, 'TRAN') ?? '').toLowerCase() !== 'usb') reason = 'This is not a removable USB disk.';
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
  return { ...job, log: [...job.log], drive: { ...job.drive, mounts: [...job.drive.mounts] } };
}

/** Native Linux USB-media access. `runCommand` and `spawnProcess` are injection seams for tests. */
export function createUsbMedia({ ventoyDir = process.env.ROMINIT_VENTOY_DIR, ventoyVersion = process.env.ROMINIT_VENTOY_VERSION,
  imagePath = process.env.ROMINIT_ISO_PATH, imageSha256 = process.env.ROMINIT_ISO_SHA256, byIdDir = '/dev/disk/by-id',
  runCommand = (file, args, options) => execFile(file, args, options), spawnProcess = nodeSpawn,
  readText = readFile, listDir = readdir, resolvePath = realpath, fileStat = stat, fileStatFs = statfs,
  trustStat = lstat, installerOwnerUid = 0,
  mediaMountRoots = ['/run/media', '/media'], installTimeout = INSTALL_TIMEOUT,
  now = Date.now, makeId = () => randomBytes(32).toString('base64url') } = {}) {
  const plans = new Map();
  let job = null;
  let writeBlocked = false;

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
    await Promise.all(names.filter(name => name.startsWith('usb-')).map(async name => {
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
      flag(field(root, 'RM')) && String(field(root, 'TRAN') ?? '').toLowerCase() === 'usb')
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
    if (actual.size !== info.size || actual.sha256 !== sha256) throw fail(503, 'The pinned local ISO size or SHA-256 does not match its file.');
    return { sourcePath, name, size: info.size, sha256 };
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

  function ventoyLayout(found) {
    const partitions = found.internal.nodes.filter(node => String(field(node, 'TYPE') ?? '').toLowerCase() === 'part');
    const data = partitions.filter(node => String(field(node, 'LABEL') ?? '') === 'Ventoy');
    const efi = partitions.filter(node => String(field(node, 'LABEL') ?? '') === 'VTOYEFI');
    if (data.length !== 1 || !field(data[0], 'FSTYPE') || efi.length !== 1 || !field(efi[0], 'FSTYPE'))
      throw fail(500, 'Ventoy installer finished, but its Ventoy and VTOYEFI filesystems were not verified.');
    return { data: data[0], efi: efi[0] };
  }

  async function copyImage(plan) {
    const image = await localImage();
    if (!image || image.sourcePath !== plan.imageSource || image.name !== plan.image.name || image.size !== plan.image.size || image.sha256 !== plan.image.sha256)
      throw fail(409, 'The pinned ISO changed after review. Create a new plan.');
    let found = (await inventory()).find(value => value.public.id === plan.drive.id);
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
      append(job, `Copying ${image.name} (${image.size} bytes).`);
      try { await copyFile(image.sourcePath, destination, fsConstants.COPYFILE_EXCL); }
      catch (error) {
        throw fail(error?.code === 'EEXIST' ? 409 : 500,
          error?.code === 'EEXIST' ? `${image.name} already exists on the Ventoy USB.` : `Could not copy ${image.name}: ${errorText(error)}`);
      }
      const file = await open(destination, 'r+');
      try { await file.sync(); } finally { await file.close(); }
      await directory.sync();
      const copied = await sha256File(destination);
      if (copied.size !== image.size || copied.sha256 !== image.sha256) throw fail(500, 'The copied ISO size or SHA-256 does not match the pinned image.');
      const checked = (await inventory()).find(value => value.public.id === plan.drive.id);
      if (!checked || !sameIdentity(checked.internal, plan.identity)) throw fail(409, 'The USB disk changed during the ISO copy.');
      const finalLayout = ventoyLayout(checked);
      if (!mountpoints(finalLayout.data).includes(mountpoint)) throw fail(409, 'The Ventoy USB mount changed during the ISO copy.');
      append(job, `Verified ${image.name} SHA-256 ${image.sha256}.`);
    } finally { await directory.close(); }
  }

  async function runInstaller(target, path, jobState) {
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

  async function executePlan(plan) {
    job.state = 'running';
    try {
      const target = await ventoy();
      await currentFor(plan, plan.identity.mounted);
      if (plan.image) {
        const image = await localImage();
        if (!image || image.sourcePath !== plan.imageSource || image.name !== plan.image.name || image.size !== plan.image.size || image.sha256 !== plan.image.sha256)
          throw fail(409, 'The pinned ISO changed after review. Create a new plan.');
        if (plan.drive.mounts.some(path => under(image.sourcePath, path)))
          throw fail(409, 'The pinned ISO is stored on the USB disk being erased.');
      }
      try { await command(BIN.sudo, ['-n', '/usr/bin/true']); }
      catch { throw fail(503, 'Noninteractive sudo is unavailable for this user.'); }

      await runVentoy({
        assertPlanned: async () => { await currentFor(plan, plan.identity.mounted); },
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
        assertUnmounted: async () => { await currentFor(plan, []); },
        install: async () => {
          const current = await currentFor(plan, []);
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
      job.state = 'succeeded';
    } catch (error) {
      job.state = 'failed';
      job.error = safeText(error?.message || error, 1000) || 'USB operation failed.';
      append(job, job.error);
    }
  }

  return {
    async listDrives() {
      return (await inventory()).map(value => ({ ...value.public, mounts: [...value.public.mounts] }));
    },
    async plan({ driveId, method } = {}) {
      if (typeof driveId !== 'string' || !driveId || method !== 'ventoy')
        throw fail(400, method === 'direct' ? 'Direct USB writing is not implemented.' : 'A USB drive ID and method "ventoy" are required.');
      await ventoy();
      const found = (await inventory()).find(value => value.public.id === driveId);
      if (!found || !found.public.available) throw fail(409, found?.public.reason ?? 'The USB disk is no longer available.');
      const image = await localImage();
      if (image && found.public.mounts.some(path => under(image.sourcePath, path)))
        throw fail(409, 'The pinned ISO is stored on the USB disk being erased.');
      if (image && image.size + VENTOY_OVERHEAD > found.public.size)
        throw fail(409, 'The pinned ISO does not fit on this USB disk with Ventoy partition space reserved.');
      prunePlans();
      const id = makeId();
      const expires = now() + PLAN_MS;
      const imageReview = image ? { name: image.name, size: image.size, sha256: image.sha256 } : undefined;
      const value = { id, drive: found.public, method, ...(imageReview ? { image: imageReview } : {}), confirm: `ERASE ${found.public.path}`,
        warning: `Installing Ventoy erases all data on ${found.public.path}${image ? `, then copies ${image.name}` : ''}. Boot has not been tested.`,
        expiresAt: new Date(expires).toISOString() };
      plans.set(id, { ...value, expires, identity: found.internal, imageSource: image?.sourcePath });
      return { ...value, drive: { ...value.drive, mounts: [...value.drive.mounts] } };
    },
    async execute({ planId, confirm } = {}) {
      if (typeof planId !== 'string' || !planId || typeof confirm !== 'string') throw fail(400, 'A USB plan and exact confirmation phrase are required.');
      const plan = plans.get(planId);
      if (!plan || now() >= plan.expires) { plans.delete(planId); throw fail(409, 'The USB plan is missing or expired. Create a new plan.'); }
      if (writeBlocked) throw fail(409, 'A previous Ventoy write timed out or has an unknown result. Restart the helper before another write.');
      if (job?.state === 'pending' || job?.state === 'running') throw fail(409, 'A USB operation is already in progress.');
      plans.delete(planId);
      if (confirm !== plan.confirm) throw fail(400, `Confirmation must exactly match ${plan.confirm}.`);
      job = { state: 'pending', log: [], drive: { id: plan.drive.id, path: plan.drive.path, model: plan.drive.model,
        size: plan.drive.size, mounted: plan.drive.mounted, mounts: [...plan.drive.mounts] }, method: plan.method };
      setImmediate(() => { void executePlan(plan); });
      return snapshotJob(job);
    },
    status() { return snapshotJob(job); },
  };
}
