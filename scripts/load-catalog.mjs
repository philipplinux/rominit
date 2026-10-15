import { readdir, readFile } from 'node:fs/promises';
import { problems } from '../src/catalog.js';

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
      const dir = new URL(`roms/${device.codename}/`, root);
      for (const file of await readdir(dir).catch(() => [])) {
        const romFile = await json(`roms/${device.codename}/${file}`);
        errors.push(...problems(device, romFile).map(p => `roms/${device.codename}/${file}: ${p}`));
        roms.push(...romFile.roms);
      }
      if (new Set(roms.map(r => r.id)).size !== roms.length) errors.push(`${device.codename}: duplicate ROM ids`);
      devices.push({ ...device, roms });
    }
  }
  if (new Set(devices.map(d => d.codename)).size !== devices.length) errors.push('duplicate device codenames');
  return { devices, errors };
}
