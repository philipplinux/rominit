// GPU records: sourced facts and project links only, no downloads or recipes.
import rtx3090 from '../../catalog/devices/gpus/nvidia/rtx-3090/rtx-3090.json' with { type: 'json' };

/** GPU pages, in the order the site lists them. */
export const GPUS = [rtx3090];

/** How recent a project is at the check date: a finished one-off is not stale; no date means it ships with something else.
 * @param {{lastUpdate?: string, oneOff?: boolean}} project @param {string} checkedDate YYYY-MM-DD */
export function gpuFreshness(project, checkedDate) {
  if (project.oneOff) return 'finished';
  if (!project.lastUpdate) return null;
  const month = (/** @type {string} */ d) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  const age = month(checkedDate) - month(project.lastUpdate);
  return age <= 3 ? 'active' : age <= 24 ? 'slow' : 'quiet';
}
