import assert from 'node:assert/strict';
import test from 'node:test';
import { OSES, osImagePinProblems, osPhotoProblems, osRecordProblems } from '../src/os/index.js';
const [alpine, omarchy] = OSES;
import { osArchitectures, osImage, osImageEntry } from '../src/os/index.js';

test('Alpine parent contains eight editions and pinned official architecture artifacts', () => {
  assert.equal(alpine.name, 'Alpine Linux');
  assert.equal(alpine.editions.length, 8);
  assert.deepEqual(alpine.editions[0].images.map(image => image.arch), ['x86', 'x86_64', 'aarch64', 'armv7', 'loongarch64', 'ppc64le', 'riscv64', 's390x']);
  const images = alpine.editions.flatMap(edition => edition.images);
  assert.equal(images.length, 40);
  assert.equal(new Set(images.map(image => image.id)).size, images.length);
  assert.deepEqual(osArchitectures(alpine).sort(), ['aarch64','armhf','armv7','loongarch64','ppc64le','riscv64','s390x','x86','x86_64']);
  for (const image of images) {
    assert.match(image.id, /^alpine-[a-z0-9_-]+$/);
    const url = new URL(image.url);
    assert.equal(url.origin, 'https://dl-cdn.alpinelinux.org');
    assert.ok(url.pathname.includes(`/releases/${image.arch}/`));
    assert.ok(url.pathname.endsWith(`.${image.format}`));
    assert.match(image.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(image.size) && image.size > 0);
    assert.equal(image.usb, image.format === 'iso' && ['x86','x86_64','aarch64'].includes(image.arch));
    assert.equal(osImage(image.id), image);
  }
  assert.equal(osImage('https://example.com/evil.iso'), undefined);
  assert.equal(osImage('../local.iso'), undefined);
  assert.equal(osImage('alpine-standard-x86_64').sha256, '20c026e3a788bfb75fc8b50a54bcc12aee85e3c75909740bba6a6f4563d63296');
});

test('Omarchy pins the official 4.0.6 installer ISO for x86_64', () => {
  assert.equal(omarchy.name, 'Omarchy');
  assert.equal(omarchy.version, '4.0.6');
  assert.equal(omarchy.editions.length, 1);
  const [edition] = omarchy.editions;
  assert.equal(edition.id, omarchy.defaultEdition);
  assert.equal(edition.images.length, 1);
  const [image] = edition.images;
  assert.equal(image.id, 'omarchy-installer-x86_64');
  assert.equal(image.arch, 'x86_64');
  assert.equal(image.format, 'iso');
  assert.equal(image.url, 'https://iso.omarchy.org/omarchy-4.0.6.iso');
  assert.equal(image.sha256, 'b542db5fecc37395d9af6654a8146ebed225f275ae4d5a6fcf432e40afe7bb88');
  assert.equal(image.size, 6448529408);
  assert.equal(image.usb, true);
  assert.deepEqual(osArchitectures(omarchy), ['x86_64']);
  assert.equal(osImage(image.id), image);
  assert.equal(osImageEntry(image.id).os.id, 'omarchy');
  assert.equal(osImageEntry(image.id).edition.id, edition.id);
});

test('every OS record is complete and its artifacts are pinned to the publisher', async () => {
  assert.ok(OSES.length >= 2, 'the template is proven by more than one OS');
  assert.equal(new Set(OSES.map(os => os.id)).size, OSES.length, 'OS ids are unique');
  const { readdirSync } = await import('node:fs'); // browser and Workers bundles have no fs, so OSES imports by hand; this catches a forgotten import
  const files = readdirSync(new URL('../catalog/os', import.meta.url), { recursive: true }).filter(f => String(f).endsWith('.json')).map(f => String(f).split('/').at(-1).slice(0, -5));
  assert.deepEqual(files.sort(), OSES.map(os => os.id).sort(), 'every catalog/os/<group>/<id>.json is imported in src/os/index.js');
  for (const os of OSES) {
    assert.match(os.id, /^[a-z0-9-]+$/);
    assert.ok(os.name && os.shortName && os.version && os.releaseDate && os.source);
    assert.equal(new URL(os.source).protocol, 'https:');
    assert.ok(os.editions.length, `${os.id} has editions`);
    assert.ok(os.editions.some(edition => edition.id === os.defaultEdition), `${os.id} default edition exists`);
    assert.ok(os.page.description && os.page.eyebrow && os.page.intro && os.page.status && os.page.checked);
    assert.ok(os.page.pros.length && os.page.cons.length);
    assert.ok(os.page.links.length && os.page.footer.length && os.page.credits.length);
    assert.deepEqual(osRecordProblems(os), [], `${os.id} record is complete`);
    const images = os.editions.flatMap(edition => edition.images);
    assert.equal(new Set(images.map(image => image.id)).size, images.length, `${os.id} image ids are unique`);
    for (const image of images) {
      assert.ok(image.id.startsWith(`${os.id}-`), `${image.id} is namespaced by OS`);
      const url = new URL(image.url);
      assert.equal(url.protocol, 'https:');
      assert.ok(!url.username && !url.password, `${image.id} has no credentials in its URL`);
      assert.deepEqual(osImagePinProblems(image), [], `${image.id} pins a digest`);
      assert.ok(Number.isSafeInteger(image.size) && image.size > 0, `${image.id} pins a size`);
      assert.match(image.format, /^(iso|img\.gz|tar\.gz)$/);
      assert.equal(typeof image.usb, 'boolean');
      assert.equal(osImage(image.id), image, `${image.id} resolves`);
    }
  }
});

test('a stock preview photo carries its author, source and licence', () => {
  for (const os of OSES) {
    const photo = os.page.shot?.photo;
    if (!photo) continue; // an OS may show its own recording or no preview at all
    assert.deepEqual(osPhotoProblems(photo), [], `${os.id}: the photo carries its author, source and licence`);
    assert.ok(os.page.credits.some(credit => credit.includes(photo.artist) && credit.includes(photo.license)),
      `${os.id}: the photo is credited in the notices`);
  }
});

test('every OS and emulator record says whether official support is ongoing or dropped', async () => {
  const { officialSupportProblems } = await import('../src/catalog.js');
  const { EMULATORS } = await import('../src/emulators/index.js');
  for (const entry of [...OSES, ...EMULATORS]) assert.deepEqual(officialSupportProblems(entry.officialSupport), [], entry.id);
});

test('an OS image may pin SHA-512 when the publisher ships no SHA-256', () => {
  const base = { id: 'x-image-x86_64', arch: 'x86_64', format: 'iso', url: 'https://example.com/x.iso', size: 1, usb: false };
  assert.deepEqual(osImagePinProblems({ ...base, sha512: 'a'.repeat(128), sha512Url: 'https://example.com/SHA512SUMS' }), []);
  assert.deepEqual(osImagePinProblems({ ...base, sha256: 'b'.repeat(64), sha256Url: 'https://example.com/SHA256SUMS' }), []);
  assert.deepEqual(osImagePinProblems({ ...base, sha256: 'b'.repeat(64), sha256Url: 'https://example.com/SHA256SUMS', sha512: 'a'.repeat(128), sha512Url: 'https://example.com/SHA512SUMS' }), []);
});

test('a pin with neither digest, a wrong-length digest or a bare checksum url fails', () => {
  const base = { id: 'x-image-x86_64', arch: 'x86_64', format: 'iso', url: 'https://example.com/x.iso', size: 1, usb: false };
  assert.match(osImagePinProblems(base).join(' '), /needs a sha256 or sha512/);
  assert.match(osImagePinProblems({ ...base, sha256: 'b'.repeat(63) }).join(' '), /sha256 must be 64/);
  assert.match(osImagePinProblems({ ...base, sha512: 'a'.repeat(127) }).join(' '), /sha512 must be 128/);
  assert.match(osImagePinProblems({ ...base, sha256Url: 'https://example.com/SHA256SUMS' }).join(' '), /sha256Url needs an https url and a sha256 pin/);
  assert.match(osImagePinProblems({ ...base, sha256: 'b'.repeat(64), sha256Url: 'http://example.com/x' }).join(' '), /https/);
});

test('an OS record may ship logo-only when no screenshot can be licensed', () => {
  const record = {
    id: 'x-os', name: 'X OS', shortName: 'X', defaultEdition: 'one', version: '1', releaseDate: '2026-01-01', source: 'https://example.com/',
    editions: [{ id: 'one', name: 'One', description: 'd', usbNote: 'u', images: [{ id: 'x-os-one-x86_64', arch: 'x86_64', format: 'iso', url: 'https://example.com/x.iso', sha256: 'b'.repeat(64), size: 1, usb: false }] }],
    page: { description: 'd', eyebrow: 'e', intro: 'i', status: 's', checked: '2026-10-27', pros: ['p'], cons: ['c'], links: [{ label: 'l', href: 'https://example.com/' }], footer: [{ label: 'f', href: 'https://example.com/' }], credits: ['logo'], logo: { src: 'logos/x.svg', alt: 'X', width: 1, height: 1 } },
  };
  assert.deepEqual(osRecordProblems(record), []);
  assert.match(osRecordProblems({ ...record, page: { ...record.page, shot: { src: 'shots/x.webp', alt: '' } } }).join(' '), /shot needs src and alt/);
  assert.match(osRecordProblems({ ...record, page: { ...record.page, logo: {} } }).join(' '), /a logo is required/);
});

test('a publisher screenshot carries its source page, artist and the terms the site states', () => {
  assert.deepEqual(osPhotoProblems({ page: 'https://www.example-os.org/screenshots/desktop', license: 'Publisher screenshot (site terms)', artist: 'Example OS project' }), []);
  assert.deepEqual(osPhotoProblems({ page: 'https://www.example-os.org/screenshots/desktop', license: 'Publisher screenshot, terms not stated', artist: 'Example OS project' }), []);
  assert.deepEqual(osPhotoProblems({ page: 'https://www.example-os.org/screenshot.png', license: 'Publisher screenshot', artist: 'Example OS project' }), []);
  assert.match(osPhotoProblems({ page: 'https://www.example-os.org/x', license: 'Publisher screenshot (site terms)' }).join(' '), /artist/);
  assert.deepEqual(osPhotoProblems({ page: 'https://www.example-os.org/x', license: 'Publisher screenshot (site terms)', artist: 'A' }), []);
  assert.match(osPhotoProblems({ license: 'Publisher screenshot (site terms)', artist: 'A' }).join(' '), /https/);
  assert.match(osPhotoProblems({ page: 'https://www.example-os.org/x', artist: 'A' }).join(' '), /licence|publisher/);
  assert.match(osPhotoProblems({ page: 'https://www.example-os.org/x', license: 'All rights reserved', artist: 'A' }).join(' '), /licence|publisher/);
});

test('a screenshot may be credited under GPL/LGPL/MPL/FDL, not only Creative Commons', () => {
  assert.deepEqual(osPhotoProblems({ page: 'https://example.com/shot', license: 'GPL 2.0', artist: 'Someone' }), []);
  assert.deepEqual(osPhotoProblems({ page: 'https://commons.wikimedia.org/wiki/File:X', license: 'LGPL 3.0', artist: 'Someone' }), []);
  assert.deepEqual(osPhotoProblems({ page: 'https://example.com/shot', license: 'MPL 2.0', artist: 'Someone' }), []);
  assert.deepEqual(osPhotoProblems({ page: 'https://example.com/shot', license: 'FDL 1.3', artist: 'Someone' }), []);
  assert.deepEqual(osPhotoProblems({ page: 'https://commons.wikimedia.org/wiki/File:X', license: 'CC BY-SA 4.0', artist: 'Someone' }), []);
  assert.match(osPhotoProblems({ page: 'https://example.com/shot', license: 'all rights reserved', artist: 'Someone' }).join(' '), /licence/);
  assert.match(osPhotoProblems({ page: 'http://example.com/shot', license: 'GPL 2.0', artist: 'Someone' }).join(' '), /https/);
  assert.match(osPhotoProblems({ page: 'https://example.com/shot', license: 'GPL 2.0' }).join(' '), /artist/);
});

test('a SHA-512 pin is verified with SHA-512 and a mismatch names the algorithm', async () => {
  const { verifyPins } = await import('../src/hash.js');
  const { createHash } = await import('node:crypto');
  const body = 'digest me';
  const good = createHash('sha512').update(body).digest('hex');
  const file = new File([body], 'image.iso');
  assert.equal((await verifyPins([{ name: 'image.iso', sha512: good, file }], () => {}))['image.iso'], good);
  const bad = createHash('sha512').update('other').digest('hex');
  await assert.rejects(verifyPins([{ name: 'image.iso', sha512: bad, file }], () => {}), /SHA-512 mismatch/);
  await assert.rejects(verifyPins([{ name: 'image.iso', sha256: 'b'.repeat(64), file }], () => {}), /SHA-256 mismatch/);
});

const fixtureRecord = () => ({
  id: 'x-os', name: 'X OS', shortName: 'X', defaultEdition: 'one', version: '1', releaseDate: '2026-01-01', source: 'https://example.com/',
  editions: [{ id: 'one', name: 'One', description: 'd', usbNote: 'u', images: [{ id: 'x-os-one-x86_64', arch: 'x86_64', format: 'iso', url: 'https://example.com/x.iso', sha256: 'b'.repeat(64), size: 1, usb: false }] }],
  page: { description: 'd', eyebrow: 'e', intro: 'i', status: 's', checked: '2026-10-27', pros: ['p'], cons: ['c'], links: [{ label: 'l', href: 'https://example.com/' }], footer: [{ label: 'f', href: 'https://example.com/' }], credits: ['logo'], logo: { src: 'logos/x.svg', alt: 'X', width: 1, height: 1 } },
});

test('a computed SHA-256 pin passes and needs the date but no publisher url', () => {
  const image = { id: 'x-image-x86_64', arch: 'x86_64', format: 'iso', url: 'https://example.com/x.iso', sha256: 'b'.repeat(64), sha256Computed: '2026-10-27', size: 1, usb: false };
  assert.deepEqual(osImagePinProblems(image), []);
  assert.match(osImagePinProblems({ ...image, sha256Computed: 'October 2026' }).join(' '), /sha256Computed must be an ISO date/);
  assert.match(osImagePinProblems({ ...image, sha256Computed: undefined }).join(' '), /^$/);
  assert.match(osImagePinProblems({ ...image, sha256Url: 'https://example.com/SHA256SUMS' }).join(' '), /computed sha256 has no publisher checksum url/);
  assert.match(osImagePinProblems({ ...image, sha256: undefined }).join(' '), /sha256Computed needs a sha256 pin/);
});

test('an info-only record passes with empty editions and no default edition', () => {
  const record = { ...fixtureRecord(), infoOnly: true, editions: [] };
  delete record.defaultEdition;
  assert.deepEqual(osRecordProblems(record), []);
});

test('an info-only record with editions or images fails', () => {
  const record = { ...fixtureRecord(), infoOnly: true };
  assert.match(osRecordProblems(record).join(' '), /an info-only record carries no editions/);
  const withDefault = { ...fixtureRecord(), infoOnly: true, editions: [] };
  assert.match(osRecordProblems(withDefault).join(' '), /no defaultEdition/);
  const noLinks = { ...fixtureRecord(), infoOnly: true, editions: [], page: { ...fixtureRecord().page, links: [] } };
  assert.match(osRecordProblems(noLinks).join(' '), /an info-only record needs links/);
});

test('a normal record still needs editions', () => {
  const record = { ...fixtureRecord(), editions: [] };
  assert.match(osRecordProblems(record).join(' '), /needs editions/);
});
