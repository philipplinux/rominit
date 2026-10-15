import * as fastboot from './recipes/fastboot.js';
import * as odin from './recipes/odin.js';
import * as twrpDd from './recipes/twrp-dd.js';

/** Recipe id → engine. `protocol` picks the USB connection, `verbs` the allowed steps and their argument counts. */
export const recipes = { fastboot, odin, 'twrp-dd': twrpDd };

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
  need(romFile?.device === device?.codename, `rom file device "${romFile?.device}" ≠ ${device?.codename}`);
  for (const rom of romFile?.roms ?? []) {
    const at = `${device?.codename}/${rom.id}`;
    need(SAFE.test(rom.id ?? ''), `${at}: id missing or unsafe`);
    // `stock` ROMs are the way back; the page lists them under Recover / revert.
    need(['verified', 'experimental', 'imported', 'stock'].includes(rom.tier), `${at}: tier must be verified, experimental, imported or stock`);
    need(rom.os && rom.version && rom.stages?.length, `${at}: os, version and stages are required`);
    for (const [i, stage] of (rom.stages ?? []).entries()) {
      const where = `${at} stage ${i + 1}`;
      const recipe = recipes[stage.recipe];
      need(recipe, `${where}: unknown recipe "${stage.recipe}"`);
      need(device.modes?.[stage.mode], `${where}: device has no instructions for mode "${stage.mode}"`);
      need(stage.title && stage.warning && /^[A-Z0-9 +]{4,}$/.test(stage.confirm ?? ''), `${where}: title, warning and an upper-case confirm phrase are required`);
      need(['tools', 'rom'].includes(stage.section), `${where}: section must be tools or rom`);
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
      need(used.size === names.size, `${where}: every file must be used by a step`);
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
 * @param {any} stage @param {Iterable<File>} files */
export function selectFiles(stage, files) {
  const selected = [...files];
  if (selected.length !== stage.files.length) throw Error(`Select exactly ${stage.files.map(f => f.name).join(', ')}.`);
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
