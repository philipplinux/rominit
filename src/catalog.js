import * as fastboot from './recipes/fastboot.js';
import * as odin from './recipes/odin.js';
import * as twrpDd from './recipes/twrp-dd.js';
import * as fastbootTgz from './recipes/fastboot-tgz.js';
import * as twrpSideload from './recipes/twrp-sideload.js';
import * as amlogic from './recipes/amlogic.js';

/** Recipe id → engine. `protocol` picks the USB connection, `verbs` the allowed steps and their argument counts. */
export const recipes = { fastboot, odin, 'twrp-dd': twrpDd, 'fastboot-tgz': fastbootTgz, 'twrp-sideload': twrpSideload, amlogic };

/** Curated rating: every ROM states every feature, so ROMs compare side by side. User ratings come later. */
/** Feature table of the postmarketOS/Nura device wiki, grouped like its sections. */
export const FEATURE_GROUPS = {'basics':  ['flashing',  'usb_net',  'storage',  'sdcard',  'battery',  'screen',  'touch'],  'multimedia':  ['gpu',  'audio',  'camera',  'camera_flash'],  'connectivity':  ['wifi',  'bluetooth',  'gps',  'nfc'],  'modem':  ['calls',  'sms',  'data'],  'misc':  ['ir', 'fde',  'otg',  'hdmi',  'fingerprint'],  'sensors':  ['accelerometer',  'magnetometer',  'light',  'proximity',  'hall',  'haptics',  'barometer']};
export const FEATURES = Object.values(FEATURE_GROUPS).flat();
/** n/a = the phone has no such hardware; left out of completeness. */
export const STATES = ['works', 'partial', 'broken', 'untested', 'n/a'];
/** What a ROM includes or lacks, the usual reasons to pick one: yes, no, or optional (an add-on the user can install). */
export const INCLUDES = ['google_play', 'microg', 'android_apps', 'phone_ui', 'root', 'updates', 'encryption', 'relock', 'banking_apps', 'ssh', 'docker'];
export const OPTIONS = ['yes', 'no', 'optional'];
/** mainline = upstream Linux (gets updates); downstream = the vendor's old fork. */
export const KERNELS = ['mainline', 'downstream'];
/** Top of the device tree. */
export const CATEGORIES = { phone: 'Phones', tablet: 'Tablets', tvmedia: 'TV media boxes & sticks', television: 'Smart TVs', misc: 'Misc & IoT', networking: 'Networking', console: 'Consoles', pc: 'OS', emulator: 'Emulators', gpu: 'GPUs' };
/** catalog/devices/<folder>/<vendor>/<codename>/ holds <codename>.json, roms/ and recoveries/: the folder sets the device's category, so each kind keeps its own tree. */
export const CATEGORY_DIRS = { phones: 'phone', tablets: 'tablet', tvmedia: 'tvmedia', televisions: 'television', misc: 'misc', networking: 'networking' };
export const SUPPORT_ROUTE_SECTIONS = { os: 'Operating systems', apps: 'Apps', root: 'Root', 'custom-os': 'Custom OS', recovery: 'Recovery', tools: 'Manufacturer tools', projects: 'Community projects', discussion: 'Discussion' };
export const SUPPORT = ['active', 'maintenance', 'abandoned'];
/** The maker's own updates for the stock OS: ongoing, dropped, or not established by the source. `until` is the promised end or last update. */
export const OFFICIAL_SUPPORT = ['ongoing', 'dropped', 'unknown'];
/** First-party updates only (community projects never count). Unknown needs a sourced summary and no invented date. @param {any} s officialSupport @returns {string[]} */
export const officialSupportProblems = s => {
  if (!s || typeof s !== 'object') return ['officialSupport must be an object'];
  const dated = ['ongoing', 'dropped'].includes(s?.status) && /^\d{4}(-\d{2})?$/.test(s.until ?? '0000');
  const unknown = s?.status === 'unknown' && s.until === undefined && typeof s.summary === 'string' && !!s.summary.trim();
  const summary = s.summary === undefined || (typeof s.summary === 'string' && s.summary.length <= 120);
  return (dated || unknown) && s.source?.startsWith('https://') && summary ? []
    : ['officialSupport needs ongoing/dropped with until (YYYY or YYYY-MM), or unknown with a summary and no until; all require an https source'];
};
/** "Stock OS: maker updates until 2031-10" or an explicit unknown. @param {any} s @param {string} who whose updates */
export const officialSupportText = (s, who) => s.status === 'unknown' ? `${who}: ${s.summary}`
  : `${who} updates ${s.summary ?? (s.status === 'dropped' ? `ended${s.until ? ` ${s.until}` : ''}, no more fixes` : s.until ? `until ${s.until}` : 'ongoing, no end date announced')}`;
const isHttpsUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname; }
  catch { return false; }
};
/** Search levels, best first: an approved ROMinit phone test, a curated ROM, a scraped ROM with a recipe, support-only (no recipe), only link-only ROMs. */
export const LEVELS = { tested: 'Tested', approved: 'Approved', untested: 'Untested (with recipe)', supported: 'Supported (no recipe)', placeholder: 'Placeholder', retired: 'Retired' };
/** Retired holds discontinued OS families (publisher stopped releasing); devices never land there. @param {any} os */
export const osLevel = (os) => os.officialSupport?.status === 'dropped' ? 'retired' : null;
/** A phone's best level. @param {any} d index entry @param {Set<string>} tested codenames with an approved phone test @returns {keyof LEVELS} */
export const deviceLevel = (d, tested) => tested.has(d.codename) ? 'tested' : d.supportOnly ? 'supported'
  : d.roms.some((/** @type {any} */ r) => r.vetting === 'curated') ? 'approved' : d.roms.some((/** @type {any} */ r) => !r.external) ? 'untested' : 'placeholder';
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

/** Shared checks for executable stages. `rom` is the ROM the stages install (none for recovery files): a `lock`
 * step needs a ROM that supports a relocked bootloader. @param {any} device @param {any[]} stages @param {string} at @param {any} [rom] */
export function stagesProblems(device, stages, at, rom) {
  const out = [];
  const need = (ok, text) => { if (!ok) out.push(text); };
  for (const [i, stage] of (stages ?? []).entries()) {
    const where = `${at} stage ${i + 1}`;
    const recipe = recipes[stage.recipe];
    need(recipe, `${where}: unknown recipe "${stage.recipe}"`);
    need(device.modes?.[stage.mode], `${where}: device has no instructions for mode "${stage.mode}"`);
    need(stage.title && stage.warning && /^[A-Z0-9 +]{4,}$/.test(stage.confirm ?? ''), `${where}: title, warning and an upper-case confirm phrase are required`);
    // `unlock` is only the one-step stage unlockStage() builds; `lock` only in an option the user ticks (default off),
    // on a ROM that boots with a locked bootloader: relocking anything else bricks the phone.
    const unlockOnly = stage.steps?.length === 1 && stage.steps[0][0] === 'unlock' && !stage.files?.length && !stage.options?.length;
    need(stage.section === 'unlock' ? unlockOnly : ['tools', 'rom'].includes(stage.section), `${where}: section must be tools or rom (unlock: one unlock step, no files or options)`);
    need(!(stage.steps ?? []).some((/** @type {any[]} */ [verb]) => verb === 'lock'), `${where}: lock only inside an option`);
    need((stage.options ?? []).every((/** @type {any} */ o) => !o.steps?.some((/** @type {any[]} */ [verb]) => verb === 'lock') || (o.default === false && rom?.rating?.includes?.relock === 'yes')),
      `${where}: a lock option must default to off, on a ROM whose includes.relock is yes`);
    if (stage.recipe === 'amlogic') need(stage.steps?.length === 1 && amlogic.WIPES.includes(stage.steps[0][2]), `${where}: an amlogic stage is one burn step with wipe ${amlogic.WIPES.join('/')}`);
    if (recipe?.archive) need(Number.isInteger(stage.anti) && stage.anti >= 0, `${where}: archive stages need the package's anti-rollback level (anti)`);
    if (stage.recipe === 'twrp-dd') need(PATH.test(stage.by_name ?? ''), `${where}: by_name must be an absolute path`);
    const names = new Set();
    for (const file of stage.files ?? []) {
      need(SAFE.test(file.name ?? '') && !names.has(file.name), `${where}: file name "${file.name}" unsafe or duplicated`);
      names.add(file.name);
      need(Number.isSafeInteger(file.size) && file.size > 0 && SHA.test(file.sha256 ?? ''), `${where}: ${file.name} needs size and sha256`);
      for (const rev of file.revisions ?? []) need(Number.isSafeInteger(rev.size) && rev.size > 0 && SHA.test(rev.sha256 ?? ''), `${where}: ${file.name} revisions need size and sha256`);
      need(file.source?.startsWith('https://') && (file.url === undefined || file.url.startsWith('https://')), `${where}: ${file.name} needs an https source page (and an https url if any)`);
    }
    const used = new Set();
    const steps = [...stage.steps ?? [], ...(stage.options ?? []).flatMap(option => option.steps ?? [])];
    need(stage.steps?.length, `${where}: no steps`);
    need(stage.section === 'unlock' || !steps.some(([verb]) => verb === 'unlock'), `${where}: unlock only in the unlock stage`);
    for (const [verb, ...args] of steps) {
      const arity = recipe?.verbs[verb];
      need(arity !== undefined && args.length === arity, `${where}: step ${verb}(${args}) not allowed for ${stage.recipe}`);
      need(args.every(arg => SAFE.test(arg)), `${where}: step ${verb} has unsafe arguments`);
      if (verb === 'unlock' || verb === 'lock') need(['flashing', 'oem'].includes(args[0]), `${where}: ${verb} takes flashing or oem`);
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
  need(device?.recovery?.stockAndroid === undefined || (/^\d+$/.test(device.recovery.stockAndroid) && device.recovery.url?.startsWith('https://')), `${device?.codename}: recovery.stockAndroid needs an Android version and an https recovery url`);
  need(device?.recovery?.stockOs === undefined || (typeof device.recovery.stockOs?.name === 'string' && device.recovery.stockOs.name && typeof device.recovery.stockOs.version === 'string' && device.recovery.stockOs.version && device.recovery.url?.startsWith('https://')), `${device?.codename}: recovery.stockOs needs a name, version and an https recovery url`);
  need(device?.supportLabel === undefined || (typeof device.supportLabel === 'string' && device.supportLabel.length <= 100), `${device?.codename}: supportLabel must be plain text up to 100 characters`);
  const ownership = device?.ownership;
  need(ownership === undefined || (['label', 'details'].every(k => typeof ownership[k] === 'string' && ownership[k]) && isHttpsUrl(ownership.source)),
    `${device?.codename}: ownership needs label, details and an https source`);
  need(device?.supportRoutes === undefined || (Array.isArray(device.supportRoutes) && device.supportRoutes.every(route =>
    Object.hasOwn(SUPPORT_ROUTE_SECTIONS, route?.section) && typeof route?.name === 'string' && route.name.trim() && route.name.length <= 120 &&
    typeof route.kind === 'string' && route.kind.trim() && route.kind.length <= 80 &&
    typeof route.description === 'string' && route.description.trim() && route.description.length <= 800 &&
    Array.isArray(route.requirements) && route.requirements.every(r => typeof r === 'string' && r.trim() && r.length <= 400) &&
    isHttpsUrl(route.url) && typeof route.checked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.checked))),
  `${device?.codename}: supportRoutes need a valid section, name, kind, description, requirements list, an https URL and a checked YYYY-MM-DD date`);
  need((device?.unsupported ?? []).every(u => u.name && u.models?.length && u.why), `${device?.codename}: unsupported variants need name, models and why`);
  const unlock = device?.unlock;
  need(unlock === undefined || (unlock.text && unlock.steps?.length && [...unlock.steps, ...unlock.hints ?? []].every(step => typeof step === 'string')
    && (unlock.pivots ?? []).every(p => p.problem && p.fix && (p.url === undefined || p.url.startsWith('https://')))),
  `${device?.codename}: unlock needs text and steps (hints are strings); each pivot needs problem, fix and an https url if any`);
  need(unlock?.fastboot === undefined || ['flashing', 'oem'].includes(unlock.fastboot), `${device?.codename}: unlock.fastboot must be flashing or oem`);
  if (unlock?.fastboot) out.push(...stagesProblems(device, [unlockStage(device)], `${device?.codename}/unlock`));
  const hw = device?.hardware; // one site line: RAM · CPU · GPU · resolution · tags
  need(hw === undefined || (['ram', 'cpu', 'gpu', 'display'].every(k => typeof hw[k] === 'string' && hw[k]) && (hw.tags ?? []).every((/** @type {unknown} */ t) => typeof t === 'string')),
    `${device?.codename}: hardware needs ram, cpu, gpu and display strings (tags are strings)`);
  need(hw === undefined || (['chipset', 'architecture', 'storage', 'note'].every(k => hw[k] === undefined || (typeof hw[k] === 'string' && hw[k]))
    && (hw.source === undefined || isHttpsUrl(hw.source))), `${device?.codename}: optional hardware details must be text with an https source`);
  const software = device?.software;
  need(software === undefined || (typeof software.os === 'string' && software.os && /^\d{4}-\d{2}-\d{2}$/.test(software.checked) && isHttpsUrl(software.source)
    && (software.latestFirmware === undefined || (typeof software.latestFirmware === 'string' && software.latestFirmware && /^\d{4}-\d{2}-\d{2}$/.test(software.released)))),
    `${device?.codename}: software needs os, checked date and an https source; latestFirmware needs a release date`);
  need(software?.reportedOs === undefined || (typeof software.reportedOs === 'string' && software.reportedOs && isHttpsUrl(software.reportSource)),
    `${device?.codename}: software.reportedOs needs text and an https reportSource`);
  // Header picture kept in site/phones with its credit: a free-licensed Commons photo, or the vendor's own press image.
  need(device?.category === undefined || device.category in CATEGORIES, `${device?.codename}: category must be one of ${Object.keys(CATEGORIES).join('/')} (set by its catalog/devices folder)`);
  const photo = device?.photo, press = photo?.license === 'press';
  need(photo === undefined || (/^devices\/[\w-]+\/[\w-]+\/[\w-]+\.webp$/.test(photo.src) && photo.artist
    && (press ? photo.page?.startsWith('https://') : photo.page?.startsWith('https://commons.wikimedia.org/') && /^(CC0|CC BY(-SA)? [\d.]+)$/.test(photo.license))),
    `${device?.codename}: photo needs src devices/<category>/<vendor>/<name>.webp, artist (the vendor for press) and either a Commons page + CC0 / CC BY[-SA] x.y or license "press" + the vendor's https page`);
  need(romFile?.device === device?.codename, `rom file device "${romFile?.device}" ≠ ${device?.codename}`);
  for (const rom of romFile?.roms ?? []) {
    const at = `${device?.codename}/${rom.id}`;
    need(SAFE.test(rom.id ?? ''), `${at}: id missing or unsafe`);
    need(rom.vetting in VETTING, `${at}: vetting must be ${Object.keys(VETTING).join(' or ')}`);
    need(rom.origin in ORIGINS && rom.status in STATUSES, `${at}: origin (${Object.keys(ORIGINS).join('/')}) and status (${Object.keys(STATUSES).join('/')}) are required`);
    // Every ROM states these, null when there is none, so a new field shows up on every page instead of only some.
    need('source' in rom && (rom.source === null || rom.source.startsWith?.('https://')), `${at}: source must be an https URL or null (no source code published)`);
    need(rom.discussion === undefined || rom.discussion.startsWith?.('https://'), `${at}: discussion (the ROM's support / discussion thread) must be an https URL`);
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
    // Link-only: an external installer or guide handles installation; no executable stages are claimed.
    need(rom.external === undefined || (rom.external.url?.startsWith('https://') && rom.external.why && !rom.stages?.length), `${at}: external needs an https url and why, and no stages`);
    need(rom.external?.kind === undefined || ['installer', 'guide'].includes(rom.external.kind), `${at}: external.kind must be installer or guide`);
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
    need(rating.sources === undefined || (Array.isArray(rating.sources) && rating.sources.every(s => s && typeof s.label === 'string' && s.label && typeof s.url === 'string' && s.url.startsWith('https://'))), `${at}: rating.sources needs labelled https URLs`);
    need(rating.note === undefined || typeof rating.note === 'string', `${at}: rating.note must be text`);
    need(/^\d+\.\d+(\.\d+)?$/.test(rating.kernel?.version ?? '') && KERNELS.includes(rating.kernel?.type), `${at}: rating.kernel needs version and type (${KERNELS.join('/')})`);
    need(rating.base && /^\d{4}-\d{2}-\d{2}$/.test(rating.released ?? '') && SUPPORT.includes(rating.support),
      `${at}: rating needs base, released date and support (${SUPPORT.join('/')})`);
    const includes = rom.rating?.includes ?? {};
    need(INCLUDES.every(i => OPTIONS.includes(includes[i])) && Object.keys(includes).length === INCLUDES.length,
      `${at}: rating.includes needs exactly these (${OPTIONS.join('/')}): ${INCLUDES.join(', ')}`);
    out.push(...stagesProblems(device, rom.stages, at, rom));
  }
  return out;
}

/** One-click unlock for phones whose bootloader unlocks with one fastboot command (`unlock.fastboot`: flashing / oem).
 * Same consent as any destructive stage: the human types the confirm phrase. @param {any} device */
export function unlockStage(device) {
  const family = device?.unlock?.fastboot;
  return family ? { title: 'Unlock the bootloader', section: 'unlock', recipe: 'fastboot', mode: 'fastboot', files: [], steps: [['unlock', family]],
    confirm: 'UNLOCK AND WIPE', warning: `Sends \`fastboot ${family} unlock\`. The phone asks again on its screen; confirming there erases everything on it. OEM unlocking must be on in Developer options first.`,
    done: 'Confirm on the phone (volume keys, then Power). It wipes itself; put it back in fastboot mode for the next section.' } : null;
}

/** Steps for this run: the stage's own, then each enabled option's, in catalog order.
 * @param {any} stage @param {Record<string, boolean>} enabled */
export function stepsFor(stage, enabled = {}) {
  return [...stage.steps, ...(stage.options ?? []).filter(option => enabled[option.id] ?? option.default).flatMap(option => option.steps)];
}

/** Matches picked/downloaded files to the stage's pins by name and size; the hash is checked by the recipe.
 * A pin's `revisions` [{size, sha256}] are other accepted builds of the same file (the publisher re-uploaded it);
 * `accept` lists the hashes whose size matches.
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
    const accept = [pin, ...pin.revisions ?? []].filter(rev => rev.size === matches[0]?.size).map(rev => rev.sha256);
    if (matches.length !== 1 || !accept.length) throw Error(`${pin.name} is missing, duplicated, or has the wrong size.`);
    return { ...pin, size: matches[0].size, accept, file: matches[0] };
  });
}

/** @param {any} stage @param {{consent:boolean, confirmation:string}} answer */
export function assertConsent(stage, { consent, confirmation }) {
  if (!consent || confirmation !== stage.confirm) throw Error(`Acknowledge the warning and type ${stage.confirm}.`);
}
