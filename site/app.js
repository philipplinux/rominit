import { h } from './dom.js';
import { OSES, ARCH_FAMILY, osArchitectures } from '../src/os/index.js';
import { CATEGORIES, FEATURES, FEATURE_GROUPS, INCLUDES, LEVELS, ORIGINS, STATUSES, USES, VETTING, assertConsent, completeness, deviceLevel, recipes, selectFiles, stepsFor, unlockStage } from '../src/catalog.js';
import { connect, rebootFromAndroid } from '../src/protocols/usb.js';
import { validateUsbEnvironment } from '../src/usb-environment.js';
import { redact, summarize, traced } from '../src/debug.js';
import { fetchPinned } from '../src/download.js';
import { HOSTS, browserProblem, detectHost, fixFor, prereqsFor } from '../src/hosts.js';
import { disconnectHelper, ensureHelper, helperRequest, helperSession, pairHelper } from './helper.js';
import { usbMediaPanel } from './usb-media.js';
import { PROVIDER_NAMES, me, mountAccount, signInLinks } from './account.js';

const DONATE = 'https://www.buymeacoffee.com/philipplinux';
// ROMinit's own builds: this host lets the page download them itself (CORS), so a stage can attach them in one click.
const SELF_HOSTED = 'https://huggingface.co/PhilippLinux/';
const supported = 'usb' in navigator && window.isSecureContext;
const params = new URLSearchParams(location.search);
// The computer doing the flashing: auto-detected, changeable in the header, remembered per browser.
const stored = (() => { try { return localStorage.getItem('host'); } catch { return null; } })();
let host = stored && stored in HOSTS ? stored : detectHost(/** @type {any} */ (navigator));
const hostSelect = /** @type {HTMLSelectElement} */ (document.getElementById('host'));
hostSelect.append(...Object.entries(HOSTS).map(([id, name]) => Object.assign(document.createElement('option'), { value: id, textContent: name })));
hostSelect.value = host;
hostSelect.addEventListener('change', () => {
  host = hostSelect.value;
  try { localStorage.setItem('host', host); } catch { /* private window */ }
  document.dispatchEvent(new Event('host-change'));
});
// First visit: confirm the guessed computer once, since every stage's setup steps follow it.
if (!stored) {
  const pick = h('select', { className: 'host-confirm-select', ariaLabel: "Your computer's operating system" },
    ...Object.entries(HOSTS).map(([id, name]) => h('option', { value: id, textContent: name, selected: id === host })));
  const dialog = h('dialog', { className: 'host-confirm' },
    h('form', { method: 'dialog' }, h('p', { className: 'field-label', textContent: 'Which computer are you flashing from?' }),
      h('p', { className: 'field-help', textContent: 'ROMinit guessed it from your browser. The setup steps (drivers, USB access) follow this choice; you can change it later at the top of the page.' }),
      pick, h('button', { className: 'button button-primary', textContent: 'Confirm' })));
  dialog.addEventListener('close', () => { hostSelect.value = pick.value; hostSelect.dispatchEvent(new Event('change')); dialog.remove(); });
  document.body.append(dialog);
  dialog.showModal();
}

/** Catalog text with `code` spans. @param {string} text */
const rich = (text = '') => text.split('`').map((part, i) => i % 2 ? h('code', {}, part) : part);
/** @param {unknown} error */
const message = error => error instanceof Error ? error.message : String(error);
/** Quote a command argument for a POSIX shell, preserving embedded apostrophes. @param {string} value */
const shellArg = value => `'${value.replaceAll("'", "'\\''")}'`;
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
  rom.recommended && h('span', { className: 'feature works', title: 'recommended by ROMinit: official build, low security risk. A hint, not a guarantee: flashing is at your own risk, no responsibility taken', textContent: 'recommended ✓ safe' }),
  rom.vetting === 'curated' ? h('span', { className: 'feature works', title: VETTING.curated, textContent: 'curated ★' })
    : h('span', { className: 'feature partial', title: VETTING.scraped, textContent: 'scraped · unverified' }, placeholderMark()),
  h('span', { className: `feature ${({ low: 'works', mid: 'partial', high: 'broken' })[rom.risk.level]}`, title: `${rom.risk.why}. Estimate from reputation and contributors, not an audit`, textContent: `${rom.risk.level} security risk` }),
  rom.pick && h('a', { className: 'feature works', href: rom.pick.url, target: '_blank', rel: 'noopener noreferrer', title: rom.pick.text, textContent: 'community pick ♛' }),
  h('small', { textContent: `${ORIGINS[rom.origin]}; ${STATUSES[rom.status]}; ${VETTING[rom.vetting]}` }));
const link = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: text });
/** Where the ROM comes from: release page and source code, first thing in section 0. @param {any} rom */
/** Two-part pill (logo + label | value), drawn in CSS around a small local logo. @param {string} logo @param {string} label @param {string} value @param {Record<string, any>} attrs */
const badge = (logo, label, value, attrs) => h('a', { className: 'badge-pill', ...attrs },
  h('span', { className: 'badge-label' }, h('img', { src: `./logos/${logo}.svg`, alt: '', onerror() { this.remove(); } }), label), h('span', { className: 'badge-value', textContent: value }));
const sourceRow = (/** @type {any} */ rom, /** @type {string} */ key, /** @type {any} */ device) => h('p', { className: 'rating source-row' }, h('strong', { textContent: 'source' }),
  link(rom.homepage, 'ROM source'), rom.source ? link(rom.source, 'Source code') : h('span', { className: 'feature untested', textContent: 'no source code published' }), rom.discussion && link(rom.discussion, 'Discussion'),
  badge('xda', 'XDA', 'search', { href: `https://xdaforums.com/search/?q=${encodeURIComponent(`${device.vendor} ${device.name}`)}`, target: '_blank', rel: 'noopener noreferrer', title: 'Search XDA Forums for this phone' }), favoriteButton(key));
/**
 * Badges under the model card: one per ROM project, the newest stock Android, and each recovery. A project with several builds says
 * "multiple available" and opens section 0. @param {any} device @param {any[]} roms non-stock ROMs, best first @param {any[]} stock @param {any} rom the ROM section 0 shows now @param {HTMLDetailsElement} infoSection @param {HTMLDetailsElement} recoverSection
 */
function badgeRow(device, roms, stock, rom, infoSection, recoverSection) {
  // postmarketOS is rolling, so its number is the Linux kernel; others show the release number, or the base when the version is a date/build.
  const shown = (/** @type {any} */ r) => r.os === 'postmarketOS' ? `Linux ${r.rating.kernel.version}`
    : r.version.match(/^v?\d{1,3}\.\d+(?: A\d+)?/)?.[0] ?? r.rating.base.replace(`${r.os} `, '');
  const byOs = new Map();
  for (const r of roms) if (r.status !== 'broken') byOs.set(r.os, [...(byOs.get(r.os) ?? []), r]);
  const jump = (/** @type {HTMLDetailsElement} */ sec) => (/** @type {Event} */ e) => { e.preventDefault(); sec.open = true; sec.scrollIntoView({ behavior: 'smooth' }); };
  const romBadges = [...byOs].map(([os, list]) => list.length === 1
    // Another ROM reloads the page with it selected, and #rom scrolls there once loaded.
    ? badge(os.toLowerCase(), os, shown(list[0]), list[0].id === rom?.id ? { href: '#', title: `${list[0].name} ${list[0].version}: selected in section 0`, onclick: jump(infoSection) }
      : { href: `./?${new URLSearchParams({ device: device.codename, rom: list[0].id })}#rom`, title: `${list[0].name} ${list[0].version}: select it in section 0` })
    : badge(os.toLowerCase(), os, 'multiple available', { href: '#', title: 'Pick one in section 0', onclick: jump(infoSection) }));
  const latest = [...stock].sort((a, b) => b.rating.released.localeCompare(a.rating.released))[0];
  const stockBadge = latest && badge('android', 'Stock Android', latest.rating.base.replace('Android ', ''), { href: '#', title: `${latest.name} ${latest.version}: restore it in section R`, onclick: jump(recoverSection) });
  const recoveryBadges = (device.recoveries ?? []).map((/** @type {any} */ r) => badge(r.id, r.name, r.version, { href: r.project, target: '_blank', rel: 'noopener noreferrer', title: `${r.name} recovery project` }));
  return h('p', { className: 'badge-row' }, ...romBadges, stockBadge, ...recoveryBadges);
}
/** "♥ Favorite 3", like a GitHub star; signed out it opens the sign-in popup. Hidden without the API. @param {string} key `<codename>/<rom id>` */
function favoriteButton(key) {
  const button = h('button', { type: 'button', className: 'favorite', hidden: true });
  let state = { count: 0, mine: false };
  const show = () => { button.textContent = `${state.mine ? '♥ Favorited' : '♡ Favorite'} · ${state.count}`; button.classList.toggle('on', state.mine); button.hidden = false; };
  fetch(`./api/favorites?rom=${encodeURIComponent(key)}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(s => { state = s; show(); }, () => {});
  button.onclick = async () => {
    if (!(await me)?.user) return /** @type {any} */ (document.getElementById('signin'))?.showPopover();
    const on = !state.mine, r = await fetch('./api/favorites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rom: key, on }) });
    if (r.ok) { state = { count: state.count + (on ? 1 : -1), mine: on }; show(); }
  };
  return button;
}
const KERNEL = { mainline: 'mainline: gets upstream fixes', downstream: 'downstream: vendor fork, no upstream fixes' };
/** Kernel, base, build date and support. @param {any} rating */
const metaRow = rating => h('p', { className: 'rating' }, ...[`kernel ${rating.kernel.version} (${KERNEL[rating.kernel.type]})`, rating.base,
  `built ${rating.released}`, `support: ${rating.support}`, complete(rating, 'computer', true), complete(rating, 'phone', true)].map(text => h('span', { className: 'feature', textContent: text })));
/** Default login, shown where people look for it. @param {string} login `user / password` */
const loginRow = login => { const [user, password] = login.split(' / ');
  return h('div', { className: 'login-box' }, h('strong', { textContent: 'login' }), h('pre', {}, h('code', { textContent: `user      ${user}\npassword  ${password}` })),
    h('small', { textContent: 'change it after the first login (passwd)' })); };
/** Feature row: ✓ works, ~ partial, ✗ broken, ? untested. @param {any} rating */
const ratingRow = rating => h('div', {}, ...Object.entries(FEATURE_GROUPS).map(([group, features]) => h('p', { className: 'rating' }, h('strong', { textContent: group }),
  ...features.filter(f => rating.features[f] !== 'n/a').map(f => h('span', { className: `feature ${rating.features[f]}`, title: rating.features[f],
    textContent: `${LABEL[f] ?? f} ${MARK[rating.features[f]]}` })))), h('small', { className: 'field-help', textContent: `Feature list follows the postmarketOS wiki · curated ${rating.checked}${rating.tested ? ` · phone test accepted ${rating.tested}` : ''}` }));
/** Count one view or flash of a ROM; failures are ignored. @param {string} rom @param {'view'|'flash'} kind */
// Opt-in: in-page downloads kept in Cache Storage by SHA-256, so a retry skips the download; the recipe still checks the hash.
const KEPT = 'rominit-downloads';
/** Read or set the keep-downloads choice (this browser). @param {boolean} [on] */
const keepDownloads = on => { try { if (on !== undefined) localStorage.setItem('keep-downloads', on ? '1' : ''); return !!localStorage.getItem('keep-downloads'); } catch { return false; } };
const forgetKept = () => caches.delete(KEPT).catch(() => false);
/** @param {any} pin @param {(fraction:number)=>void} progress @param {boolean} keep */
async function fetchKept(pin, progress, keep) {
  const cache = keep ? await caches.open(KEPT).catch(() => null) : null, key = `/kept/${pin.sha256}`;
  const hit = await (await cache?.match(key))?.blob();
  if (hit?.size === pin.size) return new File([hit], pin.name);
  const file = await fetchPinned(pin, progress);
  await cache?.put(key, new Response(file)).catch(() => {}); // full disk: keep going without
  return file;
}
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
  // Five empty stars that fill up to the pointer, so it reads as "rate me" rather than as a score.
  const input = h('span', { className: 'rate stars-input', role: 'group', ariaLabel: 'Your rating' }, h('span', { className: 'rate-label', textContent: 'rate it' }));
  const fill = (/** @type {number} */ upTo) => input.querySelectorAll('button').forEach((b, i) => { b.textContent = i < upTo ? '★' : '☆'; });
  input.addEventListener('mouseleave', () => fill(0));
  for (const n of [1, 2, 3, 4, 5]) {
    const button = h('button', { type: 'button', textContent: '☆', title: `Rate ${n} of 5`, ariaLabel: `${n} of 5 stars` });
    button.addEventListener('mouseenter', () => fill(n)); button.addEventListener('focus', () => fill(n));
    button.addEventListener('click', async () => {
      status.textContent = 'Saving…';
      const response = await fetch('./api/ratings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rom: key, stars: n }) }).catch(() => null);
      status.textContent = response?.ok ? `Thanks, you rated ${n} / 5.` : 'Could not save the rating.';
      load();
    });
    input.append(button);
  }
  row.append(input, status);
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
mountAccount();
/** Arrow looping back counter-clockwise into a circle (start over). */
const REWIND_SVG = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.25"/><path d="M3 3v5.25h5.25"/></svg>';
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
/** "maintainer: name (all postmarketOS)"; verified owners, else the scraped placeholder. Hidden where there is no API. @param {string} key @param {{name:string, avatar?:string, source:string}} [hint] */
/** Marks anything a scraper filled in. A scraped name is only text: never matched to an account with that username; owners come from roles an admin grants. */
const placeholderMark = (text = 'placeholder') => h('span', { className: 'placeholder-mark', title: 'Filled in by a scraper: not checked, and not linked to any ROMinit account with this name.', textContent: text });
function ownersRow(key, hint) {
  const row = h('p', { className: 'rating', hidden: true }, h('strong', { textContent: 'maintainer' }));
  // Scraped maintainer (catalog `maintainer`): a placeholder, always marked unverified until they claim the ROM.
  const placeholder = () => hint ? [h('span', { className: 'feature maintainer-hint' }, hint.avatar && h('img', { src: hint.avatar, alt: '', width: 18, height: 18 }), hint.name, placeholderMark()),
    h('small', {}, 'unverified · found at ', link(hint.source, new URL(hint.source).hostname), ' · subject to verification')] : [h('span', { className: 'feature untested', textContent: 'no verified maintainer yet' })];
  fetch(`./api/owners?rom=${encodeURIComponent(key)}`).then(r => r.ok ? r.json() : Promise.reject()).then((/** @type {any[]} */ owners) => {
    row.append(...(owners.length ? owners.map(o => h('span', { className: 'feature works', textContent: `✓ ${o.name}${o.scope.startsWith('rom:') ? '' : ` (${o.scope.replace(':', ' ')})`}` }))
      : placeholder()));
    row.hidden = false;
  }, () => {});
  return row;
}
/** Phone test tiers, in tap order; `inconclusive` only comes from a probe that failed. */
const TIERS = ['full', 'partial', 'broken', 'blocked', 'untested', 'n/a'];
/** Phone test tier → catalog feature state; tiers missing here say nothing about the feature. */
/** Review state of a sent card, as the sender sees it: [text, feature class]. */
const BENCH_STATE = /** @type {Record<string, string[]>} */ ({ new: ['received · waiting for review', 'untested'], review: ['in review', 'partial'], approved: ['approved · shown on this page', 'works'], rejected: ['not counted', 'broken'] });
/** How the tested ROM got on the phone (bench_runs.flash). */
const FLASH_NOTE = /** @type {Record<string, string>} */ ({ verified: 'flashed through ROMinit · listed image', unmatched: '⚠ unmatched image: flashed with skip verification', elsewhere: 'flashed another way · unconfirmed' });
const TIER_STATE = /** @type {Record<string, string>} */ ({ full: 'works', partial: 'partial', broken: 'broken', 'n/a': 'n/a' });
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
  root: p => ['com.topjohnwu.magisk', 'me.weishu.kernelsu', 'magisk', 'kernelsu', 'sudo', 'sudo-rs', 'doas', 'doas-suid'].some(x => p.has(x)),
});
/** Script output → {features: {f: {status, note}}, info: [], debug: [], packages}. @param {string} output */
function parseBench(output) {
  /** @type {Record<string, {status:string, note:string}>} */ const features = {};
  const info = [], debug = [], packages = new Set();
  /** @type {{status:string, note:string}|null} */ let root = null;
  for (const line of output.split('\n')) {
    const m = line.match(/^([a-z_]+) (full|partial|broken|blocked|untested|ask|inconclusive) ?(.*)$/);
    const rootMatch = line.match(/^@root (available|unverified|missing)(?: (.*))?$/);
    if (m && FEATURES.includes(m[1])) features[m[1]] = { status: m[2], note: m[3] };
    else if (rootMatch) root = { status: rootMatch[1], note: rootMatch[2] ?? '' };
    else if (line.startsWith('@debug ')) debug.push(line.slice(7));
    else if (line.startsWith('@pkgs ')) for (const name of line.slice(6).split(' ')) if (name) packages.add(name);
    else if (line.startsWith('@ ') && line !== '@ done') info.push(line.slice(2));
  }
  return { features, info, debug, packages, root };
}
/**
 * "4 · Test your phone": one command runs a read-only script on the phone (on it, over SSH or ADB), the page waits for its output,
 * shows a report card the user corrects by tapping, asks a few questions (all on request) and submits it.
 * @param {any} rom @param {string} key
 * @param {string[]} sent @param {() => string|null} flash
 * @param {{user?:string,password?:string,host?:string,usbHost?:string,way?:string,sound?:boolean}} connection
 */
function benchBox(rom, key, sent = /** @type {string[]} */ ([]), flash = () => /** @type {string|null} */ (null), connection = {}) {
  const linux = rom.os === 'postmarketOS';
  const [defaultUser, defaultPassword] = (rom.login ?? 'user / ').split(' / ');
  let loginUser = connection.user ?? defaultUser, loginPassword = connection.password ?? defaultPassword ?? '';
  let phoneHost = connection.host ?? '', usbHost = connection.usbHost ?? '172.16.42.1', phoneWay = connection.way, phoneSound = connection.sound ?? false;
  const credentials = () => ({ user: loginUser, password: loginPassword, host: phoneHost, usbHost, way: phoneWay, sound: phoneSound });
  try { localStorage.removeItem('rominit.phoneIp'); } catch { /* connection details stay in memory */ }
  let sshHost = `${loginUser}@<phone address>`;
  const box = h('div', { className: 'bench' });
  const start = h('button', { type: 'button', className: 'button button-secondary', textContent: 'Start a phone test' });
  let pairedHelper = false;
  const connectHelper = h('p', { className: 'field-help', textContent: 'For one-click testing, keep `rominit serve` running on this computer. ROMinit checks and connects to the CLI when you start the test.' });
  box.append(h('p', { className: 'intro-copy', textContent: 'Checks the phone silently, then asks about features that need a real try. The report autosubmits when results arrive; your corrections save automatically.' }), h('p', { className: 'field-label', textContent: `Testing ${rom.name} · ${rom.os} · automatic OS detection. Select the ROM currently installed on the phone.` }), start, linux ? connectHelper : '');
  me.then(info => {
    const session = helperSession();
    pairedHelper = linux && !!session && session.user.id === info?.user?.id;
    start.textContent = pairedHelper ? 'Run with CLI' : 'Start a phone test';
    connectHelper.hidden = !linux || pairedHelper;
  });
  start.addEventListener('click', async () => {
    start.disabled = true;
    let session = null, connectionError = '';
    const info = linux ? await me : null;
    if (linux) {
      if (info?.user) {
        try { session = await ensureHelper(info.user.id, helperSession()); }
        catch (error) { connectionError = message(error); }
      } else connectionError = info ? 'Sign in to ROMinit to connect the CLI.' : 'Could not check your ROMinit account. Check your connection and retry.';
    }
    const autoRun = !!session;
    start.textContent = autoRun ? 'Starting with CLI…' : 'Starting phone test…';
    const r = await fetch('./api/bench', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rom: key }) }).catch(() => null);
    const reply = await r?.json().catch(() => ({}));
    if (!r?.ok) { start.disabled = false; start.textContent = pairedHelper ? 'Run with CLI' : 'Start a phone test'; box.append(h('p', { className: 'status', textContent: `Could not start: ${reply?.error ?? 'network error'}.` })); return; }
    waitFor(reply.code, autoRun, session, connectionError);
  });
  // Your sent cards and where review stands: from your account when signed in, else the codes this browser kept, else none.
  fetch(`./api/bench?mine=${encodeURIComponent(key)}`).then(r => r.json()).catch(() => ({})).then(({ codes }) => (codes = codes ?? [...sent].reverse()) &&
    codes.length && box.prepend(h('div', { className: 'bench-sent' }, h('p', { className: 'field-label', textContent: 'Your report cards' }), ...codes.map((/** @type {string} */ code) => {
    const row = h('div', {}, h('small', { textContent: 'Loading…' }));
    fetch(`./api/bench?code=${encodeURIComponent(code)}`).then(r => r.ok ? r.json() : null).then(card => {
      if (!card?.submitted) { row.remove(); return; }
      const [state, cls] = BENCH_STATE[card.state] ?? [card.state, 'untested'];
      const counts = Object.values(card.final).reduce((/** @type {Record<string, number>} */ n, /** @type {any} */ t) => ({ ...n, [t]: (n[t] ?? 0) + 1 }), {});
      row.replaceChildren(h('p', { className: 'rating' }, h('span', { className: `feature ${cls}`, textContent: state }),
          h('small', { textContent: ` sent ${card.at} UTC · ${Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(' · ')} · ${FLASH_NOTE[card.flash] ?? 'flash path unknown'}` })),
        h('details', {}, h('summary', { textContent: 'show card' }), h('p', { className: 'rating' },
          ...Object.entries(card.final).map(([f, t]) => h('span', { className: `feature ${TIER_STATE[/** @type {string} */ (t)] ?? 'untested'}`, textContent: `${LABEL[f] ?? f}: ${t}` })))));
    }).catch(() => row.remove());
    return row;
  }))));
  /** @param {string} code @param {(busy:boolean) => void} onBusy */
  function discardButton(code, onBusy = () => {}) {
    return h('button', { type: 'button', className: 'button button-secondary bench-discard', textContent: 'Discard test', async onclick() {
      this.disabled = true; onBusy(true);
      const response = await fetch('./api/bench', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, discard: true }) }).catch(() => null);
      if (!response?.ok) { this.disabled = false; onBusy(false); this.textContent = 'Could not discard — retry'; return; }
      box.dispatchEvent(new CustomEvent('bench-discarded', { bubbles: true, detail: code }));
      box.replaceWith(benchBox(rom, key, sent.filter(item => item !== code), flash, credentials()));
    } });
  }
  /** @param {string} code */
  function waitFor(code, autoRun = false, initialSession = null, initialConnectionError = '') {
    const url = `${location.origin}/b/${code}`;
    let localHelper = initialSession ?? helperSession();
    let helperReady = !!localHelper;
    const sound = h('input', { type: 'checkbox', checked: phoneSound });
    // Browsers cannot open SSH themselves, so the page builds the one command: USB uses postmarketOS' fixed USB-network address.
    const ssh = 'ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new ';
    const ways = linux ? [['USB cable', 'usb'], ['Wi-Fi', 'wifi'], ['Terminal on the phone', '']]
      : [['ADB from a computer', 'adb shell '], ['SSH from a computer', 'ssh'], ['On the phone (terminal app)', '']];
    const savedWay = (() => { try { const value = localStorage.getItem('rominit.benchTransport'); return value === 'wifi' || value === 'usb' ? value : 'usb'; } catch { return 'usb'; } })();
    let way = phoneWay ?? (linux ? savedWay : ways[0][1]);
    const ip = h('input', { type: 'text', className: 'bench-target', inputMode: 'decimal', spellcheck: false, placeholder: '192.168.1.50',
      value: phoneHost });
    const ipRow = h('label', { className: 'field-help', hidden: true }, 'Phone IP address (Settings → Wi-Fi, or `ip a` on the phone): ', ip);
    let targetDiscovery = false, usbEdited = !!connection.usbHost;
    const targetSelect = h('select', { className: 'confirmation-input', ariaLabel: 'USB-network phone' }, new Option('Enter an address manually', ''));
    const targetHelp = h('small', { className: 'field-help' });
    const targetRow = h('label', { className: 'field-help', hidden: true }, 'USB-network phone detected by CLI', targetSelect, targetHelp);
    targetSelect.addEventListener('change', () => {
      usbEdited = true;
      if (targetSelect.value) usbHost = targetSelect.value;
      render();
    });

    // Login details stay in this tab and are sent only to the paired local CLI when the user runs the test.
    const userBox = h('input', { type: 'text', className: 'bench-target', spellcheck: false, autocomplete: 'off', value: loginUser });
    const passBox = h('input', { type: 'password', className: 'bench-target', spellcheck: false, autocomplete: 'off', value: loginPassword });
    const loginRow = h('div', { className: 'field-help bench-login' }, h('label', {}, 'User ', userBox), ' ', h('label', {}, 'Password ', passBox),
      h('small', { textContent: ' Prefilled from the ROM’s public defaults. Your edits stay in this tab’s memory.' }));
    const hint = h('p', { className: 'field-help' });
    const command = h('code', { className: 'bench-command' });
    const helperRun = h('button', { type: 'button', className: 'button button-primary', textContent: 'Run with CLI', hidden: true });
    const helperStatus = h('p', { className: 'status', role: 'status', ariaLive: 'polite' });
    const helperNote = h('p', { className: 'field-help', textContent: 'This run may play a short tone and buzz. The report will tell you if a tool or permission prevented a check.', hidden: true });
    const sshSelected = () => way === 'usb' || way === 'wifi' || way === 'ssh';
    const render = () => {
      loginUser = userBox.value.trim() || defaultUser; loginPassword = passBox.value; phoneWay = way; phoneSound = sound.checked;
      loginRow.hidden = !sshSelected();
      const sh = sound.checked ? 'ROMINIT_SOUND=1 sh' : 'sh';
      ip.value = way === 'usb' ? usbHost : phoneHost;
      if (sshSelected()) sshHost = `${loginUser}@${ip.value.trim() || '<phone IP>'}`;
      const prefix = sshSelected() ? `${ssh}-- ${shellArg(sshHost)} ` : way;
      ipRow.hidden = !sshSelected();
      targetRow.hidden = way !== 'usb' || !targetDiscovery;
      targetSelect.value = [...targetSelect.options].some(option => option.value === usbHost) ? usbHost : '';
      hint.textContent = sshSelected() ? `Paste it into a terminal on your computer. The command prompts for the phone password; Run with CLI sends the password field only to your paired CLI. Test code ${code}, valid for an hour. The phone needs an SSH server and a login allowed to run the benchmark commands.${linux ? ' After a reflash, remove the old host key with ssh-keygen -R 172.16.42.1 (or the Wi-Fi IP).' : ''}`
        : linux ? `Paste it into a terminal on the phone. Test code ${code}, valid for an hour.`
          : `Test code ${code}, valid for an hour. Freshly flashed? USB debugging starts off again: Settings › About phone, tap Build number 7 times, then Developer options › USB debugging on, plug in and tap Allow on the phone (until then ADB says unauthorized). No network on the phone? Use ADB from a computer; the computer does the downloading. A terminal app lacks the permissions for most checks; ADB works best.`;
      command.textContent = `curl -fsSL ${url} | ${prefix}${prefix && sound.checked ? `'${sh}'` : sh} | curl -sS --data-binary @- ${url}`;
      const canUseHelper = sshSelected();
      helperRun.hidden = !canUseHelper;
      helperRun.disabled = sshSelected() && !ip.value.trim();
      connectHelper.hidden = !(linux || way === 'ssh') || helperReady;
      helperNote.hidden = !canUseHelper || !sound.checked;
    };
    const runWithHelper = async () => {
      if (!box.isConnected) return;
      if (!sshSelected()) {
        helperStatus.textContent = 'Choose SSH or a USB/Wi-Fi connection to run with the CLI.';
        return;
      }
      if (sshSelected() && !ip.value.trim()) {
        helperStatus.textContent = 'Enter the phone IP address to run with the CLI.';
        ip.focus();
        return;
      }
      helperRun.disabled = true;
      helperStatus.textContent = 'Checking the ROMinit CLI connection…';
      let cliReached = false;
      try {
        const account = await me;
        if (!account?.user) throw Error('Sign in to ROMinit before connecting the CLI.');
        const session = await ensureHelper(account.user.id, helperSession());
        localHelper = session; helperReady = true; render();
        const ready = await helperRequest(session, '/status');
        cliReached = true;
        if (ready.user?.id !== account.user.id) throw Error('The helper is connected to a different account.');
        if (!ready.capabilities?.includes('bench')) {
          helperStatus.replaceChildren('This CLI needs an update before it can run browser benchmarks. ', h('a', { href: '/rominit-cli.tar.gz', textContent: 'Download updated CLI' }), ' and restart rominit serve.');
          helperRun.disabled = false;
          return;
        }
        if (sound.checked && !ready.capabilities?.includes('bench-sound')) {
          helperStatus.textContent = 'Update and reconnect the CLI to run speaker and vibration checks, or use the copied terminal command.';
          helperRun.disabled = false;
          return;
        }
        if (!box.isConnected) return;
        helperStatus.textContent = 'Running the benchmark on your phone…';
        await helperRequest(session, '/bench', { code, rom: key, host: ip.value.trim(), user: loginUser, password: loginPassword, ...(sound.checked ? { sound: true } : {}) });
        helperRun.textContent = 'CLI run complete';
        helperStatus.textContent = 'The test finished. The report autosubmits; review and correct it below.';
      } catch (error) {
        helperStatus.textContent = `Could not run the benchmark: ${message(error)} You can still use the terminal command below.`;
        helperRun.disabled = false;
        if (!cliReached || message(error).startsWith('Could not reach your local ROMinit CLI')) {
          helperReady = false;
          render();
        }
      }
    };
    helperRun.addEventListener('click', runWithHelper);
    me.then(async info => {
      helperReady = !!localHelper && localHelper.user.id === info?.user?.id;
      if (initialConnectionError) helperStatus.textContent = `CLI connection error: ${initialConnectionError} You can still use the terminal command below.`;
      let canAutoRun = autoRun;
      if (helperReady && linux) {
        try {
          const ready = await helperRequest(localHelper, '/status');
          if (ready.capabilities?.includes('bench-targets')) {
            const { targets, interfaces = [] } = await helperRequest(localHelper, '/bench/targets');
            targetDiscovery = true;
            for (const target of targets) {
              const host = /^fe[89ab][0-9a-f]:/i.test(target.host) ? `${target.host}%${target.interface}` : target.host;
              targetSelect.append(new Option(`${target.label} · ${host}`, host));
            }
            for (const adapter of interfaces) {
              if (targets.some(target => target.interface === adapter.name)) continue;
              const label = `${adapter.name} — ${adapter.addresses.length ? 'no peer address detected' : 'no IP address configured'}`;
              const option = new Option(label, ''); option.disabled = true; targetSelect.append(option);
            }
            if (targets.length === 1 && !usbEdited) usbHost = targetSelect.options[1].value;
            targetHelp.textContent = targets.length ? 'Candidates from USB-network interfaces; SSH connectivity is not yet verified. Manual IP entry is available below.' : interfaces.length ? 'USB-network adapter detected, but no usable phone address. Configure the USB network connection or use Wi-Fi; the helper does not change network settings.' : 'No USB-network targets detected. Enter an address below or use Wi-Fi.';
            if (way === 'usb') {
              canAutoRun = false;
              helperStatus.textContent = targets.length ? 'Choose the USB-network phone or check the selected address, then run with CLI.' : interfaces.length ? 'USB-network adapter detected without a peer address. Wi-Fi SSH or manual entry is available.' : 'No USB-network phone detected. Check the USB network link or enter an address manually.';
            }
          }
        } catch (error) { canAutoRun = false; helperStatus.textContent = `${message(error)} You can enter the phone address manually.`; }
      }
      render();
      if (canAutoRun && box.isConnected) void runWithHelper();
    });
    ip.addEventListener('input', () => { if (way === 'usb') { usbHost = ip.value.trim(); usbEdited = true; } else phoneHost = ip.value.trim(); render(); });
    const tabs = h('div', { className: 'bench-tabs', role: 'tablist' }, ...ways.map(([label, prefix]) => h('button', { type: 'button', role: 'tab', ariaSelected: String(way === prefix), textContent: label,
      onclick(/** @type {Event} */ e) {
        way = prefix;
        if (linux && (way === 'usb' || way === 'wifi')) try { localStorage.setItem('rominit.benchTransport', way); } catch { /* private window */ }
        for (const t of tabs.children) t.setAttribute('aria-selected', String(t === e.currentTarget)); render();
      } })));
    for (const el of [sound, userBox, passBox]) el.addEventListener('input', render);
    sound.addEventListener('change', render); render();
    const waiting = h('div', { className: 'bench-wait' }, h('span', { className: 'breath', ariaHidden: 'true' }), h('span', { textContent: 'Waiting for your phone… breathe in, breathe out.' }));
    box.replaceChildren(
      h('p', { className: 'field-label', textContent: `Testing ${rom.name} · ${rom.os} · automatic OS detection` }),
      h('p', { className: 'field-label', textContent: linux ? 'How is the phone connected?' : 'Run this, wherever your phone has a shell' }), tabs, targetRow, ipRow, loginRow,
      h('div', { className: 'bench-run' }, command, h('button', { type: 'button', className: 'button button-secondary', textContent: 'Copy', async onclick() {
        await navigator.clipboard?.writeText(command.textContent ?? '').catch(() => {}); this.textContent = 'Copied'; } })),
      connectHelper, helperRun, helperStatus, helperNote,
      h('label', { className: 'field-help' }, sound, ' Also check speaker and vibration (plays a short tone; buzzes if supported)'),
      hint,
      waiting, discardButton(code));
    const started = Date.now();
    const poll = async () => {
      if (!box.isConnected || Date.now() - started > 3600_000) return;
      const run = await fetch(`./api/bench?code=${code}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
      if (run?.output?.startsWith('@ failed os-mismatch:')) {
        waiting.lastChild.textContent = run.output.slice('@ failed os-mismatch:'.length).trim();
        return;
      }
      if (run?.output?.startsWith('@ failed')) waiting.lastChild.textContent = `Nothing came from the phone last time: check the cable or IP${linux ? ' (SSH host key changed after a reflash? ssh-keygen -R 172.16.42.1)' : ''}, then run the command again. Still listening…`;
      if (run?.output && !run.output.startsWith('@ failed')) card(code, run.output); else setTimeout(poll, 3000);
    };
    poll();
  }
  /** @param {string} code @param {string} output */
  function card(code, output) {
    const { features, info, debug, packages, root } = parseBench(output);
    /** @type {Record<string, string>} */ const final = {};
    for (const f of FEATURES) final[f] = rom.rating?.features?.[f] === 'n/a' ? 'n/a' : features[f]?.status === 'ask' ? 'untested' : features[f]?.status ?? 'untested';
    const needsConfirmation = new Set(FEATURES.filter(f => features[f]?.status === 'ask' && final[f] === 'untested'));
    const tiles = /** @type {Record<string, HTMLButtonElement>} */ ({});
    const score = h('div', { className: 'bench-score' });
    const paint = (/** @type {string} */ f) => {
      const t = tiles[f], pending = needsConfirmation.has(f);
      t.className = `bench-tile ${final[f] === 'n/a' ? 'na' : final[f]}${pending ? ' needs-confirmation' : ''}`;
      t.title = `${pending ? 'needs your confirmation; not automatically verified' : TIER_HELP[final[f]]}${features[f]?.note ? ` · ${features[f].note}` : ''} · tap to change`;
      /** @type {HTMLElement} */ (t.lastChild).textContent = pending ? '? needs confirmation' : `${TIER_MARK[final[f]]} ${final[f]}`;
      const counted = FEATURES.filter(x => final[x] !== 'n/a'), n = (/** @type {string} */ s) => counted.filter(x => final[x] === s).length;
      score.replaceChildren(h('strong', { textContent: `${Math.round(100 * (n('full') + n('partial') / 2) / (counted.length || 1))}%` }),
        h('span', { textContent: ` works · ${n('full')} full · ${n('partial')} partial · ${n('broken')} broken · ${n('blocked')} blocked · ${n('untested') + n('inconclusive')} open` }));
    };
    let delay = 0;
    const groups = Object.entries(FEATURE_GROUPS).map(([group, list]) => h('div', { className: 'bench-group' }, h('p', { className: 'field-label', textContent: group }),
      h('div', { className: 'bench-tiles' }, ...list.map(f => {
        tiles[f] = h('button', { type: 'button', style: `animation-delay:${(delay++) * 40}ms`, onclick() { needsConfirmation.delete(f); final[f] = TIERS[(TIERS.indexOf(final[f]) + 1) % TIERS.length]; paint(f); changed(); } },
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
          row.append(h('button', { type: 'button', className: 'button button-secondary', textContent: label, onclick() { if (tier) { needsConfirmation.delete(f); final[f] = tier; paint(f); changed(); } row.classList.add('answered'); row.querySelectorAll('button').forEach(b => { b.disabled = true; }); } }));
        questions.append(row);
      }
      const left = pool.filter(f => !asked.has(f)).length;
      more.hidden = !left; more.textContent = `Answer more (${left} left)`;
    };
    more.addEventListener('click', () => ask(pool.length));
    ask(Math.max(3, pool.filter(f => features[f]?.status === 'ask').length)); // every only-you-can-tell question together, then a few untested
    const note = h('textarea', { className: 'confirmation-input', placeholder: 'Anything the test missed? (optional)', maxLength: 2000, rows: 2 });
    const status = h('small', { role: 'status', ariaLive: 'polite' });
    let dirty = true, saved = false, stopped = false, locked = false, saveTimer = 0;
    /** @type {Promise<boolean>|null} */ let saving = null;
    const thanks = h('p', { className: 'bench-thanks', hidden: true }, 'Thank you! ',
      h('a', { className: 'bench-donate', href: DONATE, target: '_blank', rel: 'noopener noreferrer', textContent: '☕ Support ROMinit' }));
    const retrySave = h('button', { type: 'button', className: 'button button-secondary', hidden: true, textContent: 'Retry saving', onclick() { void flush(); } });
    async function flush() {
      clearTimeout(saveTimer);
      if (stopped || !box.isConnected) return false;
      if (saving) return saving;
      saving = (async () => {
        while (dirty && !stopped && !locked) {
          dirty = false;
          status.textContent = saved ? 'Saving changes…' : 'Autosubmitting report…';
          retrySave.hidden = true;
          const response = await fetch('./api/bench', { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true, signal: AbortSignal.timeout(15_000),
            body: JSON.stringify({ code, final, note: note.value, flash: flash() }) }).catch(() => null);
          if (stopped) return false;
          if (!response?.ok) {
            dirty = true;
            locked = !!response && response.status >= 400 && response.status < 500;
            const error = (await response?.json().catch(() => ({})))?.error ?? 'network error';
            status.textContent = `Not saved: ${error}.${locked ? ' Use Retest to start a fresh report.' : ' Retry when connected.'}`;
            retrySave.hidden = locked;
            if (locked) { note.disabled = true; more.disabled = true; for (const button of [...Object.values(tiles), ...questions.querySelectorAll('button')]) button.disabled = true; }
            return false;
          }
          if (!saved) {
            saved = true; thanks.hidden = false;
            box.dispatchEvent(new CustomEvent('bench-sent', { bubbles: true, detail: code }));
          }
          status.textContent = 'Report autosubmitted. Changes save automatically until review starts.';
        }
        return !dirty;
      })();
      const ok = await saving; saving = null; return ok;
    }
    function changed() {
      if (stopped || locked) return;
      dirty = true; clearTimeout(saveTimer);
      status.textContent = 'Changes waiting to save…';
      saveTimer = window.setTimeout(() => { void flush(); }, 600);
    }
    const onLeave = () => { void flush(); };
    addEventListener('pagehide', onLeave);
    const stop = () => { stopped = true; clearTimeout(saveTimer); removeEventListener('pagehide', onLeave); };
    const retest = h('button', { type: 'button', className: 'button button-secondary', textContent: 'Retest', async onclick() {
      this.disabled = true;
      if (!locked && !await flush()) { this.disabled = false; return; }
      stop();
      box.replaceWith(benchBox(rom, key, saved ? [...new Set([...sent, code])] : sent, flash, credentials()));
    } });
    const discard = discardButton(code, busy => {
      stopped = busy; clearTimeout(saveTimer); retest.disabled = busy;
      if (busy) removeEventListener('pagehide', onLeave);
      else { addEventListener('pagehide', onLeave); changed(); }
    });
    note.addEventListener('input', changed);
    const failed = FEATURES.filter(f => features[f]?.status === 'inconclusive');
    // What the package list says the ROM ships, next to what the catalog claims.
    const ships = packages.size || root ? h('p', { className: 'rating' }, packages.size ? h('strong', { textContent: `found in ${packages.size} packages` }) : '',
      ...Object.entries(SHIPS).filter(([key]) => packages.size || key === 'root').map(([key, test]) => {
        const found = test(packages), claim = rom.rating?.includes?.[key];
        if (key === 'root') {
          const state = root?.status === 'available' ? 'available' : root?.status === 'unverified' || found ? 'unverified' : 'untested';
          const mark = state === 'available' ? '✓' : state === 'unverified' ? '~' : '·';
          const title = state === 'available' ? root?.note : state === 'unverified' ? root?.note || 'root package found; access not verified' : root?.note || 'root access was not detected; interactive commands were not tested';
          const mismatch = state !== 'unverified' && state !== 'untested' && claim && (claim === 'yes') !== (state === 'available');
          return h('span', { className: `feature ${state === 'available' ? 'works' : state === 'unverified' ? 'partial' : 'untested'}`,
            title: `${title}${mismatch ? ` · catalog says ${claim}` : ''}`, textContent: `${mark} Root${mismatch ? ' *' : ''}` });
        }
        return h('span', { className: `feature ${found ? 'works' : 'untested'}`, title: claim && (claim === 'yes') !== found ? `catalog says ${claim}` : '',
          textContent: `${found ? '✓' : '✗'} ${LABEL[key] ?? key}${claim && (claim === 'yes') !== found ? ' *' : ''}` });
      })) : '';
    // Default passwords are public: offer the change, typed on the phone so it never reaches this page.
    const password = rom.login && linux && defaultPassword ? h('div', { className: 'hints' }, h('strong', { textContent: 'Change the default password' }),
      h('p', { className: 'field-help', textContent: 'This ROM’s default login is public. Change its password now; type the new one on the phone or in your SSH session, so it never reaches ROMinit.' }),
      h('code', { className: 'bench-command', textContent: 'passwd' }), ' on the phone, or ',
      h('code', { className: 'bench-command', textContent: `ssh -t -- ${shellArg(sshHost)} passwd` })) : '';
    box.replaceChildren(h('div', { className: 'bench-card-header' }, h('p', { className: 'field-label', textContent: 'Report card' }), h('div', { className: 'bench-card-actions' }, retest, discard)), score,
      h('p', { className: 'field-help', textContent: 'This report autosubmits. Corrections and notes save automatically until review starts.' }),
      h('p', { className: 'rate-label', textContent: '✎ tap any tile to correct it' }),
      info.length ? h('p', { className: 'field-help', textContent: info.join(' · ') }) : '',
      questions.childElementCount || pool.length ? h('div', {}, h('p', { className: 'field-label', textContent: 'Quick questions' }), questions, more) : '',
      h('p', { className: 'field-help', textContent: 'Tap any tile to correct it: full → partial → broken → blocked → untested → n/a.' }),
      ...groups,
      failed.length ? h('details', { className: 'bench-debug' }, h('summary', { textContent: `${failed.length} check${failed.length > 1 ? 's' : ''} inconclusive: the script failed there (sent with your card so it gets fixed)` }),
        h('pre', { textContent: [...failed.map(f => `${f}: ${features[f].note}`), ...debug].join('\n') })) : '',
      ships, note, status, retrySave, thanks, password);
    void flush();
  }
  return box;
}
const MODE = { fastboot: 'FASTBOOT', download: 'DOWNLOAD MODE', recovery: 'RECOVERY (TWRP)', sideload: 'TWRP', 'usb-burn': 'USB BURN MODE' };
/** Label for a stage's mode; devices may name their own modes (e.g. eos-sideload), shown from the key. @param {string} mode */
const modeName = mode => MODE[/** @type {keyof typeof MODE} */ (mode)] ?? mode.replace(/-/g, ' ').toUpperCase();
const CONNECT = { fastboot: 'Connect fastboot', odin: 'Connect Download Mode', adb: 'Connect ADB', sideload: 'Connect sideload', amlogic: 'Connect USB burn mode' };
/** Where `adb reboot …` takes a booted phone for these protocols, so the stage needs no button combo. */
const REBOOT_TO = /** @type {Record<string, 'bootloader'|'download'>} */ ({ fastboot: 'bootloader', odin: 'download' });
/** One readable line per step for the card. @param {any[]} step */
const describe = ([verb, a, b]) => ({ flash: `${b} → ${a}`, write: `${b} → ${a}`, erase: `erase ${a}`, set_active: `switch to slot ${a}`,
  unmount: `unmount ${a}`, reboot: 'reboot', sideload: `install ${a}`, mkfs_ext4: `format ${a} as ext4 (${b})`,
  unlock: `fastboot ${a} unlock`, lock: `fastboot ${a} lock`, burn: `burn ${a} (${b === 'keep' ? 'no wipe' : b === 'keep_keys' ? 'wipe, keep keys' : 'wipe all'})` })[verb] ?? verb;

/** One stage card: connect, files, options, consent, flash. @param {any} device @param {any} stage @param {number} n @param {number} count @param {string} key `<codename>/<rom id>` */
function stageCard(device, stage, n, count, key) {
  const { protocol } = recipes[stage.recipe];
  const st = { session: /** @type {any} */ (null), usb: /** @type {USBDevice|undefined} */ (undefined), lost: false, busy: false, finished: false, failed: false,
    files: /** @type {ReturnType<typeof selectFiles>|null} */ (stage.files.length ? null : []) }; // no files (unlock): nothing to attach
  const connectButton = h('button', { className: 'button button-secondary', type: 'button', textContent: CONNECT[protocol] });
  const rebootTo = REBOOT_TO[protocol];
  // Phone still in Android: one click over USB debugging instead of the button combo, then the Connect button as usual.
  const rebootButton = rebootTo && h('button', { className: 'button button-secondary', type: 'button', textContent: `Phone in Android? Reboot to ${modeName(stage.mode).toLowerCase()}`, async onclick() {
    if (!supported) return;
    this.disabled = true;
    try {
      await rebootFromAndroid(rebootTo, dbg);
      report(`Phone is rebooting into ${modeName(stage.mode).toLowerCase()}. When its screen shows it, press ${CONNECT[protocol]}.`);
    } catch (error) {
      dbgError(error);
      report(`${explain(error)} Needs USB debugging on (Settings › Developer options) and the "Allow USB debugging" prompt accepted. Or use the button combo above.`);
    } finally { this.disabled = false; }
  } });
  const selfHosted = stage.files.length > 0 && stage.files.every((/** @type {any} */ f) => f.url?.startsWith(SELF_HOSTED));
  const status = h('p', { className: 'status', role: 'status', textContent: protocol === 'adb' ? 'Boot TWRP (or Android with USB debugging on), then connect: ROMinit reboots into TWRP itself.' : protocol === 'sideload' ? 'Boot TWRP (or Android with USB debugging on), then connect: ROMinit switches to ADB Sideload itself.' : `Put the phone in ${modeName(stage.mode).toLowerCase()}, then connect.` });
  status.setAttribute('aria-live', 'polite');
  const picker = h('input', { type: 'file', multiple: stage.files.length > 1 });
  const selected = h('ul', { className: 'selected-files' }, h('li', { className: 'empty-files', textContent: 'No files selected' }));
  const options = (stage.options ?? []).map(option => h('input', { type: 'checkbox', checked: option.default }));
  const risk = h('input', { type: 'checkbox' }), unverified = h('input', { type: 'checkbox' });
  let picked = /** @type {File[]} */ ([]);
  const confirm = h('input', { className: 'confirmation-input', type: 'text', placeholder: stage.confirm, autocomplete: 'off', spellcheck: false });
  const flash = h('button', { className: 'button button-primary', type: 'button', disabled: true, textContent: `Run stage ${n}` });
  const progress = h('progress', { max: 100, value: 0 });
  const percent = h('span', { textContent: '0%' });
  const log = h('ol');
  const outcome = h('div', { className: 'outcome', hidden: true }); // big DONE / FAILED under the activity list
  // Debug log: timestamped steps, every USB call with result and timing, the full error. Copied into bug reports.
  const debugText = h('pre', { className: 'debug-log' });
  const started = Date.now();
  const dbg = (/** @type {string} */ line) => { debugText.textContent += `+${((Date.now() - started) / 1000).toFixed(3)}s ${line}\n`; };
  dbg(`ROMinit ${new URL(import.meta.url).pathname}${new URL(import.meta.url).search} · ${navigator.userAgent} · host ${host} · ${navigator.language} · ${navigator.hardwareConcurrency} cores${supported ? '' : ' · NO WEBUSB'}`);
  dbg(`${device.codename} · ${key} · stage ${n}/${count} "${stage.title}" · recipe ${stage.recipe} · mode ${stage.mode}`);
  const debugBox = h('details', { className: 'field-help debug-box' }, h('summary', { textContent: 'Debug log (sent to ROMinit if the stage stops, without serial numbers)' }), debugText,
    h('button', { type: 'button', className: 'button button-secondary', textContent: 'Copy debug log', async onclick() {
      await navigator.clipboard?.writeText(debugText.textContent ?? '').catch(() => {}); this.textContent = 'Copied'; } }));

  // What this computer needs before the browser can reach the phone in this stage's mode; follows the header's host choice.
  const prereqs = h('details', { className: 'field-help prereqs' });
  const renderPrereqs = () => {
    const problem = browserProblem({ usb: navigator.usb, secure: window.isSecureContext, host });
    const items = prereqsFor(host, protocol);
    prereqs.replaceChildren(h('summary', {}, h('strong', { textContent: `Before you connect · ${items.length} hint${items.length === 1 ? '' : 's'}` }), ` (${HOSTS[host]}; change it in the header)`,
        problem && h('p', { className: 'status', textContent: `✗ ${problem}` })), // hints start collapsed; a blocker stays visible in the summary
      h('ul', {}, ...items.map(p => h('li', {}, p.text, p.url && ' ', p.url && link(p.url, new URL(p.url).hostname),
        p.command && h('div', { className: 'command-row' }, h('pre', { className: 'debug-log', textContent: p.command }),
          h('button', { type: 'button', className: 'button button-secondary', textContent: 'Copy', async onclick() {
            await navigator.clipboard?.writeText(p.command ?? '').catch(() => {}); this.textContent = 'Copied'; } }))))));
  };
  renderPrereqs();
  document.addEventListener('host-change', renderPrereqs);
  /** Error text plus the host-specific fix. @param {unknown} error */
  const explain = error => [message(error), fixFor(message(error), host, protocol)].filter(Boolean).join(' ');

  const again = `put the phone back in ${modeName(stage.mode).toLowerCase()}, press Retry connect, then run the stage again from step 1.`;
  const update = () => {
    connectButton.disabled = !supported || st.busy || (st.session !== null && !st.lost);
    // green connected · red connect failed (click to retry) · yellow lost or stopped mid-session (click to reconnect)
    const state = st.lost ? 'retry' : st.session ? 'connected' : st.failed ? 'failed' : '';
    connectButton.className = `button button-secondary${state && ` connect-${state}`}`;
    connectButton.textContent = { connected: 'Connected', failed: 'Failed · retry connect', retry: 'Retry connect', '': CONNECT[protocol] }[state];
    const oneShot = selfHosted && !unverified.checked; // own builds: the run downloads and attaches them first
    flash.disabled = !supported || !st.session || st.lost || st.busy || st.finished || !(st.files || oneShot) || !risk.checked || confirm.value !== stage.confirm;
    if (!st.busy) flash.textContent = st.files || !oneShot ? `Run stage ${n}` : `⬇ Download, check & run stage ${n}`;
  };
  const report = (/** @type {string} */ text, fraction = 0) => {
    status.textContent = text;
    progress.value = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    percent.textContent = `${progress.value}%`;
    if (log.lastElementChild?.textContent !== text) { log.append(h('li', { textContent: text })); dbg(`[status] ${text}`); }
  };
  const dbgError = (/** @type {any} */ error) => {
    for (let e = error; e; e = e.cause) dbg(`ERROR ${e?.name ?? ''}: ${e?.message ?? e}\n${e?.stack ?? ''}`);
  };
  const assertSession = () => {
    if (st.lost || !st.session) throw Error(`USB session lost. ${again}`);
  };
  /** A stopped stage sends its debug log to the admin inbox on its own, so the recipe can be fixed. No serial numbers.
   */
  const sendFailure = () => {
    const context = { rom: key, stage: n, recipe: stage.recipe, mode: stage.mode, host, unverified: unverified.checked,
      files: st.files?.map(f => ({ pin: f.name, size: f.file.size, sha256: f.sha256 || 'unverified' })), steps: stage.steps, online: navigator.onLine };
    const log = redact(`${JSON.stringify(context)}\n${debugText.textContent}`);
    fetch('./api/failures', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rom: key, stage: n, error: status.textContent?.slice(0, 2000), log }) })
      .then(r => { if (r.ok) dbg('Failure log sent to ROMinit (serial numbers removed) so the recipe can be fixed.'); }, () => {});
  };
  const pick = (/** @type {File[]} */ files) => {
    picked = files;
    if (!files.length) return;
    try {
      st.files = selectFiles(stage, files, unverified.checked);
      dbg(`Files: ${st.files.map(f => `${f.name} = ${f.file.name} ${f.file.size} B${f.sha256 ? '' : ' UNVERIFIED'}`).join(', ')}`);
      selected.className = 'selected-files files-ok';
      selected.replaceChildren(h('li', { className: 'files-head', textContent: `✓ ${st.files.length === 1 ? 'File' : `All ${st.files.length} files`} attached${st.files.every(f => f.sha256) ? ' · SHA-256 is checked when you run' : ' · UNVERIFIED'}` }),
        ...st.files.map(f => h('li', { textContent: `✓ ${f.file.name} (${size(f.size)})${f.sha256 ? '' : ' · UNVERIFIED'}` })));
    } catch (error) {
      st.files = null;
      dbg(`Files rejected: ${files.map(f => `${f.name} ${f.size} B`).join(', ')}: ${message(error)}`);
      selected.className = 'selected-files files-bad';
      selected.replaceChildren(h('li', { className: 'files-head', textContent: '✗ Not attached' }), h('li', { textContent: message(error) }));
    }
    update();
  };

  if (supported) navigator.usb.addEventListener('disconnect', event => {
    if (st.usb && event.device === st.usb && !st.finished) {
      st.lost = true;
      dbg(`USB disconnect event (${event.device.productName ?? '?'} serial ${event.device.serialNumber ?? '?'})`);
      // A reboot step is always last and drops USB by design; everything before it is written and verified.
      if (/^(Requesting reboot|Rebooting)/.test(status.textContent ?? '')) { report('Phone is rebooting.', 1); return; }
      report(`USB disconnected. The flash may be incomplete: ${again}`);
      update();
    }
  });
  connectButton.addEventListener('click', async () => {
    st.busy = true; update();
    // Reconnect: drop the dead session first; the stage then runs again from step 1.
    if (st.usb?.opened) await st.usb.close().catch(() => {});
    Object.assign(st, { session: null, usb: undefined, lost: false, failed: false, finished: false });
    try {
      dbg(`Connecting (${protocol})`);
      const found = await connect(protocol, dbg);
      Object.assign(st, found, { session: traced(found.session, dbg, protocol) });
      report(stage.files.length ? 'Connected. Choose the files, confirm, and run.' : 'Connected. Confirm and run.');
    } catch (error) {
      st.failed = true;
      dbgError(error);
      report(`${explain(error)} Check the phone is in ${modeName(stage.mode).toLowerCase()}, then press Connect again.`);
    } finally { st.busy = false; update(); }
  });
  picker.addEventListener('change', () => pick([...picker.files ?? []]));
  const total = stage.files.reduce((/** @type {number} */ n, /** @type {any} */ f) => n + f.size, 0);
  /** Downloads every pinned file in this tab and attaches it; progress goes to `show`. @param {(text:string)=>void} show */
  const download = async show => {
    const files = [];
    try {
      let done = 0;
      for (const pin of stage.files) {
        files.push(await fetchKept(pin, f => show(`Downloading ${pin.name} · ${Math.floor(100 * (done + f * pin.size) / total)}%`), keep.checked));
        done += pin.size;
      }
      dbg(`Downloaded in the page: ${files.map(f => `${f.name} ${f.size} B`).join(', ')}`);
      pick(files);
      return true;
    } catch (error) {
      dbg(`Download failed: ${message(error)}`);
      selected.className = 'selected-files files-bad';
      selected.replaceChildren(h('li', { className: 'files-head', textContent: '✗ Download failed' }), h('li', { textContent: message(error) }));
      return false;
    }
  };
  const keep = h('input', { type: 'checkbox', checked: keepDownloads(), onchange() { keepDownloads(this.checked); } });
  const fetchAll = selfHosted && h('button', { type: 'button', className: 'button button-secondary', textContent: `⬇ Download & attach all (${size(total)})`, async onclick() {
    this.disabled = true;
    const ok = await download(text => { this.textContent = text; });
    this.textContent = ok ? '✓ Downloaded and attached' : '⬇ Try the download again'; this.disabled = ok;
  } });
  flash.addEventListener('click', async () => {
    if (flash.disabled) return;
    st.busy = true; update();
    outcome.hidden = true;
    // One click for own builds: connect first (the browser's device picker needs the click), then download, check and run.
    if (!st.files && !(await download(text => { flash.textContent = text; report(text); }))) { st.busy = false; update(); return; }
    if (!st.files) { st.busy = false; update(); return; }
    try {
      assertConsent(stage, { consent: risk.checked, confirmation: confirm.value });
      const enabled = Object.fromEntries(options.map((box, i) => [stage.options[i].id, box.checked]));
      dbg(`Run · options ${summarize(enabled)} · steps ${summarize(stepsFor(stage, enabled))}`);
      const result = await recipes[stage.recipe].run(st.session, { device, stage, files: st.files, steps: stepsFor(stage, enabled) }, report, assertSession);
      dbg('Stage finished');
      st.finished = true;
      status.dispatchEvent(new CustomEvent('stage-done', { bubbles: true, detail: { unmatched: unverified.checked } })); // turns a required page section green
      if (!result?.nothing) log.append(h('li', {}, ...rich(stage.done)));
      if (n === count && stage.section !== 'unlock') bump(key, 'flash');
      outcome.className = 'outcome outcome-done';
      outcome.replaceChildren(h('strong', { textContent: '✓ DONE' }), stage.section !== 'unlock' && h('span', { textContent: n === count ? 'All stages finished. Give the first boot a few minutes.' : `Stage ${n} of ${count} finished. Go on with stage ${n + 1}.` }),
        n === count && stage.section !== 'unlock' && h('span', {}, 'Saved you an afternoon? ', h('a', { href: DONATE, target: '_blank', rel: 'noopener noreferrer', textContent: '☕ Buy me a coffee' })));
      outcome.hidden = false;
    } catch (error) {
      st.lost = true;
      dbgError(error);
      debugBox.open = true;
      report(`STOPPED: ${explain(error)} ${again[0].toUpperCase()}${again.slice(1)}`);
      sendFailure();
      outcome.className = 'outcome outcome-failed';
      outcome.replaceChildren(h('strong', { textContent: '✗ FAILED' }), h('span', { textContent: 'The reason is the last line above. The debug log went to ROMinit so the recipe can be fixed.' }));
      outcome.hidden = false;
    } finally { st.busy = false; update(); }
  });
  risk.addEventListener('change', update);
  unverified.addEventListener('change', () => pick(picked));
  confirm.addEventListener('input', update);
  update();

  const guide = [protocol !== 'adb' && protocol !== 'sideload' && protocol !== 'amlogic' && stage.section !== 'unlock' && device.unlock && 'Bootloader unlocked? See 1 · Unlock bootloader.', device.modes[stage.mode],
    !stage.files.length ? 'Connect, tick the warning, type the confirm phrase, then press Run.' : selfHosted ? 'Connect, tick the warning, type the confirm phrase, then press Run: ROMinit downloads the files in this tab, checks their SHA-256 and flashes in one go.' : 'Download the files below from their source, then connect and choose them. Connecting first tells you right away if the phone is busy.']
    .filter(Boolean).map((text, i) => h('li', {}, h('span', { textContent: String(i + 1).padStart(2, '0') }), h('p', {}, ...rich(text))));
  return h('section', { className: 'flash-card stage-card' },
    h('div', { className: 'card-heading' },
      h('div', {}, h('p', { className: 'eyebrow', textContent: `STAGE ${n} OF ${count} · ${modeName(stage.mode)}` }), h('h2', { textContent: stage.title })),
      h('span', { className: 'version-chip', textContent: stage.recipe.toUpperCase() })),
    stage.optional && h('p', { className: 'field-help', textContent: stage.optional }),
    stepsFor(stage).length > 8
      ? h('details', { className: 'field-help' }, h('summary', { textContent: `${stepsFor(stage).length} steps` }), stepsFor(stage).map(describe).join(' · '))
      : h('p', { className: 'field-help', textContent: `Steps: ${stepsFor(stage).map(describe).join(' · ')}.` }),
    h('ol', { className: 'guide-list stage-steps' }, ...guide),
    prereqs,
    h('div', { className: 'connect-row' }, connectButton, rebootButton, status),
    stage.files.length > 0 && h('ul', { className: 'selected-files file-links' }, ...stage.files.map(f => h('li', {}, `${f.name} (${size(f.size)}) · `,
      f.url && h('a', { href: f.url, rel: 'noopener noreferrer', textContent: 'download' }), f.url && ' · ',
      h('a', { href: f.source, target: '_blank', rel: 'noopener noreferrer', textContent: 'source page' })))),
    fetchAll && h('p', { className: 'field-help fetch-all' }, fetchAll, ' ROMinit downloads the files in this tab and attaches them; nothing is saved to your Downloads folder.'),
    fetchAll && h('label', { className: 'risk-check' }, keep, h('span', {}, h('strong', { textContent: 'Optional · keep downloads in this browser. ' }),
      'A retry or a second phone then skips the download (SHA-256 is still checked). Uses disk space until you ',
      h('a', { href: '#', textContent: 'forget kept downloads', async onclick(/** @type {Event} */ e) { e.preventDefault(); await forgetKept(); this.textContent = 'forgotten'; } }), '.')),
    stage.files.length > 0 && h('label', { className: 'file-picker' }, h('span', { className: 'file-picker-icon', textContent: '＋' }),
      h('span', {}, h('strong', { textContent: `Choose ${stage.files.map(f => f.name).join(', ')}` }), h('small', { textContent: 'Size and SHA-256 are checked before writing' })), picker),
    stage.files.length > 0 && selected,
    ...(stage.options ?? []).map((option, i) => h('label', { className: 'risk-check' }, options[i], h('span', { textContent: option.label }))),
    h('label', { className: 'risk-check' }, risk, h('span', {}, h('strong', { textContent: 'I understand: ' }), stage.warning)),
    h('label', { className: 'field-label confirmation-label' }, 'Type ', h('code', { textContent: stage.confirm }), ' to confirm'),
    confirm,
    stage.files.length > 0 && h('label', { className: 'risk-check skip-verify' }, unverified, h('span', {}, h('strong', { textContent: 'Optional · skip verification. ' }),
      'Leave this off unless you need it. Tick it to flash a file that differs from the one listed (a newer build, your own build). ',
      h('strong', { textContent: '⚠ Size and SHA-256 are then not checked: ' }), 'a wrong, corrupt or tampered file is written anyway and can brick the phone. The stored steps still run.')),
    h('div', { className: 'flash-actions' }, flash),
    h('div', { className: 'progress-row' }, progress, percent),
    h('section', { className: 'activity' }, h('div', { className: 'activity-heading' }, h('h3', { textContent: 'Activity' }), h('span', { className: 'activity-label', textContent: 'LOCAL SESSION' })), log, outcome, debugBox));
}

/** @param {any[]} index */
function devicePicker(index) {
  const search = h('input', { className: 'confirmation-input', type: 'search', placeholder: 'Search vendor, name, model or codename', autofocus: true, value: params.get('q') ?? '' });
  // Five levels, best first; the pick shows that level and every better one. Default includes every level for now.
  const levels = Object.keys(LEVELS), level = h('div', { className: 'level-toggle', role: 'radiogroup', ariaLabel: 'Show phones up to' }, ...levels.map(l =>
    h('label', {}, h('input', { type: 'radio', name: 'level', value: l, checked: l === 'placeholder', onchange: () => render() }), h('span', { textContent: LEVELS[l] }))));
  // Pick one device category or all categories.
  const requestedCategory = params.get('category');
  const branches = h('div', { className: 'branch-boxes', role: 'radiogroup', ariaLabel: 'Device types' }, ...Object.entries({ all: 'All', ...CATEGORIES }).map(([c, label]) => {
    const n = (c === 'all' ? index.length : index.filter(d => d.category === c).length) + (c === 'all' || c === 'pc' ? OSES.length : 0);
    return h('label', { className: n ? '' : 'none' }, h('input', { type: 'radio', name: 'category', value: c, checked: c === (requestedCategory && requestedCategory in CATEGORIES ? requestedCategory : 'all'), onchange: () => render() }), h('span', {}, h('strong', { textContent: label }), h('small', { textContent: n ? `${n}` : 'none yet' })));
  }));
  let tested = new Set();
  fetch('./api/bench?tested').then(r => r.ok ? r.json() : []).then(c => { tested = new Set(c); render(); }).catch(() => {});
  const list = h('div', { className: 'device-tree' });
  const romsOf = (/** @type {any} */ d) => d.roms.map((/** @type {any} */ r) => `${r.os} ${r.version} (${r.origin}, ${r.status}, ${r.vetting}, ${score(r.rating)})`).join(', ');
  const deviceLink = (/** @type {any} */ d) => h('li', {}, h('a', { href: `?device=${encodeURIComponent(d.codename)}`, textContent: d.variant }), d.supportOnly
    ? ` · ${d.models.join(', ') || 'model number unknown'} · ${d.codename} · support only · no ROMinit recipe yet`
    : ` · ${d.models.join(', ')} · ${d.codename} · ${romsOf(d)}`);
  /** Variants we know but cannot flash, listed so owners see why. */
  const unsupportedItems = (/** @type {any} */ d) => (d.unsupported ?? []).map((/** @type {any} */ u) => h('li', { className: 'unsupported' }, `${u.name} · ${u.models.join(', ')} · not supported: ${u.why}`));
  const render = () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const text = (/** @type {any} */ d) => [CATEGORIES[d.category], d.vendor, d.series, d.family, d.variant, d.name, d.codename, ...d.models, ...d.roms.map((/** @type {any} */ r) => `${r.os} ${r.name}`), ...(d.unsupported ?? []).flatMap((/** @type {any} */ u) => [u.name, ...u.models])].join(' ').toLowerCase();
    const matches = index.filter(d => words.every(w => text(d).includes(w)));
    const upTo = levels.indexOf(/** @type {HTMLInputElement} */ (level.querySelector('input:checked'))?.value ?? 'placeholder');
    const category = /** @type {HTMLInputElement} */ (branches.querySelector('input:checked'))?.value ?? 'all';
    const on = new Set(category === 'all' ? Object.keys(CATEGORIES) : [category]);
    const hits = matches.filter(d => on.has(d.category) && levels.indexOf(deviceLevel(d, tested)) <= upTo);
    // All › category › vendor › series › family › variant; every category shows, empty ones say so (only while not searching).
    /** @type {Record<string, Record<string, Record<string, Record<string, any[]>>>>} */ const tree = {};
    for (const d of hits) (((tree[d.category] ??= {})[d.vendor] ??= {})[d.series] ??= {})[d.family] = [...(tree[d.category][d.vendor][d.series][d.family] ?? []), d];
    const sorted = (/** @type {object} */ o) => Object.entries(o).sort(([x], [y]) => x.localeCompare(y));
    const vendors = (/** @type {any} */ byVendor) => sorted(byVendor).map(([vendor, series]) => h('details', { open: true }, h('summary', { textContent: vendor }),
      ...sorted(series).map(([name, families]) => h('details', { open: true }, h('summary', { textContent: name }),
        ...sorted(families).map(([family, devices]) => h('div', { className: 'family' }, h('strong', { textContent: family }),
          h('ul', { className: 'selected-files' }, ...devices.sort((x, y) => x.variant.localeCompare(y.variant)).map(deviceLink), ...devices.flatMap(unsupportedItems))))))));
    // OS pages (catalog/os) sit at the top of the PC category, matched by name, id and architecture.
    const osHits = on.has('pc') ? OSES.filter(os => words.every(word => `${os.name} ${os.id} ${osArchitectures(os).map(arch => `${arch} ${ARCH_FAMILY[arch] ?? ''}`).join(' ')}`.toLowerCase().includes(word))) : [];
    const showOs = osHits.length > 0;
    const osEntry = osHits.map(os => h('article', { className: 'os-entry' }, h('a', { href: `./${os.id}`, className: 'os-title' }, h('img', { src: `./${os.page.logo.src}`, alt: '', width: 40, height: 40 }), h('strong', { textContent: os.name })),
      h('p', { className: 'field-help', textContent: `${os.editions.length} editions · ${os.version}` }),
      h('div', { className: 'architecture-tags', ariaLabel: 'Architectures' }, ...[...new Set(osArchitectures(os).map(arch => ARCH_FAMILY[arch] ?? arch))].map(name => h('span', { className: 'architecture-tag', textContent: name })))));
    list.replaceChildren(...Object.entries(CATEGORIES).filter(([c]) => on.has(c) && (tree[c] || !words.length || c === 'pc' && showOs)).map(([c, label]) => c === 'pc' && showOs
      ? h('details', { className: 'category', open: true }, h('summary', { textContent: label }), ...osEntry, ...(tree[c] ? vendors(tree[c]) : [])) : tree[c]
      ? h('details', { className: 'category', open: true }, h('summary', { textContent: label }), ...vendors(tree[c]))
      : h('p', { className: 'category empty' }, h('strong', { textContent: label }), ' · none yet')));
    if (!hits.length && !showOs && matches.length) list.append(h('p', { className: 'empty-files', textContent: `No device at this level. ${matches.length} match at a level further right.` }));
    else if (!hits.length && !showOs) list.append(h('p', { className: 'empty-files', textContent: 'No device matches yet. Searches are logged anonymously, so the devices people look for get added first.' }));
    clearTimeout(logTimer);
    const q = search.value.trim();
    if (q.length >= 2) logTimer = setTimeout(() => fetch('./api/searches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q, hits: hits.length }) }).catch(() => {}), 1500);
  };
  let logTimer = 0; // logs the search once typing pauses, not every keystroke
  search.addEventListener('input', render);
  render();
  return h('section', { className: 'flash-card' }, h('label', { className: 'field-label', textContent: 'Find your device' }), branches, search,
    level, list);
}

/** One tile per group (phone brand or ROM project), linking to the device list filtered to it.
 * @param {any[]} index @param {string} title @param {(d:any) => string[]} keysOf @param {(r:any, k:string) => boolean} counts */
function tilesView(index, title, keysOf, counts) {
  /** @type {Record<string, any[]>} */ const by = {};
  for (const d of index) for (const k of new Set(keysOf(d))) (by[k] ??= []).push(d);
  return h('section', { className: 'flash-card' }, h('label', { className: 'field-label', textContent: title }),
    h('div', { className: 'brand-tiles' }, ...Object.entries(by).sort(([x], [y]) => x.localeCompare(y)).map(([k, devices]) => {
      const roms = devices.reduce((n, d) => n + d.roms.filter((/** @type {any} */ r) => counts(r, k)).length, 0);
      return h('a', { className: 'brand-tile', href: `./?q=${encodeURIComponent(k)}` }, h('strong', { textContent: k }),
        h('small', { textContent: `${devices.length} phone${devices.length === 1 ? '' : 's'} · ${roms} ROM${roms === 1 ? '' : 's'}` }));
    })));
}

/** The signed-in user's ♥ ROMs. @param {any[]} index */
async function favoritesView(index) {
  const card = h('section', { className: 'flash-card' }, h('label', { className: 'field-label', textContent: 'Your favorites' }));
  const r = await fetch('./api/favorites', { cache: 'no-store' }).catch(() => null);
  if (!r?.ok) return card.append(h('p', { className: 'empty-files', textContent: 'Sign in to keep favorites: tap ♡ Favorite on any ROM. They follow you to every browser.' })), card;
  const list = await r.json();
  if (!list.length) return card.append(h('p', { className: 'empty-files', textContent: 'Nothing yet: tap ♡ Favorite on any ROM.' })), card;
  card.append(h('ol', { className: 'selected-files popular' }, ...list.map((/** @type {{rom:string}} */ { rom }) => {
    const [codename, id] = rom.split('/'), d = index.find(x => x.codename === codename), m = d?.roms.find((/** @type {any} */ x) => x.id === id);
    return h('li', {}, h('a', { href: `?device=${encodeURIComponent(codename)}`, textContent: d ? `${d.vendor} ${d.variant}` : codename }), ` · ${m ? `${m.name} ${m.version}` : id}`);
  })));
  return card;
}

/** Admin inbox: seven numbered folders, always shown with their counts: 01 page tickets, 02 flash failures, 03 phone tests, 04 agent reports, 05 OS-USB outcomes, 06 device searches, 07 ROM requests. */
/** @param {any[]} index */
async function inboxView(index) {
  const card = h('section', { className: 'flash-card' }, h('label', { className: 'field-label', textContent: 'Inbox' }));
  const r = await fetch('./api/inbox', { cache: 'no-store' }).catch(() => null);
  if (!r?.ok) return card.append(h('p', { className: 'empty-files', textContent: 'Admins only. Sign in with an admin account.' })), card;
  const { reports, benchmarks, cli = { new: [], review: [], approved: [], rejected: [] }, failures = [], requests = { new: [], update: [], mirror: [] }, agents = { success: [], partial: [], failed: [], abandoned: [] }, osUsb = { success: [], failed: [] }, labels } = await r.json();
  const searches = await fetch('./api/searches', { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []);
  const missed = searches.filter((/** @type {any} */ s) => !s.hits).length;
  /** One folder; open when it has items. @param {string} name @param {string} hint @param {number} n @param {any[]} body */
  const folder = (name, hint, n, body, total = n) => h('details', { className: 'page-section inbox-group', open: n > 0 },
    h('summary', {}, h('span', { textContent: `${name} · ${n}` }), h('small', { textContent: hint })), ...(total ? body : [h('p', { className: 'empty-files', textContent: 'Nothing here.' })]));
  /** "File as [label] [File]"; filing removes the item. @param {string} inbox @param {string} ref @param {HTMLElement} li @param {string} [defaultLabel] @param {()=>void} [afterFile] */
  const fileAs = (inbox, ref, li, defaultLabel, afterFile) => {
    const label = h('select', {}, ...labels.map((/** @type {string} */ l) => h('option', { textContent: l })));
    if (labels.includes(defaultLabel)) label.value = defaultLabel;
    return h('label', { className: 'field-help' }, 'File as ', label, ' ', h('button', { type: 'button', className: 'button button-secondary', textContent: 'File', async onclick() {
      const ok = (await fetch('./api/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inbox, ref, label: label.value }) })).ok;
      if (ok) { li.remove(); afterFile?.(); } else li.append(h('small', { textContent: ' could not file' }));
    } }));
  };
  /** One phone test: which ROM, what it changes vs the catalog, and the moves to the other sub-folders. @param {any} x */
  const benchItem = x => {
    const final = JSON.parse(x.final ?? '{}'), [codename, id] = String(x.rom).split('/');
    const d = index.find(i => i.codename === codename), rom = d?.roms.find((/** @type {any} */ r) => r.id === id);
    const changes = Object.entries(final).filter(([f, tier]) => TIER_STATE[tier] && rom && TIER_STATE[tier] !== rom.rating.features[f])
      .map(([f, tier]) => `${LABEL[f] ?? f}: ${rom.rating.features[f]} → ${TIER_STATE[tier]}`);
    const move = (/** @type {string} */ action, /** @type {string} */ text, primary = false) => h('button', { type: 'button', className: `button ${primary ? 'button-primary' : 'button-secondary'}`, textContent: text, async onclick() {
      const ok = (await fetch('./api/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inbox: 'benchmarks', ref: x.ref, action }) })).ok;
      if (ok) location.reload(); else li.append(h('small', { textContent: ' could not save' }));
    } });
    const li = h('li', {}, h('strong', { className: 'inbox-rom' }, h('a', { href: `./?device=${encodeURIComponent(codename)}&rom=${encodeURIComponent(id)}`,
        textContent: d ? `${d.vendor} ${d.name} · ${rom ? `${rom.name} ${rom.version}` : `${id} (no longer in the catalog)`}` : x.rom })),
      h('small', { textContent: `${x.at} UTC · ${x.rom}${x.accepted ? ` · approved ${x.accepted}` : ''}` }),
      h('p', { className: x.flash === 'verified' ? 'field-help' : 'field-help flash-warn', textContent: FLASH_NOTE[x.flash] ?? 'flash path unknown (not flashed from this browser)' }),
      x.note && h('p', { textContent: x.note }),
      h('p', { className: 'field-help', textContent: changes.length ? `Changes vs catalog (${changes.length}): ${changes.join(' · ')}` : 'No changes vs the catalog rating.' }),
      h('div', { className: 'inbox-actions' }, ...{ new: [move('approve', 'Approve', true), move('reject', 'Reject'), move('review', 'Review later')],
        review: [move('approve', 'Approve', true), move('reject', 'Reject'), move('new', 'Back to new')] }[x.state] ?? [move('review', 'Back to review')]),
      h('details', {}, h('summary', { textContent: 'card and script output' }), h('pre', { className: 'bench-output', textContent: `${JSON.stringify(final, null, 1)}\n\n${x.output ?? ''}` })));
    return li;
  };
  /** Phone tests split into new / review / approved / rejected. @param {Record<string, any[]>} b */
  const byState = b => [['new', 'New'], ['review', 'Review'], ['approved', 'Approved'], ['rejected', 'Rejected (not counted)']].map(([state, title]) => h('details', { className: 'inbox-sub', open: state === 'new' || state === 'review' },
    h('summary', { className: 'field-label', textContent: `${title} · ${b[state].length}` }),
    h('ol', { className: 'comments' }, ...b[state].map(benchItem))));
  const usbSize = bytes => Number.isSafeInteger(bytes) && bytes > 0
    ? bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : 'Unknown size';
  const usbMethods = { direct: 'Direct image write', ventoy: 'Ventoy' };
  const usbActions = { direct: 'write image', copy: 'copy ISO', install: 'install Ventoy' };
  const usbVerification = { verified: 'Source checksum verified', 'mismatch-accepted': 'Source checksum mismatch accepted', none: 'Source checksum not reported' };
  const usbFailure = {
    preflight: 'USB preflight did not pass.', device_changed: 'The selected USB changed after review.',
    unmount: 'Could not unmount the USB drive.', write: 'Writing the image failed.',
    timeout: 'The USB operation timed out.', readback: 'USB readback verification failed.', unknown: 'The USB operation failed for an unknown reason.'
  };
  const usbEnum = (values, value, fallback) => typeof value === 'string' && Object.hasOwn(values, value) ? values[value] : fallback;
  const usbOsName = { linux: 'Linux', windows: 'Windows', macos: 'macOS', android: 'Android', ios: 'iOS', chromeos: 'ChromeOS', unknown: 'Unknown OS' };
  const usbBrowserName = { chrome: 'Chrome', chromium: 'Chromium', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', opera: 'Opera', brave: 'Brave', other: 'Other browser' };
  const usbDistroName = { fedora: 'Fedora', ubuntu: 'Ubuntu', debian: 'Debian', alpine: 'Alpine', arch: 'Arch Linux', manjaro: 'Manjaro', opensuse: 'openSUSE', nixos: 'NixOS', linuxmint: 'Linux Mint', centos: 'CentOS', rhel: 'RHEL', rocky: 'Rocky Linux', other: 'Linux distribution' };
  const usbEnvironmentText = value => {
    const environment = validateUsbEnvironment(value);
    if (!environment) return null;
    const parts = [];
    if (environment.hostOs) {
      const os = environment.hostDistro ? `${usbDistroName[environment.hostDistro]} ${usbOsName[environment.hostOs]}` : usbOsName[environment.hostOs];
      const version = environment.hostOsVersion ? ` ${environment.hostOsVersion}` : '';
      const arch = environment.hostArch ? ` · ${environment.hostArch}` : '';
      parts.push(`Host ${os}${version}${arch}`);
    }
    if (environment.kernelVersion) parts.push(`kernel ${environment.kernelVersion}`);
    if (environment.browser) {
      const browserVersion = environment.browserVersion ? ` ${environment.browserVersion}` : '';
      const os = environment.browserOs ? ` on ${usbOsName[environment.browserOs]}${environment.browserOsVersion ? ` platform ${environment.browserOsVersion}` : ''}` : '';
      parts.push(`${usbBrowserName[environment.browser]}${browserVersion}${os}`);
    }
    if (environment.cliVersion) parts.push(`ROMinit CLI ${environment.cliVersion}`);
    if (environment.nodeVersion) parts.push(`Node.js ${environment.nodeVersion}`);
    return parts.length ? `Technical environment: ${parts.join(' · ')}` : null;
  };
  /** Render only allowlisted operational fields; never display IDs, paths, models, or arbitrary logs/errors. @param {any} x @param {'success'|'failed'} outcome @param {any[]} items */
  const osUsbItem = (x, outcome, items) => {
    const image = x?.image && typeof x.image === 'object' ? x.image : {};
    const rawImageName = typeof image.name === 'string' ? image.name : '';
    const safeCatalogName = /^[0-9A-Za-zÀ-ſ ._+-]{1,80} [0-9A-Za-z._+-]+ · [0-9A-Za-z._+-]+ · [0-9A-Za-z._+-]+$/.test(rawImageName);
    const safeIsoName = /^[\p{L}\p{N}][\p{L}\p{N} ._+()-]{0,150}\.iso$/iu.test(rawImageName);
    const imageName = rawImageName === 'Local ISO' || rawImageName === 'No ISO' || safeCatalogName || safeIsoName ? rawImageName : 'Selected image';
    const imageId = typeof image.id === 'string' && /^[A-Za-z0-9_.+-]{1,80}$/.test(image.id) ? image.id : 'unknown';
    const method = usbEnum(usbMethods, x?.method, 'Unknown method');
    const action = usbEnum(usbActions, x?.action, 'unknown action');
    const sourceVerification = usbEnum(usbVerification, x?.verification?.source, 'Source checksum status unavailable');
    const capacity = usbSize(x?.drive?.capacityBytes);
    const readbackSize = usbSize(x?.readback?.size);
    const readback = x?.readback?.matched === true ? `USB readback matched${readbackSize !== 'Unknown size' ? ` · ${readbackSize}` : ''}`
      : x?.readback?.matched === false ? 'USB readback did not match' : 'USB readback not available';
    const at = typeof x?.at === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x.at) ? `${x.at} UTC` : 'Time unavailable';
    const failureCode = outcome === 'failed' && typeof x?.failureCode === 'string' && Object.hasOwn(usbFailure, x.failureCode) ? x.failureCode : null;
    const failure = outcome === 'failed' ? usbEnum(usbFailure, failureCode, 'The USB operation failed.') : null;
    const technicalEnvironment = usbEnvironmentText(x?.environment);
    const li = h('li', { className: 'os-usb-report' },
      h('strong', { textContent: outcome === 'success' ? 'USB operation succeeded' : 'USB operation failed' }),
      h('small', { textContent: `${at} · Unreviewed` }),
      h('p', { className: 'field-help' }, 'Image: ', h('strong', { textContent: imageName }), ' · ID ', h('code', { textContent: imageId }), ` · ${imageId === 'none' && image.size === 0 ? 'No image' : usbSize(image.size)}`),
      h('p', { className: 'field-help', textContent: `${method} · ${action} · USB capacity ${capacity}` }),
      h('p', { className: 'field-help', textContent: `${sourceVerification} · ${readback}` }),
      technicalEnvironment && h('p', { className: 'field-help usb-environment-details', textContent: technicalEnvironment }),
      failure && h('p', { className: 'field-help flash-warn' }, 'Failure ', h('code', { textContent: failureCode ?? 'unknown' }), ` · ${failure}`));
    const ref = typeof x?.jobId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x.jobId) ? x.jobId : null;
    if (ref) li.append(fileAs('os-usb', ref, li, 'user-side', () => {
      const position = items.indexOf(x);
      if (position >= 0) items.splice(position, 1);
      const successCount = usbSuccess.length, failedCount = usbFailed.length, total = successCount + failedCount;
      const header = osUsbFolder?.querySelector(':scope > summary');
      if (header) {
        const count = header.querySelector('span'), hint = header.querySelector('small');
        if (count) count.textContent = `05 OS-USB · ${total}`;
        if (hint) hint.textContent = `${successCount} success · ${failedCount} failed · unreviewed outcomes`;
      }
      const successHeader = usbSuccessGroup?.querySelector(':scope > summary'), failedHeader = usbFailedGroup?.querySelector(':scope > summary');
      if (successHeader) successHeader.textContent = `Success · ${successCount}`;
      if (failedHeader) failedHeader.textContent = `Failed · ${failedCount}`;
    }));
    return li;
  };
  const usbSuccess = Array.isArray(osUsb?.success) ? osUsb.success : [], usbFailed = Array.isArray(osUsb?.failed) ? osUsb.failed : [];
  const osUsbTotal = usbSuccess.length + usbFailed.length;
  let osUsbFolder = null, usbSuccessGroup = null, usbFailedGroup = null;
  const usbGroup = (title, items, outcome) => h('details', { className: 'inbox-sub', open: title === 'Failed' || items.length > 0 },
    h('summary', { className: 'field-label', textContent: `${title} · ${items.length}` }),
    h('ol', { className: 'comments' }, ...items.map(x => osUsbItem(x, outcome, items))));
  /** Phone tests by source, each split by state: 03a the site, 03b a rominit CLI flash + bench, 03c `rominit bench` alone (flashed another way). */
  const keep = (/** @type {(x: any) => boolean} */ f) => Object.fromEntries(Object.entries(cli).map(([state, xs]) => [state, xs.filter(f)]));
  const benchParts = [['03a Site', benchmarks], ['03b CLI run + bench', keep(x => x.flash !== 'elsewhere')], ['03c CLI bench only', keep(x => x.flash === 'elsewhere')]];
  const benchAll = /** @type {Record<string, any[]>} */ (Object.fromEntries(['new', 'review', 'approved', 'rejected'].map(s => [s, benchParts.flatMap(([, b]) => b[s])])));
  const by = /** @type {Record<string, any[]>} */ ({});
  for (const x of reports) (by[x.section || 'Whole page'] ??= []).push(x);
  card.append(
    folder('01 Tickets', 'page tickets, by section', reports.length, Object.entries(by).sort(([a], [b]) => a.localeCompare(b)).map(([section, items]) =>
      h('div', { className: 'inbox-sub' }, h('p', { className: 'field-label', textContent: `${section} · ${items.length}` }), h('ol', { className: 'comments' }, ...items.map(x => {
        const li = h('li', {}, h('small', {}, `${x.at} UTC · `, h('a', { href: /^\/(?![/\\])/.test(x.page) ? x.page : '#', textContent: x.page })), h('p', { textContent: x.text }));
        return li.append(fileAs('reports', String(x.id), li)), li;
      }))))),
    folder('02 Flash failures', 'stages that stopped, newest first: file as recipe-fix or user-side', failures.length, [h('ol', { className: 'comments' }, ...failures.map((/** @type {any} */ x) => {
      const [codename, id] = String(x.rom).split('/');
      const li = h('li', {}, h('strong', { className: 'inbox-rom' }, h('a', { href: `./?device=${encodeURIComponent(codename)}&rom=${encodeURIComponent(id)}`, textContent: `${x.rom} · stage ${x.stage}` })),
        h('small', { textContent: ` ${x.at} UTC` }), h('p', { className: 'field-help flash-warn', textContent: x.error }),
        h('details', {}, h('summary', { textContent: 'debug log' }), h('pre', { className: 'bench-output', textContent: x.log })));
      return li.append(fileAs('failures', String(x.id), li)), li;
    }))]),
    folder('03 Benchmarks', `phone tests · ${benchAll.new.length} new · ${benchAll.review.length} in review · ${benchAll.approved.length} approved · ${benchAll.rejected.length} rejected`, benchAll.new.length + benchAll.review.length,
      benchParts.map(([title, b]) => h('details', { className: 'inbox-sub', open: b.new.length + b.review.length > 0 },
        h('summary', { className: 'field-label', textContent: `${title} · ${Object.values(b).flat().length}` }), ...byState(b))), Object.values(benchAll).flat().length),
    folder('04 Agent reports', `runs reported through the MCP · ${agents.success.length} success · ${agents.partial.length} partial · ${agents.failed.length} failed · ${agents.abandoned.length} abandoned`, Object.values(agents).flat().length,
      [['success', 'Success'], ['partial', 'Partial'], ['failed', 'Failed'], ['abandoned', 'Abandoned']].map(([outcome, title]) => h('details', { className: 'inbox-sub', open: agents[outcome].length > 0 },
        h('summary', { className: 'field-label', textContent: `${title} · ${agents[outcome].length}` }),
        h('ol', { className: 'comments' }, ...agents[outcome].map((/** @type {any} */ x) => {
          const [codename, id] = String(x.rom).split('/');
          const li = h('li', {}, h('strong', { className: 'inbox-rom' }, h('a', { href: `./?device=${encodeURIComponent(codename)}&rom=${encodeURIComponent(id)}`, textContent: x.rom })),
            h('small', { textContent: ` ${x.at} UTC · ${x.user} · ${[x.host, x.tools, x.version].filter(Boolean).join(' · ')}` }),
            h('p', { textContent: x.resolution }),
            h('details', {}, h('summary', { textContent: `${x.steps.length} logged step${x.steps.length === 1 ? '' : 's'}` }),
              h('pre', { className: 'bench-output', textContent: x.steps.map((/** @type {any} */ s) => `stage ${s.stage}${s.step ? ` step ${s.step}` : ''} · ${s.outcome}${s.detail ? ` · ${s.detail}` : ''}`).join('\n') })));
          return li.append(fileAs('agents', x.id, li)), li;
        }))))),
    osUsbFolder = folder('05 OS-USB', `${usbSuccess.length} success · ${usbFailed.length} failed · unreviewed outcomes`, osUsbTotal, [
      h('p', { className: 'field-help', textContent: 'Operational USB reports are unreviewed. Filing classifies this report; it does not approve or change any phone ROM rating.' }),
      usbSuccessGroup = usbGroup('Success', usbSuccess, 'success'), usbFailedGroup = usbGroup('Failed', usbFailed, 'failed')]),
    folder('06 Searches', `last 90 days · ${missed} with no match`, searches.length, [h('ol', { className: 'selected-files popular' }, ...searches.map((/** @type {any} */ s) => h('li', { className: s.hits ? '' : 'missed' },
      h('a', { href: `./?q=${encodeURIComponent(s.q)}`, textContent: s.q }), ` · ${s.people} ${s.people === 1 ? 'person' : 'people'} · ${s.hits ? `${s.hits} match${s.hits === 1 ? '' : 'es'}` : 'NO MATCH'} · ${s.last}`)))]));
  card.append(folder('07 Requests', 'new ROMs / devices, updates and mirrors', Object.values(requests).flat().length,
    [['new', 'New ROM / device'], ['update', 'ROM updates'], ['mirror', 'ROM mirrors']].map(([kind, title]) => h('details', { className: 'inbox-sub', open: requests[kind].length > 0 },
      h('summary', { className: 'field-label', textContent: `${title} · ${requests[kind].length}` }),
      h('ol', { className: 'comments' }, ...requests[kind].map((/** @type {any} */ x) => {
        const li = h('li', {}, h('small', { textContent: `${x.at} UTC${x.rom ? ` · ${x.rom}` : ''}` }),
          h('p', { textContent: x.text }), x.url && /^https?:\/\//i.test(x.url) && link(x.url, 'Source'));
        return li.append(fileAs(`requests-${kind}`, String(x.id), li)), li;
      }))))));
  return card;
}

/** Phones ranked by successful flashes, then views, from the counts API. @param {any[]} index */
async function popularView(index) {
  const counts = await fetch('./api/counts', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const card = h('section', { className: 'flash-card' }, h('label', { className: 'field-label', textContent: 'Popular phones' }));
  if (!counts) return card.append(h('p', { className: 'empty-files', textContent: 'Popularity needs the live site.' })), card;
  const sum = (/** @type {any} */ d, /** @type {string} */ kind) => d.roms.reduce((/** @type {number} */ n, /** @type {any} */ r) => n + (counts[`${d.codename}/${r.id}`]?.[kind] ?? 0), 0);
  const ranked = index.map(d => ({ d, flash: sum(d, 'flash'), view: sum(d, 'view') })).sort((x, y) => y.flash - x.flash || y.view - x.view);
  card.append(h('ol', { className: 'selected-files popular' }, ...ranked.map(({ d, flash, view }) => h('li', {},
    h('a', { href: `?device=${encodeURIComponent(d.codename)}`, textContent: `${d.vendor} ${d.variant}` }), ` · ${flash} flash${flash === 1 ? '' : 'es'} · ${view} view${view === 1 ? '' : 's'}`))),
    h('small', { className: 'field-help', textContent: 'Counted through this site: successful flashes first, then views.' }));
  return card;
}

/** @param {string} kind @param {string} title @param {string} rom */
function requestButton(kind, title, rom = '') {
  const button = h('button', { type: 'button', className: 'button button-secondary', textContent: title, onclick() {
    const text = h('textarea', { className: 'confirmation-input', required: true, maxLength: 2000, rows: 4,
      placeholder: kind === 'update' ? 'New version and current version (for example: 2.5 replaces 2.3).' : kind === 'mirror' ? 'Which files should we mirror, and why?' : 'ROM name and/or device model, and what you would like added.' });
    const url = h('input', { className: 'confirmation-input', type: 'url', required: kind !== 'mirror', maxLength: 2000, placeholder: 'https://…' });
    const status = h('p', { role: 'status', className: 'field-help' });
    const send = h('button', { type: 'submit', className: 'button button-primary', textContent: 'Send request' });
    const dialog = h('dialog', { className: 'host-confirm', ariaLabel: title }, h('form', { async onsubmit(event) {
      event.preventDefault(); send.disabled = true; status.textContent = 'Sending…';
      const response = await fetch('./api/requests', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, rom: rom || null, page: location.pathname + location.search, text: text.value, url: url.value || null }) }).catch(() => null);
      const reply = await response?.json().catch(() => ({}));
      status.textContent = response?.ok ? 'Thanks, request sent for review.' : `Could not send: ${reply?.error ?? 'network error'}.`;
      send.disabled = !!response?.ok;
    } }, h('h2', { textContent: title }), rom && h('p', { textContent: rom }),
      h('label', { className: 'field-help' }, 'Details', text), h('label', { className: 'field-help' }, kind === 'mirror' ? 'Source URL (optional)' : 'ROM or device source URL', url),
      send, h('button', { type: 'button', className: 'button button-secondary', textContent: 'Close', onclick: () => dialog.close() }), status));
    dialog.addEventListener('close', () => { dialog.remove(); button.focus(); });
    document.body.append(dialog); dialog.showModal();
  } });
  return button;
}

/** "Something wrong on this page?" form; falls back to a GitHub issue link. */
function reportBox() {
  const page = location.pathname + location.search;
  const text = h('textarea', { className: 'confirmation-input', placeholder: 'What is wrong or missing? (wrong file, broken step, outdated info…)', maxLength: 2000, rows: 3 });
  const where = h('select', { className: 'report-section' }, h('option', { value: '', textContent: 'Whole page' }));
  const send = h('button', { type: 'button', className: 'button button-secondary', textContent: 'Send ticket' }), status = h('small', {});
  const issue = `https://github.com/philipplinux/rominit/issues/new?title=${encodeURIComponent(`Problem on ${page}`)}`;
  send.addEventListener('click', async () => {
    status.textContent = 'Sending…';
    const response = await fetch('./api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page, text: text.value, section: where.value }) }).catch(() => null);
    const reply = await response?.json().catch(() => ({}));
    status.textContent = response?.ok ? 'Thanks, ticket sent.' : `Could not send: ${reply?.error ?? 'network error'}. Use the GitHub link instead.`;
    if (response?.ok) text.value = '';
  });
  const box = h('details', { id: 'submit-request', className: 'page-section report', ontoggle() {
    if (where.isConnected) return; // built on first open, from this page's own sections
    for (const s of document.querySelectorAll('details.page-section:not(.report) > summary > span')) where.append(h('option', { textContent: s.textContent }));
    text.before(h('label', { className: 'field-help' }, 'About: ', where));
  } }, h('summary', {}, h('span', { textContent: 'T · Submit ticket / Request' }), h('small', { textContent: 'report a problem or request a new ROM / device' })),
    h('p', {}, requestButton('new', 'Request new ROM / device')),
    h('div', { className: 'comment-box' }, text, send, status, h('small', {}, 'Or ', h('a', { href: issue, target: '_blank', rel: 'noopener noreferrer', textContent: 'open a GitHub issue' }), '.')));
  return box;
}
/** What the page is built from. A test keeps this in step with package.json dependencies. */
const SOFTWARE = [
  ['In this page (bundled into app.js)', [
    ['android-fastboot', 'Danny Lin', 'MIT', 'https://github.com/kdrag0n/fastboot.js', 'fastboot over WebUSB'],
    ['@yume-chan/adb, adb-daemon-webusb, adb-credential-web, stream-extra (ya-webadb)', 'Simon Chan', 'MIT', 'https://github.com/yume-chan/ya-webadb', 'ADB and sideload over WebUSB'],
    ['@lineageos-infra/libmjolnir', 'Greg Willard (r3pwn)', 'MIT', 'https://github.com/lineageos-infra/libmjolnir', 'Samsung Odin protocol'],
    ['@lineageos-infra/libamlburn', 'LineageOS (luk1337)', 'MIT', 'https://github.com/lineageos-infra/libamlburn', 'Amlogic USB burn mode'],
    ['@zip.js/zip.js', 'Gildas Lormeau', 'BSD-3-Clause', 'https://github.com/gildas-lormeau/zip.js', 'reads zip archives'],
    ['hash-wasm', 'Dani Biró', 'MIT', 'https://github.com/Daninet/hash-wasm', 'SHA-256 checks'],
    ['xzwasm', 'Steve Sanderson (with xz-embedded, public domain, and walloc, MIT)', 'MIT', 'https://github.com/SteveSanderson/xzwasm', 'unpacks .xz images'],
  ]],
  ['Build and hosting', [
    ['esbuild', 'Evan Wallace', 'MIT', 'https://github.com/evanw/esbuild', 'bundles the page'],
    ['TypeScript', 'Microsoft', 'Apache-2.0', 'https://github.com/microsoft/TypeScript', 'type checks (not shipped)'],
    ['wrangler', 'Cloudflare', 'MIT OR Apache-2.0', 'https://github.com/cloudflare/workers-sdk', 'deploys to Cloudflare Pages'],
    ['playwright-core', 'Microsoft', 'Apache-2.0', 'https://github.com/microsoft/playwright', 'bench tests (not shipped)'],
    ['@napi-rs/keyring', 'N-API for Rust contributors', 'MIT', 'https://github.com/Brooooooklyn/keyring-node', 'OS credential storage for the CLI (not in the page)'],
    ['usb (node-usb)', 'Rob Moran, Christopher Klein and contributors', 'MIT', 'https://github.com/node-usb/node-usb', 'USB access for the rominit command-line tool (not in the page)'],
  ]],
  ['Pictures', [
    ['postmarketOS logo', 'postmarketOS contributors', 'CC BY-SA 3.0', 'https://gitlab.postmarketos.org/postmarketOS/artwork', 'ROM logo'],
    ['GrapheneOS logo and screenshots', 'GrapheneOS developers, via Wikimedia Commons', 'see each caption', 'https://commons.wikimedia.org/wiki/Category:GrapheneOS', 'ROM logo and pictures'],
    ['Mi A3 and Galaxy S9 postmarketOS screenshots', 'ROMinit', 'MIT', 'https://github.com/philipplinux/rominit', 'taken on our own phones'],
  ]],
];
function sourcesView() {
  return h('section', { className: 'flash-card info-page' }, h('label', { className: 'field-label', textContent: 'Sources & licenses' }),
    h('p', { className: 'intro-copy' }, 'ROMinit is free software under the MIT license, © 2026 Philipp Baumann. ', link('https://github.com/philipplinux/rominit', 'Source on GitHub'), ' · ', link('./THIRD-PARTY-NOTICES.txt', 'Full license texts')),
    ...SOFTWARE.flatMap(([group, rows]) => [h('h3', { textContent: /** @type {string} */ (group) }),
      h('table', { className: 'license-table' }, h('tr', {}, ...['Name', 'By', 'License', 'Used for'].map(t => h('th', { textContent: t }))),
        .../** @type {string[][]} */ (rows).map(([name, by, license, url, use]) => h('tr', {}, h('td', {}, link(url, name)), h('td', { textContent: by }), h('td', { textContent: license }), h('td', { textContent: use }))))]),
    h('h3', { textContent: 'ROMs, firmware and device facts' }),
    h('p', { className: 'intro-copy', textContent: 'ROMinit hosts only selected files: its own postmarketOS builds, on Hugging Face (huggingface.co/PhilippLinux). Everything else, vendor firmware above all, is linked to its publisher. Each file is pinned by size and SHA-256 and every ROM page links its source page and project. Device and ROM facts come from the projects’ own wikis and release pages (LineageOS, postmarketOS, GrapheneOS and others), linked on each page.' }));
}
function aboutView() {
  return h('section', { className: 'flash-card info-page' }, h('label', { className: 'field-label', textContent: 'About ROMinit' }),
    h('p', { className: 'intro-copy', textContent: 'ROMinit flashes phones from the browser over WebUSB: pick your phone, pick a ROM, plug in, and the page runs the same steps you would type into fastboot, adb or Odin. Every file is checked against a pinned size and SHA-256 before it is written, and every destructive step asks you to type a confirm phrase first.' }),
    h('p', { className: 'intro-copy', textContent: 'It runs in this browser. Files you choose stay on your computer. ROMinit hosts only selected files (its own builds, on Hugging Face); everything else links to its publisher. What reaches the server: anonymous view and flash counts, ratings, comments and tickets you send, and, if a flash stage fails, its debug log with serial numbers removed, so the recipe can be fixed. If you connect an AI agent through the MCP, its flash reports (steps and outcome, no personal data) are stored with your account. Votes and counts use a salted hash of your IP address, not the address itself.' }),
    h('p', { className: 'intro-copy' }, 'Made by Philipp Baumann. Free software under the MIT license; ', link('https://github.com/philipplinux/rominit', 'source on GitHub'), '. Questions or problems: the ticket box at the bottom of each page, or a GitHub issue. If it saved you an afternoon, ', link(DONATE, 'buy me a coffee'), '.'),
    h('p', { className: 'field-help', textContent: 'Flashing can brick a phone and voids warranties; ROMinit comes with no warranty. Android is a trademark of Google LLC. Phone, vendor and OS names belong to their owners; ROMinit is not affiliated with or endorsed by any of them.' }),
    h('p', {}, h('a', { href: './?view=sources', textContent: 'Sources & licenses' })));
}
/** CLI install instructions and its browser-connected mode live on the same page. */
async function cliView() {
  const code = (/** @type {string} */ text) => h('pre', { className: 'bench-output', textContent: text });
  const connection = await cliConnectionView();
  const page = h('section', { className: 'flash-card info-page' }, h('h1', { className: 'field-label', textContent: 'ROMinit CLI' }),
    h('p', { className: 'intro-copy', textContent: 'The ROMinit CLI runs the same recipes as this page from a terminal: same catalog, same SHA-256 checks, same confirm phrases. Use it where the browser cannot help (no WebUSB, scripts, an AI agent on your own computer). Experimental: tested on Linux so far.' }),
    connection,
    h('h3', { textContent: 'Install' }),
    h('p', { className: 'field-help', textContent: 'Install the current CLI from this site (needs Node.js):' }),
    code(`curl -fLO ${location.origin}/rominit-cli.tar.gz\ntar -xzf rominit-cli.tar.gz\ncd rominit-cli\nnpm ci --omit=dev\nalias rominit="node $PWD/bin/rominit.mjs"\nrominit auth`),
    h('p', { className: 'field-help', textContent: 'On Linux, if the phone shows in lsusb but not in "rominit devices", this user lacks USB access: install udev rules (e.g. android-udev-rules).' }),
    h('h3', { textContent: 'Commands' }),
    code(['# sign in once, then connect this CLI to the browser', 'rominit auth', 'rominit serve',
      '# phones in fastboot or ADB mode', 'rominit devices',
      "# a phone's ROMs, then one ROM's stages, files and steps", 'rominit plan <codename> [rom-id]',
      '# download the files and check their SHA-256', 'rominit fetch <codename> <rom-id>',
      '# flash one stage', 'rominit run <codename> <rom-id> --stage N',
      '# read-only phone test over SSH (postmarketOS)', 'rominit bench <codename> <rom-id>',
      '', '# any command: --json = one JSON event per line (scripts, agents)', "# --local = read a checkout's catalog/ instead of this site"].join('\n')),
    h('h3', { id: 'usb-setup', textContent: 'USB preparation · Linux' }),
    h('p', { className: 'field-help' }, 'The OS pages use this same CLI. Direct ISO writing needs Linux, Python 3, lsblk, udisksctl and noninteractive sudo permission. Ventoy additionally needs a reviewed, root-owned ', link('https://www.ventoy.net/en/download.html', 'Ventoy installation'), '. ', link('https://github.com/philipplinux/rominit#usb-preparation-linux', 'USB setup instructions'), '.'),
    code('ROMINIT_VENTOY_DIR=/absolute/path/to/reviewed/ventoy rominit serve'),
    h('h3', { textContent: 'Safety' }),
    h('ul', {}, ...['It reads phone and ROM data from this site (catalog/<codename>.json), no account needed.', 'A destructive stage asks you to type its confirm phrase in the terminal. Without a terminal it stops; an agent cannot type it for you.', 'Every file is checked against its pinned size and SHA-256 before it is written.'].map(t => h('li', { textContent: t }))),
    h('p', { className: 'intro-copy' }, 'Want your AI agent to look things up without installing anything? Use the ', h('a', { href: './?view=agents', textContent: 'Hosted MCP' }), '.'),
    h('p', { className: 'field-help' }, 'Preparing a PC OS? Open its USB guide: ', ...OSES.flatMap((os, i) => [i ? ', ' : '', h('a', { href: `./${os.id}`, textContent: os.name })]), '.'));
  return page;
}
/** Hosted MCP: endpoint, setup, the deal (read our data, report how the flash went), and your API tokens. */
async function agentsView() {
  const url = `${location.origin}/mcp`, info = await me;
  const code = (/** @type {string} */ text) => h('pre', { className: 'bench-output', textContent: text });
  /** A code block with a Copy button that copies what it shows at click time. @param {HTMLElement} pre */
  const copyable = pre => h('div', { className: 'bench-run' }, pre, h('button', { type: 'button', className: 'button button-secondary', textContent: 'Copy', async onclick() {
    await navigator.clipboard?.writeText(pre.textContent ?? '').catch(() => {}); this.textContent = 'Copied'; } }));
  // Set it up: filled with the token just created (this page only, never stored), else a placeholder.
  const cli = code(''), config = code('');
  const fillSetup = (/** @type {string} */ token) => {
    cli.textContent = `claude mcp add --transport http rominit ${url} --header "Authorization: Bearer ${token}"`;
    config.textContent = JSON.stringify({ mcpServers: { rominit: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  };
  fillSetup('<your token>');
  const tokens = h('div', {});
  async function listTokens() {
    const r = await fetch('./api/tokens', { cache: 'no-store' });
    if (!r.ok) return;
    const list = await r.json();
    tokens.replaceChildren(list.length ? h('table', { className: 'license-table' }, h('tr', {}, ...['Name', 'Created', 'Expires', 'Last used', ''].map(t => h('th', { textContent: t }))),
      ...list.map((/** @type {any} */ t) => h('tr', {}, h('td', { textContent: t.name }), h('td', { textContent: t.created.slice(0, 10) }), h('td', { textContent: t.expires.slice(0, 10) }), h('td', { textContent: t.last_used?.slice(0, 16) ?? 'never' }),
        h('td', {}, h('button', { type: 'button', className: 'link-button', textContent: 'REVOKE', async onclick() {
          if (!confirm(`Revoke "${t.name}"? Agents using it stop working.`)) return;
          await fetch('./api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revoke: t.id }) });
          listTokens();
        } })))))
      : h('p', { className: 'field-help', textContent: 'No tokens yet.' }));
  }
  const name = h('input', { placeholder: 'e.g. laptop claude', maxLength: 40, required: true }), made = h('div', {});
  const days = h('select', { title: 'Expires after' }, ...[[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']].map(([d, label]) => new Option(`expires in ${label}`, String(d), false, d === 365)));
  const form = h('form', { className: 'token-form', async onsubmit(/** @type {Event} */ e) {
    e.preventDefault();
    const r = await fetch('./api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.value, days: Number(days.value) }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { made.replaceChildren(h('p', { className: 'status', textContent: body.error ?? 'could not create the token' })); return; }
    made.replaceChildren(h('div', { className: 'token-new' }, h('strong', { textContent: `New token "${body.name}": copy it now` }),
      copyable(code(body.token)), h('small', { textContent: 'Shown only once; ROMinit stores only a hash. The setup commands below now contain it.' })));
    fillSetup(body.token);
    name.value = ''; listTokens();
  } }, name, days, h('button', { type: 'submit', className: 'button', textContent: 'Create token' }));
  if (info?.user) listTokens();
  return h('section', { className: 'flash-card info-page' }, h('label', { className: 'field-label', textContent: 'Hosted MCP' }),
    h('p', { className: 'intro-copy', textContent: 'Let your own AI agent (Claude, ChatGPT, Cursor, anything that speaks MCP) look up phones and ROM recipes here and walk you through a flash. It needs a free API token (below): 100 tool calls an hour.' }),
    h('div', { className: 'deal' }, h('strong', { textContent: 'The deal' }),
      h('ul', {}, ...['Data is free to read with a free token.', 'In return your agent reports how a flash went: steps, fixes, outcome.', 'Device and procedure only. No personal data; the server rejects it.', 'Deletion requires your approval: the agent must ask you first.'].map(t => h('li', { textContent: t })))),
    h('h3', { textContent: 'Your API tokens' }),
    info?.user ? h('div', {}, h('p', { className: 'field-help', textContent: 'A token lets an agent send reports in your name. Pick how long it lasts (up to a year); revoke it any time.' }), form, made, tokens)
      : h('p', { className: 'intro-copy' }, 'Sign in to create a token: ', ...signInLinks(info?.providers ?? [])),
    h('h3', { textContent: 'Endpoint' }), copyable(code(url)),
    h('p', { className: 'field-help', textContent: 'Streamable HTTP, JSON-RPC. Tools: find devices, get a device, get a ROM recipe, start a run, log a step, finish a run.' }),
    h('h3', { textContent: 'Set it up' }),
    h('p', { className: 'field-help', textContent: 'Claude Code:' }), copyable(cli),
    h('p', { className: 'field-help', textContent: 'Other MCP clients (JSON config):' }), copyable(config));
}
/** Connect this browser tab to the same ROMinit CLI used by rominit serve. */
async function cliConnectionView() {
  const info = await me;
  const status = h('p', { className: 'status', role: 'status', ariaLive: 'polite' });
  const controls = h('div', {}), panels = h('div', {});
  let usbPanel = null;
  const box = h('div', { id: 'cli-browser-connection' }, h('hr'), h('h3', { textContent: 'Connect this browser to ROMinit CLI' }),
    h('p', { className: 'field-help', textContent: 'Keep rominit serve running on this computer. ROMinit checks the local CLI automatically when you use a CLI feature; the browser may ask to allow local network access.' }),
    controls, status, panels,
    h('p', { className: 'field-help', textContent: 'The short-lived CLI connection is remembered across tabs in this browser for up to 30 days or until the website login expires. Phone SSH credentials stay in page memory and go only to the local CLI when a benchmark runs. Disconnecting does not erase the CLI login.' }));
  if (!info) {
    status.textContent = 'Could not check your ROMinit sign-in. Reload the page to retry.';
    return box;
  }
  if (!info.user) {
    controls.append(h('p', { className: 'intro-copy' }, 'Sign in to approve your CLI connection: ', ...signInLinks(info?.providers ?? [])));
    return box;
  }
  const user = info.user;
  const returnToPhone = (() => {
    try { const path = sessionStorage.getItem('rominit.helper.return'); return path && /^\/(?![/\\])/.test(path) ? path : './'; }
    catch { return './'; }
  })();
  controls.append(h('p', { textContent: `Account: ${user.name}` }));
  /** @param {any} session @param {HTMLButtonElement} button */
  const checkConnection = async (session, button, summary) => {
    button.disabled = true;
    try {
      const active = await ensureHelper(user.id, session);
      const result = await helperRequest(active, '/status');
      if (result.user?.id !== user.id) throw Error('The CLI is connected to a different account. Disconnect and pair again.');
      if (summary) summary.textContent = `Connected as ${active.user.name} · expires ${new Date(active.expiresAt).toLocaleString()}`;
      const capabilities = Array.isArray(result.capabilities) ? result.capabilities : [];
      if (capabilities.includes('usb-media')) {
        if (!usbPanel) { usbPanel = usbMediaPanel(active, h); panels.append(usbPanel); }
      } else { usbPanel?.remove(); usbPanel = null; }
      if (capabilities.includes('bench')) status.textContent = `ROMinit CLI ready as ${result.user.name}.`;
      else status.replaceChildren('ROMinit CLI connected. Phone benchmarks need an updated CLI: ', h('a', { href: '/rominit-cli.tar.gz', textContent: 'download it' }), ' and restart rominit serve.');
    } catch (error) { status.textContent = `${message(error)} Keep rominit serve running and allow local network access when asked.`; }
    finally { button.disabled = false; }
  };
  /** @param {any} session */
  const connected = session => {
    const summary = h('p', { textContent: `Connected as ${session.user.name} · expires ${new Date(session.expiresAt).toLocaleString()}` });
    controls.replaceChildren(summary,
      h('p', { className: 'field-help', textContent: 'This short-lived connection is shared across tabs in this browser. Continue to your phone test from any open ROMinit tab.' }),
      h('button', { type: 'button', className: 'button button-secondary', textContent: 'Check CLI connection', onclick() { void checkConnection(session, /** @type {HTMLButtonElement} */ (this), summary); } }),
      h('button', { type: 'button', className: 'button button-secondary', textContent: 'Disconnect CLI', async onclick() {
        this.disabled = true;
        try { await disconnectHelper(); status.textContent = 'Disconnected. Run rominit serve again to reconnect.'; }
        catch { status.textContent = 'Connection forgotten in this browser. Close rominit serve on its computer to stop the unreachable CLI.'; }
        usbPanel?.remove(); usbPanel = null;
        controls.replaceChildren(h('p', { textContent: 'No CLI connected.' }));
      } }),
      h('p', {}, h('a', { href: returnToPhone, textContent: returnToPhone === './' ? 'Back to ROMinit' : 'Back to phone test' })));
    const button = /** @type {HTMLButtonElement} */ (controls.querySelector('button'));
    void checkConnection(session, button, summary);
  };
  const hasPairingParams = ['port', 'state', 'challenge'].some(key => params.has(key));
  const port = params.get('port') ?? '', state = params.get('state') ?? '', challenge = params.get('challenge') ?? '';
  if (!hasPairingParams) {
    status.textContent = 'Checking for a running ROMinit CLI…';
    void ensureHelper(user.id).then(connected).catch(error => { status.textContent = message(error); });
    return box;
  }
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535 || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[a-f0-9]{64}$/.test(challenge)) {
    status.textContent = 'This pairing link is invalid or expired. Restart rominit serve and open its latest link.';
    return box;
  }
  controls.append(h('p', { textContent: `Connect ROMinit CLI on this computer (port ${port}) as ${user.name}?` }),
    h('button', { type: 'button', className: 'button button-primary', textContent: 'Approve and connect helper', async onclick() {
      this.disabled = true; status.textContent = 'Connecting to your local helper…';
      try {
        const session = await pairHelper(params, user.id);
        history.replaceState(null, '', './?view=cli');
        connected(session); status.textContent = 'ROMinit CLI connected.';
      } catch (error) {
        status.textContent = `${message(error)} Keep rominit serve running; allow local network access when asked, then retry using its pairing link.`;
        this.disabled = false;
      }
    } }));
  return box;
}
async function start() {
  const codename = params.get('device'), requestedView = params.get('view'), view = requestedView === 'helper' ? 'cli' : requestedView;
  // Disclaimer × hides it; remembered per browser.
  const notice = document.querySelector('.disclaimer');
  try { if (localStorage.getItem('rominit.noticeHidden')) notice?.remove(); } catch {}
  notice?.querySelector('button')?.addEventListener('click', () => { notice.remove(); try { localStorage.setItem('rominit.noticeHidden', '1'); } catch {} });
  // Header nav: mark where we are and keep the search text.
  const navSearch = /** @type {HTMLInputElement|null} */ (document.querySelector('.topbar input[type=search]'));
  if (navSearch) navSearch.value = params.get('q') ?? '';
  if (!codename && !view) navSearch?.form?.remove(); // the device list has its own search box
  // The OS link points at the PC category, so it matches on category as well as view.
  for (const a of document.querySelectorAll('.sitenav a')) {
    if (codename) break;
    const link = /** @type {HTMLAnchorElement} */ (a);
    const href = new URL(link.href);
    const matches = link.dataset.nav === 'os' ? href.searchParams.get('category') === params.get('category') : href.searchParams.get('view') === view;
    if (matches) link.setAttribute('aria-current', 'page');
  }
  if (!codename) {
    const index = await (await fetch('./catalog/index.json')).json();
    for (const a of document.querySelectorAll('.site-menu a, .top-links a')) if (new URL(/** @type {HTMLAnchorElement} */ (a).href).searchParams.get('view') === view) a.setAttribute('aria-current', 'page');
    if (view === 'sources' || view === 'about') { main.append(view === 'sources' ? sourcesView() : aboutView()); return; }
    if (view === 'agents') { main.append(await agentsView()); return; }
    if (view === 'cli') { main.append(await cliView()); return; }
    main.append(view === 'brands' ? tilesView(index, 'Brands', d => [d.vendor], () => true) : view === 'projects' ? tilesView(index, 'Projects', d => d.roms.map((/** @type {any} */ r) => r.os), (r, k) => r.os === k) : view === 'popular' ? await popularView(index) : view === 'favorites' ? await favoritesView(index) : view === 'inbox' ? await inboxView(index) : devicePicker(index));
    return;
  }
  const response = await fetch(`./catalog/${encodeURIComponent(codename)}.json`);
  if (!response.ok) { main.append(h('p', { className: 'status', textContent: `Unknown device ${codename}.` }), h('a', { href: './', textContent: 'Back to all devices' })); return; }
  const device = await response.json();
  if (device.supportOnly) {
    document.title = `${device.vendor} ${device.name} · ROMinit`;
    main.append(h('section', { className: 'intro' },
      h('a', { className: 'back-link', href: './', textContent: '← BACK' }),
      h('p', { className: 'eyebrow', textContent: `${device.vendor} / ${device.series} / SUPPORT ONLY` }),
      h('h1', {}, h('span', { textContent: `${device.name}.` })),
      h('p', { className: 'feature untested', textContent: 'No ROMinit flash recipe is catalogued for this phone yet.' }),
      h('p', { className: 'intro-copy', textContent: `Nura lists this phone in its Community device catalog. That does not mean ROMinit has a verified image, install recipe, or recovery path. This support-only page is shown when your search has no flashable match.` }),
      h('p', { className: 'intro-copy' }, link(device.supportUrl, 'Nura device page'), ` · codename ${device.codename}`),
      h('p', { className: 'field-help', textContent: 'Useful next details to gather: exact model number, device-specific install steps, and a safe recovery or stock restore path.' })));
    return;
  }
  // Accepted phone tests override the catalog's feature states; blocked / untested / inconclusive keep the catalog value.
  const tested = await fetch(`./api/bench?device=${encodeURIComponent(codename)}`).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  for (const r of device.roms) {
    const run = tested[`${codename}/${r.id}`];
    if (!run) continue;
    for (const [f, tier] of Object.entries(run.final)) if (TIER_STATE[tier] && f in r.rating.features) r.rating.features[f] = TIER_STATE[tier];
    r.rating.tested = run.accepted.slice(0, 10);
  }
  // A superseded ROM sits right after the one that replaced it, so it is never the default pick.
  const parent = (/** @type {any} */ r) => device.roms.find((/** @type {any} */ p) => p.supersedes === r.id);
  const rank = (/** @type {any} */ r) => parent(r) ? rank(parent(r)) + 0.5 : Object.keys(ORIGINS).indexOf(r.origin) * 20 + (r.vetting === 'curated' ? 0 : 10) - (r.pick ? 5 : 0) - (r.recommended ? 10 : 0) + Object.keys(STATUSES).indexOf(r.status);
  const roms = device.roms.filter((/** @type {any} */ r) => r.origin !== 'stock').sort((/** @type {any} */ a, /** @type {any} */ b) => rank(a) - rank(b));
  const stock = device.roms.filter((/** @type {any} */ r) => r.origin === 'stock');
  const rom = roms.find((/** @type {any} */ r) => r.id === params.get('rom')) ?? roms[0];
  document.title = `${device.vendor} ${device.name} · ROMinit`;
  const romSelect = h('select', { className: 'confirmation-input' }, ...Object.keys(ORIGINS).map(origin => h('optgroup', { label: origin },
    ...roms.filter((/** @type {any} */ r) => r.origin === origin).map((/** @type {any} */ r) => new Option(`${parent(r) ? '↳ ' : ''}${r.name} ${r.version} (${parent(r) ? 'superseded, ' : ''}${r.recommended ? 'recommended, ' : ''}${r.external ? 'link-only, ' : ''}${r.pick ? 'community pick, ' : ''}${r.risk.level === 'high' ? 'high risk, ' : ''}${r.status}, ${r.vetting === 'scraped' ? 'scraped placeholder' : r.vetting})`, r.id, false, r === rom)))).filter(g => g.children.length));
  const flashable = (/** @type {any} */ r) => r.status !== 'broken';
  romSelect.addEventListener('change', () => go({ device: codename, rom: romSelect.value }));
  /** One of the collapsible page sections. @param {string} title @param {string} hint @param {boolean} open @param {any[]} body */
  // Not needed for this phone / ROM counts as done (green, dashed on the rail).
  const section = (title, hint, open, body, badge = '') => h('details', { className: `page-section${badge === 'NOT REQUIRED' ? ' skipped' : ''}`, open },
    h('summary', {}, badge && h('b', { className: 'badge', textContent: badge }), h('span', { textContent: title }), h('small', { textContent: hint })), ...body);
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
  /** @type {{rom?:string, steps?:number[], unlocked?:boolean, twrp?:boolean, flashed?:string[], flashedElsewhere?:string[], unmatched?:string[], tested?:string[], cards?:Record<string, string[]>}} */ let progress = {};
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
      h('label', { className: 'field-label rom-label' }, rom && h('img', { className: 'os-logo', src: `./logos/${rom.os.toLowerCase()}.svg`, alt: '', onerror() { this.remove(); } }), rom ? rom.os : 'ROM'), h('div', { className: 'rom-pick' }, romSelect, rom && lockButton()),
      // A dashed arrow runs from the top lock-in button, past the details, down to the centred one at the bottom.
      rom ? h('div', { className: 'lock-path' }, rom.screenshots?.length ? slideshow(rom.screenshots) : h('div', { className: 'slideshow no-shot', textContent: 'No screen picture yet' }),
      rom && sourceRow(rom, `${device.codename}/${rom.id}`, device),
      rom && h('p', { className: 'inbox-actions' }, requestButton('update', 'Request ROM update', `${device.codename}/${rom.id}`), requestButton('mirror', 'Request ROM mirror', `${device.codename}/${rom.id}`)),
      rom && kindRow(rom),
      rom && starsRow(`${device.codename}/${rom.id}`),
      rom && countsRow(`${device.codename}/${rom.id}`),
      rom && ownersRow(`${device.codename}/${rom.id}`, rom.maintainer),
      rom && ratingRow(rom.rating),
      rom && metaRow(rom.rating),
      ...(rom ? includesRows(rom.rating) : []),
      rom && requirementsRow(rom)) : '',
      rom && h('div', { className: 'lock-end' }, rom.login && loginRow(rom.login), lockButton()),
      rom && h('p', { className: 'intro-copy' }, ...rich(`${rom.notes ?? ''} `)),
      rom && commentsBox(`${device.codename}/${rom.id}`)], rom ? 'REQUIRED' : '');
  if (rom) required(infoSection, () => {
    for (const b of lockButtons) b.textContent = progress.rom === rom.id ? '✓ Locked in · change' : `Lock in ${rom.name} ${rom.version}`;
    return progress.rom === rom.id;
  });
  const unlock = device.unlock;
  const oneClickStage = unlockStage(device), oneClick = oneClickStage && stageCard(device, oneClickStage, 1, 1, `${device.codename}/unlock`);
  const alreadyUnlocked = h('input', { type: 'checkbox', checked: !!progress.unlocked });
  const stepBoxes = (unlock?.steps ?? []).map((/** @type {any} */ _, /** @type {number} */ i) => h('input', { type: 'checkbox', checked: progress.steps?.includes(i) ?? false }));
  const manual = unlock && h('ol', { className: 'guide' }, ...unlock.steps.map((/** @type {string} */ step, /** @type {number} */ i) => h('li', {}, h('label', {}, stepBoxes[i], ' ', ...rich(step)))));
  const unlockSection = section('1 · Unlock bootloader', unlock ? 'once per phone; tick each step' : 'not needed', !!unlock, unlock ? [
    h('label', { className: 'field-help' }, alreadyUnlocked, ' Bootloader is already unlocked on this phone'),
    unlock.hints?.length && h('details', { className: 'hints' }, h('summary', {}, h('strong', { textContent: `Good to know · ${unlock.hints.length} hint${unlock.hints.length === 1 ? '' : 's'}` })), h('ul', {}, ...unlock.hints.map((/** @type {string} */ hint) => h('li', {}, ...rich(hint))))),
    oneClick && h('div', { className: 'stages' }, h('p', { className: 'field-help' }, h('strong', { textContent: 'One click: ' }),
      'turn on OEM unlocking in Developer options, put the phone in fastboot mode, then this sends the unlock command from the browser instead of a computer terminal.'), oneClick),
    oneClick ? h('details', { className: 'alt-path' }, h('summary', { textContent: 'Alternative path: unlock by hand' }), manual) : manual,
    unlock.pivots?.length && h('details', { className: 'pivots' }, h('summary', { textContent: 'Stuck? Locked or soft-bricked' }),
      h('dl', {}, ...unlock.pivots.flatMap((/** @type {any} */ p) => [h('dt', {}, ...rich(p.problem)), h('dd', {}, ...rich(p.fix), ' ', p.url && link(p.url, 'Open'))]))),
    unlock.url && link(unlock.url, 'Full unlock guide')] : [h('p', { className: 'field-help', textContent: 'This phone needs no bootloader unlock.' })], unlock ? 'REQUIRED' : 'NOT REQUIRED');
  // A one-click run (or its already-unlocked no-op) ticks the box itself.
  unlockSection.addEventListener('stage-done', () => { alreadyUnlocked.checked = true; alreadyUnlocked.dispatchEvent(new Event('change', { bubbles: true })); });
  if (unlock) required(unlockSection, () => {
    progress.steps = stepBoxes.flatMap((box, i) => box.checked ? [i] : []); progress.unlocked = alreadyUnlocked.checked; save();
    return alreadyUnlocked.checked || stepBoxes.every(box => box.checked);
  });
  const haveTwrp = h('input', { type: 'checkbox', checked: !!progress.twrp });
  const twrpSection = section('2 · Custom recovery', tools.length ? 'needed before the ROM' : 'not needed for this ROM', tools.length > 0,
    tools.length ? [h('label', { className: 'field-help' }, haveTwrp, ' A custom recovery (TWRP or similar) is already installed on this phone'), h('div', { className: 'stages' }, ...tools)]
      : [h('p', { className: 'field-help', textContent: 'This ROM flashes without a custom recovery.' })], tools.length ? 'REQUIRED' : 'NOT REQUIRED');
  let twrpDone = 0;
  twrpSection.addEventListener('stage-done', () => { if (++twrpDone >= tools.length) haveTwrp.checked = true; });
  if (tools.length) required(twrpSection, () => { progress.twrp = haveTwrp.checked; save(); return haveTwrp.checked; });
  const recoveryInstallers = (device.recoveries ?? []).map((/** @type {any} */ recovery) => {
    const toolHashes = new Set((rom?.stages ?? []).filter((/** @type {any} */ stage) => stage.section === 'tools').flatMap((/** @type {any} */ stage) => stage.files.map((/** @type {any} */ file) => file.sha256)));
    const duplicates = tools.length > 0 && recovery.stages.every((/** @type {any} */ stage) => stage.files.every((/** @type {any} */ file) => toolHashes.has(file.sha256)));
    const cards = duplicates ? [] : recovery.stages.map((/** @type {any} */ stage, /** @type {number} */ i) => stageCard(device, stage, i + 1, recovery.stages.length, `${device.codename}/recovery/${recovery.id}`));
    return h('div', { className: 'recovery-installer' },
      h('h3', { textContent: `${recovery.name} ${recovery.version}` }),
      h('p', { className: 'rating source-row' }, h('strong', { textContent: 'installer' }), recovery.vetting === 'scraped' && h('span', { className: 'feature partial', textContent: 'scraped · unverified' }, placeholderMark()),
        link(recovery.project, 'Project'), link(recovery.source, 'Device instructions')),
      h('ul', { className: 'field-help' }, ...recovery.requirements.map((/** @type {string} */ requirement) => h('li', { textContent: requirement }))),
      duplicates ? h('p', { className: 'field-help', textContent: 'This same pinned installer is already shown in section 2.' }) : h('div', { className: 'stages' }, ...cards));
  });
  // Opt-in, tucked into R: a recovery the selected ROM needs is already in section 2.
  const otherRecoveries = recoveryInstallers.length && h('details', { className: 'pivots' }, h('summary', { textContent: `Other recovery installers (${recoveryInstallers.length}) · opt-in, only if you need one` }),
    h('p', { className: 'field-help', textContent: 'Not needed for the selected ROM; a recovery it needs is in section 2. These are alternatives and are not compatible with every ROM.' }), ...recoveryInstallers);
  // Optional, so never amber; it goes green once a report card for this ROM was sent from this browser.
  const benchRomSelect = /** @type {HTMLSelectElement} */ (romSelect.cloneNode(true));
  benchRomSelect.value = rom?.id ?? '';
  benchRomSelect.setAttribute('aria-label', 'Installed ROM for this test');
  benchRomSelect.addEventListener('change', () => {
    location.href = `?${new URLSearchParams({ device: codename, rom: benchRomSelect.value })}#phone-test`;
  });
  const testSection = rom && section('4 · Test your phone', `${rom.name} ${rom.version} · optional`, location.hash === '#phone-test', [
    h('label', { className: 'field-label' }, 'ROM currently installed on this phone', benchRomSelect),
    h('p', { className: 'field-help', textContent: 'Choose the ROM running on the phone now. Changing it opens a fresh test for that ROM.' }),
    benchBox(rom, `${device.codename}/${rom.id}`, progress.cards?.[rom.id] ?? [], () => flashOf())], 'OPTIONAL');
  if (testSection) testSection.id = 'phone-test';
  const markTested = () => { const ok = !!progress.tested?.includes(rom.id); testSection.classList.toggle('done', ok); testSection.querySelector(':scope > summary .badge').textContent = ok ? 'COMPLETED' : 'OPTIONAL'; };
  if (rom) { testSection.addEventListener('bench-sent', (/** @type {any} */ e) => { progress.tested = [...new Set([...progress.tested ?? [], rom.id])]; progress.cards = { ...progress.cards, [rom.id]: [...progress.cards?.[rom.id] ?? [], e.detail] }; save(); markTested(); }); testSection.addEventListener('bench-discarded', (/** @type {any} */ e) => {
    progress.cards = { ...progress.cards, [rom.id]: (progress.cards?.[rom.id] ?? []).filter(code => code !== e.detail) };
    if (!progress.cards[rom.id].length) progress.tested = (progress.tested ?? []).filter(id => id !== rom.id);
    save(); markTested();
  }); markTested(); }
  const romCards = rom && flashable(rom) ? cards(rom, 'rom') : [];
  // Flashed some other way (own tools, another guide): counts as done, but marked unconfirmed since ROMinit did not see it.
  const flashedElsewhere = h('input', { type: 'checkbox', checked: !!rom && !!progress.flashedElsewhere?.includes(rom.id) });
  const romSection = section('3 · Flash ROM', rom ? `${rom.name} ${rom.version}` : 'none in the catalog yet', true, [
      rom && requirementsRow(rom),
      rom?.login && loginRow(rom.login),
      rom?.external && h('p', { className: 'experimental-note' }, h('strong', { textContent: 'Link-only: ' }), ...rich(rom.external.why), ' ', link(rom.external.url, `Open the ${rom.os} installer`)),
      (romCards.length || rom?.external) && h('label', { className: 'field-help' }, flashedElsewhere, rom?.external ? ` I flashed ${rom.name} with that installer` : ' I flashed this ROM another way (marked unconfirmed)'),
      rom && !rom.external && (flashable(rom) ? h('div', { className: 'stages' }, ...romCards)
        : h('p', { className: 'experimental-note' }, h('strong', { textContent: 'Known broken: ' }), 'this release is listed for the record and cannot be flashed here. Pick another ROM.'))], romCards.length || rom?.external ? 'REQUIRED' : '');
  let romDone = 0, romUnmatched = false;
  romSection.addEventListener('stage-done', (/** @type {any} */ e) => {
    romUnmatched ||= !!e.detail?.unmatched;
    if (++romDone < romCards.length) return;
    // Skip verification on any stage: the phone runs an image other than the listed one; a clean verified run clears that.
    progress.flashed = [...new Set([...progress.flashed ?? [], rom.id])];
    progress.unmatched = [...(progress.unmatched ?? []).filter(id => id !== rom.id), ...romUnmatched ? [rom.id] : []]; save(); });
  /** How this ROM got on the phone, for the report card. */
  const flashOf = () => progress.flashed?.includes(rom.id) ? (progress.unmatched?.includes(rom.id) ? 'unmatched' : 'verified') : progress.flashedElsewhere?.includes(rom.id) ? 'elsewhere' : null;
  const romFlashed = () => {
    progress.flashedElsewhere = [...(progress.flashedElsewhere ?? []).filter(id => id !== rom.id), ...flashedElsewhere.checked ? [rom.id] : []]; save();
    return !!progress.flashed?.includes(rom.id) || flashedElsewhere.checked;
  };
  const unconfirmed = () => { if (romSection.classList.contains('done') && flashOf() !== 'verified') romSection.querySelector(':scope > summary .badge').textContent = flashOf() === 'unmatched' ? 'COMPLETED · UNMATCHED IMAGE' : 'COMPLETED · UNCONFIRMED'; };
  if (romCards.length || rom?.external) required(romSection, romFlashed, () => romSection.querySelector(':scope > summary').after(
    h('p', { className: 'congrats' }, h('strong', { textContent: `Congratulations, ${rom.name} is on your ${device.name}!` }),
      ' Give it a few minutes for the first boot. ', h('a', { href: '#', textContent: 'Tell others how it went', onclick(/** @type {Event} */ e) {
        e.preventDefault(); infoSection.open = true; const box = /** @type {HTMLTextAreaElement|null} */ (infoSection.querySelector('.comment-box textarea')); box?.scrollIntoView({ block: 'center' }); box?.focus(); } }),
      '.')));
  // Scraped ROM: its info and flash steps are placeholders until checked.
  if (rom?.vetting === 'scraped') for (const sec of [infoSection, romSection]) sec.querySelector(':scope > summary > span')?.after(placeholderMark('untested placeholder'));
  if (romCards.length || rom?.external) { romSection.addEventListener('change', unconfirmed); romSection.addEventListener('stage-done', unconfirmed); unconfirmed(); } // after required() set the badge
  // Under the intro, three rows: specs, phone tags (year, microSD, cameras, telephoto, LiDAR), then badges for the ROM projects, stock Android and recoveries.
  const tags = /** @type {string[]} */ (device.hardware?.tags ?? []), isOs = (/** @type {string} */ t) => /android|linux|jailbreak|os\b/i.test(t); // iOS, postmarketOS, Sailfish OS…
  const recoverSection = section('R · Recover / revert', stock.length ? 'back to stock' : 'manual for now', false, [
    device.recovery && h('p', { className: 'experimental-note' }, h('strong', { textContent: 'Way back: ' }), ...rich(device.recovery.text), ' ', device.recovery.url && link(device.recovery.url, 'More')),
    ...stock.map((/** @type {any} */ r) => h('div', { className: 'stages' }, h('p', { className: 'intro-copy' }, `${r.name} ${r.version}. `, ...rich(r.notes ?? ''), ' ', r.homepage && link(r.homepage, 'Source')),
      ...r.stages.map((/** @type {any} */ stage, /** @type {number} */ i) => stageCard(device, stage, i + 1, r.stages.length, `${device.codename}/${r.id}`)))),
    otherRecoveries]);
  main.append(
    h('section', { className: 'intro' },
      device.photo && h('figure', { className: 'phone-photo' }, h('img', { src: `./${device.photo.src}`, alt: `${device.vendor} ${device.name}` }),
        h('figcaption', {}, h('a', { href: device.photo.page, target: '_blank', rel: 'noopener noreferrer', textContent: device.photo.license === 'press' ? `Image © ${device.photo.artist}` : `Photo: ${device.photo.artist}, ${device.photo.license}` }))),
      h('a', { className: 'back-link', href: './', textContent: '← BACK', onclick(/** @type {MouseEvent} */ e) {
        if (document.referrer.startsWith(location.origin)) { e.preventDefault(); history.back(); } } }),
      h('p', { className: 'eyebrow' }, h('a', { href: './', textContent: 'ALL' }),
        ...[CATEGORIES[device.category], device.vendor, device.series, device.family].flatMap(crumb => [' / ', h('a', { href: `./?q=${encodeURIComponent(crumb)}`, textContent: crumb.toUpperCase() })]), ` / ${device.variant.toUpperCase()}`),
      h('div', { className: 'title-row' }, h('h1', {}, 'Flash your ', h('span', { textContent: `${device.name}.` })),
        h('button', { className: 'start-over', type: 'button', title: 'Forget progress on this phone and start from section 0', onclick() {
          if (!confirm(`Start over on this ${device.name}? This forgets the locked-in ROM and every ticked step in this browser.`)) return;
          try { localStorage.removeItem(progressKey); } catch { /* private window */ } location.reload(); } },
          Object.assign(h('span', { className: 'rewind', ariaHidden: 'true' }), { innerHTML: REWIND_SVG }), h('small', { textContent: 'Start over' }))),
      h('p', { className: 'intro-copy', textContent: `${device.vendor} ${device.name} (${device.models.join(', ')}, ${device.codename}) only. ${device.notes ?? ''} Everything runs in this browser; you download the files from their source and nothing is uploaded.` }),
      device.hardware && h('p', { className: 'hardware-line', textContent: [device.hardware.ram, device.hardware.cpu, device.hardware.gpu, device.hardware.display].join(' · ') }),
      tags.some(t => !isOs(t)) && h('p', { className: 'hardware-line', textContent: tags.filter(t => !isOs(t)).join(' · ') }),
      badgeRow(device, roms, stock, rom, infoSection, recoverSection)),
    infoSection,
    unlockSection,
    twrpSection,
    romSection,
    testSection,
    // R and S sit apart from the numbered flow: a way back, and a way to tell us something is wrong.
    h('p', { className: 'side-divider', textContent: 'when things go wrong' }),
    recoverSection);
}
/** Left rail like a scrollbar: the rail is the whole page, milestones 0–4, R, T sit at their section's place (so long sections
 * get long stretches), the thumb is what the window shows. Green when a section is done, amber ring on the next one to do,
 * +/- opens or closes the section. @param {HTMLDetailsElement[]} sections */
function progressRail(sections) {
  const marks = sections.map(sec => {
    const [num, label] = (sec.querySelector(':scope > summary > span')?.textContent ?? '').split(' · ');
    const fold = h('button', { type: 'button', className: 'rail-fold', onclick() { sec.open = !sec.open; } });
    const sync = () => { fold.textContent = sec.open ? '−' : '+'; fold.title = `${sec.open ? 'Close' : 'Open'} ${label}`; };
    sec.addEventListener('toggle', sync); sync();
    const mark = h('div', { className: 'rail-mark' }, fold, h('a', { href: '#', title: label, onclick(/** @type {Event} */ e) {
      e.preventDefault(); sec.open = true; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, h('b', { textContent: num }), h('small', { textContent: label })));
    mark.dataset.num = num; // R and T take their section's colours
    return mark;
  });
  const fill = h('i', { className: 'rail-fill' }), thumb = h('i', { className: 'rail-thumb' });
  const place = () => {
    const page = Math.max(1, document.documentElement.scrollHeight);
    // Two sections closer than a two-line label still get that much room; pushed up from the bottom if needed.
    const gap = Math.min(44, rail.clientHeight / sections.length) / Math.max(1, rail.clientHeight); // short window: squeeze evenly
    const tops = sections.map(sec => (sec.getBoundingClientRect().top + scrollY) / page);
    for (let i = 1; i < tops.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + gap);
    for (let i = tops.length - 1; i >= 0; i--) tops[i] = Math.min(tops[i], i === tops.length - 1 ? 1 : tops[i + 1] - gap);
    tops.forEach((top, i) => { marks[i].style.top = `${100 * top}%`; });
    fill.style.height = thumb.style.top = `${100 * scrollY / page}%`;
    thumb.style.height = `${100 * innerHeight / page}%`;
  };
  const paint = () => {
    const next = sections.findIndex(sec => !sec.classList.contains('done') && sec.classList.contains('required'));
    marks.forEach((mark, i) => { const c = sections[i].classList; mark.className = `rail-mark${c.contains('done') ? ' done' : c.contains('skipped') ? ' done skipped' : i === next ? ' next' : ''}`; });
  };
  // Sections flip their own done / required classes; opening or closing one moves the rest, so re-place on resize too.
  const watch = new MutationObserver(paint);
  for (const sec of sections) watch.observe(sec, { attributes: true, attributeFilter: ['class'] });
  let frame = 0;
  const soon = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
  addEventListener('scroll', soon, { passive: true });
  new ResizeObserver(soon).observe(document.body);
  const rail = h('nav', { className: 'progress-rail', ariaLabel: 'Progress through this page' }, fill, thumb, ...marks);
  paint(); soon();
  return rail;
}
for (const a of document.querySelectorAll('a[href="#submit-request"]')) a.addEventListener('click', () => {
  const box = /** @type {HTMLDetailsElement|null} */ (document.getElementById('submit-request'));
  if (box) box.open = true;
  a.closest('details')?.removeAttribute('open');
});
start().then(() => {
  main.append(reportBox());
  if (location.hash === '#phone-test') document.getElementById('phone-test')?.scrollIntoView({ block: 'start' });
  // Device pages: one milestone per section, R and T included (T is the ticket box added just above).
  const sections = /** @type {HTMLDetailsElement[]} */ ([...main.querySelectorAll(':scope > details.page-section')]);
  if (sections.length < 2) return;
  if (location.hash === '#rom') { sections[0].open = true; sections[0].scrollIntoView({ block: 'start' }); } // a ROM badge picked this ROM
  const rail = progressRail(sections);
  // Start over moves to the top of the rail; the title-row button stays for phones, where the rail is hidden.
  const restart = /** @type {HTMLButtonElement|null} */ (main.querySelector('.title-row .start-over'));
  if (restart) rail.prepend(Object.assign(/** @type {HTMLButtonElement} */ (restart.cloneNode(true)), { onclick: () => restart.click() }));
  main.append(rail);
}, error => main.append(h('p', { className: 'status', textContent: `Could not load the catalog: ${message(error)}` }), reportBox())); // a broken page is what tickets are for
