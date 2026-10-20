import { helperRequest } from './helper.js';

const size = bytes => Number.isFinite(bytes) && bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : 'Unknown capacity';

function breakableText(value, every) {
  const parts = [];
  for (let start = 0; start < value.length; start += every) {
    if (start) parts.push(document.createElement('wbr'));
    parts.push(value.slice(start, start + every));
  }
  return parts;
}

/** @param {any} session @param {any} h */
export function usbMediaPanel(session, h) {
  const driveSelect = /** @type {HTMLSelectElement} */ (h('select', { id: 'usb-media-drive', disabled: true }));
  const driveInfo = h('div', {}), planBox = h('div', {}), status = h('p', { className: 'status', role: 'status', ariaLive: 'polite' });
  const jobLog = h('pre', { className: 'bench-output', hidden: true, ariaLive: 'off' });
  const statusCheck = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', className: 'button button-secondary', textContent: 'Check installation status', hidden: true, onclick: checkStatus }));
  const panel = h('section', { id: 'usb-media-panel', className: 'page-section' },
    h('h2', { textContent: 'Ventoy USB test' }),
    h('p', { className: 'field-help', textContent: 'Linux test: this installs the Ventoy bootloader on the selected USB drive. If the helper has a configured ISO, it copies and verifies it. Booting has not been tested.' }),
    h('p', { className: 'field-help', textContent: 'Any data on the selected drive will be erased. Check the model, capacity and device path before continuing.' }),
    h('label', { className: 'field-label', htmlFor: driveSelect.id, textContent: 'USB drive' }), driveSelect, driveInfo,
    h('button', { type: 'button', className: 'button button-secondary', textContent: 'Refresh drives', onclick: refresh }),
    h('div', {}, h('button', { type: 'button', className: 'button button-primary', textContent: 'Review Ventoy installation', disabled: true, onclick: review })),
    planBox,
    h('p', { className: 'field-help', textContent: 'Direct image writing is not available in this test.' }), status, statusCheck, jobLog);
  let drives = [], currentPlan = null, confirmInput = null, installButton = null, busy = false, writeDeadline = 0, activeImageName = null;

  const refreshButton = /** @type {HTMLButtonElement} */ (panel.querySelector('button'));
  const reviewButton = /** @type {HTMLButtonElement} */ (panel.querySelectorAll('button')[1]);
  const setBusy = value => {
    busy = value;
    refreshButton.disabled = value;
    driveSelect.disabled = value || drives.length === 0;
    reviewButton.disabled = value || !drives.find(d => String(d.id) === driveSelect.value && d.available === true) || !!currentPlan;
  };
  const clearPlan = () => {
    currentPlan = null; confirmInput = null; installButton = null; planBox.replaceChildren();
    setBusy(busy);
  };
  const selectedDrive = () => drives.find(d => String(d.id) === driveSelect.value);
  const showDrive = () => {
    clearPlan();
    jobLog.hidden = true; jobLog.textContent = ''; statusCheck.hidden = true;
    status.textContent = '';
    const drive = selectedDrive();
    driveInfo.replaceChildren();
    if (!drive) { setBusy(false); return; }
    driveInfo.append(
      h('p', { className: 'field-help', textContent: `Model: ${drive.model || 'Unknown'} · Capacity: ${size(drive.size)}` }),
      h('p', { className: 'field-help', textContent: `Device path: ${drive.path || 'Unknown'} · Mounted: ${drive.mounted ? 'yes' : 'no'}` }),
      ...(Array.isArray(drive.mounts) && drive.mounts.length ? [h('p', { className: 'field-help', textContent: `Mounted partitions: ${drive.mounts.join(', ')}` })] : []),
      ...(!drive.available && drive.reason ? [h('p', { className: 'field-help', textContent: `Unavailable: ${drive.reason}` })] : []));
    setBusy(false);
  };
  driveSelect.addEventListener('change', showDrive);

  async function refresh() {
    const previous = driveSelect.value;
    clearPlan(); setBusy(true); status.textContent = 'Looking for USB drives…';
    try {
      const found = await helperRequest(session, '/usb/drives');
      if (!panel.isConnected) return;
      if (!Array.isArray(found)) throw Error('The helper returned an invalid USB drive list.');
      drives = found.filter(d => d && (typeof d.id === 'string' || typeof d.id === 'number'));
      driveSelect.replaceChildren(h('option', { value: '', textContent: 'Choose a USB drive' }), ...drives.map(d => h('option', {
        value: String(d.id), disabled: d.available !== true,
        textContent: `${d.model || 'USB drive'} · ${size(d.size)} · ${d.path || 'unknown path'}${d.available ? '' : ' · unavailable'}`
      })));
      driveSelect.value = drives.some(d => String(d.id) === previous && d.available === true) ? previous : '';
      showDrive();
      status.textContent = drives.length ? 'Drive list refreshed. Listing drives does not change them.' : 'No USB drives found.';
    } catch (error) {
      if (panel.isConnected) status.textContent = error instanceof Error ? error.message : String(error);
      drives = []; driveSelect.replaceChildren(h('option', { value: '', textContent: 'Choose a USB drive' })); setBusy(false);
    }
  }

  async function review() {
    const drive = selectedDrive(), driveKey = driveSelect.value;
    if (!drive || drive.available !== true || busy || currentPlan) return;
    setBusy(true); status.textContent = 'Preparing an installation plan…';
    try {
      const plan = await helperRequest(session, '/usb/plan', { driveId: drive.id, method: 'ventoy' });
      if (!panel.isConnected || driveSelect.value !== driveKey) return;
      if (!plan || typeof plan.id !== 'string' || typeof plan.confirm !== 'string' || !plan.confirm || !plan.drive || typeof plan.drive !== 'object')
        throw Error('The helper returned an invalid Ventoy plan.');
      if (typeof plan.expiresAt !== 'string' || !Number.isFinite(Date.parse(plan.expiresAt))) throw Error('The helper returned a plan with no valid expiry.');
      if (String(plan.drive.id) !== String(drive.id)) throw Error('The helper plan is for a different drive. Refresh and review again.');
      if (plan.image && (typeof plan.image.name !== 'string' || !Number.isFinite(plan.image.size) || plan.image.size <= 0 || !/^[a-f\d]{64}$/i.test(plan.image.sha256)))
        throw Error('The helper returned invalid configured ISO details.');
      currentPlan = { id: plan.id, confirm: plan.confirm, expiresAt: plan.expiresAt, driveKey, imageName: plan.image?.name ?? null };
      confirmInput = /** @type {HTMLInputElement} */ (h('input', { id: 'usb-media-confirm', className: 'confirmation-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: 'Type the phrase shown above' }));
      installButton = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', className: 'button button-primary', textContent: 'Install Ventoy and erase this USB drive', disabled: true, onclick: install }));
      const isoDetails = plan.image ? h('p', { className: 'field-help' }, 'ISO: ', ...breakableText(plan.image.name, 32), ` · ${size(plan.image.size)} · SHA-256 `,
        h('code', {}, ...breakableText(plan.image.sha256, 8))) : h('p', { className: 'field-help', textContent: 'No ISO is configured. This will install Ventoy without copying an image.' });
      confirmInput.addEventListener('input', () => { installButton.disabled = confirmInput.value !== currentPlan?.confirm; });
      planBox.replaceChildren(
        h('h3', { textContent: 'Drive to erase' }),
        h('p', { className: 'field-help', textContent: `Model: ${plan.drive.model || 'Unknown'} · Capacity: ${size(plan.drive.size)}` }),
        h('p', { className: 'field-help', textContent: `Device path: ${plan.drive.path || 'Unknown'} · Mounted: ${plan.drive.mounted ? 'yes' : 'no'}` }),
        ...(Array.isArray(plan.drive.mounts) && plan.drive.mounts.length ? [h('p', { className: 'field-help', textContent: `Mounted partitions: ${plan.drive.mounts.join(', ')}` })] : [h('p', { className: 'field-help', textContent: 'Mounted partitions: none' })]),
        isoDetails,
        h('p', { className: 'field-help', textContent: plan.warning || 'This will erase the selected USB drive and install the Ventoy bootloader.' }),
        h('p', {}, 'Type exactly: ', h('code', { textContent: plan.confirm })),
        h('label', { className: 'confirmation-label', htmlFor: confirmInput.id, textContent: 'Confirmation phrase' }, confirmInput), h('div', {}, installButton));
      setBusy(false); reviewButton.disabled = true;
      status.textContent = plan.expiresAt ? `Plan ready · expires ${new Date(plan.expiresAt).toLocaleTimeString()}.` : 'Plan ready. Review the selected drive, then type the phrase to install.';
    } catch (error) {
      if (panel.isConnected) status.textContent = error instanceof Error ? error.message : String(error);
      setBusy(false);
    }
  }

  async function install() {
    const plan = currentPlan;
    if (!plan || busy || driveSelect.value !== plan.driveKey || confirmInput?.value !== plan.confirm) return;
    const expires = Date.parse(plan.expiresAt);
    if (Number.isFinite(expires) && expires <= Date.now()) { clearPlan(); status.textContent = 'The plan expired. Review the installation again.'; return; }
    const confirmation = confirmInput.value;
    activeImageName = plan.imageName;
    clearPlan(); setBusy(true); jobLog.hidden = false;
    statusCheck.hidden = true;
    status.textContent = 'Starting the Ventoy installation…';
    writeDeadline = Date.now() + 16 * 60_000;
    try {
      const job = await helperRequest(session, '/usb/write', { planId: plan.id, confirm: confirmation });
      if (!panel.isConnected || showJob(job)) return;
      if (activeJob(job) && Date.now() < writeDeadline) setTimeout(poll, 1500);
      else { statusCheck.hidden = false; statusCheck.disabled = false; }
    } catch (error) {
      if (panel.isConnected) {
        status.textContent = `${error instanceof Error ? error.message : String(error)} The write result is unknown; inspect the USB before trying again.`;
        statusCheck.hidden = false; statusCheck.disabled = false;
      }
    }
  }

  function activeJob(job) { return ['pending', 'running', 'queued'].includes(job?.state); }
  function showJob(job) {
    if (Array.isArray(job?.log)) jobLog.textContent = job.log.join('\n');
    else jobLog.textContent = typeof job?.log === 'string' ? job.log : '';
    if (job?.state === 'succeeded') {
      status.textContent = activeImageName ? `Ventoy prepared; ${activeImageName} copied and verified. Boot untested.` : 'Ventoy prepared. No ISO copied. Boot untested.';
      statusCheck.hidden = true; setBusy(false); activeImageName = null; return true;
    }
    if (job?.state === 'failed') {
      status.textContent = `${job.error || 'Ventoy installation failed.'} Boot untested; review the log before trying again.`;
      statusCheck.hidden = true; setBusy(false); activeImageName = null; return true;
    }
    status.textContent = job?.error ? String(job.error) : `Ventoy installation ${job?.state || 'status unknown'}…`;
    return false;
  }
  async function poll() {
    if (!panel.isConnected) return;
    if (Date.now() >= writeDeadline) {
      status.textContent = 'Status check timed out. The write may still be running; inspect the USB and helper before trying again.';
      statusCheck.hidden = false; statusCheck.disabled = false; return;
    }
    try {
      const job = await helperRequest(session, '/usb/status');
      if (!panel.isConnected || showJob(job)) return;
      if (activeJob(job) && Date.now() < writeDeadline) setTimeout(poll, 1500);
      else { statusCheck.hidden = false; statusCheck.disabled = false; }
    } catch (error) {
      if (panel.isConnected) {
        status.textContent = `${error instanceof Error ? error.message : String(error)} The write result is unknown; inspect the USB before trying again.`;
        statusCheck.hidden = false; statusCheck.disabled = false;
      }
    }
  }
  async function checkStatus() {
    statusCheck.disabled = true; status.textContent = 'Checking current installation status…';
    try {
      const job = await helperRequest(session, '/usb/status');
      if (!panel.isConnected || showJob(job)) return;
      if (activeJob(job) && Date.now() < writeDeadline) { statusCheck.hidden = true; setTimeout(poll, 1500); }
      else { statusCheck.hidden = false; statusCheck.disabled = false; }
    } catch (error) {
      if (panel.isConnected) {
        status.textContent = `${error instanceof Error ? error.message : String(error)} The write result is unknown; inspect the USB before trying again.`;
        statusCheck.disabled = false;
      }
    }
  }

  setTimeout(() => { if (panel.isConnected) void refresh(); }, 0);
  return panel;
}
