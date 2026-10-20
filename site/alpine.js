import { ALPINE, ALPINE_ARCHITECTURES, ARCH_FAMILY, alpineImage } from '../src/alpine.js';
import { h } from './dom.js';
import { ensureHelper, helperRequest, helperSession } from './helper.js';
import { usbMediaPanel } from './usb-media.js';

const editionSelect = /** @type {HTMLSelectElement} */ (document.getElementById('alpine-edition'));
const images = /** @type {HTMLElement} */ (document.getElementById('alpine-images'));
const usb = /** @type {HTMLElement} */ (document.getElementById('alpine-usb-panel'));
const status = /** @type {HTMLElement} */ (document.getElementById('alpine-usb-status'));
const params = new URLSearchParams(location.search);
let selectedEdition = ALPINE.editions.find(edition => edition.id === params.get('edition')) ?? ALPINE.editions.find(edition => edition.id === 'extended') ?? ALPINE.editions[0];
let connecting = false;
const busy = () => connecting || usb.querySelector('#usb-media-panel')?.getAttribute('data-busy') === 'true';
const sizes = bytes => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

for (const name of [...new Set(ALPINE_ARCHITECTURES.map(arch => ARCH_FAMILY[arch]))])
  document.getElementById('alpine-architectures')?.append(h('span', { className: 'architecture-tag', textContent: name }));
editionSelect.append(...ALPINE.editions.map(edition => h('option', { value: edition.id, textContent: edition.name })));
document.getElementById('alpine-version').textContent = `Version ${ALPINE.version} · Stable`;
document.getElementById('alpine-release').replaceChildren(h('strong', { className: 'alpine-version-inline', textContent: `Version ${ALPINE.version}` }), ` · Stable · released ${ALPINE.releaseDate}`);

function showDrivePrompt(text = 'Choose an ISO above', image = null) {
  usb.replaceChildren(
    ...(image ? [h('p', { className: 'usb-selected-image', textContent: `${ALPINE.name} ${ALPINE.version} · ${selectedEdition.name} · ${image.arch} · ${image.url.split('/').pop()} · ${sizes(image.size)}` })] : []),
    h('label', { className: 'field-label', htmlFor: 'alpine-usb-method', textContent: 'USB install type' }),
    h('select', { id: 'alpine-usb-method', disabled: true }, h('option', { textContent: image ? 'Connecting to CLI…' : 'Choose an ISO first' })),
    h('label', { className: 'field-label', htmlFor: 'alpine-usb-drive', textContent: 'USB drive' }),
    h('select', { id: 'alpine-usb-drive', disabled: true }, h('option', { textContent: text })));
}
showDrivePrompt();

function updateUrl(imageId = '') {
  const url = new URL(location.href);
  url.searchParams.set('edition', selectedEdition.id);
  if (imageId) url.searchParams.set('image', imageId); else url.searchParams.delete('image');
  history.replaceState(null, '', url);
}

async function chooseImage(imageId) {
  if (busy()) { status.textContent = 'Wait for the current USB operation to finish before changing the image.'; return; }
  const image = alpineImage(imageId);
  if (!['iso', 'img.gz'].includes(image?.format)) return;
  updateUrl(imageId);
  connecting = true;
  showDrivePrompt('Connect the CLI to list USB drives', image);
  status.textContent = `Connecting to your CLI for ${image.url.split('/').pop()}…`;
  document.getElementById('alpine-usb')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const response = await fetch('./api/me', { cache: 'no-store' }).catch(() => null);
    if (!response) throw Error('Could not check your ROMinit account. Check your connection and retry.');
    if (!response.ok && response.status !== 401) throw Error('ROMinit account check is temporarily unavailable. Retry in a moment.');
    const account = await response.json().catch(() => null);
    if (!account?.user?.id) throw Error('Sign in to ROMinit before preparing an Alpine USB.');
    const session = await ensureHelper(account.user.id, helperSession());
    const ready = await helperRequest(session, '/status');
    if (ready.user?.id !== account.user.id) throw Error('The CLI belongs to a different account. Reconnect it.');
    if (!ready.capabilities?.includes('usb-media')) {
      status.replaceChildren('USB preparation is not enabled in this CLI. ', h('a', { href: './?view=cli#usb-setup', textContent: 'Set up the Ventoy USB support' }));
      return;
    }
    if (!ready.capabilities?.includes('usb-images')) {
      status.replaceChildren('This CLI needs an update for image selection. ', h('a', { href: './rominit-cli.tar.gz', textContent: 'Download updated CLI' }), ' and restart rominit serve.');
      return;
    }
    status.textContent = `${ALPINE.name} ${ALPINE.version} · ${selectedEdition.name} · ${image.arch}. Choose Ventoy or Direct write, select the USB drive, then review.`;
    usb.replaceChildren(usbMediaPanel(session, h, image.id, ready.capabilities));
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally { connecting = false; }
}

function render() {
  editionSelect.value = selectedEdition.id;
  document.getElementById('alpine-edition-description').textContent = selectedEdition.description;
  document.getElementById('alpine-edition-note').textContent = selectedEdition.usbNote;
  images.replaceChildren(...selectedEdition.images.map(image => h('article', { className: 'alpine-image', id: image.id },
    h('div', { className: 'alpine-image-title' }, h('strong', { textContent: image.arch }), h('span', { className: 'architecture-tag', textContent: ARCH_FAMILY[image.arch] }), ...(image.usb === true ? [h('span', { className: 'architecture-tag ventoy-supported', textContent: 'Ventoy supported' })] : []), h('span', { className: 'field-help', textContent: `${image.format} · ${sizes(image.size)}` })),
    h('div', { className: 'alpine-image-actions' }, ['iso', 'img.gz'].includes(image.format)
      ? h('button', { type: 'button', className: 'button button-primary', textContent: 'Prepare USB', ariaLabel: `Prepare ${selectedEdition.name} ${image.arch} USB`, onclick: () => chooseImage(image.id) })
      : h('span', { className: 'field-help', textContent: 'Download · platform-specific setup' }),
      h('a', { href: image.url, textContent: 'Download' }),
      h('a', { href: ALPINE.source, target: '_blank', rel: 'noopener noreferrer', textContent: 'Source' }),
      h('a', { href: `${image.url}.sha256`, target: '_blank', rel: 'noopener noreferrer', textContent: 'SHA-256' })))));
}
editionSelect.addEventListener('change', () => {
  if (busy()) { editionSelect.value = selectedEdition.id; status.textContent = 'Wait for the current USB operation to finish before changing edition.'; return; }
  selectedEdition = ALPINE.editions.find(edition => edition.id === editionSelect.value) ?? ALPINE.editions[0];
  showDrivePrompt(); status.textContent = ''; updateUrl(); render();
});

render();
const initialImage = alpineImage(params.get('image') ?? '');
if (['iso', 'img.gz'].includes(initialImage?.format) && selectedEdition.images.includes(initialImage)) void chooseImage(initialImage.id);
