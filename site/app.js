import { assertConsent, recipes, selectFiles, stepsFor } from '../src/catalog.js';
import { fetchPinned } from '../src/fetch.js';
import { connect } from '../src/protocols/usb.js';

const DONATE = 'https://www.buymeacoffee.com/philipplinux';
const supported = 'usb' in navigator && window.isSecureContext;
const params = new URLSearchParams(location.search);

/** Tiny DOM builder: catalog data only ever lands in text nodes, never in innerHTML.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag @param {Record<string, any>} props @param {any[]} children @returns {HTMLElementTagNameMap[K]} */
function h(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(c => c !== null && c !== undefined && c !== false && c !== ''));
  return node;
}
/** Catalog text with `code` spans. @param {string} text */
const rich = (text = '') => text.split('`').map((part, i) => i % 2 ? h('code', {}, part) : part);
/** @param {unknown} error */
const message = error => {
  const text = error instanceof Error ? error.message : String(error);
  // Another program (usually the PC's own fastboot/adb) holds the USB interface.
  return /in use|claim|access denied/i.test(text) ? `${text} Close other USB tools (adb kill-server, no running fastboot). On Linux you may need the android-udev rules.` : text;
};
const main = /** @type {HTMLElement} */ (document.getElementById('main'));
const go = (/** @type {Record<string,string>} */ query) => { location.search = `?${new URLSearchParams(query)}`; };

const MODE = { fastboot: 'FASTBOOT', download: 'DOWNLOAD MODE', recovery: 'RECOVERY (TWRP)' };
const CONNECT = { fastboot: 'Connect fastboot', odin: 'Connect Download Mode', adb: 'Connect ADB' };
/** One readable line per step for the card. @param {any[]} step */
const describe = ([verb, a, b]) => ({ flash: `${b} → ${a}`, write: `${b} → ${a}`, erase: `erase ${a}`, set_active: `switch to slot ${a}`,
  reboot: 'reboot', mkfs_ext4: `format ${a} as ext4 (${b})` })[verb] ?? verb;

/** One stage card: connect, files, options, consent, flash. @param {any} device @param {any} stage @param {number} n @param {number} count */
function stageCard(device, stage, n, count) {
  const { protocol } = recipes[stage.recipe];
  const st = { session: /** @type {any} */ (null), usb: /** @type {USBDevice|undefined} */ (undefined), lost: false, busy: false, finished: false,
    files: /** @type {ReturnType<typeof selectFiles>|null} */ (null) };
  const connectButton = h('button', { className: 'button button-secondary', type: 'button', textContent: CONNECT[protocol] });
  const status = h('p', { className: 'status', role: 'status', textContent: `Put the phone in ${MODE[stage.mode].toLowerCase()}, then connect.` });
  status.setAttribute('aria-live', 'polite');
  const total = stage.files.reduce((sum, f) => sum + f.size, 0);
  const download = h('button', { className: 'button button-secondary download-button', type: 'button',
    textContent: `Download ${stage.files.length === 1 ? stage.files[0].name : `the ${stage.files.length} files`} (${(total / 1024 / 1024).toFixed(0)} MiB)` });
  const picker = h('input', { type: 'file', multiple: stage.files.length > 1 });
  const selected = h('ul', { className: 'selected-files' }, h('li', { className: 'empty-files', textContent: 'No files selected' }));
  const options = (stage.options ?? []).map(option => h('input', { type: 'checkbox', checked: option.default }));
  const risk = h('input', { type: 'checkbox' });
  const confirm = h('input', { className: 'confirmation-input', type: 'text', placeholder: stage.confirm, autocomplete: 'off', spellcheck: false });
  const flash = h('button', { className: 'button button-primary', type: 'button', disabled: true, textContent: `Run stage ${n}` });
  const progress = h('progress', { max: 100, value: 0 });
  const percent = h('span', { textContent: '0%' });
  const log = h('ol');

  const update = () => {
    connectButton.disabled = !supported || st.busy || st.session !== null || st.lost;
    flash.disabled = !supported || !st.session || st.lost || st.busy || st.finished || !st.files || !risk.checked || confirm.value !== stage.confirm;
    download.disabled = st.busy;
  };
  const report = (/** @type {string} */ text, fraction = 0) => {
    status.textContent = text;
    progress.value = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    percent.textContent = `${progress.value}%`;
    if (log.lastElementChild?.textContent !== text) log.append(h('li', { textContent: text }));
  };
  const assertSession = () => {
    if (st.lost || !st.session) throw Error('USB session lost. Reload the page before reconnecting; no automatic retry.');
  };
  const pick = (/** @type {File[]} */ files) => {
    try {
      st.files = selectFiles(stage, files);
      selected.replaceChildren(...st.files.map(f => h('li', { textContent: `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MiB)` })));
    } catch (error) {
      st.files = null;
      selected.replaceChildren(h('li', { textContent: message(error) }));
    }
    update();
  };

  if (supported) navigator.usb.addEventListener('disconnect', event => {
    if (st.usb && event.device === st.usb && !st.finished) {
      st.lost = true;
      report('USB disconnected. The flash may be incomplete; reload before reconnecting.');
      update();
    }
  });
  connectButton.addEventListener('click', async () => {
    st.busy = true; update();
    try {
      Object.assign(st, await connect(protocol));
      report('Connected. Download or pick the files, confirm, and run.');
    } catch (error) {
      report(`${message(error)} Reload to try again.`);
    } finally { st.busy = false; update(); }
  });
  picker.addEventListener('change', () => pick([...picker.files ?? []]));
  download.addEventListener('click', async () => {
    st.busy = true; update();
    try {
      const files = [];
      for (const pin of stage.files) files.push(await fetchPinned(pin, f => report(`Downloading ${pin.name}`, f)));
      pick(files);
      report('Downloaded and selected. The SHA-256 is checked before anything is written.', 1);
    } catch (error) {
      report(message(error));
    } finally { st.busy = false; update(); }
  });
  flash.addEventListener('click', async () => {
    if (flash.disabled || !st.files) return;
    st.busy = true; update();
    try {
      assertConsent(stage, { consent: risk.checked, confirmation: confirm.value });
      const enabled = Object.fromEntries(options.map((box, i) => [stage.options[i].id, box.checked]));
      await recipes[stage.recipe].run(st.session, { device, stage, files: st.files, steps: stepsFor(stage, enabled) }, report, assertSession);
      st.finished = true;
      log.append(h('li', {}, ...rich(stage.done)));
      if (n === count) log.append(h('li', {}, 'Worked? ', h('a', { href: DONATE, target: '_blank', rel: 'noopener noreferrer', textContent: 'Buy the maintainer a beer' }), '.'));
    } catch (error) {
      st.lost = true;
      report(`STOPPED: ${message(error)} Do not retry blindly; reload the page first.`);
    } finally { st.busy = false; update(); }
  });
  risk.addEventListener('change', update);
  confirm.addEventListener('input', update);
  update();

  const guide = [device.modes[stage.mode], protocol !== 'adb' && device.unlock?.text, 'Connect first: it tells you right away if the phone is busy. Then download the files or pick copies you already have.']
    .filter(Boolean).map((text, i) => h('li', {}, h('span', { textContent: String(i + 1).padStart(2, '0') }), h('p', {}, ...rich(text))));
  return h('section', { className: 'flash-card stage-card' },
    h('div', { className: 'card-heading' },
      h('div', {}, h('p', { className: 'eyebrow', textContent: `STAGE ${n} OF ${count} · ${MODE[stage.mode]}` }), h('h2', { textContent: stage.title })),
      h('span', { className: 'version-chip', textContent: stage.recipe.toUpperCase() })),
    stage.optional && h('p', { className: 'field-help', textContent: stage.optional }),
    h('p', { className: 'field-help', textContent: `Steps: ${stepsFor(stage).map(describe).join(' · ')}.` }),
    h('ol', { className: 'guide-list stage-steps' }, ...guide),
    h('div', { className: 'connect-row' }, connectButton, status),
    download,
    h('label', { className: 'file-picker' }, h('span', { className: 'file-picker-icon', textContent: '＋' }),
      h('span', {}, h('strong', { textContent: `Or choose ${stage.files.map(f => f.name).join(', ')}` }), h('small', { textContent: 'Size and SHA-256 are checked before writing' })), picker),
    selected,
    ...(stage.options ?? []).map((option, i) => h('label', { className: 'risk-check' }, options[i], h('span', { textContent: option.label }))),
    h('label', { className: 'risk-check' }, risk, h('span', {}, h('strong', { textContent: 'I understand: ' }), stage.warning)),
    h('label', { className: 'field-label confirmation-label' }, 'Type ', h('code', { textContent: stage.confirm }), ' to confirm'),
    confirm,
    h('div', { className: 'flash-actions' }, flash),
    h('div', { className: 'progress-row' }, progress, percent),
    h('section', { className: 'activity' }, h('div', { className: 'activity-heading' }, h('h3', { textContent: 'Activity' }), h('span', { className: 'activity-label', textContent: 'LOCAL SESSION' })), log));
}

/** @param {any[]} index */
function devicePicker(index) {
  const search = h('input', { className: 'confirmation-input', type: 'search', placeholder: 'Search vendor, name, model or codename', autofocus: true });
  const list = h('ul', { className: 'selected-files' });
  const render = () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = index.filter(d => words.every(w => [d.vendor, d.name, d.codename, ...d.models].join(' ').toLowerCase().includes(w)));
    list.replaceChildren(...hits.map(d => h('li', {}, h('a', { href: `?device=${encodeURIComponent(d.codename)}`, textContent: `${d.vendor} ${d.name}` }),
      ` · ${d.codename} · ${d.models.join(', ')} · ${d.roms.map(r => `${r.os} ${r.version}`).join(', ')}`)));
    if (!hits.length) list.append(h('li', { className: 'empty-files', textContent: 'No device matches. The catalog grows through pull requests.' }));
  };
  search.addEventListener('input', render);
  render();
  return h('section', { className: 'flash-card' }, h('label', { className: 'field-label', textContent: 'Find your phone' }), search, list);
}

async function start() {
  if (!supported) main.append(h('p', { className: 'experimental-note', textContent: 'Open this page over HTTPS in desktop Chrome or Edge: flashing needs WebUSB.' }));
  const codename = params.get('device');
  if (!codename) {
    const index = await (await fetch('./catalog/index.json')).json();
    main.append(devicePicker(index));
    return;
  }
  const response = await fetch(`./catalog/${encodeURIComponent(codename)}.json`);
  if (!response.ok) { main.append(h('p', { className: 'status', textContent: `Unknown device ${codename}.` }), h('a', { href: './', textContent: 'Back to all devices' })); return; }
  const device = await response.json();
  const rom = device.roms.find((/** @type {any} */ r) => r.id === params.get('rom')) ?? device.roms[0];
  document.title = `${device.vendor} ${device.name} · ROMinit`;
  const romSelect = h('select', { className: 'confirmation-input' }, ...device.roms.map((/** @type {any} */ r) => new Option(`${r.name} ${r.version} (${r.tier})`, r.id, false, r === rom)));
  romSelect.addEventListener('change', () => go({ device: codename, rom: romSelect.value }));
  main.append(h('section', { className: 'intro' },
    h('p', { className: 'eyebrow' }, h('a', { href: './', textContent: 'ALL DEVICES' }), ` // ${device.vendor.toUpperCase()}`),
    h('h1', {}, 'Flash your ', h('span', { textContent: `${device.name}.` })),
    h('p', { className: 'intro-copy', textContent: `${device.vendor} ${device.name} (${device.models.join(', ')}, ${device.codename}) only. ${device.notes ?? ''} Everything runs in this browser; nothing is uploaded.` }),
    h('label', { className: 'field-label', textContent: 'ROM' }), romSelect,
    rom && h('p', { className: 'intro-copy' }, ...rich(`${rom.notes ?? ''}${rom.login ? ` Login afterwards: \`${rom.login}\`, change it.` : ''} `),
      rom.homepage && h('a', { href: rom.homepage, target: '_blank', rel: 'noopener noreferrer', textContent: 'Release page' })),
    device.recovery && h('p', { className: 'experimental-note' }, h('strong', { textContent: 'Way back: ' }), ...rich(device.recovery.text), ' ',
      device.recovery.url && h('a', { href: device.recovery.url, target: '_blank', rel: 'noopener noreferrer', textContent: 'More' }))));
  if (rom) main.append(h('div', { className: 'stages' }, ...rom.stages.map((/** @type {any} */ stage, /** @type {number} */ i) => stageCard(device, stage, i + 1, rom.stages.length))));
}
start().catch(error => main.append(h('p', { className: 'status', textContent: `Could not load the catalog: ${message(error)}` })));
