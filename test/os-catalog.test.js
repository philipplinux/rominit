import assert from 'node:assert/strict';
import test from 'node:test';
import { OSES } from '../src/os/index.js';
const [alpine] = OSES;
import { osArchitectures, osImage } from '../src/os/index.js';

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
