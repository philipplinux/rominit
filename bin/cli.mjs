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
import { deleteCredential, loadCredential, saveCredential } from './credentials.mjs';
import { identifyCredential, siteOrigin, startHelper } from './helper.mjs';
import { createUsbMedia } from './usb-media.mjs';
import { installBrowserShims } from './node-env.mjs';

/** Recipes the CLI has run on a real phone. Another one joins once its protocol library works under Node (see node-env.mjs). */
const CLI_RECIPES = ['fastboot'];

const USAGE = `rominit devices
rominit auth [--api-key] [--json]
rominit serve [--json]
rominit logout [--json]
rominit plan <codename> [rom-id]
rominit fetch <codename> <rom-id> [--dir DIR]
rominit run <codename> <rom-id> --stage N [--dir DIR] [--no-bench]
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

/** Node-side USB: WebUSB from the `usb` package. android-fastboot's connect() asks navigator.usb,
 * so point that at the one fastboot phone (getDevices() would otherwise list every USB device). */
async function nodeUsb() {
  installBrowserShims();
  const { WebUSB } = await import('usb');
  const webusb = new WebUSB({ allowAllDevices: true });
  const fast = (await listPhones(webusb)).filter(p => p.mode === 'fastboot');
  if (fast.length !== 1) throw Error(fast.length ? 'More than one phone in fastboot mode; unplug the others.' : 'No phone in fastboot mode found. If lsusb lists it, this user may lack USB access (udev rules, e.g. android-udev-rules).');
  const chosen = fast[0].raw;
  // On the prototype so a device android-fastboot re-claims after a replug gets the same treatment.
  const proto = Object.getPrototypeOf(chosen);
  if (!proto.rominitPatched) {
    // `usb` gives every bulk transfer a 1 s timeout (0 = none at all) and reports it as "Cancelled"; browser WebUSB waits
    // forever. The Mi A3 takes far longer than 1 s to answer flash:userdata, so allow 5 min.
    const { transferIn, transferOut } = proto;
    proto.transferIn = function (/** @type {number} */ ep, /** @type {number} */ length) { return transferIn.call(this, ep, length, 300_000); };
    proto.transferOut = function (/** @type {number} */ ep, /** @type {any} */ data) { return transferOut.call(this, ep, data, 300_000); };
    // android-fastboot resets on every (re)connect "to fix some platforms". Linux doesn't need it, and a reset while the
    // bootloader still waits for the rest of a download wedges it (no descriptors until the human re-enters fastboot).
    proto.reset = async () => {};
    proto.rominitPatched = true;
  }
  // No hotplug events: android-fastboot's connect listener claims whatever attaches next and throws outside any caller
  // (it killed the CLI when the booted phone's USB network appeared). recover() reconnects through here instead.
  Object.defineProperty(globalThis.navigator, 'usb', { configurable: true, value: {
    getDevices: async () => [chosen], requestDevice: async () => chosen, addEventListener: () => {} } });
}

/** USB errors from a phone that went away for a while (the Mi A3 bootloader drops off for ~10-60 s after a big write). */
export const USB_GONE = /cancel|timeout of|no phone in|libusb|disconnect|stall|NotFound|NetworkError|transfer error|getString|hardware fault|protocol violation/i;

const SITE = process.env.ROMINIT_URL ?? 'https://rominit.pages.dev';
const PMOS_USB = '172.16.42.1'; // postmarketOS' fixed USB-network address, as on the site's test box
const portOpen = (/** @type {string} */ host, /** @type {number} */ port) => new Promise(ok => {
  const s = tcp({ host, port, timeout: 3000 }, () => { s.destroy(); ok(true); });
  s.on('error', () => ok(false)).on('timeout', () => { s.destroy(); ok(false); });
});

/** After a postmarketOS flash: wait for SSH over USB, run site/bench/linux.sh (read-only) on the phone, save and print its lines.
 * A fresh install has a fresh host key, so the key is not checked or kept for this USB-only address.
 * Then it is sent to ROMinit as a phone test (admin inbox 03 Benchmarks: 03b CLI run + bench, or 03c CLI bench only), unreviewed: the CLI only takes the script's own verdicts.
 * @param {any} rom @param {string} key codename/rom-id @param {string} dir @param {ReturnType<typeof reporter>} out
 * @param {{host?:string, waitMs?:number, get?:typeof fetch, settleMs?:number, flashed?:boolean}} [opts] flashed: false = bench only, not flashed by this CLI */
export async function bench(rom, key, dir, out, { host = PMOS_USB, waitMs = 600_000, get = fetch, settleMs = 45_000, flashed = true } = {}) {
  out.step(`Waiting for the phone to boot (SSH on ${host}, up to ${waitMs / 60_000} min)`);
  const [user, password] = (rom.login ?? 'user / ').split(' / ');
  const ssh = ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', '-o', 'ConnectTimeout=8', `${user}@${host}`, 'sh'];
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
    ? `Local helper ready for ${name} on http://127.0.0.1:${helper.port}\nPair with: ${helper.pairingUrl}`
    : `Local helper awaiting account approval on http://127.0.0.1:${helper.port}\nPair with: ${helper.pairingUrl}`;
  out.emit('ready', text, undefined, { host: helper.host, port: helper.port, pairingUrl: helper.pairingUrl, ...(account ? { name } : {}) });
  const stop = () => { void helper.close(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try { await helper.closed; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await helper.close(); }
}

/** @param {string[]} argv @param {{stdin:any, stdout:any, stderr:any}} io
 * @param {{session?:()=>Promise<any>, get?:typeof fetch, catalog?:{devices:any[]}, bench?:typeof bench, site?:string, startHelper?:typeof startHelper,
 * loadCredential?:typeof loadCredential, saveCredential?:typeof saveCredential, deleteCredential?:typeof deleteCredential,
 * identifyCredential?:typeof identifyCredential, readApiKey?:(io:any)=>Promise<string>, now?:()=>number}} [deps] test seams @returns {Promise<number>} exit code */
export async function main(argv, io, deps = {}) {
  let out = reporter(argv.includes('--json'), io);
  try {
    const { flags, rest } = parse(argv);
    const [cmd, codename, romId] = rest;
    const usbMedia = ['auth', 'serve'].includes(cmd) && process.env.ROMINIT_VENTOY_DIR ? createUsbMedia() : undefined;
    if (cmd === 'auth') {
      if (rest.length !== 1 || helperArgs(argv)) throw Error('auth takes no device arguments or flash flags.');
      const site = siteOrigin(deps.site ?? SITE);
      if (flags.apiKey) {
        const key = await (deps.readApiKey ?? promptApiKey)(io);
        const account = await (deps.identifyCredential ?? identifyCredential)(site, key, deps.get, deps.now);
        await (deps.saveCredential ?? saveCredential)(site, key);
        const helper = await (deps.startHelper ?? startHelper)({ site, fetch: deps.get, now: deps.now, usbMedia, credential: key, identity: account,
          saveCredential: saved => (deps.saveCredential ?? saveCredential)(site, saved),
          onCredentialError: () => out.error('Saved ROMinit API key was rejected or expired. Run "rominit auth".') });
        await runHelper(helper, out, account.user);
        return 0;
      }
      const helper = await (deps.startHelper ?? startHelper)({ site, fetch: deps.get, now: deps.now, usbMedia,
        saveCredential: key => (deps.saveCredential ?? saveCredential)(site, key),
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
      const account = await (deps.identifyCredential ?? identifyCredential)(site, key, deps.get, deps.now);
      const helper = await (deps.startHelper ?? startHelper)({ site, fetch: deps.get, now: deps.now, usbMedia, credential: key, identity: account,
        saveCredential: saved => (deps.saveCredential ?? saveCredential)(site, saved),
        onCredentialError: () => out.error('Saved ROMinit API key was rejected or expired. Run "rominit auth".') });
      await runHelper(helper, out, account.user);
      return 0;
    }
    if (cmd === 'logout') {
      if (rest.length !== 1 || flags.apiKey || helperArgs(argv)) throw Error('logout takes no device arguments or other flags.');
      const site = siteOrigin(deps.site ?? SITE);
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
      out.done([`${plan.device} / ${plan.rom} ${plan.version} (${plan.status})`, ...plan.stages.flatMap(s => [
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
    // Each attempt reconnects (or keeps a session that is still claimed), re-checks, then resumes
    // at the failed step; repeating that step is safe (it rewrites a whole partition, erases, or sets a slot).
    const progress = { done: 0 };
    /** @type {any} */ let session;
    await recover(`Stage ${flags.stage}`, async () => {
      if (deps.session) session = await deps.session();
      else if (!session?.isConnected) {
        await nodeUsb();
        const { connect } = await import('../src/protocols/usb.js');
        session = (await connect(recipe.protocol, t => out.step(t))).session;
      }
      await recipe.run(session, { device, files, steps: stepsFor(stage), progress },
        (/** @type {string} */ text, /** @type {number} */ fraction) => (fraction > 0 && fraction < 1 ? out.progress(text, fraction) : out.step(text)), () => {});
    }, io, out, false, { match: USB_GONE, ms: 120_000, every: 15_000 });
    out.done(stage.done ?? 'Stage finished.');
    if (benchAfter)
      await recover('Benchmark', () => (deps.bench ?? bench)(rom, `${device.codename}/${rom.id}`, dir, out), io, out, true);
    return 0;
  } catch (error) {
    out.error(/** @type {Error} */ (error).message);
    return 1;
  }
}
