import { spawn as spawnProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { benchmarkScript } from '../src/bench.js';

const CODE = /^[a-z2-9]{8}$/;
const CODENAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ROM_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/;
const USER = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/;
const PASSWORD_BYTES = 256;
const OUTPUT_BYTES = 128 * 1024;
const RUN_MS = 180_000;
const FETCH_MS = 10_000;
const REMOTE_BODY_BYTES = 512 * 1024;

export class PhoneBenchError extends Error {
  constructor(message) { super(message); this.name = 'PhoneBenchError'; }
}

function validHost(host) {
  if (typeof host !== 'string') return false;
  const match = /^([^%]+)(?:%([A-Za-z0-9_.-]{1,32}))?$/.exec(host);
  if (!match) return false;
  const version = isIP(match[1]);
  return version === 4 ? !match[2] : version === 6;
}

/** Validate the exact JSON fields accepted by the local helper. */
export function validatePhoneBench(value) {
  const fields = ['code', 'rom', 'host', 'user', 'password'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      fields.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...fields, 'sound'].includes(key)))
    throw Error('Expected code, ROM, host, username, and password.');
  const sound = Object.hasOwn(value, 'sound') ? value.sound : false;
  if (typeof sound !== 'boolean') throw Error('Sound must be a boolean.');
  if (typeof value.code !== 'string' || !CODE.test(value.code)) throw Error('Invalid benchmark code.');
  if (typeof value.rom !== 'string') throw Error('Invalid ROM selection.');
  const [codename, id, ...extra] = value.rom.split('/');
  if (extra.length || !CODENAME.test(codename ?? '') || !ROM_ID.test(id ?? '')) throw Error('Invalid ROM selection.');
  if (!validHost(value.host)) throw Error('Host must be an IPv4 or IPv6 address, optionally with an IPv6 interface.');
  if (typeof value.user !== 'string' || !USER.test(value.user)) throw Error('Invalid SSH username.');
  if (typeof value.password !== 'string' || !value.password || value.password.includes('\0') || Buffer.byteLength(value.password) > PASSWORD_BYTES)
    throw Error('Password must be 1 to 256 bytes.');
  return { code: value.code, rom: value.rom, host: value.host, user: value.user, password: value.password, sound };
}

async function boundedText(response, limit) {
  const declared = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => {});
    throw new PhoneBenchError('ROMinit returned an oversized response.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new PhoneBenchError('ROMinit returned an oversized response.');
      }
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof PhoneBenchError) throw error;
    throw new PhoneBenchError('ROMinit returned an invalid response.');
  }
}

async function siteRequest(get, url, options, signal) {
  let response;
  try {
    response = await get(url, { ...options, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_MS)]) : AbortSignal.timeout(FETCH_MS) });
  } catch {
    if (signal?.aborted) throw Error('Benchmark cancelled.');
    throw new PhoneBenchError('Could not reach ROMinit to verify or save this benchmark.');
  }
  if (!response.ok || response.redirected || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel().catch(() => {});
    throw new PhoneBenchError('The benchmark code expired or ROMinit rejected the request.');
  }
  return response;
}

function normalizedModel(value) {
  return value.replace(/\s*\([^()]*\)\s*$/, '').toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function benchmarkRows(output, version, family) {
  const lines = output.trimEnd().split(/\r?\n/);
  if (/^@ script (linux|android) /.test(lines[0]) && !lines[0].startsWith(`@ script ${family} `))
    throw new PhoneBenchError('Detected phone OS differs from the selected ROM. Select the installed ROM and start a new test; results were not sent.');
  if (lines[0] !== `@ script ${family} ${version}` || lines.at(-1) !== '@ done')
    throw new PhoneBenchError('The phone returned invalid benchmark output.');
  const rows = lines.filter(line => /^[a-z_]+ (?:full|partial|broken|blocked|untested|ask|inconclusive)(?: |$)/.test(line));
  const modelLines = lines.filter(line => line.startsWith('@ model '));
  if (!rows.length || modelLines.length !== 1 || !modelLines[0].slice(8).trim())
    throw new PhoneBenchError('The phone returned invalid benchmark output or no model name.');
  const deviceLines = lines.filter(line => line.startsWith('@ device '));
  if (deviceLines.length > 1) throw new PhoneBenchError('The phone returned conflicting device identities.');
  return { rows, model: modelLines[0].slice(8).trim(), codename: deviceLines[0]?.slice(9).trim() };
}

function sshOutput({ spawn, input, host, user, password, sound = false, signal, timeoutMs, maxOutputBytes }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      const remoteCommand = sound ? 'env ROMINIT_SOUND=1 sh -s' : 'env ROMINIT_SOUND=0 sh -s';
      const args = ['-F', '/dev/null', '-T', '-o', 'ConnectTimeout=8', '-o', 'ConnectionAttempts=1', '-o', 'NumberOfPasswordPrompts=1',
        '-o', 'PreferredAuthentications=password,keyboard-interactive', '-o', 'PubkeyAuthentication=no', '-o', 'IdentityAgent=none',
        '-o', 'StrictHostKeyChecking=accept-new', '-o', 'LogLevel=ERROR', `${user}@${host}`, remoteCommand];
      child = spawn('sshpass', ['-e', 'ssh', ...args], { env: { PATH: process.env.PATH ?? '', SSHPASS: password },
        stdio: ['pipe', 'pipe', 'ignore'], detached: process.platform !== 'win32' });
    } catch {
      reject(new PhoneBenchError('Could not start SSH. Install OpenSSH and sshpass on the computer running ROMinit.'));
      return;
    }

    let settled = false, failure = null, size = 0;
    const chunks = [];
    let forceKill, killing = false;
    const kill = () => {
      if (killing) return;
      killing = true;
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch { try { child.kill('SIGTERM'); } catch { /* process already exited */ } }
      forceKill = setTimeout(() => {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* process already exited */ }
      }, 1500);
      forceKill.unref?.();
      if (settled) clearTimeout(forceKill);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => { failure = Error('Benchmark cancelled.'); kill(); };
    const timer = setTimeout(() => { failure = new PhoneBenchError('Phone benchmark timed out after three minutes.'); kill(); }, timeoutMs);
    timer.unref?.();
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', () => finish(new PhoneBenchError('Could not start SSH. Install OpenSSH and sshpass on the computer running ROMinit.')));
    child.stdout.on('data', chunk => {
      if (failure) return;
      size += chunk.length;
      if (size > maxOutputBytes) {
        failure = new PhoneBenchError('Phone benchmark output exceeded the size limit.');
        kill();
      } else chunks.push(chunk);
    });
    child.stdin.on('error', () => {});
    child.once('close', () => clearTimeout(forceKill));
    child.once('close', code => {
      if (settled) return;
      if (failure) return finish(failure);
      const output = Buffer.concat(chunks, size).toString('utf8');
      if (/^@ failed os-mismatch:/.test(output))
        return finish(new PhoneBenchError('Detected phone OS differs from the selected ROM. Select the installed ROM and start a new test; results were not sent.'));
      if (code !== 0) return finish(new PhoneBenchError('SSH benchmark failed. Check the address, credentials, and saved host key.'));
      finish(null, output);
    });
    child.stdin.end(input);
  });
}

/** Detect the OS and run only its bundled probe, then store its raw output for browser review. */
export async function runPhoneBench({ origin, code, rom, host, user, password, sound = false, fetch: get = globalThis.fetch,
  spawn = spawnProcess, signal, authorize = async () => {}, timeoutMs = RUN_MS, maxOutputBytes = OUTPUT_BYTES } = {}) {
  const input = validatePhoneBench({ code, rom, host, user, password, sound });
  let site;
  try { site = new URL(origin); } catch { throw Error('Invalid ROMinit origin or fetch implementation.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(site.hostname);
  if (typeof origin !== 'string' || site.origin !== origin || site.username || site.password || site.pathname !== '/' || site.search || site.hash ||
      (site.protocol !== 'https:' && !(site.protocol === 'http:' && loopback)) || typeof get !== 'function')
    throw Error('Invalid ROMinit origin or fetch implementation.');
  const [codename, id] = input.rom.split('/');
  const catalogResponse = await siteRequest(get, `${origin}/catalog/${codename}.json`, {}, signal);
  let device;
  try { device = JSON.parse(await boundedText(catalogResponse, REMOTE_BODY_BYTES)); }
  catch (error) { if (error instanceof PhoneBenchError) throw error; throw new PhoneBenchError('Could not verify the selected ROM on ROMinit.'); }
  if (device?.codename !== codename || typeof device.vendor !== 'string' || typeof device.name !== 'string' || !Array.isArray(device.roms))
    throw new PhoneBenchError('The selected ROM is not in the ROMinit catalog.');
  const selectedRom = device.roms.find(item => item?.id === id);
  const family = selectedRom?.os === 'postmarketOS' ? 'linux' : ['Android', 'GrapheneOS', 'LineageOS', 'eOS'].includes(selectedRom?.os) ? 'android' : null;
  if (!family) throw new PhoneBenchError('The selected ROM is not a supported Android or postmarketOS ROM.');

  const codeResponse = await siteRequest(get, `${origin}/b/${input.code}`, {}, signal);
  const remoteScript = await boundedText(codeResponse, REMOTE_BODY_BYTES);
  const remoteVersion = /^VERSION=(\d+)$/m.exec(remoteScript)?.[1];
  if (!remoteVersion || !remoteScript.includes(`say "@ script ${family} $VERSION"`) || !remoteScript.includes('say "@ done"'))
    throw new PhoneBenchError(`This browser test is not an active ${family} benchmark. Start a new test on the ROM page.`);

  const [linux, android] = await Promise.all(['linux', 'android'].map(name => readFile(new URL(`../site/bench/${name}.sh`, import.meta.url), 'utf8')));
  const script = benchmarkScript(linux, android, family);
  const localVersion = /^VERSION=(\d+)$/m.exec(script.toString('utf8'))?.[1];
  if (remoteVersion !== localVersion) throw new PhoneBenchError('Update ROMinit CLI before running this benchmark.');
  const output = await sshOutput({ spawn, input: script, host: input.host, user: input.user, password: input.password, sound: input.sound,
    signal, timeoutMs, maxOutputBytes });
  const { rows, model, codename: detected } = benchmarkRows(output, localVersion, family);
  const codenames = [device.codename, `${device.vendor.toLowerCase()}-${device.codename}`, device.detect?.adb?.device];
  const models = [`${device.vendor} ${device.name}`, ...(device.models ?? []).flatMap(name => [name, `${device.vendor} ${name}`])];
  if (detected ? !codenames.includes(detected) : !models.some(name => normalizedModel(model) === normalizedModel(name)))
    throw new PhoneBenchError('The connected phone does not match the selected ROM device; results were not sent.');

  await authorize();
  const upload = await siteRequest(get, `${origin}/b/${input.code}`, {
    method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8' }, body: output,
  }, signal);
  await upload.body?.cancel().catch(() => {});
  return { ok: true, model, features: rows.length };
}
