/** Install Ventoy through an injected native-media session; this recipe has no browser APIs.
 * @param {any} media @param {{image?:{name:string}}} plan @param {(message:string)=>void} [report] */
export async function run(media, plan, report = () => {}) {
  report('Rechecking the selected USB drive and its mount state.');
  await media.assertPlanned(plan);
  report('Unmounting mounted USB partitions.');
  await media.unmount(plan);
  report('Rechecking the USB drive before installation.');
  await media.assertUnmounted(plan);
  report('Installing Ventoy.');
  await media.install(plan);
  report('Verifying the Ventoy partition layout.');
  await media.verify(plan);
  if (plan.image) {
    report(`Copying ${plan.image.name} onto the Ventoy USB.`);
    await media.copyImage(plan);
  }
  report(`${plan.image ? 'Ventoy and the ISO are ready' : 'Ventoy is installed'}; boot has not been tested.`);
  return { bootTested: false };
}
