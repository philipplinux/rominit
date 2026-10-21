import { AmlImage, WipeMode, flashImage } from '@lineageos-infra/libamlburn';
import { verifyPins } from '../hash.js';

// Amlogic USB burn mode (TV boxes, boards): writes a whole aml_upgrade_package.img with Amlogic's Optimus flow
// (SPL → U-Boot → disk_initial → each partition written and verified on the box), via LineageOS's libamlburn.
// ponytail: no identity check: burn mode only names the SoC family, so the pinned package for this box is the guard.
export const protocol = 'amlogic';
/** ["burn", file, wipe]; wipe: keep (no erase), keep_keys (erase, keep the box's keys), all (erase everything). */
export const verbs = { burn: 2 };
export const fileArg = { burn: 0 };
const WIPE = { keep: WipeMode.None, keep_keys: WipeMode.KeepKeys, all: WipeMode.All };
export const WIPES = Object.keys(WIPE);

/**
 * @param {any} box libamlburn Device, initialized
 * @param {{files:{name:string,sha256:string,file:Blob}[], steps:any[][]}} job
 * @param {(message:string,fraction:number)=>void} report @param {()=>void} assertSession
 */
export async function run(box, { files, steps }, report, assertSession) {
  const [[verb, name, wipe]] = steps;
  if (steps.length !== 1 || verb !== 'burn' || !WIPES.includes(wipe)) throw Error('An Amlogic stage is one burn step. Nothing written.');
  await verifyPins(files, report);
  assertSession();
  const image = await AmlImage.open(/** @type {Blob} */ (files.find(f => f.name === name)?.file));
  // The box re-enumerates after U-Boot starts; libamlburn reopens it if the browser kept the permission, else the run stops.
  await flashImage(box, image, { wipe: WIPE[/** @type {keyof typeof WIPE} */ (wipe)], reboot: true,
    onProgress: (/** @type {any} */ p) => report(`Burning: ${p.stage}${p.partition ? ` ${p.partition}` : ''}`, p.totalBytes ? p.bytesTransferred / p.totalBytes : 0) });
  report('Done.', 1);
}
