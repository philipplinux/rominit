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
  // Files with direct links are fetched from the publisher when the stage runs; the rest the user downloads from the source page.
  const direct = stage.files.every(f => f.urls.length);
  const total = stage.files.reduce((sum, f) => sum + f.size, 0);
  const save = h('input', { type: 'checkbox' });
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
    flash.disabled = !supported || !st.session || st.lost || st.busy || st.finished || !(st.files || direct) || !risk.checked || confirm.value !== stage.confirm;
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
      report(direct ? 'Connected. Confirm and run: the files download from source first.' : 'Connected. Choose the files, confirm, and run.');
    } catch (error) {
      report(`${message(error)} Reload to try again.`);
    } finally { st.busy = false; update(); }
  });
  picker.addEventListener('change', () => pick([...picker.files ?? []]));
  /** Downloads every file from its publisher; nothing is cached, only saved to disk when asked. */
  const download = async () => {
    const files = [];
    for (const pin of stage.files) {
      const file = await fetchPinned(pin, f => report(`Downloading ${pin.name} from source`, f));
      if (save.checked) {
        const link = h('a', { href: URL.createObjectURL(file), download: file.name });
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
      }
      files.push(file);
    }
    return selectFiles(stage, files);
  };
  flash.addEventListener('click', async () => {
    if (flash.disabled) return;
    st.busy = true; update();
    try {
      assertConsent(stage, { consent: risk.checked, confirmation: confirm.value });
      const enabled = Object.fromEntries(options.map((box, i) => [stage.options[i].id, box.checked]));
      const files = st.files ?? await download();
      await recipes[stage.recipe].run(st.session, { device, stage, files, steps: stepsFor(stage, enabled) }, report, assertSession);
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

  const guide = [device.modes[stage.mode], protocol !== 'adb' && device.unlock?.text, direct ? 'Connect first: it tells you right away if the phone is busy. Running downloads the files from their source, or choose copies you already have.'
    : 'Download the files from the source links below, then connect and choose them.']
    .filter(Boolean).map((text, i) => h('li', {}, h('span', { textContent: String(i + 1).padStart(2, '0') }), h('p', {}, ...rich(text))));
  return h('section', { className: 'flash-card stage-card' },
    h('div', { className: 'card-heading' },
      h('div', {}, h('p', { className: 'eyebrow', textContent: `STAGE ${n} OF ${count} · ${MODE[stage.mode]}` }), h('h2', { textContent: stage.title })),
      h('span', { className: 'version-chip', textContent: stage.recipe.toUpperCase() })),
    stage.optional && h('p', { className: 'field-help', textContent: stage.optional }),
    h('p', { className: 'field-help', textContent: `Steps: ${stepsFor(stage).map(describe).join(' · ')}.` }),
    h('ol', { className: 'guide-list stage-steps' }, ...guide),
    h('div', { className: 'connect-row' }, connectButton, status),
    h('ul', { className: 'selected-files' }, ...stage.files.map(f => h('li', {}, `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MiB) · `,
      h('a', { href: f.source, target: '_blank', rel: 'noopener noreferrer', textContent: f.urls.length ? 'source' : 'get it from source' })))),
    direct && h('label', { className: 'risk-check' }, save, h('span', { textContent: `Also save the downloaded files (${(total / 1024 / 1024).toFixed(0)} MiB) to disk. Nothing is cached otherwise.` })),
    h('label', { className: 'file-picker' }, h('span', { className: 'file-picker-icon', textContent: '＋' }),
      h('span', {}, h('strong', { textContent: `${direct ? 'Or choose' : 'Choose'} ${stage.files.map(f => f.name).join(', ')}` }), h('small', { textContent: 'Size and SHA-256 are checked before writing' })), picker),
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
  const roms = device.roms.filter((/** @type {any} */ r) => r.tier !== 'stock');
  const stock = device.roms.filter((/** @type {any} */ r) => r.tier === 'stock');
  const rom = roms.find((/** @type {any} */ r) => r.id === params.get('rom')) ?? roms[0];
  document.title = `${device.vendor} ${device.name} · ROMinit`;
  const romSelect = h('select', { className: 'confirmation-input' }, ...roms.map((/** @type {any} */ r) => new Option(`${r.name} ${r.version} (${r.tier})`, r.id, false, r === rom)));
  romSelect.addEventListener('change', () => go({ device: codename, rom: romSelect.value }));
  const link = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: text });
  /** One of the three collapsible page sections. @param {string} title @param {string} hint @param {boolean} open @param {any[]} body */
  const section = (title, hint, open, body) => h('details', { className: 'page-section', open },
    h('summary', {}, h('span', { textContent: title }), h('small', { textContent: hint })), ...body);
  /** Stage cards of one ROM, numbered across the whole ROM. @param {any} r @param {string} which */
  const cards = (r, which) => r.stages.flatMap((/** @type {any} */ stage, /** @type {number} */ i) =>
    stage.section === which ? [stageCard(device, stage, i + 1, r.stages.length)] : []);
  const tools = rom ? cards(rom, 'tools') : [];
  main.append(
    h('section', { className: 'intro' },
      h('p', { className: 'eyebrow' }, h('a', { href: './', textContent: 'ALL DEVICES' }), ` // ${device.vendor.toUpperCase()}`),
      h('h1', {}, 'Flash your ', h('span', { textContent: `${device.name}.` })),
      h('p', { className: 'intro-copy', textContent: `${device.vendor} ${device.name} (${device.models.join(', ')}, ${device.codename}) only. ${device.notes ?? ''} Everything runs in this browser; files come straight from their source and nothing is uploaded.` })),
    section('1 · Recovery tools', tools.length ? 'needed for this ROM; skip if already installed' : 'not needed for this ROM', tools.length > 0,
      tools.length ? [h('div', { className: 'stages' }, ...tools)] : [h('p', { className: 'field-help', textContent: 'This ROM flashes without a custom recovery.' })]),
    section('2 · ROM', rom ? `${rom.name} ${rom.version}` : 'none in the catalog yet', true, [
      h('label', { className: 'field-label', textContent: 'ROM' }), romSelect,
      rom && h('p', { className: 'intro-copy' }, ...rich(`${rom.notes ?? ''}${rom.login ? ` Login afterwards: \`${rom.login}\`, change it.` : ''} `), rom.homepage && link(rom.homepage, 'Release page')),
      rom && h('div', { className: 'stages' }, ...cards(rom, 'rom'))]),
    section('3 · Recover / revert', stock.length ? 'back to stock' : 'manual for now', false, [
      device.recovery && h('p', { className: 'experimental-note' }, h('strong', { textContent: 'Way back: ' }), ...rich(device.recovery.text), ' ', device.recovery.url && link(device.recovery.url, 'More')),
      ...stock.map((/** @type {any} */ r) => h('div', { className: 'stages' }, h('p', { className: 'intro-copy' }, `${r.name} ${r.version}. `, ...rich(r.notes ?? ''), ' ', r.homepage && link(r.homepage, 'Source')),
        ...r.stages.map((/** @type {any} */ stage, /** @type {number} */ i) => stageCard(device, stage, i + 1, r.stages.length))))]));
}
start().catch(error => main.append(h('p', { className: 'status', textContent: `Could not load the catalog: ${message(error)}` })));
