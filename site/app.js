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
/** Who is signed in and which logins exist; null without the API. @type {Promise<{user:any, providers:string[]}|null>} */
const me = fetch('./api/me', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
const PROVIDER_NAMES = /** @type {Record<string, string>} */ ({ google: 'Google', github: 'GitHub' });
/** "Sign in with Google · GitHub", returning to this page. @param {string[]} providers */
const signInLinks = providers => providers.flatMap((p, i) => [i ? ' · ' : '', h('a', { href: `./auth/${p}/login?return=${encodeURIComponent(location.pathname + location.search)}`, textContent: PROVIDER_NAMES[p] ?? p })]);
/** Header: sign in, or name + sign out. */
me.then(info => {
  if (!info?.providers.length && !info?.user) return;
  const slot = h('span', { className: 'account' });
  if (info.user) slot.append(`${info.user.name} · `, h('button', { type: 'button', className: 'link-button', textContent: 'SIGN OUT', async onclick() { await fetch('./auth/logout', { method: 'POST' }); location.reload(); } }));
  else slot.append('SIGN IN: ', ...signInLinks(info.providers));
  document.querySelector('.topbar-note')?.prepend(slot, ' ');
});
const ROLE_LABEL = /** @type {Record<string, string>} */ ({ owner: 'maintainer', moderator: 'moderator', admin: 'admin' });

/** Comments of one ROM; hidden where there is no API. Text only, never HTML. Posting needs an account. @param {string} key `<codename>/<rom id>` */
function commentsBox(key) {
  const list = h('ol', { className: 'comments' }), status = h('small', {});
  const text = h('textarea', { className: 'confirmation-input', placeholder: 'How did it go on your phone?', maxLength: 2000, rows: 3 });
  const shot = h('input', { type: 'file', accept: 'image/*', title: 'Screenshot (optional)' });
  const post = h('button', { type: 'button', className: 'button button-secondary', textContent: 'Post comment' });
  const form = h('div', { className: 'comment-form', hidden: true }, text, h('label', { className: 'field-help' }, 'Screenshot (optional): ', shot), post, status);
  const signIn = h('p', { className: 'field-help', hidden: true });
  const box = h('div', { className: 'comment-box', hidden: true }, h('p', { className: 'field-label', textContent: 'Comments' }), list, signIn, form);
  me.then(info => {
    if (info?.user) form.hidden = false;
    else { signIn.hidden = false; signIn.append(...(info?.providers.length ? ['Sign in to comment: ', ...signInLinks(info.providers)] : ['Comments need an account; sign-in is not set up here yet.'])); }
  });
  const url = `./api/comments?rom=${encodeURIComponent(key)}`;
  /** Owner / moderator / admin action on one comment. @param {number} comment @param {string} action */
  const moderate = (comment, action) => h('button', { type: 'button', className: 'link-button', textContent: action, async onclick() {
    const r = await fetch('./api/moderate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comment, action }) }).catch(() => null);
    if (r?.ok) load(); else status.textContent = `Could not ${action}: ${(await r?.json().catch(() => ({})))?.error ?? 'network error'}.`; } });
  const load = () => fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then((/** @type {any[]} */ rows) => {
    list.replaceChildren(...rows.map(c => h('li', { className: c.hidden ? 'hidden-comment' : '' },
      h('small', {}, c.name, c.role ? ' ' : '', c.role && h('b', { className: 'role', textContent: ROLE_LABEL[c.role] }), ` · ${c.provider ? `${PROVIDER_NAMES[c.provider] ?? c.provider} · ` : ''}${c.at.slice(0, 16)} UTC${c.hidden ? ' · hidden' : ''}`),
      h('p', { textContent: c.text }),
      c.image === 'approved' || (c.image && c.moderate) ? h('a', { href: `./api/image?id=${c.id}`, target: '_blank' }, h('img', { src: `./api/image?id=${c.id}`, alt: 'screenshot', loading: 'lazy' }))
        : c.image ? h('small', { textContent: 'Screenshot awaiting review.' }) : '',
      c.moderate && h('small', { className: 'mod-actions' }, moderate(c.id, c.hidden ? 'show' : 'hide'), c.image === 'pending' && ' · ', c.image === 'pending' && moderate(c.id, 'approve')))));
    if (!rows.length) list.append(h('li', {}, h('small', { textContent: 'No comments yet.' })));
    box.hidden = false;
  }, () => {});
  post.addEventListener('click', async () => {
    status.textContent = 'Posting…';
    let image = null;
    try { image = await webp(shot.files?.[0]); } catch { status.textContent = 'Could not use that screenshot (too large or not an image).'; return; }
    const response = await fetch('./api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rom: key, text: text.value, image }) }).catch(() => null);
    const reply = await response?.json().catch(() => ({}));
    status.textContent = response?.ok ? (image ? 'Posted. The screenshot shows after review.' : 'Posted.') : `Could not post: ${reply?.error ?? 'network error'}.`;
    if (response?.ok) { text.value = ''; shot.value = ''; load(); }
  });
  load();
  return box;
}
/** "maintainer: name (all postmarketOS)"; verified owners only. Hidden where there is no API. @param {string} key */
function ownersRow(key) {
  const row = h('p', { className: 'rating', hidden: true }, h('strong', { textContent: 'maintainer' }));
  fetch(`./api/owners?rom=${encodeURIComponent(key)}`).then(r => r.ok ? r.json() : Promise.reject()).then((/** @type {any[]} */ owners) => {
    row.append(...(owners.length ? owners.map(o => h('span', { className: 'feature works', textContent: `✓ ${o.name}${o.scope.startsWith('rom:') ? '' : ` (${o.scope.replace(':', ' ')})`}` }))
      : [h('span', { className: 'feature untested', textContent: 'no verified maintainer yet' })]));
    row.hidden = false;
  }, () => {});
  return row;
}
/** Phone test tiers, in tap order; `inconclusive` only comes from a probe that failed. */
const TIERS = ['full', 'partial', 'broken', 'blocked', 'untested', 'n/a'];
const TIER_MARK = /** @type {Record<string, string>} */ ({ full: '✓', partial: '~', broken: '✗', blocked: '⊘', untested: '·', 'n/a': '–', inconclusive: '?' });
const TIER_HELP = /** @type {Record<string, string>} */ ({ full: 'works fully', partial: 'works in part', broken: 'does not work', blocked: 'needs something first (SIM, card, cable)',
  untested: 'not tried yet', 'n/a': 'this phone has none', inconclusive: 'the test script failed here; reported for a fix' });
const ICON = /** @type {Record<string, string>} */ ({ flashing: '⚡', usb_net: '🔌', storage: '💾', sdcard: '🗂', battery: '🔋', screen: '🖥', touch: '👆', gpu: '🎮', audio: '🔊',
  camera: '📷', camera_flash: '🔦', ir: '📡', wifi: '📶', bluetooth: '🔵', gps: '🧭', nfc: '💳', calls: '📞', sms: '💬', data: '🌐', fde: '🔒', otg: '🔗', hdmi: '📺',
  fingerprint: '☝', accelerometer: '🔄', magnetometer: '🧲', light: '💡', proximity: '✋', hall: '📕', haptics: '📳', barometer: '🌡' });
/** What installed packages reveal about a ROM's includes; each test gets the package set. */
const SHIPS = /** @type {Record<string, (p:Set<string>) => boolean>} */ ({
  ssh: p => ['openssh-server', 'openssh', 'dropbear'].some(x => p.has(x)),
  docker: p => p.has('docker') || p.has('podman') || p.has('docker.io'),
  phone_ui: p => [...p].some(x => /^(phosh|plasma-mobile|sxmo-|gnome-shell-mobile|lomiri)/.test(x)),
  android_apps: p => p.has('waydroid') || p.has('com.android.vending') || p.has('org.fdroid.fdroid'),
  google_play: p => p.has('com.android.vending') && ![...p].some(x => x.startsWith('org.microg')),
  microg: p => [...p].some(x => x.startsWith('org.microg')),
  root: p => p.has('com.topjohnwu.magisk') || p.has('me.weishu.kernelsu') || p.has('sudo') || p.has('doas'),
});
/** Script output → {features: {f: {status, note}}, info: [], debug: [], packages}. @param {string} output */
function parseBench(output) {
  /** @type {Record<string, {status:string, note:string}>} */ const features = {};
  const info = [], debug = [], packages = new Set();
  for (const line of output.split('\n')) {
    const m = line.match(/^([a-z_]+) (full|partial|broken|blocked|untested|ask|inconclusive) ?(.*)$/);
    if (m && FEATURES.includes(m[1])) features[m[1]] = { status: m[2], note: m[3] };
    else if (line.startsWith('@debug ')) debug.push(line.slice(7));
    else if (line.startsWith('@pkgs ')) for (const name of line.slice(6).split(' ')) if (name) packages.add(name);
    else if (line.startsWith('@ ') && line !== '@ done') info.push(line.slice(2));
  }
  return { features, info, debug, packages };
}
/**
 * "4 · Test your phone": one command runs a read-only script on the phone (on it, over SSH or ADB), the page waits for its output,
 * shows a report card the user corrects by tapping, asks a few questions (all on request) and submits it.
 * @param {any} rom @param {string} key
 */
function benchBox(rom, key) {
  const linux = rom.os === 'postmarketOS';
  const [loginUser, loginPassword] = (rom.login ?? 'user / ').split(' / ');
  const box = h('div', { className: 'bench' });
  const start = h('button', { type: 'button', className: 'button button-secondary', textContent: 'Start a phone test' });
  box.append(h('p', { className: 'intro-copy', textContent: 'One command checks every feature on the phone in a few seconds. It only reads, changes nothing and stays silent. Then you fix anything it got wrong with a tap.' }), start);
  start.addEventListener('click', async () => {
    start.disabled = true;
    const r = await fetch('./api/bench', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rom: key }) }).catch(() => null);
    const reply = await r?.json().catch(() => ({}));
    if (!r?.ok) { start.disabled = false; box.append(h('p', { className: 'status', textContent: `Could not start: ${reply?.error ?? 'network error'}.` })); return; }
    waitFor(reply.code);
  });
  /** @param {string} code */
  function waitFor(code) {
    const url = `${location.origin}/b/${code}`;
    const sound = h('input', { type: 'checkbox' });
    // Browsers cannot open SSH themselves, so the page builds the one command: USB uses postmarketOS' fixed USB-network address.
    const ssh = `ssh -o StrictHostKeyChecking=accept-new ${loginUser}@`;
    const ways = linux ? [['USB cable', 'usb'], ['Wi-Fi', 'wifi'], ['Terminal on the phone', '']]
      : [['ADB from a computer', 'adb shell '], ['On the phone (terminal app)', '']];
    let way = ways[0][1];
    const ip = h('input', { type: 'text', className: 'bench-target', inputMode: 'decimal', spellcheck: false, placeholder: '192.168.1.50',
      value: (() => { try { return localStorage.getItem('rominit.phoneIp') ?? ''; } catch { return ''; } })() });
    const ipRow = h('label', { className: 'field-help', hidden: true }, 'Phone IP address (Settings → Wi-Fi, or `ip a` on the phone): ', ip);
    const command = h('code', { className: 'bench-command' });
    const render = () => {
      const sh = sound.checked ? 'ROMINIT_SOUND=1 sh' : 'sh';
      const prefix = way === 'usb' ? `${ssh}172.16.42.1 ` : way === 'wifi' ? `${ssh}${ip.value.trim() || '<phone IP>'} ` : way;
      ipRow.hidden = way !== 'wifi';
      command.textContent = `curl -fsSL ${url} | ${prefix}${prefix && sound.checked ? `'${sh}'` : sh} | curl -fsS --data-binary @- ${url}`;
    };
    ip.addEventListener('input', () => { try { localStorage.setItem('rominit.phoneIp', ip.value.trim()); } catch { /* private window */ } render(); });
    const tabs = h('div', { className: 'bench-tabs', role: 'tablist' }, ...ways.map(([label, prefix], i) => h('button', { type: 'button', role: 'tab', ariaSelected: String(!i), textContent: label,
      onclick(/** @type {Event} */ e) { way = prefix; for (const t of tabs.children) t.setAttribute('aria-selected', String(t === e.currentTarget)); render(); } })));
    sound.addEventListener('change', render); render();
    const waiting = h('div', { className: 'bench-wait' }, h('span', { className: 'breath', ariaHidden: 'true' }), h('span', { textContent: 'Waiting for your phone… breathe in, breathe out.' }));
    box.replaceChildren(
      h('p', { className: 'field-label', textContent: linux ? 'How is the phone connected?' : 'Run this, wherever your phone has a shell' }), tabs, ipRow,
      h('div', { className: 'bench-run' }, command, h('button', { type: 'button', className: 'button button-secondary', textContent: 'Copy', async onclick() {
        await navigator.clipboard?.writeText(command.textContent ?? '').catch(() => {}); this.textContent = 'Copied'; } })),
      h('label', { className: 'field-help' }, sound, ' Also check speaker and vibration (plays a short tone and buzzes once)'),
      h('p', { className: 'field-help', textContent: linux ? `Paste it into a terminal on your computer. When asked, type the password ${loginPassword || 'from above'}. Test code ${code}, valid for an hour.`
        : `Test code ${code}, valid for an hour. No network on the phone? Use ADB from a computer; the computer does the downloading. A terminal app lacks the permissions for most checks; ADB works best.` }),
      waiting);
    const started = Date.now();
    const poll = async () => {
      if (!box.isConnected || Date.now() - started > 3600_000) return;
      const run = await fetch(`./api/bench?code=${code}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
      if (run?.output) card(code, run.output); else setTimeout(poll, 3000);
    };
    poll();
  }
  /** @param {string} code @param {string} output */
  function card(code, output) {
    const { features, info, debug, packages } = parseBench(output);
    /** @type {Record<string, string>} */ const final = {};
    for (const f of FEATURES) final[f] = rom.rating?.features?.[f] === 'n/a' ? 'n/a' : features[f]?.status === 'ask' ? 'untested' : features[f]?.status ?? 'untested';
    const tiles = /** @type {Record<string, HTMLButtonElement>} */ ({});
    const score = h('div', { className: 'bench-score' });
    const paint = (/** @type {string} */ f) => {
      const t = tiles[f]; t.className = `bench-tile ${final[f] === 'n/a' ? 'na' : final[f]}`;
      t.title = `${TIER_HELP[final[f]]}${features[f]?.note ? ` · ${features[f].note}` : ''} · tap to change`;
      /** @type {HTMLElement} */ (t.lastChild).textContent = `${TIER_MARK[final[f]]} ${final[f]}`;
      const counted = FEATURES.filter(x => final[x] !== 'n/a'), n = (/** @type {string} */ s) => counted.filter(x => final[x] === s).length;
      score.replaceChildren(h('strong', { textContent: `${Math.round(100 * (n('full') + n('partial') / 2) / (counted.length || 1))}%` }),
        h('span', { textContent: ` works · ${n('full')} full · ${n('partial')} partial · ${n('broken')} broken · ${n('blocked')} blocked · ${n('untested') + n('inconclusive')} open` }));
    };
    let delay = 0;
    const groups = Object.entries(FEATURE_GROUPS).map(([group, list]) => h('div', { className: 'bench-group' }, h('p', { className: 'field-label', textContent: group }),
      h('div', { className: 'bench-tiles' }, ...list.map(f => {
        tiles[f] = h('button', { type: 'button', style: `animation-delay:${(delay++) * 40}ms`, onclick() { final[f] = TIERS[(TIERS.indexOf(final[f]) + 1) % TIERS.length]; paint(f); } },
          h('span', { className: 'icon', textContent: ICON[f] ?? '•' }), h('span', { textContent: LABEL[f] ?? f.replace(/_/g, ' ') }), h('small', {}));
        return tiles[f];
      }))));
    for (const f of FEATURES) paint(f);
    // A few questions per person; the rest only on request, so nobody gets a survey.
    const asked = new Set();
    const pool = [...FEATURES.filter(f => features[f]?.status === 'ask'),
      ...FEATURES.filter(f => final[f] === 'untested' && features[f]?.status !== 'ask').sort(() => Math.random() - .5)];
    const questions = h('div', { className: 'bench-questions' });
    const more = h('button', { type: 'button', className: 'link-button' });
    const ask = (/** @type {number} */ count) => {
      for (const f of pool.filter(f => !asked.has(f)).slice(0, count)) {
        asked.add(f);
        const q = features[f]?.status === 'ask' ? features[f].note : `Have you tried ${LABEL[f] ?? f.replace(/_/g, ' ')}? Does it work?`;
        const row = h('div', { className: 'bench-q' }, h('span', { className: 'icon', textContent: ICON[f] ?? '•' }), h('span', { textContent: q }));
        for (const [label, tier] of [['👍 yes', 'full'], ['〰 partly', 'partial'], ['👎 no', 'broken'], ['skip', '']])
          row.append(h('button', { type: 'button', className: 'button button-secondary', textContent: label, onclick() { if (tier) { final[f] = tier; paint(f); } row.classList.add('answered'); row.querySelectorAll('button').forEach(b => { b.disabled = true; }); } }));
        questions.append(row);
      }
      const left = pool.filter(f => !asked.has(f)).length;
      more.hidden = !left; more.textContent = `Answer more (${left} left)`;
    };
    more.addEventListener('click', () => ask(pool.length));
    ask(3);
    const note = h('textarea', { className: 'confirmation-input', placeholder: 'Anything the test missed? (optional)', maxLength: 2000, rows: 2 });
    const status = h('small', {});
    const send = h('button', { type: 'button', className: 'button button-primary', textContent: 'Send report card', async onclick() {
      send.disabled = true; status.textContent = 'Sending…';
      const r = await fetch('./api/bench', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, final, note: note.value }) }).catch(() => null);
      if (r?.ok) { status.textContent = 'Thank you! Your report card helps the next person pick a ROM.'; send.textContent = '✓ Sent'; }
      else { send.disabled = false; status.textContent = `Could not send: ${(await r?.json().catch(() => ({})))?.error ?? 'network error'}.`; }
    } });
    const failed = FEATURES.filter(f => features[f]?.status === 'inconclusive');
    // What the package list says the ROM ships, next to what the catalog claims.
    const ships = packages.size ? h('p', { className: 'rating' }, h('strong', { textContent: `found in ${packages.size} packages` }),
      ...Object.entries(SHIPS).map(([key, test]) => { const found = test(packages), claim = rom.rating?.includes?.[key];
        return h('span', { className: `feature ${found ? 'works' : 'untested'}`, title: claim && (claim === 'yes') !== found ? `catalog says ${claim}` : '',
          textContent: `${found ? '✓' : '✗'} ${LABEL[key] ?? key}${claim && (claim === 'yes') !== found ? ' *' : ''}` }); })) : '';
    // Default passwords are public: offer the change, typed on the phone so it never reaches this page.
    const password = rom.login && linux ? h('div', { className: 'hints' }, h('strong', { textContent: 'Change the default password' }),
      h('p', { className: 'field-help', textContent: `${loginUser} / ${loginPassword} is printed on this page for everyone. Change it now; you type the new one on the phone (or in your SSH session), so it never reaches ROMinit.` }),
      h('code', { className: 'bench-command', textContent: 'passwd' }), ' on the phone, or ',
      h('code', { className: 'bench-command', textContent: `ssh -t ${loginUser}@<phone address> passwd` })) : '';
    box.replaceChildren(h('p', { className: 'field-label', textContent: 'Report card' }), score,
      info.length ? h('p', { className: 'field-help', textContent: info.join(' · ') }) : '',
      questions.childElementCount || pool.length ? h('div', {}, h('p', { className: 'field-label', textContent: 'Quick questions' }), questions, more) : '',
      h('p', { className: 'field-help', textContent: 'Tap any tile to correct it: full → partial → broken → blocked → untested → n/a.' }),
      ...groups,
      failed.length ? h('details', { className: 'bench-debug' }, h('summary', { textContent: `${failed.length} check${failed.length > 1 ? 's' : ''} inconclusive: the script failed there (sent with your card so it gets fixed)` }),
        h('pre', { textContent: [...failed.map(f => `${f}: ${features[f].note}`), ...debug].join('\n') })) : '',
      ships, note, send, status, password);
  }
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
  // Progress on this phone in one record per device: locked-in ROM, ticked unlock steps, TWRP, flashed ROMs.
  // ponytail: this browser only; user accounts can sync the same record later.
  const progressKey = `progress:${codename}`;
  /** @type {{rom?:string, steps?:number[], unlocked?:boolean, twrp?:boolean, flashed?:string[]}} */ let progress = {};
  try { progress = JSON.parse(localStorage.getItem(progressKey) ?? '{}'); } catch { /* private window */ }
  const save = () => { try { localStorage.setItem(progressKey, JSON.stringify(progress)); } catch { /* private window */ } };
  /** @type {HTMLButtonElement[]} */ const lockButtons = [];
  /** "Lock in this ROM", next to the select and under the features; locking completes section 0. */
  const lockButton = () => {
    const button = h('button', { className: 'button button-secondary lock-in', type: 'button', onclick() {
      progress.rom = progress.rom === rom.id ? undefined : rom.id; save();
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
      rom && ownersRow(`${device.codename}/${rom.id}`),
      rom && ratingRow(rom.rating),
      rom && metaRow(rom.rating),
      ...(rom ? includesRows(rom.rating) : []),
      rom && requirementsRow(rom),
      rom && lockButton(),
      rom?.login && loginRow(rom.login),
      rom && h('p', { className: 'intro-copy' }, ...rich(`${rom.notes ?? ''} `), rom.homepage && link(rom.homepage, 'Release page')),
      rom && commentsBox(`${device.codename}/${rom.id}`)], rom ? 'REQUIRED' : '');
  if (rom) required(infoSection, () => {
    for (const b of lockButtons) b.textContent = progress.rom === rom.id ? '✓ Locked in · change' : `Lock in ${rom.name} ${rom.version}`;
    return progress.rom === rom.id;
  });
  const unlock = device.unlock;
  const alreadyUnlocked = h('input', { type: 'checkbox', checked: !!progress.unlocked });
  const stepBoxes = (unlock?.steps ?? []).map((/** @type {any} */ _, /** @type {number} */ i) => h('input', { type: 'checkbox', checked: progress.steps?.includes(i) ?? false }));
  const unlockSection = section('1 · Unlock bootloader', unlock ? 'once per phone; tick each step' : 'not needed', !!unlock, unlock ? [
    h('label', { className: 'field-help' }, alreadyUnlocked, ' Bootloader is already unlocked on this phone'),
    unlock.hints?.length && h('div', { className: 'hints' }, h('strong', { textContent: 'Good to know' }), h('ul', {}, ...unlock.hints.map((/** @type {string} */ hint) => h('li', {}, ...rich(hint))))),
    h('ol', { className: 'guide' }, ...unlock.steps.map((/** @type {string} */ step, /** @type {number} */ i) => h('li', {}, h('label', {}, stepBoxes[i], ' ', ...rich(step))))),
    unlock.pivots?.length && h('details', { className: 'pivots' }, h('summary', { textContent: 'Stuck? Locked or soft-bricked' }),
      h('dl', {}, ...unlock.pivots.flatMap((/** @type {any} */ p) => [h('dt', {}, ...rich(p.problem)), h('dd', {}, ...rich(p.fix), ' ', p.url && link(p.url, 'Open'))]))),
    unlock.url && link(unlock.url, 'Full unlock guide')] : [h('p', { className: 'field-help', textContent: 'This phone needs no bootloader unlock.' })], unlock ? 'REQUIRED' : '');
  if (unlock) required(unlockSection, () => {
    progress.steps = stepBoxes.flatMap((box, i) => box.checked ? [i] : []); progress.unlocked = alreadyUnlocked.checked; save();
    return alreadyUnlocked.checked || stepBoxes.every(box => box.checked);
  });
  const haveTwrp = h('input', { type: 'checkbox', checked: !!progress.twrp });
  const twrpSection = section('2 · TWRP recovery', tools.length ? 'needed before the ROM' : 'not needed for this ROM', tools.length > 0,
    tools.length ? [h('label', { className: 'field-help' }, haveTwrp, ' TWRP is already installed on this phone'), h('div', { className: 'stages' }, ...tools)]
      : [h('p', { className: 'field-help', textContent: 'This ROM flashes without a custom recovery.' })], tools.length ? 'REQUIRED' : '');
  let twrpDone = 0;
  twrpSection.addEventListener('stage-done', () => { if (++twrpDone >= tools.length) haveTwrp.checked = true; });
  if (tools.length) required(twrpSection, () => { progress.twrp = haveTwrp.checked; save(); return haveTwrp.checked; });
  const romCards = rom && flashable(rom) ? cards(rom, 'rom') : [];
  const romSection = section('3 · Flash ROM', rom ? `${rom.name} ${rom.version}` : 'none in the catalog yet', true, [
      rom && requirementsRow(rom),
      rom?.login && loginRow(rom.login),
      rom && (flashable(rom) ? h('div', { className: 'stages' }, ...romCards)
        : h('p', { className: 'experimental-note' }, h('strong', { textContent: 'Known broken: ' }), 'this release is listed for the record and cannot be flashed here. Pick another ROM.'))], romCards.length ? 'REQUIRED' : '');
  let romDone = 0;
  romSection.addEventListener('stage-done', () => {
    if (++romDone >= romCards.length) { progress.flashed = [...new Set([...progress.flashed ?? [], rom.id])]; save(); } });
  if (romCards.length) required(romSection, () => !!progress.flashed?.includes(rom.id), () => romSection.querySelector(':scope > summary').after(
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
      h('button', { className: 'start-over', type: 'button', textContent: 'Start over (forget progress on this phone)', onclick() {
        try { localStorage.removeItem(progressKey); } catch { /* private window */ } location.reload(); } }),
      h('p', { className: 'intro-copy', textContent: `${device.vendor} ${device.name} (${device.models.join(', ')}, ${device.codename}) only. ${device.notes ?? ''} Everything runs in this browser; you download the files from their source and nothing is uploaded.` })),
    infoSection,
    unlockSection,
    twrpSection,
    romSection,
    rom && section('4 · Test your phone', 'optional · about 2 minutes · report card', false, [benchBox(rom, `${device.codename}/${rom.id}`)]),
    section('5 · Recover / revert', stock.length ? 'back to stock' : 'manual for now', false, [
      device.recovery && h('p', { className: 'experimental-note' }, h('strong', { textContent: 'Way back: ' }), ...rich(device.recovery.text), ' ', device.recovery.url && link(device.recovery.url, 'More')),
      ...stock.map((/** @type {any} */ r) => h('div', { className: 'stages' }, h('p', { className: 'intro-copy' }, `${r.name} ${r.version}. `, ...rich(r.notes ?? ''), ' ', r.homepage && link(r.homepage, 'Source')),
        ...r.stages.map((/** @type {any} */ stage, /** @type {number} */ i) => stageCard(device, stage, i + 1, r.stages.length, `${device.codename}/${r.id}`))))]));
}
start().then(() => main.append(reportBox()), error => main.append(h('p', { className: 'status', textContent: `Could not load the catalog: ${message(error)}` })));
