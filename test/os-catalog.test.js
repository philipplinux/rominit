import assert from 'node:assert/strict';
import test from 'node:test';
import { OSES } from '../src/os/index.js';
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

test('every OS record is complete and its artifacts are pinned to the publisher', () => {
  assert.ok(OSES.length >= 2, 'the template is proven by more than one OS');
  assert.equal(new Set(OSES.map(os => os.id)).size, OSES.length, 'OS ids are unique');
  for (const os of OSES) {
    assert.match(os.id, /^[a-z0-9-]+$/);
    assert.ok(os.name && os.shortName && os.version && os.releaseDate && os.source);
    assert.equal(new URL(os.source).protocol, 'https:');
    assert.ok(os.editions.length, `${os.id} has editions`);
    assert.ok(os.editions.some(edition => edition.id === os.defaultEdition), `${os.id} default edition exists`);
    assert.ok(os.page.description && os.page.eyebrow && os.page.intro && os.page.status && os.page.checked);
    assert.ok(os.page.pros.length && os.page.cons.length);
    assert.ok(os.page.links.length && os.page.footer.length && os.page.credits.length);
    assert.ok(os.page.logo.src && os.page.shot.src && os.page.shot.alt);
    const images = os.editions.flatMap(edition => edition.images);
    assert.equal(new Set(images.map(image => image.id)).size, images.length, `${os.id} image ids are unique`);
    for (const image of images) {
      assert.ok(image.id.startsWith(`${os.id}-`), `${image.id} is namespaced by OS`);
      const url = new URL(image.url);
      assert.equal(url.protocol, 'https:');
      assert.ok(!url.username && !url.password, `${image.id} has no credentials in its URL`);
      assert.match(image.sha256, /^[a-f0-9]{64}$/, `${image.id} pins a SHA-256`);
      assert.ok(Number.isSafeInteger(image.size) && image.size > 0, `${image.id} pins a size`);
      assert.match(image.format, /^(iso|img\.gz|tar\.gz)$/);
      assert.equal(typeof image.usb, 'boolean');
      assert.equal(osImage(image.id), image, `${image.id} resolves`);
    }
  }
});

test('a stock preview photo carries its author, source and licence', () => {
  for (const os of OSES) {
    const photo = os.page.shot.photo;
    if (!photo) continue; // an OS may show its own recording instead
    assert.ok(photo.artist, `${os.id}: the photo names its author`);
    assert.match(photo.page, /^https:\/\/commons\.wikimedia\.org\//, `${os.id}: the photo links its Commons page`);
    assert.match(photo.license, /^(CC0|CC BY(-SA)? [\d.]+)$/, `${os.id}: the photo states a Creative Commons licence`);
    assert.ok(os.page.credits.some(credit => credit.includes(photo.artist) && credit.includes(photo.license)),
      `${os.id}: the photo is credited in the notices`);
  }
});
