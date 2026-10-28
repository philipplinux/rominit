// Console entries are research records; they do not define flash recipes or downloadable artifacts.
import ps5 from '../../catalog/devices/consoles/sony/ps5/ps5.json' with { type: 'json' };
import switchConsole from '../../catalog/devices/consoles/nintendo/switch/switch.json' with { type: 'json' };
import rg35xx from '../../catalog/devices/consoles/anbernic/rg35xx/rg35xx.json' with { type: 'json' };
import rogAlly from '../../catalog/devices/consoles/asus/rog-ally/rog-ally.json' with { type: 'json' };

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
export const CONSOLES = [ps5, switchConsole, rg35xx, rogAlly];

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
