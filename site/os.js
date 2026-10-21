import { OSES, ARCH_FAMILY, osArchitectures, osImage } from '../src/os/index.js';
import { h } from './dom.js';
import { ensureHelper, helperRequest, helperSession } from './helper.js';
import { usbMediaPanel } from './usb-media.js';
import { PROVIDER_NAMES, mountAccount } from './account.js';

/** The build stamps the OS id on <html data-os>, so one template serves every OS page. */
const OS = OSES.find(os => os.id === document.documentElement.dataset.os) ?? OSES[0];
const { page } = OS;
const byId = id => /** @type {HTMLElement} */ (document.getElementById(id));
const links = list => list.flatMap((link, i) => [i ? ' ' : '', h('a', { href: link.href, rel: 'noopener noreferrer', target: '_blank', textContent: `${link.label} ↗` })]);
const editionSelect = /** @type {HTMLSelectElement} */ (document.getElementById('alpine-edition'));
const images = /** @type {HTMLElement} */ (document.getElementById('alpine-images'));
const usb = /** @type {HTMLElement} */ (document.getElementById('alpine-usb-panel'));
const status = /** @type {HTMLElement} */ (document.getElementById('alpine-usb-status'));
const params = new URLSearchParams(location.search);
let selectedEdition = OS.editions.find(edition => edition.id === params.get('edition')) ?? OS.editions.find(edition => edition.id === OS.defaultEdition) ?? OS.editions[0];
let connecting = false, cliReady = false;
const busy = () => connecting || usb.querySelector('#usb-media-panel')?.getAttribute('data-busy') === 'true';
const sizes = bytes => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

for (const name of [...new Set(osArchitectures(OS).map(arch => ARCH_FAMILY[arch]))])
  document.getElementById('alpine-architectures')?.append(h('span', { className: 'architecture-tag', textContent: name }));
if (OS.requirements) // system requirements, from the OS's own docs
  document.getElementById('os-reqs')?.append(h('a', { className: 'architecture-tag', href: OS.requirements.source, target: '_blank', rel: 'noopener noreferrer', title: `Minimum (checked ${OS.requirements.checked}). ${OS.requirements.note ?? ''}`, textContent: OS.requirements.summary }));
editionSelect.append(...OS.editions.map(edition => h('option', { value: edition.id, textContent: edition.name })));
document.title = `${OS.name} · OS · ROMinit`;
const logo = /** @type {HTMLImageElement} */ (byId('os-logo'));
Object.assign(logo, { src: `./${page.logo.src}`, alt: page.logo.alt, width: page.logo.width, height: page.logo.height });
byId('os-eyebrow').textContent = page.eyebrow;
byId('os-name').replaceChildren(OS.name, h('span', { textContent: '.' }));
byId('os-intro').textContent = page.intro;
byId('preview-title').textContent = `${OS.name}, pros and cons`;
byId('os-pros').replaceChildren(...page.pros.map(text => h('li', { textContent: text })));
byId('os-cons').replaceChildren(...page.cons.map(text => h('li', { textContent: text })));
byId('os-links').replaceChildren(...links(page.links));
byId('os-preview-note').textContent = page.previewNote;
byId('os-shot-bar').textContent = page.shot.bar;
// A stock photo carries its attribution in the caption, as device photos do.
byId('os-shot-caption').replaceChildren(page.shot.caption,
  ...(page.shot.photo ? [' · ', h('a', { href: page.shot.photo.page, target: '_blank', rel: 'noopener noreferrer', textContent: `Photo: ${page.shot.photo.artist}, ${page.shot.photo.license}` })] : []));
Object.assign(byId('alpine-operation'), { src: `./${page.shot.src}`, alt: page.shot.alt, width: page.shot.width, height: page.shot.height });
byId('downloads-title').textContent = `Choose your ${OS.name}`;
byId('os-status').textContent = page.status;
byId('os-footer').replaceChildren(...page.footer.map(link => h('a', { href: link.href, textContent: link.label })), h('span', { textContent: `Release metadata checked ${page.checked}` }));
// Kernel: what the release media boots; `updates` is what apk upgrade installs on that branch now.
const kernel = OS.kernel && `Linux ${OS.kernel.version} ${OS.kernel.line}`;
document.getElementById('alpine-version').textContent = `Version ${OS.version} · Stable${kernel ? ` · ${kernel}` : ''}`;
document.getElementById('alpine-release').replaceChildren(h('strong', { className: 'alpine-version-inline', textContent: `Version ${OS.version}` }), ` · Stable · released ${OS.releaseDate}`,
  ...(OS.kernel ? [' · kernel ', h('a', { href: OS.kernel.source, target: '_blank', rel: 'noopener noreferrer', textContent: kernel }), OS.kernel.updates ? ` on the image, ${OS.kernel.updates} after apk upgrade (checked ${OS.kernel.checked})` : ''] : []));

const signInHint = providers => providers?.length
  ? ['Sign in with ', ...providers.flatMap((p, i) => [i ? ' or ' : '', h('a', { href: `./auth/${p}/login?return=${encodeURIComponent(location.pathname + location.search)}`, textContent: PROVIDER_NAMES[p] ?? p })]), ', then press Connect CLI again.']
  : ['Sign-in is not set up at this address. Open ', h('a', { href: `https://rominit.pages.dev/${OS.id}`, textContent: 'rominit.pages.dev' }), ' instead.'];
const cliHint = () => ['Run ', h('code', { textContent: 'rominit auth' }), ' once, then ', h('code', { textContent: 'rominit serve' }), ' on this computer. ', h('a', { href: './?view=cli', textContent: 'CLI setup' }), '.'];

/** Quiet check (no prompts) whether a saved CLI connection already works, so the buttons say Prepare USB instead of Connect CLI. */
async function probeCli() {
  try {
    const session = helperSession();
    if (!session) return;
    const ready = await helperRequest(session, '/status');
    cliReady = !!ready.capabilities?.includes('usb-media');
  } catch { cliReady = false; }
  render();
}

function showDrivePrompt(text = 'Choose an ISO above', image = null) {
  usb.replaceChildren(
    ...(image ? [h('p', { className: 'usb-selected-image', textContent: `${OS.name} ${OS.version} · ${selectedEdition.name} · ${image.arch} · ${image.url.split('/').pop()} · ${sizes(image.size)}` })] : []),
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
  const image = osImage(imageId);
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
    if (!account?.user?.id) throw Object.assign(Error('Sign in to ROMinit to connect the CLI.'), { hint: signInHint(account?.providers) });
    const session = await ensureHelper(account.user.id, helperSession()).catch(error => { throw Object.assign(error, { hint: cliHint() }); });
    const ready = await helperRequest(session, '/status').catch(error => { throw Object.assign(error, { hint: cliHint() }); });
    if (ready.user?.id !== account.user.id) throw Error('The CLI belongs to a different account. Reconnect it.');
    if (!ready.capabilities?.includes('usb-media')) {
      status.replaceChildren('USB preparation is not enabled in this CLI. ', h('a', { href: './?view=cli#usb-setup', textContent: 'Set up the Ventoy USB support' }));
      return;
    }
    if (!ready.capabilities?.includes('usb-images')) {
      status.replaceChildren('This CLI needs an update for image selection. ', h('a', { href: './rominit-cli.tar.gz', textContent: 'Download updated CLI' }), ' and restart rominit serve.');
      return;
    }
    cliReady = true; render();
    status.textContent = `${OS.name} ${OS.version} · ${selectedEdition.name} · ${image.arch}. Choose Ventoy or Direct write, select the USB drive, then review.`;
    usb.replaceChildren(usbMediaPanel(session, h, image.id, ready.capabilities));
  } catch (error) {
    cliReady = false; render();
    status.replaceChildren(error instanceof Error ? error.message : String(error), ...(error?.hint ? [' ', ...error.hint] : []));
  } finally { connecting = false; }
}

function render() {
  editionSelect.value = selectedEdition.id;
  document.getElementById('alpine-edition-description').textContent = selectedEdition.description;
  document.getElementById('alpine-edition-note').textContent = selectedEdition.usbNote;
  images.replaceChildren(...selectedEdition.images.map(image => h('article', { className: 'alpine-image', id: image.id },
    h('div', { className: 'alpine-image-title' }, h('span', { className: 'architecture-tag', textContent: ARCH_FAMILY[image.arch] }), h('strong', { textContent: image.arch }), h('span', { className: `architecture-tag${image.usb === true ? ' ventoy-supported' : ''}`, textContent: image.usb === true ? 'Ventoy supported' : 'No Ventoy' }), h('span', { className: 'alpine-image-size', textContent: `${image.format} · ${sizes(image.size)}` }), h('a', { href: `${image.url}.sha256`, target: '_blank', rel: 'noopener noreferrer', textContent: 'SHA-256' })),
    h('div', { className: 'alpine-image-actions' }, ['iso', 'img.gz'].includes(image.format)
      ? h('button', { type: 'button', className: 'button button-primary alpine-main-action', textContent: cliReady ? 'Prepare USB' : 'Connect CLI', ariaLabel: `${cliReady ? 'Prepare' : 'Connect CLI for'} ${selectedEdition.name} ${image.arch} USB`, onclick: () => chooseImage(image.id) })
      : h('span', { className: 'field-help', textContent: 'Download · platform-specific setup' }),
      h('a', { className: 'button button-secondary', href: image.url, textContent: 'Download' }),
      h('a', { className: 'button button-secondary', href: OS.source, target: '_blank', rel: 'noopener noreferrer', textContent: 'Source' })))));
}
editionSelect.addEventListener('change', () => {
  if (busy()) { editionSelect.value = selectedEdition.id; status.textContent = 'Wait for the current USB operation to finish before changing edition.'; return; }
  selectedEdition = OS.editions.find(edition => edition.id === editionSelect.value) ?? OS.editions[0];
  showDrivePrompt(); status.textContent = ''; updateUrl(); render();
});

render();
const initialImage = osImage(params.get('image') ?? '');
if (['iso', 'img.gz'].includes(initialImage?.format) && selectedEdition.images.includes(initialImage)) void chooseImage(initialImage.id);
void probeCli();
void mountAccount();
