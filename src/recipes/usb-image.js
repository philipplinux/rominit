/** Write a pinned disk image through an injected native-media session.
 * @param {any} media @param {{image:{name:string}}} plan @param {(message:string)=>void} [report] */
export async function run(media, plan, report = () => {}) {
  report('Rechecking the selected USB drive and ISO source.');
  await media.assertPlanned(plan);
  report('Unmounting mounted USB partitions.');
  await media.unmount(plan);
  report('Rechecking the USB drive and ISO source before writing.');
  await media.assertUnmounted(plan);
  report(`Writing ${plan.image.name} across the whole USB disk.`);
  await media.write(plan);
  report('Checking the USB readback.');
  await media.verify(plan);
  report('The USB image write and readback are verified; boot compatibility has not been tested.');
  return { bootTested: false };
}
