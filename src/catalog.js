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
export const ORIGINS = { official: 'built and released by the OS project', unofficial: 'community or personal port', stock: "the phone maker's own firmware" };
/** How far ROMinit vouches for a ROM. Only a person sets `curated`; scrapers always write `scraped`. */
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
  need(romFile?.device === device?.codename, `rom file device "${romFile?.device}" ≠ ${device?.codename}`);
  for (const rom of romFile?.roms ?? []) {
    const at = `${device?.codename}/${rom.id}`;
    need(SAFE.test(rom.id ?? ''), `${at}: id missing or unsafe`);
    need(rom.vetting in VETTING, `${at}: vetting must be ${Object.keys(VETTING).join(' or ')}`);
    need(rom.origin in ORIGINS && rom.status in STATUSES, `${at}: origin (${Object.keys(ORIGINS).join('/')}) and status (${Object.keys(STATUSES).join('/')}) are required`);
    need(rom.login === undefined || /^\S+ \/ \S+$/.test(rom.login), `${at}: login must look like "user / password"`);
    // slots: A/B phones install to one slot and keep the other; requirements: everything the install assumes, spelled out.
    need(['ab', 'single'].includes(rom.slots) && rom.requirements?.length && rom.requirements.every(r => typeof r === 'string'), `${at}: slots (ab/single) and a requirements list are required`);
    need(rom.os && rom.version && rom.stages?.length, `${at}: os, version and stages are required`);
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
    for (const [i, stage] of (rom.stages ?? []).entries()) {
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
        // ROMinit never downloads or hosts files: `source` is the publisher's page, `url` an optional direct link the user opens.
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
