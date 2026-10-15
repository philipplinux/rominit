import { FEATURES, FEATURE_GROUPS, INCLUDES, ORIGINS, STATUSES, USES, assertConsent, completeness, recipes, selectFiles, stepsFor } from '../src/catalog.js';
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

const size = (/** @type {number} */ bytes) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const MARK = { works: '✓', partial: '~', broken: '✗', untested: '?' };
const LABEL = { usb_net: 'USB networking', wifi: 'Wi-Fi', gpu: '3D acceleration', camera_flash: 'camera flash', ir: 'IR blaster', gps: 'GPS', nfc: 'NFC',
  data: 'mobile data', fde: 'disk encryption', otg: 'USB OTG', hdmi: 'HDMI/DP', light: 'ambient light', hall: 'hall sensor', sdcard: 'SD card', google_play: 'Google Play', microg: 'microG', android_apps: 'Android apps',
  phone_ui: 'phone UI', updates: 'updates', encryption: 'encryption', relock: 'bootloader relock', banking_apps: 'banking apps', ssh: 'SSH', docker: 'Docker' };
/** Includes / lacks rows; optional items are listed as add-ons. @param {any} rating */
const includesRows = rating => ['yes', 'optional', 'no'].map(value => {
  const items = INCLUDES.filter(i => rating.includes[i] === value);
  return items.length > 0 && h('p', { className: `rating includes ${value}` }, h('strong', { textContent: ({ yes: 'Includes', optional: 'Add-on', no: 'Lacks' })[value] }),
    ...items.map(i => h('span', { className: 'feature', textContent: LABEL[i] ?? i })));
});
/** "7/10 work" summary for lists. @param {any} rating */
/** "as computer 67% (4 untested)" @param {any} rating @param {'computer'|'phone'} use @param {boolean} details */
const complete = (rating, use, details = false) => {
  const untested = USES[use].filter(f => rating.features[f] === 'untested').length;
  return `as ${use} ${completeness(rating, USES[use])}%${details && untested ? ` (${untested} untested)` : ''}`;
};
const score = rating => `${complete(rating, 'computer')} · ${complete(rating, 'phone')} · ${rating.kernel.type} kernel ${rating.kernel.version} · ${rating.support}`;
/** Origin and status chips, colored like the feature states. @param {any} rom */
const kindRow = rom => h('p', { className: 'rating' }, h('strong', { textContent: 'release' }),
  h('span', { className: 'feature', title: ORIGINS[rom.origin], textContent: rom.origin }),
  h('span', { className: `feature ${({ stable: 'works', legacy: 'untested', broken: 'broken' })[rom.status] ?? 'partial'}`, title: STATUSES[rom.status], textContent: rom.status }),
  rom.curated && h('span', { className: 'feature works', title: 'picked and checked by hand by ROMinit maintainers', textContent: 'curated ★' }),
  h('small', { textContent: `${ORIGINS[rom.origin]}; ${STATUSES[rom.status]}${rom.curated ? '; checked by hand by ROMinit' : ''}` }));
const KERNEL = { mainline: 'mainline: gets upstream fixes', downstream: 'downstream: vendor fork, no upstream fixes' };
/** Kernel, base, build date and support. @param {any} rating */
const metaRow = rating => h('p', { className: 'rating' }, ...[`kernel ${rating.kernel.version} (${KERNEL[rating.kernel.type]})`, rating.base,
  `built ${rating.released}`, `support: ${rating.support}`, complete(rating, 'computer', true), complete(rating, 'phone', true)].map(text => h('span', { className: 'feature', textContent: text })));
/** Default login, shown where people look for it. @param {string} login `user / password` */
const loginRow = login => { const [user, password] = login.split(' / ');
  return h('p', { className: 'rating' }, h('strong', { textContent: 'login' }), h('span', { className: 'feature', textContent: `user: ${user}` }),
    h('span', { className: 'feature', textContent: `password: ${password}` }), h('small', { textContent: 'change it after the first login (passwd)' })); };
/** Feature row: ✓ works, ~ partial, ✗ broken, ? untested. @param {any} rating */
const ratingRow = rating => h('div', {}, ...Object.entries(FEATURE_GROUPS).map(([group, features]) => h('p', { className: 'rating' }, h('strong', { textContent: group }),
  ...features.filter(f => rating.features[f] !== 'n/a').map(f => h('span', { className: `feature ${rating.features[f]}`, title: rating.features[f],
    textContent: `${LABEL[f] ?? f} ${MARK[rating.features[f]]}` })))), h('small', { className: 'field-help', textContent: `Feature list follows the postmarketOS wiki · curated ${rating.checked}` }));
/** Count one view or flash of a ROM; failures are ignored. @param {string} rom @param {'view'|'flash'} kind */
const bump = (rom, kind) => fetch('./api/counts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rom, kind }) }).catch(() => {});
/** "120 views · 12 successful flashes"; counts this view first. Hidden where there is no API. @param {string} key */
function countsRow(key) {
  const views = h('span', { className: 'feature' }), flashes = h('span', { className: 'feature' });
  const row = h('p', { className: 'rating', hidden: true }, h('strong', { textContent: 'stats' }), views, flashes,
    h('small', { textContent: 'views and successful flashes through this page, once per visitor per day / hour' }));
  bump(key, 'view').then(() => fetch('./api/counts', { cache: 'no-store' })).then(r => r?.ok ? r.json() : Promise.reject()).then((/** @type {any} */ all) => {
    const n = all[key] ?? { view: 0, flash: 0 };
    views.textContent = `${n.view} view${n.view === 1 ? '' : 's'}`; flashes.textContent = `${n.flash} successful flash${n.flash === 1 ? '' : 'es'}`; row.hidden = false; }, () => {});
  return row;
}
/**
 * Screenshots or GIFs of the ROM running, one at a time with arrows and "2 / 5" when there are several. Swipe works through scroll-snap.
 * @param {{src:string, caption?:string}[]} shots
 */
function slideshow(shots) {
  const track = h('div', { className: 'slides' }, ...shots.map(shot => h('figure', {}, h('img', { src: shot.src, alt: shot.caption ?? '', loading: 'lazy' }), shot.caption && h('figcaption', { textContent: shot.caption }))));
  if (shots.length < 2) return h('div', { className: 'slideshow' }, track);
  const counter = h('span', { className: 'slide-count', textContent: `1 / ${shots.length}` });
  const at = () => Math.round(track.scrollLeft / track.clientWidth);
  const go = (/** @type {number} */ step) => track.scrollTo({ left: ((at() + step + shots.length) % shots.length) * track.clientWidth, behavior: 'smooth' });
  track.addEventListener('scroll', () => { counter.textContent = `${at() + 1} / ${shots.length}`; });
  return h('div', { className: 'slideshow' }, track,
    h('button', { className: 'slide-prev', type: 'button', 'aria-label': 'Previous screenshot', textContent: '‹', onclick: () => go(-1) }),
    h('button', { className: 'slide-next', type: 'button', 'aria-label': 'Next screenshot', textContent: '›', onclick: () => go(1) }), counter);
}
/** A/B or single slot plus everything the install assumes. @param {any} rom */
const requirementsRow = rom => h('div', { className: 'requirements' }, h('p', { className: 'rating' }, h('strong', { textContent: 'install' }),
  h('span', { className: 'feature', textContent: rom.slots === 'ab' ? 'A/B slots' : 'single slot' })),
  h('ul', {}, ...rom.requirements.map((/** @type {string} */ r) => h('li', {}, ...rich(r)))));
/** User stars from the ratings API; stays hidden where there is no API (static preview). @param {string} key `<codename>/<rom id>` */
function starsRow(key) {
  const summary = h('span', { className: 'feature' }), status = h('small', {});
  const row = h('p', { className: 'rating', hidden: true }, h('strong', { textContent: 'users' }), summary);
  const show = (/** @type {any} */ all) => { const r = all[key]; summary.textContent = r ? `★ ${r.stars} / 5 · ${r.votes} vote${r.votes === 1 ? '' : 's'}` : 'no votes yet'; row.hidden = false; };
  const load = () => fetch('./api/ratings', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(show, () => {});
  for (const n of [1, 2, 3, 4, 5]) {
    const button = h('button', { type: 'button', className: 'feature star', textContent: '★'.repeat(n), title: `Rate ${n} of 5` });
    button.addEventListener('click', async () => {
      status.textContent = 'Saving…';
      const response = await fetch('./api/ratings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rom: key, stars: n }) }).catch(() => null);
      status.textContent = response?.ok ? `Thanks, you rated ${n} / 5.` : 'Could not save the rating.';
      load();
    });
    row.append(button);
  }
  row.append(status);
  load();
  return row;
}
/** Re-encode a screenshot as WebP, at most 1280 px wide/high; drops EXIF (location) on the way. Returns base64 or null. @param {File|undefined} file */
async function webp(file) {
  if (!file) return null;
  const bitmap = await createImageBitmap(file), scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.8, 0.6, 0.4]) {
    const blob = await new Promise(done => canvas.toBlob(done, 'image/webp', quality));
    if (blob && blob.size <= 400_000) return btoa(Array.from(new Uint8Array(await blob.arrayBuffer()), b => String.fromCharCode(b)).join(''));
  }
  throw Error('screenshot too large');
}
/** Comments of one ROM; hidden where there is no API. Text only, never HTML. @param {string} key `<codename>/<rom id>` */
function commentsBox(key) {
  const list = h('ol', { className: 'comments' }), status = h('small', {});
  const name = h('input', { className: 'confirmation-input', placeholder: 'name (optional)', maxLength: 40 });
  const text = h('textarea', { className: 'confirmation-input', placeholder: 'How did it go on your phone?', maxLength: 2000, rows: 3 });
  const shot = h('input', { type: 'file', accept: 'image/*', title: 'Screenshot (optional)' });
  const post = h('button', { type: 'button', className: 'button button-secondary', textContent: 'Post comment' });
  const box = h('div', { className: 'comment-box', hidden: true }, h('p', { className: 'field-label', textContent: 'Comments' }), list, name, text, h('label', { className: 'field-help' }, 'Screenshot (optional): ', shot), post, status);
  const url = `./api/comments?rom=${encodeURIComponent(key)}`;
  const load = () => fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then((/** @type {any[]} */ rows) => {
    list.replaceChildren(...rows.map(c => h('li', {}, h('small', { textContent: `${c.name} · ${c.at.slice(0, 16)} UTC` }), h('p', { textContent: c.text }),
      c.image === 'approved' ? h('a', { href: `./api/image?id=${c.id}`, target: '_blank' }, h('img', { src: `./api/image?id=${c.id}`, alt: 'screenshot', loading: 'lazy' }))
        : c.image ? h('small', { textContent: 'Screenshot awaiting review.' }) : '')));
    if (!rows.length) list.append(h('li', {}, h('small', { textContent: 'No comments yet.' })));
    box.hidden = false;
  }, () => {});
  post.addEventListener('click', async () => {
    status.textContent = 'Posting…';
    let image = null;
    try { image = await webp(shot.files?.[0]); } catch { status.textContent = 'Could not use that screenshot (too large or not an image).'; return; }
    const response = await fetch('./api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rom: key, name: name.value, text: text.value, image }) }).catch(() => null);
    const reply = await response?.json().catch(() => ({}));
    status.textContent = response?.ok ? (image ? 'Posted. The screenshot shows after review.' : 'Posted.') : `Could not post: ${reply?.error ?? 'network error'}.`;
    if (response?.ok) { text.value = ''; shot.value = ''; load(); }
  });
  load();
  return box;
}
const MODE = { fastboot: 'FASTBOOT', download: 'DOWNLOAD MODE', recovery: 'RECOVERY (TWRP)', sideload: 'TWRP ADB SIDELOAD' };
const CONNECT = { fastboot: 'Connect fastboot', odin: 'Connect Download Mode', adb: 'Connect ADB', sideload: 'Connect sideload' };
/** One readable line per step for the card. @param {any[]} step */
const describe = ([verb, a, b]) => ({ flash: `${b} → ${a}`, write: `${b} → ${a}`, erase: `erase ${a}`, set_active: `switch to slot ${a}`,
  reboot: 'reboot', sideload: `install ${a}`, mkfs_ext4: `format ${a} as ext4 (${b})` })[verb] ?? verb;

/** One stage card: connect, files, options, consent, flash. @param {any} device @param {any} stage @param {number} n @param {number} count @param {string} key `<codename>/<rom id>` */
function stageCard(device, stage, n, count, key) {
  const { protocol } = recipes[stage.recipe];
  const st = { session: /** @type {any} */ (null), usb: /** @type {USBDevice|undefined} */ (undefined), lost: false, busy: false, finished: false,
    files: /** @type {ReturnType<typeof selectFiles>|null} */ (null) };
  const connectButton = h('button', { className: 'button button-secondary', type: 'button', textContent: CONNECT[protocol] });
  const status = h('p', { className: 'status', role: 'status', textContent: `Put the phone in ${MODE[stage.mode].toLowerCase()}, then connect.` });
  status.setAttribute('aria-live', 'polite');
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
      selected.replaceChildren(...st.files.map(f => h('li', { textContent: `${f.name} (${size(f.size)})` })));
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
      report('Connected. Choose the files, confirm, and run.');
    } catch (error) {
      report(`${message(error)} Reload to try again.`);
    } finally { st.busy = false; update(); }
  });
  picker.addEventListener('change', () => pick([...picker.files ?? []]));
  flash.addEventListener('click', async () => {
    if (flash.disabled || !st.files) return;
    st.busy = true; update();
    try {
      assertConsent(stage, { consent: risk.checked, confirmation: confirm.value });
      const enabled = Object.fromEntries(options.map((box, i) => [stage.options[i].id, box.checked]));
      await recipes[stage.recipe].run(st.session, { device, stage, files: st.files, steps: stepsFor(stage, enabled) }, report, assertSession);
      st.finished = true;
      status.dispatchEvent(new Event('stage-done', { bubbles: true })); // turns a required page section green
      log.append(h('li', {}, ...rich(stage.done)));
      if (n === count) bump(key, 'flash');
    } catch (error) {
      st.lost = true;
      report(`STOPPED: ${message(error)} Do not retry blindly; reload the page first.`);
    } finally { st.busy = false; update(); }
  });
  risk.addEventListener('change', update);
  confirm.addEventListener('input', update);
  update();

  const guide = [device.modes[stage.mode], protocol !== 'adb' && protocol !== 'sideload' && device.unlock && 'Bootloader unlocked? See 1 · Unlock bootloader.', 'Download the files below from their source, then connect and choose them. Connecting first tells you right away if the phone is busy.']
    .filter(Boolean).map((text, i) => h('li', {}, h('span', { textContent: String(i + 1).padStart(2, '0') }), h('p', {}, ...rich(text))));
  return h('section', { className: 'flash-card stage-card' },
    h('div', { className: 'card-heading' },
      h('div', {}, h('p', { className: 'eyebrow', textContent: `STAGE ${n} OF ${count} · ${MODE[stage.mode]}` }), h('h2', { textContent: stage.title })),
      h('span', { className: 'version-chip', textContent: stage.recipe.toUpperCase() })),
    stage.optional && h('p', { className: 'field-help', textContent: stage.optional }),
    stepsFor(stage).length > 8
      ? h('details', { className: 'field-help' }, h('summary', { textContent: `${stepsFor(stage).length} steps` }), stepsFor(stage).map(describe).join(' · '))
      : h('p', { className: 'field-help', textContent: `Steps: ${stepsFor(stage).map(describe).join(' · ')}.` }),
    h('ol', { className: 'guide-list stage-steps' }, ...guide),
    h('div', { className: 'connect-row' }, connectButton, status),
    h('ul', { className: 'selected-files file-links' }, ...stage.files.map(f => h('li', {}, `${f.name} (${size(f.size)}) · `,
      f.url && h('a', { href: f.url, rel: 'noopener noreferrer', textContent: 'download' }), f.url && ' · ',
      h('a', { href: f.source, target: '_blank', rel: 'noopener noreferrer', textContent: 'source page' })))),
    h('label', { className: 'file-picker' }, h('span', { className: 'file-picker-icon', textContent: '＋' }),
      h('span', {}, h('strong', { textContent: `Choose ${stage.files.map(f => f.name).join(', ')}` }), h('small', { textContent: 'Size and SHA-256 are checked before writing' })), picker),
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
  const search = h('input', { className: 'confirmation-input', type: 'search', placeholder: 'Search vendor, name, model or codename', autofocus: true, value: params.get('q') ?? '' });
  const list = h('div', { className: 'device-tree' });
  const romsOf = (/** @type {any} */ d) => d.roms.map((/** @type {any} */ r) => `${r.os} ${r.version} (${r.origin}, ${r.status}${r.curated ? ', curated' : ''}, ${score(r.rating)})`).join(', ');
  const deviceLink = (/** @type {any} */ d) => h('li', {}, h('a', { href: `?device=${encodeURIComponent(d.codename)}`, textContent: d.variant }), ` · ${d.models.join(', ')} · ${d.codename} · ${romsOf(d)}`);
  /** Variants we know but cannot flash, listed so owners see why. */
  const unsupportedItems = (/** @type {any} */ d) => (d.unsupported ?? []).map((/** @type {any} */ u) => h('li', { className: 'unsupported' }, `${u.name} · ${u.models.join(', ')} · not supported: ${u.why}`));
  const render = () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const text = (/** @type {any} */ d) => [d.vendor, d.series, d.family, d.variant, d.name, d.codename, ...d.models, ...(d.unsupported ?? []).flatMap((/** @type {any} */ u) => [u.name, ...u.models])].join(' ').toLowerCase();
    const hits = index.filter(d => words.every(w => text(d).includes(w)));
    // All › vendor › series › family › variant
    /** @type {Record<string, Record<string, Record<string, any[]>>>} */ const tree = {};
    for (const d of hits) ((tree[d.vendor] ??= {})[d.series] ??= {})[d.family] = [...(tree[d.vendor][d.series][d.family] ?? []), d];
    const sorted = (/** @type {object} */ o) => Object.entries(o).sort(([x], [y]) => x.localeCompare(y));
    list.replaceChildren(...sorted(tree).map(([vendor, series]) => h('details', { open: true }, h('summary', { textContent: vendor }),
      ...sorted(series).map(([name, families]) => h('details', { open: true }, h('summary', { textContent: name }),
        ...sorted(families).map(([family, devices]) => h('div', { className: 'family' }, h('strong', { textContent: family }),
          h('ul', { className: 'selected-files' }, ...devices.sort((x, y) => x.variant.localeCompare(y.variant)).map(deviceLink), ...devices.flatMap(unsupportedItems)))))))));
    if (!hits.length) list.append(h('p', { className: 'empty-files', textContent: 'No device matches. The catalog grows through pull requests.' }));
  };
  search.addEventListener('input', render);
  render();
  return h('section', { className: 'flash-card' }, h('label', { className: 'field-label', textContent: 'Find your phone' }), search, list);
}

/** "Something wrong on this page?" form; falls back to a GitHub issue link. */
function reportBox() {
  const page = location.pathname + location.search;
  const text = h('textarea', { className: 'confirmation-input', placeholder: 'What is wrong or missing? (wrong file, broken step, outdated info…)', maxLength: 2000, rows: 3 });
  const send = h('button', { type: 'button', className: 'button button-secondary', textContent: 'Send report' }), status = h('small', {});
  const issue = `https://github.com/philipplinux/rominit/issues/new?title=${encodeURIComponent(`Problem on ${page}`)}`;
  send.addEventListener('click', async () => {
    status.textContent = 'Sending…';
    const response = await fetch('./api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page, text: text.value }) }).catch(() => null);
    const reply = await response?.json().catch(() => ({}));
    status.textContent = response?.ok ? 'Thanks, report sent.' : `Could not send: ${reply?.error ?? 'network error'}. Use the GitHub link instead.`;
    if (response?.ok) text.value = '';
  });
  return h('details', { className: 'page-section report' }, h('summary', {}, h('span', { textContent: 'Something wrong on this page?' }), h('small', { textContent: 'report it' })),
    h('div', { className: 'comment-box' }, text, send, status, h('small', {}, 'Or ', h('a', { href: issue, target: '_blank', rel: 'noopener noreferrer', textContent: 'open a GitHub issue' }), '.')));
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
  const rank = (/** @type {any} */ r) => Object.keys(ORIGINS).indexOf(r.origin) * 20 + (r.curated ? 0 : 10) + Object.keys(STATUSES).indexOf(r.status);
  const roms = device.roms.filter((/** @type {any} */ r) => r.origin !== 'stock').sort((/** @type {any} */ a, /** @type {any} */ b) => rank(a) - rank(b));
  const stock = device.roms.filter((/** @type {any} */ r) => r.origin === 'stock');
  const rom = roms.find((/** @type {any} */ r) => r.id === params.get('rom')) ?? roms[0];
  document.title = `${device.vendor} ${device.name} · ROMinit`;
  const romSelect = h('select', { className: 'confirmation-input' }, ...Object.keys(ORIGINS).map(origin => h('optgroup', { label: origin },
    ...roms.filter((/** @type {any} */ r) => r.origin === origin).map((/** @type {any} */ r) => new Option(`${r.name} ${r.version} (${r.status}${r.curated ? ', curated' : ''})`, r.id, false, r === rom)))).filter(g => g.children.length));
  const flashable = (/** @type {any} */ r) => r.status !== 'broken';
  romSelect.addEventListener('change', () => go({ device: codename, rom: romSelect.value }));
  const link = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: text });
  /** One of the collapsible page sections. @param {string} title @param {string} hint @param {boolean} open @param {any[]} body */
  const section = (title, hint, open, body, badge = '') => h('details', { className: 'page-section', open },
    h('summary', {}, h('span', { textContent: title }), badge && h('b', { className: 'badge', textContent: badge }), h('small', { textContent: hint })), ...body);
  /** Stage cards of one ROM, numbered across the whole ROM. @param {any} r @param {string} which */
  const cards = (r, which) => r.stages.flatMap((/** @type {any} */ stage, /** @type {number} */ i) =>
    stage.section === which ? [stageCard(device, stage, i + 1, r.stages.length, `${device.codename}/${r.id}`)] : []);
  const tools = rom && flashable(rom) ? cards(rom, 'tools') : [];
  /**
   * Required sections are amber until done, then green and (by default) collapsed. @param {any} el @param {() => boolean} done @param {() => void} [onDone]
   */
  const required = (el, done, onDone = () => { el.open = false; }) => {
    el.classList.add('required');
    let was = false;
    const update = () => {
      const ok = done();
      el.classList.toggle('done', ok); el.querySelector(':scope > summary .badge').textContent = ok ? 'COMPLETED' : 'REQUIRED';
      if (ok && !was) onDone();
      was = ok;
    };
    el.addEventListener('change', update); el.addEventListener('stage-done', update); update();
    return el;
  };
  const lockKey = `rom-locked:${codename}`;
  let locked = ''; try { locked = localStorage.getItem(lockKey) ?? ''; } catch { /* private window */ }
  /** @type {HTMLButtonElement[]} */ const lockButtons = [];
  /** "Lock in this ROM", next to the select and under the features; locking completes section 0. */
  const lockButton = () => {
    const button = h('button', { className: 'button button-secondary lock-in', type: 'button', onclick() {
      locked = locked === rom.id ? '' : rom.id;
      try { localStorage.setItem(lockKey, locked); } catch { /* private window */ }
      infoSection.dispatchEvent(new Event('change'));
    } });
    lockButtons.push(button);
    return button;
  };
  const infoSection = section('0 · ROM, features & info', rom ? `${rom.name} ${rom.version} · ${rom.origin} · ${rom.status} · ${score(rom.rating)}` : 'none in the catalog yet', true, [
      h('label', { className: 'field-label rom-label' }, rom && h('img', { className: 'os-logo', src: `./logos/${rom.os.toLowerCase()}.svg`, alt: '', onerror() { this.remove(); } }), rom ? rom.os : 'ROM'), romSelect, lockButton(),
      rom?.screenshots?.length && slideshow(rom.screenshots),
      rom && kindRow(rom),
      rom && starsRow(`${device.codename}/${rom.id}`),
      rom && countsRow(`${device.codename}/${rom.id}`),
      rom && ratingRow(rom.rating),
      rom && metaRow(rom.rating),
      ...(rom ? includesRows(rom.rating) : []),
      rom && requirementsRow(rom),
      rom && lockButton(),
      rom?.login && loginRow(rom.login),
      rom && h('p', { className: 'intro-copy' }, ...rich(`${rom.notes ?? ''} `), rom.homepage && link(rom.homepage, 'Release page')),
      rom && commentsBox(`${device.codename}/${rom.id}`)], rom ? 'REQUIRED' : '');
  if (rom) required(infoSection, () => {
    for (const b of lockButtons) b.textContent = locked === rom.id ? '✓ Locked in · change' : `Lock in ${rom.name} ${rom.version}`;
    return locked === rom.id;
  });
  const unlock = device.unlock, saved = `unlocked-steps:${codename}`;
  /** Ticked unlock steps survive a reload (the 7-day Samsung wait). */
  let ticked = []; try { ticked = JSON.parse(localStorage.getItem(saved) ?? '[]'); } catch { /* private window */ }
  const stepBoxes = (unlock?.steps ?? []).map((/** @type {any} */ _, /** @type {number} */ i) => h('input', { type: 'checkbox', checked: ticked.includes(i) }));
  const unlockSection = section('1 · Unlock bootloader', unlock ? 'once per phone; tick each step' : 'not needed', !!unlock, unlock ? [
    unlock.hints?.length && h('div', { className: 'hints' }, h('strong', { textContent: 'Good to know' }), h('ul', {}, ...unlock.hints.map((/** @type {string} */ hint) => h('li', {}, ...rich(hint))))),
    h('ol', { className: 'guide' }, ...unlock.steps.map((/** @type {string} */ step, /** @type {number} */ i) => h('li', {}, h('label', {}, stepBoxes[i], ' ', ...rich(step))))),
    unlock.pivots?.length && h('details', { className: 'pivots' }, h('summary', { textContent: 'Stuck? Locked or soft-bricked' }),
      h('dl', {}, ...unlock.pivots.flatMap((/** @type {any} */ p) => [h('dt', {}, ...rich(p.problem)), h('dd', {}, ...rich(p.fix), ' ', p.url && link(p.url, 'Open'))]))),
    unlock.url && link(unlock.url, 'Full unlock guide')] : [h('p', { className: 'field-help', textContent: 'This phone needs no bootloader unlock.' })], unlock ? 'REQUIRED' : '');
  if (unlock) required(unlockSection, () => {
    try { localStorage.setItem(saved, JSON.stringify(stepBoxes.flatMap((box, i) => box.checked ? [i] : []))); } catch { /* private window */ }
    return stepBoxes.every(box => box.checked);
  });
  const haveTwrp = h('input', { type: 'checkbox' });
  const twrpSection = section('2 · TWRP recovery', tools.length ? 'needed before the ROM' : 'not needed for this ROM', tools.length > 0,
    tools.length ? [h('label', { className: 'field-help' }, haveTwrp, ' TWRP is already installed on this phone'), h('div', { className: 'stages' }, ...tools)]
      : [h('p', { className: 'field-help', textContent: 'This ROM flashes without a custom recovery.' })], tools.length ? 'REQUIRED' : '');
  let twrpDone = 0;
  twrpSection.addEventListener('stage-done', () => twrpDone++);
  if (tools.length) required(twrpSection, () => haveTwrp.checked || twrpDone >= tools.length);
  const romCards = rom && flashable(rom) ? cards(rom, 'rom') : [];
  const romSection = section('3 · Flash ROM', rom ? `${rom.name} ${rom.version}` : 'none in the catalog yet', true, [
      rom && requirementsRow(rom),
      rom?.login && loginRow(rom.login),
      rom && (flashable(rom) ? h('div', { className: 'stages' }, ...romCards)
        : h('p', { className: 'experimental-note' }, h('strong', { textContent: 'Known broken: ' }), 'this release is listed for the record and cannot be flashed here. Pick another ROM.'))], romCards.length ? 'REQUIRED' : '');
  let romDone = 0;
  romSection.addEventListener('stage-done', () => romDone++);
  if (romCards.length) required(romSection, () => romDone >= romCards.length, () => romSection.querySelector(':scope > summary').after(
    h('p', { className: 'congrats' }, h('strong', { textContent: `Congratulations, ${rom.name} is on your ${device.name}!` }),
      ' Give it a few minutes for the first boot. ', h('a', { href: '#', textContent: 'Tell others how it went', onclick(/** @type {Event} */ e) {
        e.preventDefault(); infoSection.open = true; const box = /** @type {HTMLTextAreaElement|null} */ (infoSection.querySelector('.comment-box textarea')); box?.scrollIntoView({ block: 'center' }); box?.focus(); } }),
      '. Saved you an afternoon? ', h('a', { href: DONATE, target: '_blank', rel: 'noopener noreferrer', textContent: '☕ Buy me a coffee' }), '.')));
  main.append(
    h('section', { className: 'intro' },
      h('a', { className: 'back-link', href: './', textContent: '← BACK', onclick(/** @type {MouseEvent} */ e) {
        if (document.referrer.startsWith(location.origin)) { e.preventDefault(); history.back(); } } }),
      h('p', { className: 'eyebrow' }, h('a', { href: './', textContent: 'ALL' }),
        ...[device.vendor, device.series, device.family].flatMap(crumb => [' / ', h('a', { href: `./?q=${encodeURIComponent(crumb)}`, textContent: crumb.toUpperCase() })]), ` / ${device.variant.toUpperCase()}`),
      h('h1', {}, 'Flash your ', h('span', { textContent: `${device.name}.` })),
      h('p', { className: 'intro-copy', textContent: `${device.vendor} ${device.name} (${device.models.join(', ')}, ${device.codename}) only. ${device.notes ?? ''} Everything runs in this browser; you download the files from their source and nothing is uploaded.` })),
    infoSection,
    unlockSection,
    twrpSection,
    romSection,
    section('4 · Recover / revert', stock.length ? 'back to stock' : 'manual for now', false, [
      device.recovery && h('p', { className: 'experimental-note' }, h('strong', { textContent: 'Way back: ' }), ...rich(device.recovery.text), ' ', device.recovery.url && link(device.recovery.url, 'More')),
      ...stock.map((/** @type {any} */ r) => h('div', { className: 'stages' }, h('p', { className: 'intro-copy' }, `${r.name} ${r.version}. `, ...rich(r.notes ?? ''), ' ', r.homepage && link(r.homepage, 'Source')),
        ...r.stages.map((/** @type {any} */ stage, /** @type {number} */ i) => stageCard(device, stage, i + 1, r.stages.length, `${device.codename}/${r.id}`))))]));
}
start().then(() => main.append(reportBox()), error => main.append(h('p', { className: 'status', textContent: `Could not load the catalog: ${message(error)}` })));
