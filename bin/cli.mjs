// ROMinit CLI spike: the website's fastboot flashes from a terminal. Logic stays in src/; this file is I/O only.
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { loadCatalog } from '../scripts/load-catalog.mjs';
import { assertConsent, recipes, stepsFor } from '../src/catalog.js';
import { checksum } from '../src/hash.js';

const USAGE = `rominit devices
rominit plan <codename> [rom-id]
rominit fetch <codename> <rom-id> [--dir DIR]
rominit run <codename> <rom-id> --stage N [--dir DIR]
All commands take --json (one JSON event per line: step|progress|error|done).`;

/** Output: text for people, one JSON event per line with --json. @param {boolean} json @param {{stdout:any}} io */
export function reporter(json, io) {
  const emit = (/** @type {string} */ type, /** @type {string} */ text, /** @type {number=} */ fraction, /** @type {any=} */ data) => {
    if (json) io.stdout.write(JSON.stringify({ type, text, ...(fraction === undefined ? {} : { fraction }), ...(data === undefined ? {} : { data }) }) + '\n');
    else if (type !== 'progress') io.stdout.write(text + '\n');
    else if (fraction === 1) io.stdout.write(`  ${text}\n`); // humans get a line per finished transfer, not a stream
  };
  return { emit, step: (/** @type {string} */ t) => emit('step', t), done: (/** @type {string} */ t, /** @type {any=} */ d) => emit('done', t, undefined, d),
    error: (/** @type {string} */ t) => emit('error', t), progress: (/** @type {string} */ t, /** @type {number} */ f) => emit('progress', t, f) };
}

/** @param {string[]} args */
function parse(args) {
  const flags = { json: false, dir: '', stage: 0 };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') flags.json = true;
    else if (args[i] === '--dir') flags.dir = args[++i] ?? '';
    else if (args[i] === '--stage') flags.stage = Number(args[++i]);
    else if (args[i].startsWith('--')) throw Error(`Unknown flag ${args[i]}.`);
    else rest.push(args[i]);
  }
  return { flags, rest };
}

/** @param {any[]} devices @param {string} codename @param {string|undefined} romId */
function find(devices, codename, romId) {
  const device = devices.find(d => d.codename === codename);
  if (!device) throw Error(`Unknown device "${codename}".`);
  if (romId === undefined) return { device, rom: undefined };
  const rom = device.roms.find((/** @type {any} */ r) => r.id === romId);
  if (!rom) throw Error(`${codename} has no ROM "${romId}" (have: ${device.roms.map((/** @type {any} */ r) => r.id).join(', ')}).`);
  return { device, rom };
}

/** Plan: the ROM's stages, files and steps from the catalog. @param {any} device @param {any} rom */
export function planOf(device, rom) {
  return { device: device.codename, rom: rom.id, version: rom.version, status: rom.status,
    stages: (rom.stages ?? []).map((/** @type {any} */ s, /** @type {number} */ i) => ({ stage: i + 1, title: s.title, recipe: s.recipe, mode: s.mode, warning: s.warning, confirm: s.confirm,
      files: s.files.map((/** @type {any} */ f) => ({ name: f.name, size: f.size, sha256: f.sha256, url: f.url ?? null, source: f.source })), steps: stepsFor(s) })) };
}

/** Does this size+SHA-256 pin match the file on disk? @param {string} path @param {{size:number,sha256:string}} pin */
async function matches(path, pin) {
  const info = await stat(path).catch(() => null);
  return !!info && info.size === pin.size && await checksum(await openAsBlob(path)) === pin.sha256;
}

/** Download every pinned file that has a direct url; skip present+matching ones. Fails closed on size/hash mismatch.
 * @param {any} rom @param {string} dir @param {ReturnType<typeof reporter>} out @param {typeof fetch} [get] */
export async function fetchFiles(rom, dir, out, get = fetch) {
  await mkdir(dir, { recursive: true });
  for (const stage of rom.stages ?? []) for (const pin of stage.files) {
    const path = join(dir, pin.name);
    if (await matches(path, pin)) { out.step(`${pin.name}: already present, SHA-256 ok`); continue; }
    if (!pin.url) { out.step(`${pin.name}: no direct url; download it by hand from ${pin.source} into ${dir}`); continue; }
    out.step(`${pin.name}: downloading ${pin.url}`);
    const res = await get(pin.url);
    if (!res.ok || !res.body) throw Error(`${pin.name}: HTTP ${res.status}`);
    let got = 0;
    const part = `${path}.part`;
    await res.body.pipeThrough(new TransformStream({ transform(chunk, c) { got += chunk.length; out.progress(pin.name, Math.min(0.99, got / pin.size)); c.enqueue(chunk); } }))
      .pipeTo(Writable.toWeb(createWriteStream(part)));
    if (!await matches(part, pin)) throw Error(`${pin.name}: size or SHA-256 mismatch after download; kept as ${part}.`);
    await rename(part, path);
    out.progress(pin.name, 1);
  }
}

/** The confirm phrase comes from a human at a terminal: never from argv, env or a pipe.
 * @param {any} stage @param {{stdin:any, stderr:any}} io */
export async function confirmFromTty(stage, io) {
  if (!io.stdin.isTTY) throw Error('Refusing to run: stdin is not a terminal. The confirm phrase must be typed by a human.');
  const rl = createInterface({ input: io.stdin, output: io.stderr });
  try {
    const typed = await rl.question(`Type ${stage.confirm} to continue: `);
    assertConsent(stage, { consent: true, confirmation: typed.trim() });
  } finally { rl.close(); }
}

/** USB devices with a fastboot (ff/42/03) or ADB (ff/42/01) interface. Reads descriptors only; never writes.
 * @param {any} usb WebUSB-like */
export async function listPhones(usb) {
  const hex = (/** @type {number} */ n) => n.toString(16).padStart(4, '0');
  const phones = [];
  for (const raw of await usb.getDevices()) {
    try {
      for (const alt of raw.configurations.flatMap((/** @type {any} */ c) => c.interfaces.flatMap((/** @type {any} */ i) => i.alternates))) {
        if (alt.interfaceClass === 0xff && alt.interfaceSubclass === 0x42 && [1, 3].includes(alt.interfaceProtocol)) {
          phones.push({ vendorId: hex(raw.vendorId), productId: hex(raw.productId), product: raw.productName ?? '?', serial: raw.serialNumber ?? '?', mode: alt.interfaceProtocol === 3 ? 'fastboot' : 'adb', raw });
          break;
        }
      }
    } catch { /* not readable by this user, so not a phone we may touch */ }
  }
  return phones;
}

/** Node-side USB: WebUSB from the `usb` package. android-fastboot's connect() asks navigator.usb,
 * so point that at the one fastboot phone (getDevices() would otherwise list every USB device). */
async function nodeUsb() {
  const { WebUSB } = await import('usb');
  const webusb = new WebUSB({ allowAllDevices: true });
  const fast = (await listPhones(webusb)).filter(p => p.mode === 'fastboot');
  if (fast.length !== 1) throw Error(fast.length ? 'More than one phone in fastboot mode; unplug the others.' : 'No phone in fastboot mode found.');
  const chosen = fast[0].raw;
  Object.defineProperty(globalThis.navigator, 'usb', { configurable: true, value: {
    getDevices: async () => [chosen], requestDevice: async () => chosen,
    addEventListener: (/** @type {any[]} */ ...a) => /** @type {any} */ (webusb).addEventListener(...a) } });
}

/** @param {string[]} argv @param {{stdin:any, stdout:any, stderr:any}} io
 * @param {{session?:()=>Promise<any>, get?:typeof fetch, catalog?:{devices:any[]}}} [deps] test seams @returns {Promise<number>} exit code */
export async function main(argv, io, deps = {}) {
  let out = reporter(argv.includes('--json'), io);
  try {
    const { flags, rest: [cmd, codename, romId] } = parse(argv);
    if (cmd === 'devices') {
      const { WebUSB } = await import('usb');
      const phones = await listPhones(new WebUSB({ allowAllDevices: true }));
      out.done(phones.length ? phones.map(p => `${p.vendorId}:${p.productId} ${p.product} serial ${p.serial} [${p.mode}]`).join('\n') : 'No phone in fastboot or ADB mode found.',
        phones.map(({ raw, ...p }) => p));
      return 0;
    }
    if (!['plan', 'fetch', 'run'].includes(cmd)) { io.stderr.write(USAGE + '\n'); return cmd ? 2 : 0; }
    const { devices, errors } = deps.catalog ? { ...deps.catalog, errors: [] } : await loadCatalog();
    if (errors.length) throw Error(`Catalog invalid: ${errors[0]}`);
    if (!codename) throw Error('Missing <codename>.');
    const { device, rom } = find(devices, codename, romId);
    if (cmd === 'plan' && !rom) {
      out.done(device.roms.map((/** @type {any} */ r) => `${r.id}  ${r.os} ${r.version}  ${r.status}  ${r.stages?.length ?? 0} stage(s)`).join('\n'), device.roms.map((/** @type {any} */ r) => r.id));
      return 0;
    }
    if (!rom) throw Error('Missing <rom-id>.');
    const dir = resolve(flags.dir || join('rominit-files', codename, rom.id));
    if (cmd === 'plan') {
      const plan = planOf(device, rom);
      out.done([`${plan.device} / ${plan.rom} ${plan.version} (${plan.status})`, ...plan.stages.flatMap(s => [
        `Stage ${s.stage}: ${s.title} [${s.recipe}, ${s.mode}]`, `  warning: ${s.warning}`, `  confirm: ${s.confirm}`,
        ...s.files.map((/** @type {any} */ f) => `  file ${f.name}  ${f.size} bytes  sha256 ${f.sha256}  ${f.url ?? '(no direct url: ' + f.source + ')'}`),
        ...s.steps.map((/** @type {any[]} */ st) => `  step ${st.join(' ')}`)])].join('\n'), plan);
      return 0;
    }
    if (cmd === 'fetch') {
      await fetchFiles(rom, dir, out, deps.get);
      out.done(`Files ready in ${dir}`);
      return 0;
    }
    // run
    const stage = rom.stages?.[flags.stage - 1];
    if (!stage) throw Error(`--stage N required (1-${rom.stages?.length ?? 0}).`);
    if (stage.recipe !== 'fastboot') throw Error(`Recipe "${stage.recipe}" is not supported by the CLI yet (only fastboot).`);
    if (stage.files.some((/** @type {any} */ f) => f.name.endsWith('.img.xz'))) throw Error('This stage decodes .img.xz through browser storage (OPFS); not supported by the CLI yet.');
    const files = [];
    for (const pin of stage.files) {
      const info = await stat(join(dir, pin.name)).catch(() => null);
      if (!info?.isFile() || info.size !== pin.size) throw Error(`${pin.name} missing or wrong size in ${dir}; run "rominit fetch" first.`);
      files.push({ ...pin, file: await openAsBlob(join(dir, pin.name)) });
    }
    out.step(`WARNING: ${stage.warning}`);
    await confirmFromTty(stage, io); // before any USB access
    let session;
    if (deps.session) session = await deps.session();
    else {
      await nodeUsb();
      const { connect } = await import('../src/protocols/usb.js');
      session = (await connect('fastboot', t => out.step(t))).session;
    }
    await recipes.fastboot.run(session, { device, files, steps: stepsFor(stage) },
      (text, fraction) => (fraction > 0 && fraction < 1 ? out.progress(text, fraction) : out.step(text)), () => {});
    out.done(stage.done ?? 'Stage finished.');
    return 0;
  } catch (error) {
    out.error(/** @type {Error} */ (error).message);
    return 1;
  }
}
