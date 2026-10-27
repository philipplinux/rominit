import { readdirSync, readFileSync } from 'node:fs';
import { CATEGORY_DIRS, problems, recoveryProblems, officialSupportProblems } from '../src/catalog.js';

const root = new URL('../catalog/', import.meta.url);
const json = (/** @type {string} */ path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
/** Sub-folders only, so a README or .DS_Store next to them is ignored. @param {string} path */
const dirs = path => readdirSync(new URL(path, root), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
/** JSON files in a folder, [] when it is missing. @param {string} path */
const jsonFiles = path => { try { return readdirSync(new URL(path, root)).filter(f => f.endsWith('.json')); } catch { return []; } };
/** devices/consoles/ holds console families (src/consoles), not flashable devices. */
const OTHER_DIRS = ['consoles'];

/** catalog/devices/<folder>/<vendor>/<codename>/: one folder per device, holding <codename>.json, roms/ and recoveries/.
 * @returns {{folder:string, vendor:string, codename:string, path:string}[]} path is relative to catalog/ */
export const deviceDirs = () => dirs('devices/').filter(f => Object.hasOwn(CATEGORY_DIRS, f)).flatMap(folder => dirs(`devices/${folder}/`)
  .flatMap(vendor => dirs(`devices/${folder}/${vendor}/`).map(codename => ({ folder, vendor, codename, path: `devices/${folder}/${vendor}/${codename}` }))));
/** One device folder's ROM files, as [file path relative to catalog/, parsed JSON]. @param {string} path */
export const romFiles = path => jsonFiles(`${path}/roms/`).map(f => [`${path}/roms/${f}`, json(`${path}/roms/${f}`)]);
/** Every catalog device JSON with its category, plus its folder. */
export const catalogDevices = () => deviceDirs().map(d => ({ ...json(`${d.path}/${d.codename}.json`), category: CATEGORY_DIRS[/** @type {keyof typeof CATEGORY_DIRS} */ (d.folder)], dir: d.vendor, path: d.path }));

/** Every device with its ROMs, plus every catalog problem found (build fails on any). */
export async function loadCatalog() {
  const devices = [];
  const errors = [];
  for (const folder of dirs('devices/').filter(f => !Object.hasOwn(CATEGORY_DIRS, f) && !OTHER_DIRS.includes(f))) errors.push(`devices/${folder}: unknown category folder (one of ${Object.keys(CATEGORY_DIRS).join(', ')})`);
  for (const folder of dirs('devices/').filter(f => Object.hasOwn(CATEGORY_DIRS, f))) for (const vendor of dirs(`devices/${folder}/`))
    for (const loose of jsonFiles(`devices/${folder}/${vendor}/`)) errors.push(`devices/${folder}/${vendor}/${loose}: move it into its own folder, devices/${folder}/${vendor}/${loose.slice(0, -5)}/`);
  for (const { folder, codename, path } of deviceDirs()) {
    const name = `${path}/${codename}.json`;
    let file;
    try { file = json(name); } catch { errors.push(`${path}: needs ${codename}.json (the folder name is the codename)`); continue; }
    if (file.codename !== codename) errors.push(`${name}: codename must match its folder`);
    if ('category' in file) errors.push(`${name}: drop "category", the folder sets it`);
    const device = { ...file, category: CATEGORY_DIRS[folder] };
    const roms = [];
    const recoveries = [];
    for (const [romPath, romFile] of romFiles(path)) {
      errors.push(...problems(device, romFile).map(p => `${romPath}: ${p}`));
      roms.push(...romFile.roms);
    }
    if (new Set(roms.map(r => r.id)).size !== roms.length) errors.push(`${device.codename}: duplicate ROM ids`);
    for (const file of jsonFiles(`${path}/recoveries/`)) {
      const recoveryFile = json(`${path}/recoveries/${file}`);
      errors.push(...recoveryProblems(device, recoveryFile).map(p => `${path}/recoveries/${file}: ${p}`));
      if (file !== `${recoveryFile.recovery?.id}.json`) errors.push(`${path}/recoveries/${file}: file name must be <recovery id>.json`);
      recoveries.push(recoveryFile.recovery);
    }
    if (new Set(recoveries.map(r => r.id)).size !== recoveries.length) errors.push(`${device.codename}: duplicate recovery ids`);
    if (device.supportOnly) errors.push(...problems(device, { device: device.codename, roms: [] }));
    if (device.supportOnly && (!device.supportUrl?.startsWith('https://') || roms.length)) errors.push(`${device.codename}: support-only needs an https supportUrl and no ROMs`);
    errors.push(...officialSupportProblems(device.officialSupport).map(p => `${device.codename}: ${p}`));
    devices.push({ ...device, roms, recoveries });
  }
  if (new Set(devices.map(d => d.codename)).size !== devices.length) errors.push('duplicate device codenames');
  return { devices, errors };
}
