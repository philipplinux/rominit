import * as fastboot from './recipes/fastboot.js';
import * as odin from './recipes/odin.js';
import * as twrpDd from './recipes/twrp-dd.js';
import * as fastbootTgz from './recipes/fastboot-tgz.js';
import * as twrpSideload from './recipes/twrp-sideload.js';

/** Recipe id → engine. `protocol` picks the USB connection, `verbs` the allowed steps and their argument counts. */
export const recipes = { fastboot, odin, 'twrp-dd': twrpDd, 'fastboot-tgz': fastbootTgz, 'twrp-sideload': twrpSideload };

/** Curated rating: every ROM states every feature, so ROMs compare side by side. User ratings come later. */
/** Feature table of the postmarketOS/Nura device wiki, grouped like its sections. */
export const FEATURE_GROUPS = {'basics':  ['flashing',  'usb_net',  'storage',  'sdcard',  'battery',  'screen',  'touch'],  'multimedia':  ['gpu',  'audio',  'camera',  'camera_flash',  'ir'],  'connectivity':  ['wifi',  'bluetooth',  'gps',  'nfc'],  'modem':  ['calls',  'sms',  'data'],  'misc':  ['fde',  'otg',  'hdmi',  'fingerprint'],  'sensors':  ['accelerometer',  'magnetometer',  'light',  'proximity',  'hall',  'haptics',  'barometer']};
export const FEATURES = Object.values(FEATURE_GROUPS).flat();
/** n/a = the phone has no such hardware; left out of completeness. */
export const STATES = ['works', 'partial', 'broken', 'untested', 'n/a'];
/** What a ROM includes or lacks, the usual reasons to pick one: yes, no, or optional (an add-on the user can install). */
export const INCLUDES = ['google_play', 'microg', 'android_apps', 'phone_ui', 'root', 'updates', 'encryption', 'relock', 'banking_apps', 'ssh', 'docker'];
export const OPTIONS = ['yes', 'no', 'optional'];
/** mainline = upstream Linux (gets updates); downstream = the vendor's old fork. */
export const KERNELS = ['mainline', 'downstream'];
export const SUPPORT = ['active', 'maintenance', 'abandoned'];
/** Who built the ROM. `stock` ROMs are the way back; the page lists them under Recover / revert. */
export const ORIGINS = { official: 'built and released by the OS project', maintainer: "the OS project's official build for this phone, hosted by its device maintainer", unofficial: 'community or personal port', stock: "the phone maker's own firmware" };
/** How far ROMinit vouches for a ROM. Only a person sets `curated`; scrapers always write `scraped`. */
/** Security risk from reputation and contributors: who could slip something into the image, and would anyone notice. */
export const RISKS = { low: 'source published, many contributors or the vendor itself, long track record', mid: 'source published, but one or a few maintainers', high: 'no source code or no reputation: the image cannot be checked' };
export const VETTING = { curated: 'endorsed by its community or ROMinit (GrapheneOS, mainline postmarketOS / Nura, our own builds)',
  scraped: 'found by a scraper; subject to verification' };
/** How usable the release is, best first. `broken` ROMs stay listed for the record but cannot be flashed here. */
export const STATUSES = { stable: 'daily-driver ready', beta: 'mostly works, known rough edges', nightly: 'automatic build, untested',
  experimental: 'early port, expect bugs', legacy: 'old release, superseded or no longer updated', broken: 'known not to boot or flash' };
/** Share of hardware features that work (partial counts half), 0-100. @param {any} rating */
/** Which features matter for each way of using the phone. */
export const USES = {
  computer: ['flashing', 'usb_net', 'storage', 'sdcard', 'battery', 'screen', 'gpu', 'audio', 'wifi', 'bluetooth', 'otg', 'hdmi', 'fde'],
  phone: ['screen', 'touch', 'battery', 'audio', 'calls', 'sms', 'data', 'camera', 'camera_flash', 'gps', 'wifi', 'bluetooth',
    'accelerometer', 'proximity', 'light', 'haptics', 'fingerprint', 'nfc'],
};
/** Share of the given features that work (partial counts half, n/a skipped), 0-100. @param {any} rating @param {string[]} features */
export function completeness(rating, features = FEATURES) {
  const present = features.filter(f => rating.features[f] !== 'n/a');
  return Math.round(100 * present.reduce((sum, f) => sum + (({ works: 1, partial: 0.5 })[rating.features[f]] ?? 0), 0) / present.length);
}
const SHA = /^[0-9a-f]{64}$/;
// Partition names, labels and slots end up in fastboot commands and TWRP shell lines.
const SAFE = /^[A-Za-z0-9_.-]+$/;
const PATH = /^\/[A-Za-z0-9/._-]+$/;

/** Shared checks for executable stages. @param {any} device @param {any[]} stages @param {string} at */
export function stagesProblems(device, stages, at) {
  const out = [];
  const need = (ok, text) => { if (!ok) out.push(text); };
  for (const [i, stage] of (stages ?? []).entries()) {
    const where = `${at} stage ${i + 1}`;
    const recipe = recipes[stage.recipe];
    need(recipe, `${where}: unknown recipe "${stage.recipe}"`);
    need(device.modes?.[stage.mode], `${where}: device has no instructions for mode "${stage.mode}"`);
    need(stage.title && stage.warning && /^[A-Z0-9 +]{4,}$/.test(stage.confirm ?? ''), `${where}: title, warning and an upper-case confirm phrase are required`);
    need(['tools', 'rom'].includes(stage.section), `${where}: section must be tools or rom`);
    if (recipe?.archive) need(Number.isInteger(stage.anti) && stage.anti >= 0, `${where}: archive stages need the package's anti-rollback level (anti)`);
    if (stage.recipe === 'twrp-dd') need(PATH.test(stage.by_name ?? ''), `${where}: by_name must be an absolute path`);
    const names = new Set();
    for (const file of stage.files ?? []) {
      need(SAFE.test(file.name ?? '') && !names.has(file.name), `${where}: file name "${file.name}" unsafe or duplicated`);
      names.add(file.name);
      need(Number.isSafeInteger(file.size) && file.size > 0 && SHA.test(file.sha256 ?? ''), `${where}: ${file.name} needs size and sha256`);
      need(file.source?.startsWith('https://') && (file.url === undefined || file.url.startsWith('https://')), `${where}: ${file.name} needs an https source page (and an https url if any)`);
    }
    const used = new Set();
    const steps = [...stage.steps ?? [], ...(stage.options ?? []).flatMap(option => option.steps ?? [])];
    need(stage.steps?.length, `${where}: no steps`);
    for (const [verb, ...args] of steps) {
      const arity = recipe?.verbs[verb];
      need(arity !== undefined && args.length === arity, `${where}: step ${verb}(${args}) not allowed for ${stage.recipe}`);
      need(args.every(arg => SAFE.test(arg)), `${where}: step ${verb} has unsafe arguments`);
      if (recipe?.fileArg?.[verb] !== undefined) {
        const name = args[recipe.fileArg[verb]];
        need(names.has(name), `${where}: step ${verb} uses unknown file ${name}`);
        used.add(name);
      }
    }
    need(recipe?.archive ? names.size === 1 : used.size === names.size, `${where}: ${recipe?.archive ? 'an archive recipe takes exactly one file' : 'every file must be used by a step'}`);
  }
  return out;
}

/** Validate a standalone recovery catalog file. @param {any} device @param {any} recoveryFile */
export function recoveryProblems(device, recoveryFile) {
  const out = [];
  const need = (ok, text) => { if (!ok) out.push(text); };
  need(recoveryFile?.device === device?.codename, `recovery file device "${recoveryFile?.device}" ≠ ${device?.codename}`);
  const recovery = recoveryFile?.recovery;
  const at = `${device?.codename}/${recovery?.id}`;
  need(SAFE.test(recovery?.id ?? ''), `${at}: id missing or unsafe`);
  need(recovery?.name && recovery?.version && recovery?.project?.startsWith('https://') && recovery?.source?.startsWith('https://'), `${at}: name, version, project and source https URLs are required`);
  need(['scraped', 'curated'].includes(recovery?.vetting), `${at}: vetting must be scraped or curated`);
  need(recovery?.requirements?.length && recovery.requirements.every(r => typeof r === 'string'), `${at}: requirements must be a non-empty list`);
  need(/^\d{4}-\d{2}-\d{2}$/.test(recovery?.imported ?? '') && recovery?.imported_from, `${at}: imported date and imported_from catalog source are required`);
  need(recovery?.stages?.length && recovery.stages.every(stage => stage.section === 'tools'), `${at}: recovery needs tool stages only`);
  out.push(...stagesProblems(device, recovery?.stages, at));
  return out;
}

/** Every reason this catalog entry is unusable; empty means valid. Data comes from PRs, so it is checked, not trusted.
 * @param {any} device @param {any} romFile */
export function problems(device, romFile) {
  const out = [];
  const need = (ok, text) => { if (!ok) out.push(text); };
  need(SAFE.test(device?.codename ?? ''), 'device.codename missing or unsafe');
  need(device?.vendor && device?.name, `${device?.codename}: vendor and name are required`);
  need(device?.series && device?.family && device?.variant, `${device?.codename}: series, family and variant are required (All › vendor › series › family › variant)`);
  need((device?.unsupported ?? []).every(u => u.name && u.models?.length && u.why), `${device?.codename}: unsupported variants need name, models and why`);
  const unlock = device?.unlock;
  need(unlock === undefined || (unlock.text && unlock.steps?.length && [...unlock.steps, ...unlock.hints ?? []].every(step => typeof step === 'string')
    && (unlock.pivots ?? []).every(p => p.problem && p.fix && (p.url === undefined || p.url.startsWith('https://')))),
  `${device?.codename}: unlock needs text and steps (hints are strings); each pivot needs problem, fix and an https url if any`);
  const hw = device?.hardware; // one site line: RAM · CPU · GPU · resolution · tags
  need(hw === undefined || (['ram', 'cpu', 'gpu', 'display'].every(k => typeof hw[k] === 'string' && hw[k]) && (hw.tags ?? []).every((/** @type {unknown} */ t) => typeof t === 'string')),
    `${device?.codename}: hardware needs ram, cpu, gpu and display strings (tags are strings)`);
  need(romFile?.device === device?.codename, `rom file device "${romFile?.device}" ≠ ${device?.codename}`);
  for (const rom of romFile?.roms ?? []) {
    const at = `${device?.codename}/${rom.id}`;
    need(SAFE.test(rom.id ?? ''), `${at}: id missing or unsafe`);
    need(rom.vetting in VETTING, `${at}: vetting must be ${Object.keys(VETTING).join(' or ')}`);
    need(rom.origin in ORIGINS && rom.status in STATUSES, `${at}: origin (${Object.keys(ORIGINS).join('/')}) and status (${Object.keys(STATUSES).join('/')}) are required`);
    // Every ROM states these, null when there is none, so a new field shows up on every page instead of only some.
    need('source' in rom && (rom.source === null || rom.source.startsWith?.('https://')), `${at}: source must be an https URL or null (no source code published)`);
    need('maintainer' in rom && (rom.maintainer === null || (rom.maintainer.name && rom.maintainer.source?.startsWith('https://'))), `${at}: maintainer must be {name, source https, avatar?} or null`);
    need(rom.screenshots === undefined || rom.screenshots.every((/** @type {any} */ s) => s.src && s.caption), `${at}: screenshots need src and caption`);
    need(rom.login === undefined || /^\S+ \/ \S+$/.test(rom.login), `${at}: login must look like "user / password"`);
    // slots: A/B phones install to one slot and keep the other; requirements: everything the install assumes, spelled out.
    need(['ab', 'single'].includes(rom.slots) && rom.requirements?.length && rom.requirements.every(r => typeof r === 'string'), `${at}: slots (ab/single) and a requirements list are required`);
    need(rom.risk?.level in RISKS && rom.risk.why, `${at}: risk needs level (${Object.keys(RISKS).join('/')}) and why`);
    need(rom.source !== null || rom.origin === 'stock' || rom.risk?.level === 'high', `${at}: no source code published means risk high`);
    // Recommended (safe): set by a person only, on official or stock builds with low risk; scrapers never write it.
    need(rom.recommended === undefined || (rom.recommended === true && rom.risk?.level === 'low' && ['official', 'stock'].includes(rom.origin)), `${at}: recommended only on official or stock ROMs with low risk`);
    // Community pick (XDA top pick, years of releases): set by a person only, like `curated`; scrapers never write it.
    need(rom.pick === undefined || (rom.pick.text && rom.pick.url?.startsWith('https://')), `${at}: pick needs text and an https url`);
    need(rom.os && rom.version && (rom.stages?.length || rom.external), `${at}: os, version and stages are required`);
    // Link-only: the publisher's own installer does the flash (no pinned files yet). Kept as a marker to revisit with a real recipe.
    need(rom.external === undefined || (rom.external.url?.startsWith('https://') && rom.external.why && !rom.stages?.length), `${at}: external needs an https url and why, and no stages`);
    // The id names a ROM line and stays put across small updates (ratings, comments and tests hang off it); a big jump is a new entry that supersedes the old one from the same publisher file.
    // <publisher>-<line>: the same line from two builders stays two entries (philipplinux-pmos-server vs official-pmos-mainline).
    const publisher = rom.origin === 'official' ? 'official' : rom.origin === 'stock' ? device.vendor : rom.maintainer?.name;
    need(publisher && rom.id?.startsWith(`${String(publisher).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-`), `${at}: id must start with its publisher (official-, the vendor for stock, else the maintainer name)`);
    need(!rom.version || !rom.id.includes(rom.version), `${at}: id must not contain the version (keep it stable across updates)`);
    need(rom.supersedes === undefined || (rom.supersedes !== rom.id && romFile.roms.some((/** @type {any} */ r) => r.id === rom.supersedes)), `${at}: supersedes must name another ROM in the same file`);
    const features = rom.rating?.features ?? {};
    need(/^\d{4}-\d{2}-\d{2}$/.test(rom.rating?.checked ?? '') && FEATURES.every(f => STATES.includes(features[f])) && Object.keys(features).length === FEATURES.length,
      `${at}: rating needs a checked date and exactly these features (${STATES.join('/')}): ${FEATURES.join(', ')}`);
    const rating = rom.rating ?? {};
    need(/^\d+\.\d+(\.\d+)?$/.test(rating.kernel?.version ?? '') && KERNELS.includes(rating.kernel?.type), `${at}: rating.kernel needs version and type (${KERNELS.join('/')})`);
    need(rating.base && /^\d{4}-\d{2}-\d{2}$/.test(rating.released ?? '') && SUPPORT.includes(rating.support),
      `${at}: rating needs base, released date and support (${SUPPORT.join('/')})`);
    const includes = rom.rating?.includes ?? {};
    need(INCLUDES.every(i => OPTIONS.includes(includes[i])) && Object.keys(includes).length === INCLUDES.length,
      `${at}: rating.includes needs exactly these (${OPTIONS.join('/')}): ${INCLUDES.join(', ')}`);
    out.push(...stagesProblems(device, rom.stages, at));
  }
  return out;
}

/** Steps for this run: the stage's own, then each enabled option's, in catalog order.
 * @param {any} stage @param {Record<string, boolean>} enabled */
export function stepsFor(stage, enabled = {}) {
  return [...stage.steps, ...(stage.options ?? []).filter(option => enabled[option.id] ?? option.default).flatMap(option => option.steps)];
}

/** Matches picked/downloaded files to the stage's pins by name and size; the hash is checked by the recipe.
 * `unverified`: the user takes a newer file than the catalog pins; size and hash are not checked (sha256 ''),
 * and a single-file stage takes any name. The stored steps still run.
 * @param {any} stage @param {Iterable<File>} files @param {boolean} unverified */
export function selectFiles(stage, files, unverified = false) {
  const selected = [...files];
  if (selected.length !== stage.files.length) throw Error(`Select exactly ${stage.files.map(f => f.name).join(', ')}.`);
  if (unverified) return stage.files.map(pin => {
    const matches = stage.files.length === 1 ? selected : selected.filter(file => file.name === pin.name);
    if (matches.length !== 1) throw Error(`${pin.name} is missing or duplicated; with several files the names must match.`);
    return { ...pin, size: matches[0].size, sha256: '', file: matches[0] };
  });
  return stage.files.map(pin => {
    const matches = selected.filter(file => file.name === pin.name);
    if (matches.length !== 1 || matches[0].size !== pin.size) throw Error(`${pin.name} is missing, duplicated, or has the wrong size.`);
    return { ...pin, file: matches[0] };
  });
}

/** @param {any} stage @param {{consent:boolean, confirmation:string}} answer */
export function assertConsent(stage, { consent, confirmation }) {
  if (!consent || confirmation !== stage.confirm) throw Error(`Acknowledge the warning and type ${stage.confirm}.`);
}
