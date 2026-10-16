// POST /mcp: MCP server over the published catalog (Streamable HTTP, stateless, plain JSON replies).
// Everything but initialize needs a free personal API token (Authorization: Bearer, made at /?view=agents); 100 tool calls an hour.
// Agents read devices, ROMs and their flash recipes and report runs: device and procedure facts only, free text checked
// for personal data. ROMvault and user data are not exposed. Finished runs land in the admin inbox (folder "MCP agent reports").
import { tokenUser } from './_lib/auth.js';
// ponytail: hand-rolled JSON-RPC (initialize, ping, tools/list, tools/call) instead of the MCP SDK; switch when we need sessions, streaming or OAuth.

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const CODENAME = /^[A-Za-z0-9_-]{1,64}$/;
const RUN = /^[A-Za-z0-9_-]{20,64}$/;
const RUNS_PER_DAY = 20, STEPS_PER_RUN = 200;
const PER_HOUR = 100; // tool calls per API token; without a token only initialize answers

/** Without a valid token: what to tell the agent. @param {Request} request */
const needsToken = request => `ROMinit's MCP needs a free personal API token. Ask the human to sign in at ${new URL('/?view=agents', request.url).href}, create a token there and add it to this MCP connection as the header "Authorization: Bearer <token>". Then reconnect.`;

/** Counts one tool call for this token; returns the message to send back when over the hourly limit. @param {any} env @param {{token_id:number}} who */
async function overLimit(env, who) {
  const hour = new Date().toISOString().slice(0, 13);
  const row = await env.DB.prepare('INSERT INTO mcp_hits (who, hour, n) VALUES (?1, ?2, 1) ON CONFLICT (who, hour) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(`token:${who.token_id}`, hour).first();
  if (row.n === 1) await env.DB.prepare('DELETE FROM mcp_hits WHERE hour < ?1').bind(hour).run(); // first call of a new hour sweeps old ones
  return row.n <= PER_HOUR ? null : `Rate limit: ${PER_HOUR} tool calls per hour per token. Try again after ${hour.slice(11)}:59 UTC.`;
}

/** Sent on connect: what the data is, how to use it safely, and what we ask back (the soft contract). */
export const INSTRUCTIONS = `ROMinit publishes free, checked data for flashing and recovering phones: devices, ROMs, and step-by-step flash recipes with files pinned by SHA-256.
Access: every tool call needs the human's free personal API token on this connection (header Authorization: Bearer <token>, made at {origin}/?view=agents), 100 calls an hour.
How to use it: rominit_find_devices (search by name, model number or codename) → rominit_get_device (unlock steps, boot modes, ROM list) → rominit_get_rom (stages, files, steps).
Step verbs: ["flash", partition, file], ["erase", partition], ["set_active", slot], ["reboot"], ["sideload", file], ["write", partition, file], ["mkfs_ext4", partition, label]; archive recipes (fastboot-tgz) run the package's own flash list.
Safety: stages marked destructive erase data. Never run one on your own initiative: show the human the stage warning and let them confirm it themselves. Check every file's SHA-256 before flashing. Read the ROM's notes, risk and requirements first.
Soft contract: this data is free. In return, report every flash or recovery attempt: rominit_start_run before the first stage, rominit_log_step after each stage (and each failed or worked-around step), rominit_finish_run with the outcome and the best path you found. Report device and procedure facts only, never personal data: no serial numbers, IMEI, account names, emails, IP or MAC addresses, phone numbers or home paths.`;

const str = (/** @type {string} */ description) => ({ type: 'string', description });
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const REPORT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const text = (/** @type {string} */ description, maxLength = 500) => ({ type: 'string', maxLength, description });

export const TOOLS = [
  { name: 'rominit_find_devices', title: 'Find devices', annotations: READ,
    description: 'Search the ROMinit catalog by device name, vendor, model number (e.g. SM-G960F), codename or OS. Returns matching devices with a short ROM list. Empty query lists all.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      query: str('Words to match, e.g. "galaxy s9", "SM-G965F", "laurel_sprout", "postmarketOS".'),
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Max devices to return.' } } } },
  { name: 'rominit_get_device', title: 'Get device', annotations: READ,
    description: 'One device by codename: models, hardware, boot modes (how to enter fastboot/download/recovery), bootloader unlock steps and pitfalls, recoveries, and every ROM (including stock restore) in short form.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['codename'], properties: { codename: str('Device codename from rominit_find_devices, e.g. "laurel_sprout".') } } },
  { name: 'rominit_get_rom', title: 'Get ROM recipe', annotations: READ,
    description: 'Full flash recipe for one ROM on one device: notes, risk, requirements, feature rating, and ordered stages with mode, files (name, size, sha256, url, source page) and steps. Destructive stages are marked; their warning must be shown to the human.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['codename', 'rom_id'], properties: {
      codename: str('Device codename, e.g. "laurel_sprout".'), rom_id: str('ROM id from rominit_get_device, e.g. "philipplinux-pmos-server".') } } },
  { name: 'rominit_start_run', title: 'Start a run report', annotations: REPORT,
    description: 'Before flashing or recovering with a ROMinit recipe: open a run report and get its run_id. Needs the human\'s API token on the connection.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['codename', 'rom_id'], properties: {
      codename: str('Device codename.'), rom_id: str('ROM id whose recipe you follow.'),
      host: { type: 'string', enum: ['linux', 'windows', 'macos', 'android', 'other'], description: 'OS of the computer doing the flashing.' },
      tools: text('Flash tools and versions, e.g. "fastboot 35.0.2, adb 35.0.2".', 100) } } },
  { name: 'rominit_log_step', title: 'Log a stage or step', annotations: REPORT,
    description: 'After each stage of the recipe (and each step that failed, was skipped or needed a workaround): record what happened. Device and procedure facts only.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['run_id', 'stage', 'outcome'], properties: {
      run_id: str('From rominit_start_run.'),
      stage: { type: 'integer', minimum: 1, maximum: 50, description: '1-based stage number in the recipe.' },
      step: { type: 'integer', minimum: 1, maximum: 500, description: '1-based step number inside the stage; omit for the whole stage.' },
      outcome: { type: 'string', enum: ['ok', 'failed', 'skipped', 'workaround'] },
      detail: text('Error line, bootloader/firmware version, what you changed. No serials, IMEI, emails, IPs or home paths.') } } },
  { name: 'rominit_finish_run', title: 'Finish a run report', annotations: REPORT,
    description: 'Close the run: overall outcome and the resolution or best path you found. It goes to ROMinit\'s maintainers for review.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['run_id', 'outcome', 'resolution'], properties: {
      run_id: str('From rominit_start_run.'),
      outcome: { type: 'string', enum: ['success', 'partial', 'failed', 'abandoned'] },
      resolution: text('What worked or fixed it, which steps to skip or change, what the next person should do.', 2000) } } },
];

/** Personal data agents must not send, each with the fix to tell them. */
const PRIVATE = /** @type {[RegExp, string][]} */ ([
  [/rmi_[A-Za-z0-9_-]{8,}/, 'an API token'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, 'an email address'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'an IPv4 address'],
  [/\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/i, 'an IPv6 address'],
  [/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i, 'a MAC address'],
  [/\b\d{14,17}\b/, 'an IMEI or other long number'],
  [/\+\d[\d ()-]{7,}\d/, 'a phone number'],
  [/(?:\/home\/|\/Users\/|[A-Z]:\\Users\\)[^\s/\\]+/i, 'a home path (write ~ instead)'],
  [/serial(?:no| ?number)?\W{0,3}[A-Za-z0-9]{6,}/i, 'a serial number'],
  [/\b[A-Za-z0-9]{6,}\t(?:fastboot|device|recovery|sideload)\b/, 'a serial number (fastboot/adb devices output)'],
]);
/** Throws the first kind of personal data found in a free-text field. @param {string} field @param {unknown} value */
export function checkPrivate(field, value) {
  if (value === undefined) return;
  if (typeof value !== 'string') throw Error(`${field} must be text.`);
  for (const [pattern, what] of PRIVATE) if (pattern.test(value)) throw Error(`${field} contains ${what}. Remove it and send again: ROMinit takes device and procedure facts only.`);
}

/** A published catalog file, or null. @param {any} env @param {Request} request @param {string} name */
async function catalog(env, request, name) {
  const response = await env.ASSETS.fetch(new URL(`/catalog/${name}.json`, request.url));
  return response.ok ? response.json() : null;
}

/** @param {any} r */
const romSummary = r => ({ id: r.id, os: r.os, name: r.name, version: r.version, origin: r.origin, status: r.status, vetting: r.vetting, risk: r.risk?.level, recommended: r.recommended });
/** The human types the confirm phrase on the site; agents only learn that the stage is destructive. @param {any} stage */
const agentStage = ({ confirm, ...stage }) => ({ ...stage, destructive: Boolean(confirm) });

/** Runs one tool; throws an Error whose message tells the agent what to do instead. @param {any} env @param {Request} request @param {string} name @param {any} args */
export async function callTool(env, request, name, args = {}) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) throw Error(`Unknown tool "${name}". Call tools/list.`);
  const props = /** @type {Record<string, any>} */ (tool.inputSchema.properties);
  args ??= {};
  const extra = Object.keys(args).filter(k => !(k in props));
  if (extra.length) throw Error(`Unknown argument ${extra.join(', ')}. Allowed: ${Object.keys(props).join(', ')}.`);
  for (const [k, p] of Object.entries(props)) {
    const v = args[k];
    if (v === undefined) { if (/** @type {string[]} */ (tool.inputSchema.required ?? []).includes(k)) throw Error(`${k} is required.`); continue; }
    if (p.enum && !p.enum.includes(v)) throw Error(`${k} must be one of ${p.enum.join(', ')}.`);
    if (p.type === 'integer' && (!Number.isInteger(v) || v < p.minimum || v > p.maximum)) throw Error(`${k} must be a whole number from ${p.minimum} to ${p.maximum}.`);
    if (p.maxLength) { checkPrivate(k, v); if (v.length > p.maxLength) throw Error(`${k} is longer than ${p.maxLength} characters.`); }
  }
  const page = (/** @type {string} */ codename) => new URL(`/?device=${encodeURIComponent(codename)}`, request.url).href;
  const device = async () => {
    if (!CODENAME.test(args.codename ?? '')) throw Error('codename is required (letters, digits, _ or -). Use rominit_find_devices to look it up.');
    const d = await catalog(env, request, args.codename);
    if (!d) throw Error(`Unknown codename "${args.codename}". Use rominit_find_devices to search by name or model number.`);
    return d;
  };
  if (name === 'rominit_find_devices') {
    const words = String(args.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
    /** @type {any[]} */ const index = await catalog(env, request, 'index');
    const text = (/** @type {any} */ d) => [d.vendor, d.series, d.family, d.variant, d.name, d.codename, ...d.models, ...d.roms.flatMap((/** @type {any} */ r) => [r.os, r.name]),
      ...(d.unsupported ?? []).flatMap((/** @type {any} */ u) => [u.name, ...u.models])].join(' ').toLowerCase();
    const hits = index.filter(d => words.every(w => text(d).includes(w)));
    return { total: hits.length, devices: hits.slice(0, limit).map(d => ({ codename: d.codename, name: d.name, vendor: d.vendor, models: d.models,
      unsupported: d.unsupported, roms: d.roms.map(romSummary), page: page(d.codename) })) };
  }
  if (name === 'rominit_get_device') {
    const { roms, ...d } = await device();
    return { ...d, roms: roms.map(romSummary), page: page(d.codename) };
  }
  if (name === 'rominit_get_rom') {
    const { roms, ...d } = await device();
    const rom = roms.find((/** @type {any} */ r) => r.id === args.rom_id);
    if (!rom) throw Error(`No ROM "${args.rom_id}" on ${d.codename}. Known: ${roms.map((/** @type {any} */ r) => r.id).join(', ')}.`);
    return { device: { codename: d.codename, name: d.name, modes: d.modes }, ...rom, stages: rom.stages.map(agentStage), page: page(d.codename),
      report: 'Flashing with this? rominit_start_run first, rominit_log_step per stage, rominit_finish_run at the end.' };
  }
  // Report tools: the token's owner, their own runs only.
  const who = await tokenUser(env, request);
  if (!who) throw Error(`Reporting needs the human's personal API token. Ask them to create one at ${new URL(request.url).origin}/?view=agents and add it to this MCP connection as the header "Authorization: Bearer <token>". Until then, they can share how it went on the device page.`);
  if (name === 'rominit_start_run') {
    const { roms, ...d } = await device();
    const rom = roms.find((/** @type {any} */ r) => r.id === args.rom_id);
    if (!rom) throw Error(`No ROM "${args.rom_id}" on ${d.codename}. Known: ${roms.map((/** @type {any} */ r) => r.id).join(', ')}.`);
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE token_id = ?1 AND created > datetime('now', '-1 day')").bind(who.token_id).first();
    if (today?.n >= RUNS_PER_DAY) throw Error(`This token started ${RUNS_PER_DAY} runs in the last 24 hours; try again tomorrow.`);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO agent_runs (id, rom, version, user_id, token_id, host, tools) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(id, `${d.codename}/${rom.id}`, rom.version ?? null, who.id, who.token_id, args.host ?? null, args.tools ?? null).run();
    return { run_id: id, stages: rom.stages.length, next: 'After each stage call rominit_log_step (stage numbers as in rominit_get_rom); at the end call rominit_finish_run.' };
  }
  if (!RUN.test(args.run_id ?? '')) throw Error('run_id is required; get one from rominit_start_run.');
  const run = await env.DB.prepare('SELECT id, finished, (SELECT COUNT(*) FROM agent_steps WHERE run_id = ?1) AS steps FROM agent_runs WHERE id = ?1 AND user_id = ?2').bind(args.run_id, who.id).first();
  if (!run) throw Error(`Unknown run_id "${args.run_id}" for this token. Start one with rominit_start_run.`);
  if (run.finished) throw Error('This run is finished. Start a new one with rominit_start_run.');
  if (name === 'rominit_log_step') {
    if (run.steps >= STEPS_PER_RUN) throw Error(`A run holds at most ${STEPS_PER_RUN} steps; finish it with rominit_finish_run.`);
    await env.DB.prepare('INSERT INTO agent_steps (run_id, stage, step, outcome, detail) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(run.id, args.stage, args.step ?? null, args.outcome, args.detail ?? null).run();
    return { ok: true, logged: run.steps + 1 };
  }
  await env.DB.prepare("UPDATE agent_runs SET finished = datetime('now'), outcome = ?2, resolution = ?3 WHERE id = ?1").bind(run.id, args.outcome, args.resolution).run();
  return { ok: true, thanks: 'Received. ROMinit maintainers review it before it changes any page.' };
}

/** One JSON-RPC message → its reply, or null for notifications. @param {any} env @param {Request} request @param {any} msg */
export async function handle(env, request, msg) {
  if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
  if (msg.id === undefined) return null; // notifications (initialized, cancelled) need no reply
  const who = await tokenUser(env, request);
  // initialize stays open so a client can connect and the agent learns how to get a token; everything else needs one.
  if (!who && msg.method !== 'initialize') return { jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: needsToken(request) } };
  const ok = (/** @type {any} */ result) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return ok({ protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: {} },
        serverInfo: { name: 'rominit', title: 'ROMinit', version: '0.1.0' },
        instructions: (who ? '' : `No API token on this connection yet. ${needsToken(request)}\n\n`) + INSTRUCTIONS.replaceAll('{origin}', new URL(request.url).origin) });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': {
      const no = await overLimit(env, who);
      if (no) return ok({ content: [{ type: 'text', text: no }], isError: true });
      try {
        const data = await callTool(env, request, msg.params?.name, msg.params?.arguments);
        return ok({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
      } catch (error) {
        return ok({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true });
      }
    }
    default: return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

// Public read-only data and no cookies, so any origin may call it.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'access-control-allow-methods': 'POST, OPTIONS' };

/** @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  let msg;
  try { msg = await request.json(); } catch { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: CORS }); }
  if (Array.isArray(msg)) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batches are not supported; send one message per request.' } }, { status: 400, headers: CORS });
  const reply = await handle(env, request, msg);
  return reply ? Response.json(reply, { headers: CORS }) : new Response(null, { status: 202, headers: CORS });
}

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
/** Stateless server: no server-to-client stream. */
export const onRequestGet = () => new Response('ROMinit MCP: POST JSON-RPC here (Streamable HTTP).', { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS' } });
