import { ALPINE, alpineImage } from '../src/alpine.js';
import { helperRequest } from './helper.js';
import { collectUsbBrowserEnvironment } from './usb-environment.js';

const size = bytes => Number.isFinite(bytes) && bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : 'Unknown capacity';
const imageSize = bytes => Number.isSafeInteger(bytes) && bytes > 0
  ? bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  : 'Unknown size';
const validImageMeasure = value => value && typeof value === 'object' && Number.isSafeInteger(value.size) && value.size > 0 && typeof value.sha256 === 'string' && /^[a-f\d]{64}$/i.test(value.sha256);
const imageFilename = image => image?.name || (typeof image?.url === 'string' ? new URL(image.url).pathname.split('/').pop() : '') || 'Selected image';

function breakableText(value, every) {
  const parts = [];
  for (let start = 0; start < value.length; start += every) {
    if (start) parts.push(document.createElement('wbr'));
    parts.push(value.slice(start, start + every));
  }
  return parts;
}

/** @param {any} session @param {any} h @param {string|null} [imageId] @param {string[]|null} [capabilities] */
export function usbMediaPanel(session, h, imageId = null, capabilities = null) {
  const catalogImage = imageId ? alpineImage(imageId) : null;
  const catalogEdition = catalogImage && ALPINE.editions.find(edition => edition.images.some(image => image.id === catalogImage.id));
  let panelCapabilities = Array.isArray(capabilities) ? capabilities : null;
  // Only query browser diagnostics for helpers that explicitly accept the allowlisted fields.
  let browserEnvironment = panelCapabilities?.includes('usb-environment') ? collectUsbBrowserEnvironment().catch(() => null) : null;
  const directEligible = !catalogImage || ['iso', 'img.gz'].includes(catalogImage.format);
  let directAvailable = directEligible && !!panelCapabilities?.includes('usb-direct');
  const driveSelect = /** @type {HTMLSelectElement} */ (h('select', { id: 'usb-media-drive', disabled: true }));
  const directOption = directEligible ? h('option', { value: 'direct', disabled: !directAvailable, textContent: directAvailable ? 'Direct image (erases USB)' : 'Direct image (update CLI required)' }) : null;
  const methodSelect = /** @type {HTMLSelectElement} */ (h('select', { id: 'usb-media-method', disabled: true, hidden: true },
    h('option', { value: 'ventoy', disabled: !!catalogImage && catalogImage.usb !== true, textContent: catalogImage?.usb === false ? 'Ventoy (not supported for this image)' : 'Ventoy (multi-boot)' }),
    ...(directOption ? [directOption] : [])));
  const methodButtons = h('div', { className: 'usb-method-buttons', role: 'group', ariaLabel: 'USB install type' },
    ...(directEligible ? [['direct', 'Direct write']] : []).concat([['ventoy', 'Multi-boot ISOs (Ventoy)']]).map(([value, label]) =>
      h('button', { type: 'button', className: 'button button-secondary', value, textContent: label, onclick: () => setMethod(value) })));
  let methodChosen = false;
  const methodSupportedFor = value => value === 'direct' ? directAvailable : !catalogImage || catalogImage.usb === true;
  function syncMethodButtons() {
    for (const b of methodButtons.querySelectorAll('button')) {
      const on = b.value === methodSelect.value;
      b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on));
      b.disabled = busy || !panelCapabilities || !methodSupportedFor(b.value);
    }
  }
  function setMethod(value) {
    if (busy || methodSelect.value === value) return;
    methodChosen = true; methodSelect.value = value; methodSelect.dispatchEvent(new Event('change'));
  }
  const methodHelp = h('p', { className: 'field-help', id: 'usb-media-method-help' });
  const selectedSummary = h('p', { id: 'usb-media-selected-image', className: 'usb-selected-image', hidden: !catalogImage });
  const driveInfo = h('div', { className: 'usb-drive-info' }), planBox = h('div', {}), status = h('p', { className: 'status', role: 'status', ariaLive: 'polite' });
  const reportNotice = h('p', { id: 'usb-media-report-status', className: 'field-help usb-report-status', role: 'status', ariaLive: 'polite', hidden: true });
  const progressLabel = h('label', { id: 'usb-media-progress-label', htmlFor: 'usb-media-progress', textContent: 'USB operation progress' });
  const progressBar = /** @type {HTMLProgressElement} */ (h('progress', { id: 'usb-media-progress', max: 100 }));
  const progressDetail = h('span', { id: 'usb-media-progress-detail', className: 'usb-progress-detail' });
  progressBar.setAttribute('aria-describedby', progressDetail.id);
  const progressBox = h('div', { className: 'usb-progress', hidden: true }, progressLabel, progressBar, progressDetail);
  const jobLog = h('pre', { className: 'bench-output', hidden: true, ariaLive: 'off' });
  const statusCheck = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', className: 'button button-secondary', textContent: 'Check installation status', hidden: true, onclick: checkStatus }));
  const thanks = h('div', { className: 'usb-thanks', hidden: true },
    h('strong', { textContent: 'Done. Thank you!' }),
    h('p', {}, 'Thanks for using ROMinit, and thanks to the ', h('a', { href: 'https://alpinelinux.org/', target: '_blank', rel: 'noopener noreferrer', textContent: 'Alpine Linux project' }),
      ' and everyone who builds and maintains it. If this saved you time, a coffee keeps ROMinit going: ',
      h('a', { href: 'https://www.buymeacoffee.com/philipplinux', target: '_blank', rel: 'noopener noreferrer', textContent: '☕ Buy me a coffee' })));
  const panelTitle = h('h2', { textContent: imageId ? 'Prepare Alpine USB' : 'Prepare USB' });
  const refreshButton = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', className: 'button button-secondary usb-refresh-button', textContent: 'Refresh drives', onclick: refresh }));
  const driveHeading = h('div', { className: 'usb-drive-heading' }, h('label', { className: 'field-label', htmlFor: driveSelect.id, textContent: 'USB drive' }), refreshButton);
  const panel = h('section', { id: 'usb-media-panel', className: 'page-section' },
    panelTitle,
    h('p', { className: 'field-help', textContent: imageId
      ? 'Ventoy keeps a multi-boot USB. Direct image writes this ISO to the whole drive.'
      : 'Choose Ventoy to install the multi-boot loader, or Direct image to write the CLI-configured ISO to the whole drive. Boot compatibility has not been tested.' }),
    h('p', { className: 'field-help', textContent: imageId
      ? 'Ventoy is available only for images marked as supported. Direct image writing is offered for ISO files only; archives remain download-only. Check the model, capacity and device path before continuing.'
      : 'Any data on the selected drive will be erased. Check the model, capacity and device path before continuing.' }),
    h('p', { className: 'field-help usb-environment-notice', textContent: 'When supported, the automatic USB report includes OS, browser and CLI technical versions only; it does not include personal details.' }),
    selectedSummary,
    h('p', { className: 'field-label', textContent: 'USB install type' }), methodButtons, methodSelect, methodHelp,
    driveHeading, driveSelect, driveInfo,
    h('div', {}, h('button', { type: 'button', className: 'button button-primary usb-review', textContent: imageId ? 'Review USB preparation' : 'Review Ventoy installation', disabled: true, onclick: review })),
    planBox,
    status, reportNotice, progressBox, statusCheck, jobLog, thanks);
  let drives = [], currentPlan = null, confirmInput = null, installButton = null, busy = false, writeDeadline = 0, activeImageName = null, activeImageSize = null, activeAction = null, activeMethod = 'ventoy', activeUnverified = false, activeReadback = null;
  let reportPollTimer = 0, reportPollGeneration = 0;

  function imageSummaryLabel(image) {
    const name = imageFilename(image);
    return catalogImage
      ? `${ALPINE.name} ${ALPINE.version} · ${catalogEdition?.name || 'Selected edition'} · ${image?.arch || catalogImage.arch} · ${name}`
      : name;
  }
  function setImageSummary(image, bytes, unverified = false) {
    if (!image) { selectedSummary.hidden = true; selectedSummary.textContent = ''; return; }
    selectedSummary.textContent = `${imageSummaryLabel(image)} · ${imageSize(bytes)}${unverified ? ' downloaded; checksum mismatch accepted' : ''}`;
    selectedSummary.hidden = false;
  }
  if (catalogImage) setImageSummary(catalogImage, catalogImage.size);
  if (directAvailable && (!catalogImage || catalogImage.usb !== true)) methodSelect.value = 'direct';

  function methodSupported(method = methodSelect.value) {
    if (method === 'direct') return directAvailable;
    return method === 'ventoy' && (!catalogImage || catalogImage.usb === true);
  }
  function updateMethodHelp() {
    syncMethodButtons();
    if (!panelCapabilities) {
      methodHelp.textContent = 'Checking CLI support for direct image writing…';
      return;
    }
    if (!directAvailable) {
      methodHelp.replaceChildren(
        ...(catalogImage && !catalogImage.usb ? ['Ventoy is not marked supported for this image. '] : []),
        'Direct image writing needs an updated CLI. ', h('a', { href: './rominit-cli.tar.gz', textContent: 'Download updated CLI' }), ' and restart rominit serve.');
    } else if (methodSelect.value === 'direct') {
      methodHelp.textContent = catalogImage
        ? 'This writes the selected ISO to the whole USB and erases all existing data. Boot compatibility is not guaranteed.'
        : 'This writes the CLI-configured ISO to the whole USB and erases all existing data. Boot compatibility is not guaranteed.';
    } else if (catalogImage && !catalogImage.usb) {
      methodHelp.textContent = 'Ventoy is not marked as supported for this image. Choose Direct image to write the ISO; boot compatibility is not guaranteed.';
    } else {
      methodHelp.textContent = 'Ventoy keeps a multi-boot USB. If it is not already installed, installation erases all existing data.';
    }
  }
  updateMethodHelp();

  const reviewButton = /** @type {HTMLButtonElement} */ (panel.querySelector('.usb-review'));
  const setBusy = value => {
    busy = value;
    panel.dataset.busy = String(value);
    refreshButton.disabled = value;
    methodSelect.disabled = value || !panelCapabilities; syncMethodButtons();
    driveSelect.disabled = value || drives.length === 0;
    reviewButton.disabled = value || !methodSupported() || !drives.find(d => String(d.id) === driveSelect.value && d.available === true) || !!currentPlan;
  };
  function clearProgress() {
    progressBox.hidden = true;
    progressBar.removeAttribute('value');
    progressBar.removeAttribute('aria-valuetext');
    progressDetail.textContent = '';
    progressLabel.textContent = 'USB operation progress';
  }
  const clearPlan = () => {
    currentPlan = null; confirmInput = null; installButton = null; planBox.replaceChildren();
    clearProgress();
    setBusy(busy);
  };
  function clearReportNotice() {
    reportPollGeneration++;
    clearTimeout(reportPollTimer); reportPollTimer = 0;
    reportNotice.hidden = true; reportNotice.textContent = '';
  }
  function reportDelivery(job, generation = reportPollGeneration, attempts = 0, deadline = Date.now() + 60_000) {
    if (generation !== reportPollGeneration) return;
    const jobId = typeof job?.jobId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(job.jobId) ? job.jobId : null;
    const reportStatus = ['pending', 'sent', 'failed'].includes(job?.reportStatus) ? job.reportStatus : null;
    if (!jobId) { reportNotice.hidden = true; reportNotice.textContent = ''; return; }
    reportNotice.hidden = false;
    if (reportStatus === 'sent') {
      clearTimeout(reportPollTimer); reportPollTimer = 0;
      reportNotice.textContent = 'USB outcome report sent to the OS-USB inbox.';
      return;
    }
    if (reportStatus === 'failed') {
      clearTimeout(reportPollTimer); reportPollTimer = 0;
      reportNotice.textContent = 'USB outcome report could not be delivered to the OS-USB inbox. The USB operation result above is unchanged.';
      return;
    }
    reportNotice.textContent = reportStatus === 'pending'
      ? 'USB outcome report is being sent to the OS-USB inbox. The USB operation result above is unchanged.'
      : 'Checking USB outcome report delivery to the OS-USB inbox. The USB operation result above is unchanged.';
    if (attempts >= 60 || Date.now() >= deadline || reportPollTimer) {
      if (attempts >= 60 || Date.now() >= deadline) reportNotice.textContent = 'Could not confirm outcome report delivery to the OS-USB inbox. The USB operation result above is unchanged.';
      return;
    }
    reportPollTimer = setTimeout(async () => {
      reportPollTimer = 0;
      if (!panel.isConnected || generation !== reportPollGeneration) return;
      try {
        const latest = await helperRequest(session, '/usb/status');
        if (!panel.isConnected || generation !== reportPollGeneration) return;
        if (latest?.jobId !== jobId) {
          reportNotice.textContent = 'Could not confirm outcome report delivery to the OS-USB inbox. The USB operation result above is unchanged.';
          return;
        }
        reportDelivery(latest, generation, attempts + 1, deadline);
      } catch {
        if (generation !== reportPollGeneration) return;
        if (attempts + 1 >= 60 || Date.now() >= deadline) reportNotice.textContent = 'Could not confirm outcome report delivery to the OS-USB inbox. The USB operation result above is unchanged.';
        else { reportNotice.textContent = 'Checking USB outcome report delivery to the OS-USB inbox. The USB operation result above is unchanged.'; reportDelivery({ jobId }, generation, attempts + 1, deadline); }
      }
    }, 1000);
  }
  const selectedDrive = () => drives.find(d => String(d.id) === driveSelect.value);
  const showDrive = () => {
    clearPlan();
    clearReportNotice();
    if (catalogImage) setImageSummary(catalogImage, catalogImage.size);
    else setImageSummary(null);
    jobLog.hidden = true; jobLog.textContent = ''; statusCheck.hidden = true; thanks.hidden = true;
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
  methodSelect.addEventListener('change', () => {
    if (busy) return;
    clearReportNotice();
    clearPlan();
    if (catalogImage) setImageSummary(catalogImage, catalogImage.size);
    updateMethodHelp();
    if (!catalogImage) {
      reviewButton.textContent = methodSelect.value === 'direct' ? 'Review direct image write' : 'Review Ventoy installation';
    }
    status.textContent = methodSelect.value === 'direct'
      ? 'Direct image selected. Review confirms the USB will be erased before writing.'
      : 'Ventoy selected. Review the drive before continuing.';
  });

  async function refresh() {
    const previous = driveSelect.value;
    clearReportNotice();
    clearPlan(); setBusy(true); status.textContent = 'Looking for USB drives…';
    try {
      if (!panelCapabilities) {
        const helperStatus = await helperRequest(session, '/status');
        panelCapabilities = Array.isArray(helperStatus.capabilities) ? helperStatus.capabilities : [];
        if (panelCapabilities.includes('usb-environment')) browserEnvironment = collectUsbBrowserEnvironment().catch(() => null);
        directAvailable = directEligible && panelCapabilities.includes('usb-direct');
        if (directOption) {
          directOption.disabled = !directAvailable;
          directOption.textContent = directAvailable ? 'Direct image (erases USB)' : 'Direct image (update CLI required)';
        }
        if (directAvailable && !methodChosen) methodSelect.value = 'direct';
        if (!catalogImage) reviewButton.textContent = methodSelect.value === 'direct' ? 'Review direct image write' : 'Review Ventoy installation';
        updateMethodHelp();
      }
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
    const method = methodSelect.value;
    if (!drive || drive.available !== true || !methodSupported(method) || busy || currentPlan) return;
    setBusy(true); status.textContent = 'Preparing an installation plan…';
    try {
      status.textContent = imageId
        ? method === 'direct' ? 'Downloading and verifying the selected Alpine ISO, then preparing a direct-write review…' : 'Downloading and verifying the selected Alpine ISO, then preparing the Ventoy review…'
        : 'Preparing an installation plan…';
      const plan = await helperRequest(session, '/usb/plan', { driveId: drive.id, method, ...(imageId ? { imageId } : {}) });
      if (!panel.isConnected || driveSelect.value !== driveKey) return;
      if (!plan || typeof plan.id !== 'string' || typeof plan.confirm !== 'string' || !plan.confirm || !plan.drive || typeof plan.drive !== 'object')
        throw Error('The helper returned an invalid USB plan.');
      if (typeof plan.expiresAt !== 'string' || !Number.isFinite(Date.parse(plan.expiresAt))) throw Error('The helper returned a plan with no valid expiry.');
      if (String(plan.drive.id) !== String(drive.id)) throw Error('The helper plan is for a different drive. Refresh and review again.');
      if (plan.method !== method) throw Error('The helper returned a plan for a different USB install type.');
      if (plan.image && (typeof plan.image.name !== 'string' || !Number.isFinite(plan.image.size) || plan.image.size <= 0 || !/^[a-f\d]{64}$/i.test(plan.image.sha256)))
        throw Error('The helper returned invalid configured ISO details.');
      const selectedImage = imageId ? alpineImage(imageId) : null;
      if (imageId && (!selectedImage || !plan.image || ['id', 'arch', 'format', 'size', 'sha256', 'url'].some(key => plan.image[key] !== selectedImage[key])))
        throw Error('The CLI did not prepare the selected Alpine ISO. Update and reconnect the helper.');
      if (method === 'direct' && !plan.image) throw Error('The CLI has no configured ISO to write directly. Configure an ISO and restart rominit serve.');
      if (method === 'direct' && (plan.action !== 'direct' || plan.confirm !== 'ERASE'))
        throw Error('This CLI returned an unsupported direct-write plan. Update and reconnect the helper.');
      if (method === 'ventoy' && imageId && !['copy', 'install'].includes(plan.action)) throw Error('The CLI cannot safely prepare this USB. Update and reconnect the helper.');
      let verification = null;
      if (plan.verification !== undefined) {
        verification = plan.verification;
        if (!plan.image || !['mismatch', 'verified'].includes(verification?.status) || !validImageMeasure(verification.expected) || !validImageMeasure(verification.actual) ||
            verification.expected.size !== plan.image.size || verification.expected.sha256.toLowerCase() !== plan.image.sha256.toLowerCase() ||
            (verification.status === 'mismatch') === (verification.actual.size === verification.expected.size && verification.actual.sha256.toLowerCase() === verification.expected.sha256.toLowerCase()))
          throw Error('The CLI returned invalid checksum details. Update and reconnect the helper.');
        if (verification.status === 'mismatch') {
          const helperStatus = await helperRequest(session, '/status');
          if (!panel.isConnected || driveSelect.value !== driveKey) return;
          if (!Array.isArray(helperStatus.capabilities) || !helperStatus.capabilities.includes('usb-unverified'))
            throw Error('This CLI cannot safely review a checksum mismatch. Download the updated CLI and restart rominit serve.');
        }
      }
      const action = plan.action;
      const downloadedSize = verification?.actual.size ?? plan.image?.size ?? null;
      currentPlan = { id: plan.id, confirm: plan.confirm, expiresAt: plan.expiresAt, driveKey, method, imageName: plan.image?.name ?? null, imageSize: downloadedSize, action, verification, allowUnverified: false, readback: plan.image ? { size: downloadedSize, sha256: verification?.actual.sha256 ?? plan.image.sha256 } : null };
      if (plan.image) setImageSummary(plan.image, downloadedSize);
      confirmInput = /** @type {HTMLInputElement} */ (h('input', { id: 'usb-media-confirm', className: 'confirmation-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: `Type ${plan.confirm}` }));
      confirmInput.setAttribute('aria-label', 'Confirmation phrase');
      installButton = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', className: 'button button-primary', textContent: action === 'direct' ? 'Erase and write image to USB' : action === 'copy' ? 'Copy ISO to existing Ventoy USB' : 'Install Ventoy and erase this USB drive', disabled: true, onclick: install }));
      const isoDetails = plan.image ? h('p', { className: 'field-help' }, 'ISO: ', ...(plan.image.arch ? [`${plan.image.arch} · ${plan.image.format} · `] : []), ...breakableText(plan.image.name, 32), ` · ${imageSize(plan.image.size)} · SHA-256 `,
        h('code', {}, ...breakableText(plan.image.sha256, 8))) : h('p', { className: 'field-help', textContent: 'No ISO is configured. This will install Ventoy without copying an image.' });
      confirmInput.addEventListener('input', () => { installButton.disabled = confirmInput.value !== currentPlan?.confirm || !!currentPlan?.verification && currentPlan.verification.status === 'mismatch' && !currentPlan.allowUnverified; });
      let verificationWarning = null;
      if (verification?.status === 'mismatch') {
        const planState = currentPlan;
        const retry = h('button', { type: 'button', className: 'button button-secondary', textContent: 'Download again', onclick: () => {
          if (busy || currentPlan !== planState) return;
          clearPlan();
          if (catalogImage) setImageSummary(catalogImage, catalogImage.size);
          else setImageSummary(null);
          setBusy(false); void review();
        } });
        const cancel = h('button', { type: 'button', className: 'button button-secondary', textContent: 'Cancel', onclick: () => {
          if (currentPlan !== planState) return;
          clearPlan();
          if (catalogImage) setImageSummary(catalogImage, catalogImage.size);
          else setImageSummary(null);
          status.textContent = 'USB preparation cancelled. No changes were made.';
        } });
        const proceed = h('button', { type: 'button', className: 'button button-secondary', textContent: 'Use this file anyway', onclick: () => {
          if (currentPlan !== planState || busy) return;
          currentPlan.allowUnverified = true;
          proceed.disabled = true;
          proceed.textContent = 'Using this file anyway';
          setImageSummary(plan.image, verification.actual.size, true);
          installButton.disabled = confirmInput.value !== currentPlan.confirm;
          status.textContent = 'Checksum warning acknowledged. Type the confirmation phrase to continue.';
        } });
        verificationWarning = h('div', { className: 'usb-verification-warning', role: 'alert' },
          h('p', { textContent: 'Checksum does not match. We don’t recommend using this file; it may be damaged or different from the selected release.' }),
          h('p', {}, 'Expected: ', h('strong', { textContent: `${imageSize(verification.expected.size)} (${verification.expected.size.toLocaleString()} bytes) · SHA-256 ` }), h('code', {}, ...breakableText(verification.expected.sha256, 8))),
          h('p', {}, 'Downloaded: ', h('strong', { textContent: `${imageSize(verification.actual.size)} (${verification.actual.size.toLocaleString()} bytes) · SHA-256 ` }), h('code', {}, ...breakableText(verification.actual.sha256, 8))),
          h('div', { className: 'usb-verification-actions' }, retry, cancel, proceed));
      }
      planBox.replaceChildren(
        h('h3', { textContent: action === 'direct' ? 'Direct image write · whole drive erased' : action === 'copy' ? 'Existing Ventoy USB · no format' : 'Drive to erase' }),
        h('p', { className: 'field-help', textContent: `Model: ${plan.drive.model || 'Unknown'} · Capacity: ${size(plan.drive.size)}` }),
        h('p', { className: 'field-help', textContent: `Device path: ${plan.drive.path || 'Unknown'} · Mounted: ${plan.drive.mounted ? 'yes' : 'no'}` }),
        ...(Array.isArray(plan.drive.mounts) && plan.drive.mounts.length ? [h('p', { className: 'field-help', textContent: `Mounted partitions: ${plan.drive.mounts.join(', ')}` })] : [h('p', { className: 'field-help', textContent: 'Mounted partitions: none' })]),
        isoDetails,
        h('p', { className: 'field-help', textContent: plan.warning || (action === 'direct' ? 'This writes the ISO directly to the whole USB and erases all data. Boot compatibility is not guaranteed.' : action === 'copy' ? 'This copies the ISO to the existing Ventoy partition and preserves other files.' : 'This will erase the selected USB drive and install the Ventoy bootloader.') }),
        ...(verificationWarning ? [verificationWarning] : []),
        h('div', { className: 'usb-confirm-row' }, h('label', { className: 'confirmation-label', htmlFor: confirmInput.id }, 'Type ', h('code', { textContent: plan.confirm })), confirmInput),
        h('div', {}, installButton));
      setBusy(false); reviewButton.disabled = true;
      status.textContent = action === 'direct'
        ? `Direct-write plan ready · whole USB erase confirmed by typing ERASE${plan.expiresAt ? ` · expires ${new Date(plan.expiresAt).toLocaleTimeString()}` : ''}.`
        : action === 'copy'
        ? `Copy-only plan ready; existing files will be preserved${plan.expiresAt ? ` · expires ${new Date(plan.expiresAt).toLocaleTimeString()}` : ''}.`
        : plan.expiresAt ? `Plan ready · expires ${new Date(plan.expiresAt).toLocaleTimeString()}.` : 'Plan ready. Review the selected drive, then type the phrase to install.';
    } catch (error) {
      if (catalogImage) setImageSummary(catalogImage, catalogImage.size);
      else setImageSummary(null);
      if (panel.isConnected) status.textContent = error instanceof Error ? error.message : String(error);
      setBusy(false);
    }
  }

  async function install() {
    const plan = currentPlan;
    if (!plan || busy || driveSelect.value !== plan.driveKey || confirmInput?.value !== plan.confirm || plan.verification?.status === 'mismatch' && !plan.allowUnverified) return;
    const expires = Date.parse(plan.expiresAt);
    if (Number.isFinite(expires) && expires <= Date.now()) { clearPlan(); status.textContent = 'The plan expired. Review the installation again.'; return; }
    const confirmation = confirmInput.value;
    activeImageName = plan.imageName;
    activeImageSize = plan.imageSize;
    activeAction = plan.action;
    activeMethod = plan.method;
    activeUnverified = plan.verification?.status === 'mismatch';
    activeReadback = plan.readback;
    clearReportNotice();
    clearPlan(); setBusy(true); jobLog.hidden = false;
    statusCheck.hidden = true; thanks.hidden = true;
    status.textContent = activeMethod === 'direct'
      ? `Writing ${activeImageName || 'the selected ISO'} (${imageSize(activeImageSize)}) directly to USB. All existing drive data is being erased…`
      : activeImageName
        ? activeAction === 'copy' ? `Copying ${activeImageName} (${imageSize(activeImageSize)}) to the existing Ventoy USB…` : `Installing Ventoy and copying ${activeImageName} (${imageSize(activeImageSize)})…`
        : activeAction === 'copy' ? 'Copying the selected ISO to the existing Ventoy USB…' : 'Starting the Ventoy installation…';
    showProgress({ phase: activeMethod === 'direct' ? 'writing' : activeAction === 'copy' ? 'copying' : 'installing' });
    writeDeadline = Date.now() + (activeMethod === 'direct' ? 3 * 60 * 60_000 : 16 * 60_000);
    try {
      if (panelCapabilities?.includes('usb-environment') && !browserEnvironment) browserEnvironment = collectUsbBrowserEnvironment().catch(() => null);
      const browser = panelCapabilities?.includes('usb-environment') ? await browserEnvironment : null;
      if (!panel.isConnected) return;
      const job = await helperRequest(session, '/usb/write', { planId: plan.id, confirm: confirmation,
        ...(plan.allowUnverified ? { allowUnverified: true } : {}), ...(browser ? { browser } : {}) });
      if (!panel.isConnected || showJob(job)) return;
      if (activeJob(job) && Date.now() < writeDeadline) setTimeout(poll, 1500);
      else { statusCheck.hidden = false; statusCheck.disabled = false; }
    } catch (error) {
      if (panel.isConnected) {
        status.textContent = `${error instanceof Error ? error.message : String(error)} The write result is unknown; inspect the USB before trying again.`;
        clearProgress();
        statusCheck.hidden = false; statusCheck.disabled = false;
      }
    }
  }

  function activeJob(job) { return ['pending', 'running', 'queued'].includes(job?.state); }
  function phaseLabel(phase) {
    if (phase === 'syncing') return 'Flushing buffered USB writes';
    if (phase === 'verifying') return activeMethod === 'direct' ? 'Verifying USB readback' : 'Verifying the Ventoy USB copy';
    if (phase === 'copying' || activeMethod !== 'direct' && activeAction === 'copy')
      return `Copying ${activeImageName || 'the selected ISO'} to the existing Ventoy USB`;
    if (phase === 'installing' || phase === 'unmounting' || activeMethod !== 'direct' && activeAction !== 'copy')
      return phase === 'unmounting' ? 'Preparing the USB drive' : 'Installing Ventoy';
    return `Writing ${activeImageName || 'the selected ISO'} directly to USB`;
  }
  function showProgress(job) {
    const declared = job?.progress;
    const phase = job?.phase === 'syncing' ? 'syncing' :
      ['writing', 'verifying', 'copying', 'installing', 'unmounting'].includes(job?.phase) ? job.phase :
        ['writing', 'verifying'].includes(declared?.phase) ? declared.phase :
          activeMethod === 'direct' ? 'writing' : activeAction === 'copy' ? 'copying' : 'installing';
    const valid = declared && typeof declared === 'object' && declared.phase === phase &&
      ['writing', 'verifying'].includes(declared.phase) && Number.isSafeInteger(declared.completedBytes) &&
      Number.isSafeInteger(declared.totalBytes) && declared.completedBytes >= 0 && declared.totalBytes > 0 &&
      declared.completedBytes <= declared.totalBytes &&
      (!Number.isSafeInteger(activeReadback?.size) || declared.totalBytes === activeReadback.size) && job?.phase !== 'syncing';
    const label = phaseLabel(phase);
    progressBox.hidden = false;
    progressLabel.textContent = label;
    if (valid) {
      const percent = Math.floor(declared.completedBytes / declared.totalBytes * 100);
      const bytes = `${declared.completedBytes.toLocaleString()} / ${declared.totalBytes.toLocaleString()} bytes`;
      const completionHint = percent === 100
        ? phase === 'verifying' ? ' · waiting for the readback checksum match' : ' · USB operation still in progress'
        : '';
      progressBar.max = 100;
      progressBar.value = percent;
      progressDetail.textContent = `${percent}% · ${bytes}${completionHint}`;
      progressBar.setAttribute('aria-valuetext', `${label} — ${progressDetail.textContent}`);
    } else {
      progressBar.removeAttribute('value');
      progressDetail.textContent = phase === 'syncing' ? 'This flush phase has no byte counter.' : 'Progress is not reported by this CLI.';
      progressBar.setAttribute('aria-valuetext', `${label} — ${progressDetail.textContent}`);
    }
  }
  function showJob(job) {
    if (activeMethod === 'direct') {
      const reportedDeadline = Date.parse(job?.deadlineAt);
      if (Number.isFinite(reportedDeadline) && reportedDeadline > Date.now()) writeDeadline = Math.min(reportedDeadline, Date.now() + 3 * 60 * 60_000);
    }
    if (Array.isArray(job?.log)) jobLog.textContent = job.log.join('\n');
    else jobLog.textContent = typeof job?.log === 'string' ? job.log : '';
    if (job?.state === 'succeeded') {
      clearProgress();
      reportDelivery(job);
      if (activeImageName && (!validImageMeasure(job.readback) || job.readback.matched !== true || job.readback.sha256 !== activeReadback?.sha256 || job.readback.size !== activeReadback?.size)) {
        status.textContent = 'Operation finished, but the final USB checksum was not confirmed. Check the log before using the USB.';
        statusCheck.hidden = true; setBusy(false); activeImageName = null; activeImageSize = null; activeAction = null; activeMethod = 'ventoy'; activeUnverified = false; activeReadback = null; return true;
      }
      const mismatchAccepted = job?.verification?.status === 'mismatch' && job.verification.accepted === true;
      status.textContent = activeMethod === 'direct'
        ? activeUnverified
          ? mismatchAccepted
            ? `${activeImageName} (${imageSize(activeImageSize)}) written directly to USB; publisher checksum mismatch accepted, and USB readback matched the reviewed download. Boot compatibility untested.`
            : `${activeImageName} (${imageSize(activeImageSize)}) write succeeded, but the helper did not confirm checksum mismatch acceptance. Review the log before use. Boot compatibility untested.`
          : `${activeImageName} (${imageSize(activeImageSize)}) written directly to USB and readback SHA-256 verified. Boot compatibility untested.`
        : activeImageName
          ? activeUnverified
            ? mismatchAccepted
              ? activeAction === 'copy' ? `${activeImageName} (${imageSize(activeImageSize)}) copied to existing Ventoy USB; source checksum mismatch accepted, and USB copy matched the downloaded file. Boot untested.` : `Ventoy prepared; ${activeImageName} (${imageSize(activeImageSize)}) copied with source checksum mismatch accepted; USB copy matched the downloaded file. Boot untested.`
              : `${activeImageName} (${imageSize(activeImageSize)}) operation succeeded, but the helper did not confirm checksum mismatch acceptance. Review the log before use. Boot untested.`
            : activeAction === 'copy' ? `${activeImageName} (${imageSize(activeImageSize)}) copied to existing Ventoy USB; files preserved. Boot untested.` : `Ventoy prepared; ${activeImageName} (${imageSize(activeImageSize)}) copied and verified. Boot untested.`
          : 'Ventoy prepared. No ISO copied. Boot untested.';
      if (!activeUnverified || mismatchAccepted) { status.textContent = `Complete — ${status.textContent}`; thanks.hidden = false; }
      statusCheck.hidden = true; setBusy(false); activeImageName = null; activeImageSize = null; activeAction = null; activeMethod = 'ventoy'; activeUnverified = false; activeReadback = null; return true;
    }
    if (job?.state === 'failed') {
      clearProgress();
      reportDelivery(job);
      status.textContent = `${job.error || (activeMethod === 'direct' ? 'Direct image write failed.' : 'Ventoy installation failed.')} Boot untested; review the log before trying again.`;
      statusCheck.hidden = true; setBusy(false); activeImageName = null; activeImageSize = null; activeAction = null; activeMethod = 'ventoy'; activeUnverified = false; activeReadback = null; return true;
    }
    if (job?.error) clearProgress();
    else if (activeJob(job)) showProgress(job);
    else clearProgress();
    status.textContent = job?.error ? String(job.error) : job?.phase === 'verifying'
      ? activeMethod === 'direct' ? 'Write finished. Checking the USB contents’ SHA-256…' : 'Copy finished. Checking the USB file’s SHA-256…'
      : job?.phase === 'writing' ? `Writing ${activeImageName || 'the selected ISO'} directly to USB…`
        : job?.phase === 'copying' ? `Copying ${activeImageName || 'the selected ISO'} to USB…`
          : activeMethod === 'direct' ? `Direct image write ${job?.state || 'status unknown'}…` : `Ventoy installation ${job?.state || 'status unknown'}…`;
    return false;
  }
  async function poll() {
    if (!panel.isConnected) return;
    if (Date.now() >= writeDeadline) {
      status.textContent = 'Status check timed out. The write may still be running; inspect the USB and helper before trying again.';
      clearProgress();
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
        clearProgress();
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
        clearProgress();
        statusCheck.disabled = false;
      }
    }
  }

  setTimeout(() => { if (panel.isConnected) void refresh(); }, 0);
  return panel;
}
