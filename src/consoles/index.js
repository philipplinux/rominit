// Console entries are research records; they do not define flash recipes or downloadable artifacts.
import ps2 from '../../catalog/devices/consoles/sony/ps2/ps2.json' with { type: 'json' };
import psp from '../../catalog/devices/consoles/sony/psp/psp.json' with { type: 'json' };
import ps3 from '../../catalog/devices/consoles/sony/ps3/ps3.json' with { type: 'json' };
import vita from '../../catalog/devices/consoles/sony/vita/vita.json' with { type: 'json' };
import ps4 from '../../catalog/devices/consoles/sony/ps4/ps4.json' with { type: 'json' };
import ps5 from '../../catalog/devices/consoles/sony/ps5/ps5.json' with { type: 'json' };
import ds from '../../catalog/devices/consoles/nintendo/ds/ds.json' with { type: 'json' };
import wii from '../../catalog/devices/consoles/nintendo/wii/wii.json' with { type: 'json' };
import nintendo3ds from '../../catalog/devices/consoles/nintendo/3ds/3ds.json' with { type: 'json' };
import wiiU from '../../catalog/devices/consoles/nintendo/wii-u/wii-u.json' with { type: 'json' };
import switchConsole from '../../catalog/devices/consoles/nintendo/switch/switch.json' with { type: 'json' };
import xbox from '../../catalog/devices/consoles/microsoft/xbox/xbox.json' with { type: 'json' };
import xbox360 from '../../catalog/devices/consoles/microsoft/xbox360/xbox360.json' with { type: 'json' };
import xboxOne from '../../catalog/devices/consoles/microsoft/xboxone/xboxone.json' with { type: 'json' };
import xboxSeries from '../../catalog/devices/consoles/microsoft/xboxseries/xboxseries.json' with { type: 'json' };
import dreamcast from '../../catalog/devices/consoles/sega/dreamcast/dreamcast.json' with { type: 'json' };
import rg35xx from '../../catalog/devices/consoles/anbernic/rg35xx/rg35xx.json' with { type: 'json' };
import rg405 from '../../catalog/devices/consoles/anbernic/rg405/rg405.json' with { type: 'json' };
import rg505 from '../../catalog/devices/consoles/anbernic/rg505/rg505.json' with { type: 'json' };
import rg556 from '../../catalog/devices/consoles/anbernic/rg556/rg556.json' with { type: 'json' };
import rogAlly from '../../catalog/devices/consoles/asus/rog-ally/rog-ally.json' with { type: 'json' };
import odin2 from '../../catalog/devices/consoles/ayn/odin-2/odin-2.json' with { type: 'json' };
import thor from '../../catalog/devices/consoles/ayn/thor/thor.json' with { type: 'json' };
import retroidPocket5 from '../../catalog/devices/consoles/goretroid/retroid-pocket-5/retroid-pocket-5.json' with { type: 'json' };
import retroidPocketMini from '../../catalog/devices/consoles/goretroid/retroid-pocket-mini/retroid-pocket-mini.json' with { type: 'json' };
import miyooA30 from '../../catalog/devices/consoles/miyoo/a30/a30.json' with { type: 'json' };
import miyooFlip from '../../catalog/devices/consoles/miyoo/flip/flip.json' with { type: 'json' };
import miyooMini from '../../catalog/devices/consoles/miyoo/mini/mini.json' with { type: 'json' };
import miyooMiniFlip from '../../catalog/devices/consoles/miyoo/mini-flip/mini-flip.json' with { type: 'json' };
import powkiddyRgb30 from '../../catalog/devices/consoles/powkiddy/rgb30/rgb30.json' with { type: 'json' };
import powkiddyX55 from '../../catalog/devices/consoles/powkiddy/x55/x55.json' with { type: 'json' };
import trimuiBrick from '../../catalog/devices/consoles/trimui/brick/brick.json' with { type: 'json' };
import trimuiSmartPro from '../../catalog/devices/consoles/trimui/smart-pro/smart-pro.json' with { type: 'json' };

/** One project claim on a console page.
 * @typedef {Object} ConsoleProject
 * @property {string} name
 * @property {string} kind
 * @property {string} firmware
 * @property {string} summary
 * @property {string} source
 * @property {string} checkedDate
 * @property {string[]} models
 * @property {{models: string[], supportedFirmware: string[], status: string, note?: string}[]} compatibility
 * @property {string[]} requirements
 * @property {string[]} warnings
 * @property {{label: string, url: string}[]} links
 * @property {string} [page]
 * @property {string} [availability]
 * @property {string} [runtime]
 * @property {string} [systems]
 * @property {string} [access]
 */

/** A console family research record. Optional fields are the ones a page can live without.
 * @typedef {Object} ConsoleEntry
 * @property {string} id
 * @property {string} name
 * @property {string} [family] Hub id; redundant with families.js, kept only so a draft may state it (must match)
 * @property {string} manufacturer
 * @property {number} [releaseYear]
 * @property {{id: string, name: string}[]} models
 * @property {string} summary
 * @property {Record<string, string>} [specs]
 * @property {{model: string, region?: string, releaseYear?: number, storage?: string, notes?: string, specs?: Record<string, string>}[]} variants
 * @property {{version?: string, shortVersion?: string, checkedDate?: string, source?: string}} firmware
 * @property {string[]} [firmwareOptions]
 * @property {ConsoleProject[]} homebrew
 * @property {{label: string, url: string}[]} [sources]
 * @property {Record<string, {src: string, alt: string, width: number, height: number, page: string, artist: string, license: string}>} [media]
 * @property {{title: string, name: string, firmware: string, summary: string, source: string, checkedDate: string, target: string}[]} [highlights]
 * @property {{name: string, url: string, description: string, source: string, checkedDate: string}[]} [communities]
 * @property {{status: string, until?: string, source: string, summary?: string}} [officialSupport]
 * @property {Record<string, Record<string, string>>} [copy]
 */

/** Console families with a ROMinit research page.
 * @type {ConsoleEntry[]} */
export const CONSOLES = [
  ps2, psp, ps3, vita, ps4, ps5, ds, wii, nintendo3ds, wiiU, switchConsole,
  xbox, xbox360, xboxOne, xboxSeries, dreamcast,
  rg35xx, rg405, rg505, rg556, rogAlly,
  odin2, thor,
  retroidPocket5, retroidPocketMini,
  miyooA30, miyooFlip, miyooMini, miyooMiniFlip,
  powkiddyRgb30, powkiddyX55,
  trimuiBrick, trimuiSmartPro
];

/** Evaluate only explicit project claims; an unlisted firmware never inherits support from a range.
 * @param {{compatibility: {models: string[], supportedFirmware: string[], status: string}[]}} project
 * @param {string} model @param {string} firmware */
export function consoleCompatibility(project, model, firmware) {
  const rules = project.compatibility.filter(rule => !model || rule.models.includes(model));
  if (!model && !firmware) return 'See model and firmware limits';
  if (rules.some(rule => rule.status === 'documented' && rule.supportedFirmware.length && (!firmware || rule.supportedFirmware.includes(firmware))))
    return model ? 'Documented by project' : 'Documented for listed models';
  if (!rules.length || rules.some(rule => !rule.supportedFirmware.length || rule.status === 'unverified' && (!firmware || rule.supportedFirmware.includes(firmware)))) return 'Unverified';
  return 'Not listed as supported';
}
