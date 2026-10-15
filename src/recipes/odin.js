import { checksum } from '../hash.js';

export const protocol = 'odin';
export const verbs = { flash: 2 };
export const fileArg = { flash: 1 };

/**
 * Samsung Download Mode. Writes only the listed partitions and never reboots: on many Samsungs a normal
 * boot right after flashing a custom recovery restores the stock one.
 * @param {{beginSession():Promise<void>,getPitData():Promise<{findEntryByName(n:string):{partitionSize:number}|undefined}>,flashPartition(n:string,f:Blob):Promise<void>}} odin
 * @param {{device:any, stage:any, files:{name:string,sha256:string,file:Blob}[], steps:any[][]}} job
 * @param {(message:string,fraction:number)=>void} report @param {()=>void} assertSession
 */
export async function run(odin, { device, stage, files, steps }, report, assertSession) {
  const byName = Object.fromEntries(files.map(f => [f.name, f]));
  for (const file of files) {
    report(`Checking SHA-256: ${file.name}`, 0);
    const digest = await checksum(file.file, fraction => report(`Checking SHA-256: ${file.name}`, fraction));
    if (digest !== file.sha256) throw Error(`SHA-256 mismatch: ${file.name}. Nothing written.`);
  }
  assertSession();
  report('Reading partition table (PIT)', 0);
  await odin.beginSession();
  const pit = await odin.getPitData();
  // Odin reports no model name; the partition layout is the closest thing to a device check.
  for (const name of stage.require_pit ?? []) {
    if (!pit.findEntryByName(name)) throw Error(`PIT has no ${name} partition: this does not look like a ${device.name}. Nothing written.`);
  }
  for (const [, partition, name] of steps) {
    const entry = pit.findEntryByName(partition);
    if (!entry) throw Error(`PIT has no ${partition} partition. Nothing written.`);
    if (!(entry.partitionSize >= byName[name].file.size)) throw Error(`${name} is larger than ${partition}. Nothing written.`);
  }
  for (const [, partition, name] of steps) {
    assertSession();
    report(`Writing ${name} → ${partition}`, 0);
    await odin.flashPartition(partition, byName[name].file);
  }
  report('Written. Do not reboot normally; follow the next step.', 1);
}
