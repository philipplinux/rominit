// ROMinit CLI spike: the website's fastboot flashes from a terminal. Logic stays in src/; this file is I/O only.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { connect as tcp } from 'node:net';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { loadCatalog } from '../scripts/load-catalog.mjs';
import { assertConsent, recipes, stepsFor } from '../src/catalog.js';
import { checksum } from '../src/hash.js';
import { validateUsbEnvironment } from '../src/usb-environment.js';
import { ephemeralAdbCredentials, installBrowserShims } from './node-env.mjs';
import { deleteBrowserSession, deleteCredential, loadBrowserSession, loadCredential, saveBrowserSession, saveCredential } from './credentials.mjs';
import { identifyCredential, siteOrigin, startHelper } from './helper.mjs';
import { createUsbMedia } from './usb-media.mjs';

/** Recipes supported by the CLI. */
const CLI_RECIPES = ['fastboot', 'twrp-dd'];

const USAGE = `rominit devices
rominit auth [--api-key] [--json]
rominit serve [--json]
rominit logout [--json]
rominit plan <codename> [rom-id]
rominit fetch <codename> <rom-id> [--dir DIR]
rominit run <codename> <rom-id> --stage N [--dir DIR] [--no-bench] [--host ADDR]
  (postmarketOS: after the reboot, waits for SSH over USB and runs the read-only phone benchmark)
rominit bench <codename> <rom-id> [--host ADDR] [--dir DIR]
  (no flash: runs the read-only benchmark over SSH on a phone already running that ROM, sends it to ROMinit)
All commands take --json (one JSON event per line: step|progress|error|done).
plan/fetch/run/bench read the catalog from the site (ROMINIT_URL); --local reads this checkout's catalog/ instead.`;

const BANNER = String.raw`
 ____   ___  __  __ _       _ _
|  _ \ / _ \|  \/  (_)_ __ (_) |_
| |_) | | | | |\/| | | '_ \| | __|
|  _ <| |_| | |  | | | | | | | |_
|_| \_\\___/|_|  |_|_|_| |_|_|\__|
`;

/** Pacman eating dots: "[-----C o  o  o ]". @param {number} fraction @param {number} [width] */
export function pacbar(fraction, width = 24) {
  const eaten = Math.min(width, Math.round(Math.max(0, fraction) * width));
  if (eaten >= width) return `[${'-'.repeat(width)}]`;
  const rest = Array.from({ length: width - eaten - 1 }, (_, i) => (eaten + 1 + i) % 3 ? ' ' : 'o').join('');
  return `[${'-'.repeat(eaten)}${eaten % 2 ? 'c' : 'C'}${rest}]`;
}

const size = (/** @type {number} */ b) => b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(1)} GiB` : b >= 2 ** 20 ? `${(b / 2 ** 20).toFixed(1)} MiB` : `${Math.ceil(b / 1024)} KiB`;
const clock = (/** @type {number} */ s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Output: text for people (a live pacman bar on a terminal's stderr, finished transfers on stdout), one JSON event per line with --json.
 * @param {boolean} json @param {{stdout:any, stderr?:any}} io */
export function reporter(json, io) {
  /** @type {Map<string, number>} */ const started = new Map();
  let last = '', live = false;
  const line = (/** @type {string} */ text, /** @type {number} */ fraction, /** @type {number=} */ total) => {
    const secs = (Date.now() - (started.get(text) ?? Date.now())) / 1000;
    const done = (total ?? 0) * fraction;
    const facts = total ? `${size(total).padStart(9)} ${secs > 0.5 ? `${size(done / secs)}/s`.padStart(11) : ' '.repeat(11)} ${clock(fraction > 0 && fraction < 1 ? secs * (1 / fraction - 1) : secs)}` : clock(secs).padStart(5);
    const name = text.length > 34 ? `${text.slice(0, 33)}…` : text.padEnd(34);
    return `${name} ${facts} ${pacbar(fraction)} ${String(Math.round(fraction * 100)).padStart(3)}%`;
  };
  const clear = () => { if (live) { io.stderr.write('\r\x1b[K'); live = false; } };
  const emit = (/** @type {string} */ type, /** @type {string} */ text, /** @type {number=} */ fraction, /** @type {any=} */ data) => {
    if (json) { io.stdout.write(JSON.stringify({ type, text, ...(fraction === undefined ? {} : { fraction }), ...(data === undefined ? {} : { data }) }) + '\n'); return; }
    if (type === 'progress') {
      if (!started.has(text)) started.set(text, Date.now());
      if (fraction === 1) { clear(); io.stdout.write(`  ${line(text, 1, data?.total)}\n`); started.delete(text); last = ''; }
      else if (io.stderr?.isTTY) { io.stderr.write(`\r  ${line(text, /** @type {number} */ (fraction), data?.total)}`); live = true; }
      return;
    }
    clear();
    if (text === last) return; // a recipe reports a step's start and end with the same text
    last = text;
    io.stdout.write((type === 'error' ? `✗ ${text}` : type === 'done' ? `✓ ${text}` : text) + '\n');
  };
  return { emit, step: (/** @type {string} */ t) => emit('step', t), done: (/** @type {string} */ t, /** @type {any=} */ d) => emit('done', t, undefined, d),
    error: (/** @type {string} */ t) => emit('error', t),
    progress: (/** @type {string} */ t, /** @type {number} */ f, /** @type {number=} */ total) => emit('progress', t, f, total ? { total } : undefined),
    /** Run header: the logo, then what is about to happen. @param {string} title */
    header: (/** @type {string} */ title) => { if (!json) io.stdout.write(`${BANNER}  ${title}\n${'─'.repeat(Math.min(72, title.length + 4))}\n`); } };
}

/** @param {string[]} args */
function parse(args) {
  const flags = { json: false, dir: '', stage: 0, bench: true, local: false, apiKey: false };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') flags.json = true;
    else if (args[i] === '--api-key') flags.apiKey = true;
    else if (args[i] === '--dir') flags.dir = args[++i] ?? '';
    else if (args[i] === '--stage') flags.stage = Number(args[++i]);
    else if (args[i] === '--no-bench') flags.bench = false;
    else if (args[i] === '--local') flags.local = true;
    else if (args[i] === '--host') flags.host = args[++i] ?? '';
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
    ...(rom.external ? { external: rom.external } : {}),
    stages: (rom.stages ?? []).map((/** @type {any} */ s, /** @type {number} */ i) => ({ stage: i + 1, title: s.title, recipe: s.recipe, mode: s.mode, warning: s.warning, confirm: s.confirm,
      files: s.files.map((/** @type {any} */ f) => ({ name: f.name, size: f.size, sha256: f.sha256, url: f.url ?? null, source: f.source })), steps: stepsFor(s) })) };
}

/** Does this size+digest pin match the file on disk? The pin names the algorithm (sha256 preferred, sha512 fallback).
 * @param {string} path @param {{size:number,sha256?:string,sha512?:string}} pin */
async function matches(path, pin) {
  const info = await stat(path).catch(() => null);
  const algorithm = pin.sha512 && !pin.sha256 ? 'sha512' : 'sha256';
  return !!info && info.size === pin.size && await checksum(await openAsBlob(path), undefined, algorithm) === pin[algorithm];
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
    await res.body.pipeThrough(new TransformStream({ transform(chunk, c) { got += chunk.length; out.progress(pin.name, Math.min(0.99, got / pin.size), pin.size); c.enqueue(chunk); } }))
      .pipeTo(Writable.toWeb(createWriteStream(part)));
    if (!await matches(part, pin)) throw Error(`${pin.name}: size or SHA-256 mismatch after download; kept as ${part}.`);
    await rename(part, path);
    out.progress(pin.name, 1, pin.size);
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

/** Runs a step; when it fails and a human is at the terminal, says what failed and asks instead of exiting.
 * Without a terminal (agents, pipes) the error goes out as is, so the agent can ask its human.
 * @template T @param {string} what @param {()=>Promise<T>} action @param {{stdin:any, stderr:any}} io
 * @param {ReturnType<typeof reporter>} out @param {boolean} [skippable] @returns {Promise<T|undefined>} */
export async function recover(what, action, io, out, skippable = false, wait = { match: /$^/, ms: 0, every: 0 }) {
  for (let waitUntil = 0; ;) {
    try { return await action(); } catch (error) {
      // A phone that dropped off USB (bootloader busy, re-enumerating) usually comes back by itself: retry quietly first.
      if (wait.match.test(String(/** @type {any} */ (error)?.message ?? error))) {
        if (!waitUntil) { waitUntil = Date.now() + wait.ms; out.step(`${what}: ${/** @type {Error} */ (error).message}; waiting for the phone to come back (up to ${Math.round(wait.ms / 1000)} s)…`); }
        if (Date.now() < waitUntil) { await new Promise(ok => setTimeout(ok, wait.every)); continue; }
      }
      waitUntil = 0;
      if (!io.stdin.isTTY) throw error;
      out.error(`${what} stopped: ${/** @type {Error} */ (error).message}`);
      const choices = skippable ? '[r]etry, [s]kip or [a]bort' : '[r]etry or [a]bort';
      const rl = createInterface({ input: io.stdin, output: io.stderr });
      let answer = '';
      try { while (!/^[ra]$/.test(answer) && !(skippable && answer === 's')) answer = (await rl.question(`Fix it if you can (replug USB, put the phone back in the right mode), then ${choices}: `)).trim().toLowerCase()[0] ?? ''; }
      catch { throw error; } // terminal closed: nobody left to ask
      finally { rl.close(); }
      if (answer === 'a') throw error;
      if (answer === 's') return undefined;
      out.step(`Retrying: ${what}`);
    }
  }
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

/** Keep Node WebUSB's authorization picker on the phone already enumerated by the CLI. */
export function pinUsbRequestDevice(usb, device) {
  Object.defineProperty(usb, 'requestDevice', { configurable: true, value: async () => device });
  return usb;
}

/** Read native USB descriptor getters before ADB starts an asynchronous transfer. */
export function cacheUsbDescriptors(device) {
  for (const name of ['serialNumber', 'manufacturerName', 'productName', 'vendorId', 'productId']) {
    let value;
    try { value = device[name]; } catch { value = undefined; }
    Object.defineProperty(device, name, { configurable: true, enumerable: true, value });
  }
  return device;
}

/** Node-side USB: the CLI selects exactly one phone in the mode required by the recipe. */
let nodeWebUsb, selectedNodePhone;
async function nodeUsb(protocol) {
  installBrowserShims();
  if (!nodeWebUsb) {
    const { WebUSB } = await import('usb');
    nodeWebUsb = new WebUSB({ allowAllDevices: true, devicesFound: devices => {
      const matches = devices.filter(d => d.serialNumber === selectedNodePhone?.serialNumber && d.vendorId === selectedNodePhone?.vendorId && d.productId === selectedNodePhone?.productId);
      return matches.length === 1 ? matches[0] : undefined;
    } });
  }
  const mode = protocol === 'adb' ? 'adb' : 'fastboot';
  const phones = (await listPhones(nodeWebUsb)).filter(p => p.mode === mode);
  if (phones.length !== 1) throw Error(phones.length ? `More than one phone in ${mode} mode; unplug the others.` : `No phone in ${mode} mode found. If lsusb lists it, this user may lack USB access (udev rules, e.g. android-udev-rules).`);
  selectedNodePhone = phones[0].raw;
  const chosen = cacheUsbDescriptors(selectedNodePhone);
  pinUsbRequestDevice(nodeWebUsb, chosen);
  // On the prototype so reconnects get the same transfer timeout.
  const proto = Object.getPrototypeOf(chosen);
  if (!proto.rominitPatched) {
    // `usb` gives bulk transfers a 1 s timeout; a long flash or idle ADB shell can take longer, so allow 5 min.
    const { transferIn, transferOut } = proto;
    proto.transferIn = function (/** @type {number} */ ep, /** @type {number} */ length) { return transferIn.call(this, ep, length, 300_000); };
    proto.transferOut = function (/** @type {number} */ ep, /** @type {any} */ data) { return transferOut.call(this, ep, data, 300_000); };
    proto.rominitPatched = true;
  }
  if (mode === 'fastboot') {
    // android-fastboot resets on re-connect; on Linux that can wedge a download until the human re-enters fastboot.
    proto.reset = async () => {};
  }
  // android-fastboot listens for every USB hotplug; keep it on the chosen device only. ADB needs a real EventTarget.
  Object.defineProperty(globalThis.navigator, 'usb', { configurable: true, value: mode === 'adb' ? nodeWebUsb : {
    getDevices: async () => [chosen], requestDevice: async () => chosen, addEventListener: () => {} } });
}

/** USB errors from a phone that went away for a while (the Mi A3 bootloader drops off for ~10-60 s after a big write). */
export const USB_GONE = /cancel|timeout of|no phone in|libusb|disconnect|stall|NotFound|NetworkError|transfer error|getString|hardware fault|protocol violation/i;

const SITE = process.env.ROMINIT_URL ?? 'https://rominit.pages.dev';
const HELPER_PORT = 18787;
const USB_REPORT_API_KEY = /^rmi_[A-Za-z0-9_-]{43}$/;
const USB_REPORT_RETRY_DELAY = 250;
const PMOS_USB = '172.16.42.1'; // postmarketOS' fixed USB-network address, as on the site's test box
const portOpen = (/** @type {string} */ host, /** @type {number} */ port) => new Promise(ok => {
  const s = tcp({ host, port, timeout: 3000 }, () => { s.destroy(); ok(true); });
  s.on('error', () => ok(false)).on('timeout', () => { s.destroy(); ok(false); });
});

/** Password logins skip private-key auth so sshpass cannot answer an unrelated key-passphrase prompt. */
export function sshArgs(user, password, host) {
  return [...(password ? ['-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no'] : []),
    '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', '-o', 'ConnectTimeout=8', `${user}@${host}`, 'sh'];
}

/** Send one scrubbed USB outcome report with one idempotent retry for transient failures.
 * @param {string} site @param {string} credential @param {Record<string, any>} payload
 * @param {typeof fetch} [get] @param {number} [retryDelayMs] */
export async function sendUsbOutcome(site, credential, payload, get = fetch, retryDelayMs = USB_REPORT_RETRY_DELAY) {
  if (!USB_REPORT_API_KEY.test(credential) || typeof get !== 'function') throw Error('OS USB outcome report is unavailable.');
  const endpoint = `${siteOrigin(site)}/api/os-usb`;
  let reportPayload = payload;
  if (payload && Object.hasOwn(payload, 'environment')) {
    const { environment, ...safePayload } = payload;
    const normalized = validateUsbEnvironment(environment);
    reportPayload = normalized ? { ...safePayload, environment: normalized } : safePayload;
  }
  const body = JSON.stringify(reportPayload);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await get(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
        headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
        body,
      });
      if (response.status === 429 || response.status >= 500) throw Object.assign(Error('Temporary OS USB report failure.'), { retryable: true });
      if (!response.ok) throw Object.assign(Error('OS USB report was rejected.'), { retryable: false });
      const result = await response.json();
      if (result?.ok !== true || typeof result.duplicate !== 'boolean')
        throw Object.assign(Error('OS USB report response was invalid.'), { retryable: true });
      return result;
    } catch (error) {
      if (error?.retryable === false || attempt === 1) throw Error('OS USB outcome report failed.');
      if (retryDelayMs > 0) await new Promise(resolveDelay => setTimeout(resolveDelay, retryDelayMs));
    }
  }
  throw Error('OS USB outcome report failed.');
}

/** After a postmarketOS flash: wait for SSH over USB, run site/bench/linux.sh (read-only) on the phone, save and print its lines.
 * A fresh install has a fresh host key, so the key is not checked or kept for this USB-only address.
 * Then it is sent to ROMinit as a phone test (admin inbox 03 Benchmarks: 03b CLI run + bench, or 03c CLI bench only), unreviewed: the CLI only takes the script's own verdicts.
 * @param {any} rom @param {string} key codename/rom-id @param {string} dir @param {ReturnType<typeof reporter>} out
 * @param {{host?:string, waitMs?:number, get?:typeof fetch, settleMs?:number, flashed?:boolean}} [opts] flashed: false = bench only, not flashed by this CLI */
export async function bench(rom, key, dir, out, { host = PMOS_USB, waitMs = 600_000, get = fetch, settleMs = 45_000, flashed = true } = {}) {
  out.step(`Waiting for the phone to boot (SSH on ${host}, up to ${waitMs / 60_000} min)`);
  const [user, password] = (rom.login ?? 'user / ').split(' / ');
  const ssh = sshArgs(user, password, host);
  const pass = !!password && !spawnSync('sshpass', ['-V']).error; // without sshpass, ssh asks the human for the password
  const script = await readFile(new URL('../site/bench/linux.sh', import.meta.url));
  const started = Date.now();
  for (let tries = 1; ; tries += 1) {
    while (!await portOpen(host, 22)) {
      if (Date.now() - started > waitMs) throw Error(`Flash finished, but SSH on ${host} did not answer within ${waitMs / 60_000} min. Benchmark not run.`);
      await new Promise(r => setTimeout(r, 5000));
    }
    if (tries === 1) {
      // Drivers that need DSP firmware (battery gauge, sound card) come up after SSH does.
      out.step(`SSH is up after ${Math.round((Date.now() - started) / 1000)} s; letting the phone settle ${settleMs / 1000} s, then the benchmark (read-only)`);
      await new Promise(r => setTimeout(r, settleMs));
    }
    const child = spawn(pass ? 'sshpass' : 'ssh', pass ? ['-e', 'ssh', ...ssh] : ssh, { env: { ...process.env, SSHPASS: password }, stdio: ['pipe', 'pipe', 'inherit'] });
    const failed = new Promise((_, no) => child.on('error', no)); // e.g. ssh removed mid-run
    failed.catch(() => {});
    child.stdin.end(script);
    let text = '';
    for await (const chunk of child.stdout) text += chunk;
    const code = await Promise.race([new Promise(r => child.on('close', r)), failed]);
    if (/^@ script /m.test(text)) {
      const file = join(dir, `bench-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
      await mkdir(dir, { recursive: true });
      await writeFile(file, text);
      const lines = text.split('\n').filter(l => /^[a-z_]+ (full|partial|broken|blocked|untested|ask|inconclusive)\b/.test(l));
      out.step(`Benchmark: ${lines.length} features checked, output saved to ${file}\n${lines.map(l => '  ' + l).join('\n')}`);
      await submitBench(rom, key, text, lines, get, flashed);
      out.done(`Benchmark sent to ${SITE} (inbox 03 Benchmarks, waiting for review)`, { file, lines });
      return;
    }
    // sshd can accept connections a moment before logins work; retry a few times before giving up
    if (tries >= 5 || Date.now() - started > waitMs) throw Error(`Flash finished, but the benchmark over SSH failed (ssh exit ${code}).`);
    await new Promise(r => setTimeout(r, 10_000));
  }
}

/** The site's three bench calls: open a test code, upload the script output, send the card. Same mapping as the site's card:
 * "ask" becomes untested, features the catalog rates n/a stay n/a. @param {any} rom @param {string} key @param {string} output @param {string[]} lines @param {typeof fetch} get */
export async function submitBench(rom, key, output, lines, get = fetch, flashed = true) {
  const call = async (/** @type {string} */ path, /** @type {any} */ body) => {
    const res = await get(SITE + path, typeof body === 'string' ? { method: 'POST', body } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw Error(`Benchmark finished, but sending it failed: ${path} HTTP ${res.status} ${(await res.text()).trim().slice(0, 200)}`);
    return res;
  };
  const { code } = await (await call('/api/bench', { rom: key, via: 'cli' })).json();
  await call(`/b/${code}`, output);
  /** @type {Record<string, string>} */ const final = {};
  for (const line of lines) { const [f, tier] = line.split(' '); final[f] = rom.rating?.features?.[f] === 'n/a' ? 'n/a' : tier === 'ask' ? 'untested' : tier; }
  await call('/api/bench', { code, final, flash: flashed ? 'verified' : 'elsewhere',
    note: `Sent automatically by the rominit CLI${flashed ? ' right after flashing' : ' (bench only, flashed another way)'}; tiers are the script's own, no human corrected them.` });
  return code;
}

/** The device's published catalog entry (the file the page loads), or every device from this checkout's catalog/ with --local.
 * @param {string} codename @param {boolean} local @param {typeof fetch} get */
export async function loadDevices(codename, local, get = fetch) {
  if (local) {
    const { devices, errors } = await loadCatalog();
    if (errors.length) throw Error(`Catalog invalid: ${errors[0]}`);
    return devices;
  }
  const url = `${SITE}/catalog/${encodeURIComponent(codename)}.json`;
  const res = await get(url).catch((/** @type {Error} */ e) => { throw Error(`Cannot reach ${SITE} (${e.message}); --local reads this checkout's catalog/.`); });
  if (res.status === 404) throw Error(`Unknown device "${codename}".`);
  if (!res.ok) throw Error(`${url} answered ${res.status}.`);
  return [await res.json()];
}

async function promptApiKey(io) {
  const input = io.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function')
    throw Error('API key entry requires an interactive terminal; no key was read.');
  return new Promise((resolve, reject) => {
    const oldRaw = !!input.isRaw;
    let value = '';
    const cleanup = () => {
      input.removeListener('data', typed);
      try { input.setRawMode(oldRaw); } catch { /* The terminal may have closed. */ }
      input.pause();
      io.stderr.write('\n');
    };
    const finish = (error) => { cleanup(); error ? reject(error) : resolve(value.trim()); };
    const typed = chunk => {
      for (const byte of Buffer.from(chunk)) {
        if (byte === 3 || byte === 4) return finish(Error('API key entry cancelled.'));
        if (byte === 10 || byte === 13) return finish();
        if (byte === 8 || byte === 127) value = value.slice(0, -1);
        else if (byte >= 32 && byte <= 126) value += String.fromCharCode(byte);
      }
    };
    try {
      input.setRawMode(true);
      input.resume();
      input.on('data', typed);
      io.stderr.write('ROMinit API key (input hidden): ');
    } catch { finish(Error('Could not read an API key from this terminal.')); }
  });
}

function helperArgs(argv) {
  return argv.some(a => ['--dir', '--stage', '--no-bench', '--local', '--host'].includes(a));
}

async function runHelper(helper, out, account = null) {
  const name = account ? account.name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ') : null;
  const text = account
    ? `Local helper ready for ${name} on http://127.0.0.1:${helper.port}`
    : `Local helper awaiting account approval on http://127.0.0.1:${helper.port}\nPair with: ${helper.pairingUrl}`;
  out.emit('ready', text, undefined, { host: helper.host, port: helper.port, ...(account ? { name } : { pairingUrl: helper.pairingUrl }) });
  const stop = () => { void helper.close(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try { await helper.closed; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await helper.close(); }
}

/** @param {string[]} argv @param {{stdin:any, stdout:any, stderr:any}} io
 * @param {{session?:()=>Promise<any>, get?:typeof fetch, catalog?:{devices:any[]}, bench?:typeof bench, site?:string, startHelper?:typeof startHelper,
 * loadCredential?:typeof loadCredential, saveCredential?:typeof saveCredential, deleteCredential?:typeof deleteCredential,
 * loadBrowserSession?:typeof loadBrowserSession, saveBrowserSession?:typeof saveBrowserSession, deleteBrowserSession?:typeof deleteBrowserSession,
 * identifyCredential?:typeof identifyCredential, readApiKey?:(io:any)=>Promise<string>, createUsbMedia?:typeof createUsbMedia,
 * usbReportRetryDelayMs?:number, now?:()=>number}} [deps] test seams @returns {Promise<number>} exit code */
export async function main(argv, io, deps = {}) {
  let out = reporter(argv.includes('--json'), io);
  const mockedCredentialStore = ['loadCredential', 'saveCredential', 'deleteCredential', 'startHelper', 'createUsbMedia'].some(key => Object.hasOwn(deps, key));
  const loadSavedBrowserSession = deps.loadBrowserSession ?? (mockedCredentialStore ? async () => null : loadBrowserSession);
  const saveSavedBrowserSession = deps.saveBrowserSession ?? (mockedCredentialStore ? async () => {} : saveBrowserSession);
  const deleteSavedBrowserSession = deps.deleteBrowserSession ?? (mockedCredentialStore ? async () => {} : deleteBrowserSession);
  try {
    const { flags, rest } = parse(argv);
    const [cmd, codename, romId] = rest;
    const usbEnabled = ['auth', 'serve'].includes(cmd) && process.platform === 'linux';
    const usbSite = usbEnabled ? siteOrigin(deps.site ?? SITE) : undefined;
    let usbCredential = null;
    const usbMedia = usbEnabled ? (deps.createUsbMedia ?? createUsbMedia)({
      reportOutcome: payload => usbCredential
        ? sendUsbOutcome(usbSite ?? SITE, usbCredential, payload, deps.get ?? fetch, deps.usbReportRetryDelayMs ?? USB_REPORT_RETRY_DELAY)
        : Promise.reject(Error('No saved ROMinit API key is available for OS USB reporting.')),
    }) : undefined;
    if (cmd === 'auth') {
      if (rest.length !== 1 || helperArgs(argv)) throw Error('auth takes no device arguments or flash flags.');
      const site = siteOrigin(deps.site ?? SITE);
      if (flags.apiKey) {
        const key = await (deps.readApiKey ?? promptApiKey)(io);
        const account = await (deps.identifyCredential ?? identifyCredential)(site, key, deps.get, deps.now);
        await (deps.saveCredential ?? saveCredential)(site, key);
        usbCredential = key;
        const browserSession = await loadSavedBrowserSession(site, key, undefined, deps.now);
        const helper = await (deps.startHelper ?? startHelper)({ site, fetch: deps.get, now: deps.now, usbMedia, port: browserSession?.port ?? HELPER_PORT,
          browserSession, credential: key, identity: account,
          saveCredential: async saved => { await (deps.saveCredential ?? saveCredential)(site, saved); usbCredential = saved; },
          saveSession: (session, credential) => saveSavedBrowserSession(site, credential, session),
          deleteSession: () => deleteSavedBrowserSession(site),
          onCredentialError: () => out.error('Saved ROMinit API key was rejected or expired. Run "rominit auth".') });
        await runHelper(helper, out, account.user);
        return 0;
      }
      const helper = await (deps.startHelper ?? startHelper)({ site, fetch: deps.get, now: deps.now, usbMedia, port: HELPER_PORT,
        saveCredential: async key => { await (deps.saveCredential ?? saveCredential)(site, key); usbCredential = key; },
        saveSession: (session, credential) => saveSavedBrowserSession(site, credential, session),
        deleteSession: () => deleteSavedBrowserSession(site),
        onPair: user => {
          const name = user.name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
          out.emit('paired', `Authenticated as ${name}`, undefined, { name });
        },
        onCredentialError: () => out.error('Saved ROMinit API key was rejected or expired. Run "rominit auth".'),
        onStorageError: () => out.error('The OS credential store could not save the API key. Unlock it, then run "rominit auth" again.') });
      await runHelper(helper, out);
      return 0;
    }
    if (cmd === 'serve') {
      if (rest.length !== 1 || flags.apiKey || helperArgs(argv))
        throw Error('serve takes no device arguments or flash flags.');
      const site = siteOrigin(deps.site ?? SITE);
      const key = await (deps.loadCredential ?? loadCredential)(site);
      if (!key) throw Error('No saved ROMinit API key. Run "rominit auth" first.');
      usbCredential = key;
      let account;
      try { account = await (deps.identifyCredential ?? identifyCredential)(site, key, deps.get, deps.now); }
      catch (error) {
        if (error?.code === 'ROMINIT_AUTH_REJECTED') await deleteSavedBrowserSession(site);
        throw error;
      }
      const browserSession = await loadSavedBrowserSession(site, key, undefined, deps.now);
      const helper = await (deps.startHelper ?? startHelper)({ site, fetch: deps.get, now: deps.now, usbMedia, port: browserSession?.port ?? HELPER_PORT,
        browserSession, credential: key, identity: account,
        saveCredential: async saved => { await (deps.saveCredential ?? saveCredential)(site, saved); usbCredential = saved; },
        saveSession: (session, credential) => saveSavedBrowserSession(site, credential, session),
        deleteSession: () => deleteSavedBrowserSession(site),
        onCredentialError: () => out.error('Saved ROMinit API key was rejected or expired. Run "rominit auth".') });
      await runHelper(helper, out, account.user);
      return 0;
    }
    if (cmd === 'logout') {
      if (rest.length !== 1 || flags.apiKey || helperArgs(argv)) throw Error('logout takes no device arguments or other flags.');
      const site = siteOrigin(deps.site ?? SITE);
      await deleteSavedBrowserSession(site);
      await (deps.deleteCredential ?? deleteCredential)(site);
      out.done(`Saved ROMinit API key removed for ${site}. Close any running helper to clear its in-memory credential; this does not revoke the key.`);
      return 0;
    }
    if (cmd === 'devices') {
      const { WebUSB } = await import('usb');
      const phones = await listPhones(new WebUSB({ allowAllDevices: true }));
      out.done(phones.length ? phones.map(p => `${p.vendorId}:${p.productId} ${p.product} serial ${p.serial} [${p.mode}]`).join('\n') : 'No phone in fastboot or ADB mode found.',
        phones.map(({ raw, ...p }) => p));
      return 0;
    }
    if (!['plan', 'fetch', 'run', 'bench'].includes(cmd)) { io.stderr.write(USAGE + '\n'); return cmd ? 2 : 0; }
    if (!codename) throw Error('Missing <codename>.');
    const devices = deps.catalog?.devices ?? await loadDevices(codename, flags.local, deps.get);
    const { device, rom } = find(devices, codename, romId);
    if (cmd === 'plan' && !rom) {
      out.done(device.roms.map((/** @type {any} */ r) => `${r.id}  ${r.os} ${r.version}  ${r.status}  ${r.stages?.length ?? 0} stage(s)`).join('\n'), device.roms.map((/** @type {any} */ r) => r.id));
      return 0;
    }
    if (!rom) throw Error('Missing <rom-id>.');
    const dir = resolve(flags.dir || join('rominit-files', codename, rom.id));
    if (cmd === 'plan') {
      const plan = planOf(device, rom);
      out.done([`${plan.device} / ${plan.rom} ${plan.version} (${plan.status})`, ...(plan.external ? [`External ${plan.external.kind ?? 'installer'}: ${plan.external.url}`, plan.external.why, 'No automated ROMinit flash stages.'] : []), ...plan.stages.flatMap(s => [
        `Stage ${s.stage}: ${s.title} [${s.recipe}, ${s.mode}]`, `  warning: ${s.warning}`, `  confirm: ${s.confirm}`,
        ...s.files.map((/** @type {any} */ f) => `  file ${f.name}  ${f.size} bytes  sha256 ${f.sha256}  ${f.url ?? '(no direct url: ' + f.source + ')'}`),
        ...s.steps.map((/** @type {any[]} */ st) => `  step ${st.join(' ')}`)])].join('\n'), plan);
      return 0;
    }
    if (cmd === 'bench') {
      if (rom.os !== 'postmarketOS') throw Error(`The CLI benchmark runs the Linux script over SSH; ${rom.os} (Android, ADB) is not supported yet.`);
      if (spawnSync('ssh', ['-V']).error) throw Error('The benchmark needs ssh: install openssh.');
      out.header(`Benchmark · ${device.name} (${device.codename}) · ${rom.name} ${rom.version}`);
      await recover('Benchmark', () => (deps.bench ?? bench)(rom, `${device.codename}/${rom.id}`, dir, out, { host: flags.host || PMOS_USB, waitMs: 60_000, settleMs: 0, flashed: false }), io, out);
      return 0;
    }
    if (cmd === 'fetch' || cmd === 'run') out.header(`${cmd === 'fetch' ? 'Download' : `Flash stage ${flags.stage}`} · ${device.name} (${device.codename}) · ${rom.name} ${rom.version}`);
    if (cmd === 'fetch') {
      await recover('Download', () => fetchFiles(rom, dir, out, deps.get), io, out);
      out.done(`Files ready in ${dir}`);
      return 0;
    }
    // run
    const stage = rom.stages?.[flags.stage - 1];
    if (!stage) throw Error(`--stage N required (1-${rom.stages?.length ?? 0}).`);
    if (!CLI_RECIPES.includes(stage.recipe)) throw Error(`Recipe "${stage.recipe}" is not supported by the CLI yet (${CLI_RECIPES.join(', ')}).`);
    const recipe = /** @type {any} */ (recipes)[stage.recipe];
    if (stage.files.some((/** @type {any} */ f) => f.name.endsWith('.img.xz'))) throw Error('This stage decodes .img.xz through browser storage (OPFS); not supported by the CLI yet.');
    const files = [];
    for (const pin of stage.files) {
      const info = await stat(join(dir, pin.name)).catch(() => null);
      if (!info?.isFile() || info.size !== pin.size) throw Error(`${pin.name} missing or wrong size in ${dir}; run "rominit fetch" first.`);
      files.push({ ...pin, file: await openAsBlob(join(dir, pin.name)) });
    }
    const benchAfter = flags.bench && rom.os === 'postmarketOS' && stepsFor(stage).at(-1)?.[0] === 'reboot';
    // Tools the run needs on this computer, checked before anything is written. USB itself needs none (no adb/fastboot).
    if (benchAfter && spawnSync('ssh', ['-V']).error) throw Error('The benchmark after the flash needs ssh: install openssh, or pass --no-bench. Nothing written.');
    out.step(`WARNING: ${stage.warning}`);
    await confirmFromTty(stage, io); // before any USB access
    if (recipe.protocol === 'adb') out.step('ADB authentication key stays in memory for this CLI run; approve ROMinit on the phone if prompted.');
    // Each attempt reconnects (or keeps a session that is still claimed), re-checks, then resumes
    // at the failed step; repeating that step is safe (it rewrites a whole partition, erases, or sets a slot).
    const progress = { done: 0 };
    const credentialStore = recipe.protocol === 'adb' ? ephemeralAdbCredentials() : undefined;
    /** @type {any} */ let session;
    await recover(`Stage ${flags.stage}`, async () => {
      if (deps.session) session = await deps.session();
      else if (!session?.isConnected) {
        await nodeUsb(recipe.protocol);
        const { connect } = await import('../src/protocols/usb.js');
        session = (await connect(recipe.protocol, t => out.step(t), credentialStore)).session;
      }
      await recipe.run(session, { device, stage, files, steps: stepsFor(stage), progress },
        (/** @type {string} */ text, /** @type {number} */ fraction) => (fraction > 0 && fraction < 1 ? out.progress(text, fraction) : out.step(text)), () => {});
    }, io, out, false, { match: USB_GONE, ms: 120_000, every: 15_000 });
    out.done(stage.done ?? 'Stage finished.');
    if (benchAfter)
      await recover('Benchmark', () => (deps.bench ?? bench)(rom, `${device.codename}/${rom.id}`, dir, out, { host: flags.host || PMOS_USB }), io, out, true);
    return 0;
  } catch (error) {
    out.error(/** @type {Error} */ (error).message);
    return 1;
  }
}
