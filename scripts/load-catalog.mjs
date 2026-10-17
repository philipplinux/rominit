import { readdir, readFile } from 'node:fs/promises';
import { problems, recoveryProblems } from '../src/catalog.js';

const root = new URL('../catalog/', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

/** Every device with its ROMs, plus every catalog problem found (build fails on any). */
export async function loadCatalog() {
  const devices = [];
  const errors = [];
  for (const vendor of await readdir(new URL('devices/', root))) {
    for (const name of await readdir(new URL(`devices/${vendor}/`, root))) {
      const device = await json(`devices/${vendor}/${name}`);
      if (name !== `${device.codename}.json`) errors.push(`devices/${vendor}/${name}: file name must be <codename>.json`);
      const roms = [];
      const recoveries = [];
      const dir = new URL(`roms/${device.codename}/`, root);
      for (const file of await readdir(dir).catch(() => [])) {
        const romFile = await json(`roms/${device.codename}/${file}`);
        errors.push(...problems(device, romFile).map(p => `roms/${device.codename}/${file}: ${p}`));
        roms.push(...romFile.roms);
      }
      if (new Set(roms.map(r => r.id)).size !== roms.length) errors.push(`${device.codename}: duplicate ROM ids`);
      const recoveryDir = new URL(`recoveries/${device.codename}/`, root);
      for (const file of await readdir(recoveryDir).catch(() => [])) {
        const recoveryFile = await json(`recoveries/${device.codename}/${file}`);
        errors.push(...recoveryProblems(device, recoveryFile).map(p => `recoveries/${device.codename}/${file}: ${p}`));
        if (file !== `${recoveryFile.recovery?.id}.json`) errors.push(`recoveries/${device.codename}/${file}: file name must be <recovery id>.json`);
        recoveries.push(recoveryFile.recovery);
      }
      if (new Set(recoveries.map(r => r.id)).size !== recoveries.length) errors.push(`${device.codename}: duplicate recovery ids`);
      if (device.supportOnly && (!device.supportUrl?.startsWith('https://') || roms.length)) errors.push(`${device.codename}: support-only needs an https supportUrl and no ROMs`);
      devices.push({ ...device, roms, recoveries });
    }
  }
  if (new Set(devices.map(d => d.codename)).size !== devices.length) errors.push('duplicate device codenames');
  return { devices, errors };
}
