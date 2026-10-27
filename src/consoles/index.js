// Console entries are research records; they do not define flash recipes or downloadable artifacts.
import ps5 from '../../catalog/devices/consoles/sony/ps5/ps5.json' with { type: 'json' };

/** Console families with a ROMinit research page. */
export const CONSOLES = [ps5];

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
