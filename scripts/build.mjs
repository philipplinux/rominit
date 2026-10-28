import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { loadCatalog } from './load-catalog.mjs';
import { OSES, osPhotoProblems } from '../src/os/index.js';
import { CONSOLES } from '../src/consoles/index.js';
import { EMULATORS } from '../src/emulators/index.js';
import { GPUS } from '../src/gpus/index.js';

const { devices, errors } = await loadCatalog();
assert(!errors.length, `Catalog problems:\n${errors.join('\n')}`);

await rm('dist', { recursive: true, force: true });
await mkdir('dist/catalog', { recursive: true });
await mkdir('dist/catalog/consoles', { recursive: true });
// Ship only runtime source and metadata; credentials stay in the OS store.
execFileSync('tar', ['-czf', 'dist/rominit-cli.tar.gz', '--transform=s,^,rominit-cli/,', 'bin', 'src', 'scripts', 'catalog', 'site/bench', 'package.json', 'package-lock.json', 'README.md', 'LICENSE']);
// The page loads the small index first, then one file per picked device.
const index = devices.map(({ codename, category, vendor, name, series, family, variant, unsupported, models, supportOnly, supportUrl, officialSupport, roms }) => ({ codename, category, vendor, name, series, family, variant, unsupported, models, supportOnly, supportUrl, officialSupport,
  roms: roms.filter(r => r.origin !== 'stock').map(({ id, os, name, version, origin, status, vetting, recommended, pick, risk, rating, external }) => ({ id, os, name, version, origin, status, vetting, recommended, pick, risk, rating, external: !!external })) }));
await writeFile('dist/catalog/index.json', JSON.stringify(index));
for (const device of devices) await writeFile(`dist/catalog/${device.codename}.json`, JSON.stringify(device));
for (const console of CONSOLES) await writeFile(`dist/catalog/consoles/${console.id}.json`, JSON.stringify(console));

await cp('site/style.css', 'dist/style.css');
await cp('site/_headers', 'dist/_headers');

await cp('site/logos', 'dist/logos', { recursive: true });
await cp('site/shots', 'dist/shots', { recursive: true });
await cp('site/devices', 'dist/devices', { recursive: true });
await cp('site/avatars', 'dist/avatars', { recursive: true });
await cp('site/consoles', 'dist/consoles', { recursive: true });
await cp('site/bench', 'dist/bench', { recursive: true });
await writeFile('dist/404.html', '<!doctype html><meta charset="utf-8"><title>Not found · ROMinit</title><p>Not found. <a href="/">ROMinit</a></p>\n'); // without it Pages answers every missing path with index.html
await build({ entryPoints: ['site/app.js'], outfile: 'dist/app.js', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'linked' });
await build({ entryPoints: ['site/os.js'], outfile: 'dist/os.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'linked' });
await build({ entryPoints: ['site/emulator.js'], outfile: 'dist/emulator.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'linked' });
await build({ entryPoints: ['site/console.js'], outfile: 'dist/console.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'linked' });
await build({ entryPoints: ['site/gpu.js'], outfile: 'dist/gpu.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'linked' });
// ?v=<content hash> so a redeploy is picked up despite the host's cache
const version = async file => createHash('sha256').update(await readFile(`dist/${file}`)).digest('hex').slice(0, 10);
let html = await readFile('site/index.html', 'utf8');
for (const file of ['app.js', 'style.css']) html = html.replace(`"./${file}"`, `"./${file}?v=${await version(file)}"`);
assert(html.includes('app.js?v=') && html.includes('style.css?v='), 'asset links not versioned');
await writeFile('dist/index.html', html);

// One page per OS from the template; id, title and description are stamped in so no-JS and crawlers get them
const esc = text => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const osTemplate = await readFile('site/os.html', 'utf8');
for (const file of ['os.js', 'style.css']) assert(osTemplate.includes(`"./${file}"`), `os.html lacks ${file}`);
for (const os of OSES) {
  let osHtml = osTemplate;
  for (const file of ['os.js', 'style.css']) osHtml = osHtml.replace(`"./${file}"`, `"./${file}?v=${await version(file)}"`);
  // A missing logo or shot would ship a broken page, so the build stops instead. A logo-only OS has no shot.
  for (const asset of [os.page.logo.src, os.page.shot?.src].filter(Boolean)) assert(existsSync(`site/${asset}`), `${os.id}: missing site/${asset}`);
  // A screenshot must say who took it, where it came from and under which licence.
  const photo = os.page.shot?.photo;
  if (photo) assert.deepEqual(osPhotoProblems(photo), [], `${os.id}: ${osPhotoProblems(photo).join('; ')}`);
  const stamp = { ID: os.id, NAME: os.name, DESCRIPTION: os.page.description, SOURCE: os.source };
  await writeFile(`dist/${os.id}.html`, osHtml.replace(/__([A-Z]+)__/g, (_, key) => esc(stamp[key])));
}

// Console pages share one research template; the catalog owns facts and sources, not flash recipes.
const consoleTemplate = await readFile('site/console.html', 'utf8');
for (const file of ['console.js', 'style.css']) assert(consoleTemplate.includes(`"./${file}"`), `console.html lacks ${file}`);
for (const console of CONSOLES) {
  let consoleHtml = consoleTemplate;
  for (const file of ['console.js', 'style.css']) consoleHtml = consoleHtml.replace(`"./${file}"`, `"./${file}?v=${await version(file)}"`);
  const stamp = { ID: console.id, NAME: console.name, DESCRIPTION: console.summary };
  await writeFile(`dist/${console.id}.html`, consoleHtml.replace(/__([A-Z]+)__/g, (_, key) => esc(stamp[key])));
}

// Emulator pages share one template the same way; ids must not collide with console or OS pages.
const emulatorTemplate = await readFile('site/emulator.html', 'utf8');
for (const file of ['emulator.js', 'style.css']) assert(emulatorTemplate.includes(`"./${file}"`), `emulator.html lacks ${file}`);
for (const emulator of EMULATORS) {
  assert(![...OSES, ...CONSOLES].some(other => other.id === emulator.id), `${emulator.id}: page id already used`);
  let emulatorHtml = emulatorTemplate;
  for (const file of ['emulator.js', 'style.css']) emulatorHtml = emulatorHtml.replace(`"./${file}"`, `"./${file}?v=${await version(file)}"`);
  const stamp = { ID: emulator.id, NAME: emulator.name, DESCRIPTION: emulator.summary };
  await writeFile(`dist/${emulator.id}.html`, emulatorHtml.replace(/__([A-Z]+)__/g, (_, key) => esc(stamp[key])));
}

// GPU pages: same template stamping; ids must not collide with any other page.
const gpuTemplate = await readFile('site/gpu.html', 'utf8');
for (const file of ['gpu.js', 'style.css']) assert(gpuTemplate.includes(`"./${file}"`), `gpu.html lacks ${file}`);
for (const gpu of GPUS) {
  assert(![...OSES, ...CONSOLES, ...EMULATORS].some(other => other.id === gpu.id), `${gpu.id}: page id already used`);
  let gpuHtml = gpuTemplate;
  for (const file of ['gpu.js', 'style.css']) gpuHtml = gpuHtml.replace(`"./${file}"`, `"./${file}?v=${await version(file)}"`);
  const stamp = { ID: gpu.id, NAME: gpu.name, DESCRIPTION: gpu.summary };
  await writeFile(`dist/${gpu.id}.html`, gpuHtml.replace(/__([A-Z]+)__/g, (_, key) => esc(stamp[key])));
}

const notices = OSES.flatMap(os => os.page.credits);
for (const console of CONSOLES) for (const media of Object.values(console.media)) {
  assert(existsSync(`site/${media.src}`), `missing ${media.src}`);
  notices.push(`${media.src}\n${media.artist}, ${media.page}, ${media.license}.`);
}
for (const path of ['android-fastboot/LICENSE', '@zip.js/zip.js/index.js', 'hash-wasm/LICENSE', 'hash-wasm/src/sha256.c', '@napi-rs/keyring/LICENSE',
  '@lineageos-infra/libmjolnir/LICENSE', '@yume-chan/adb/LICENSE', '@yume-chan/adb-daemon-webusb/LICENSE',
  '@yume-chan/adb-credential-web/LICENSE', '@yume-chan/stream-extra/LICENSE', '@yume-chan/struct/LICENSE',
  '@yume-chan/async/LICENSE', '@yume-chan/event/LICENSE', '@yume-chan/no-data-view/LICENSE']) {
  const source = await readFile(`node_modules/${path}`, 'utf8');
  const notice = path.endsWith('LICENSE') ? source : source.match(/^(?:\s*\/\*[\s\S]*?\*\/)+/)?.[0];
  assert(notice && /[Cc]opyright/.test(notice), `Missing third-party notice: ${path}`);
  notices.push(`${path}\n${notice}`);
}
notices.push('logos/{android,eos,lineageos,xda}.svg\nSimple Icons (CC0), https://simpleicons.org; the marks belong to Google, the /e/ Foundation, the LineageOS project and XDA, shown only to name them. logos/twrp.svg is our own monogram.');
notices.push('logos/{ubuntu,fedora,debian,linux-mint,arch-linux}.svg\nSimple Icons (CC0), https://simpleicons.org; the marks belong to Canonical, the Fedora Project (Red Hat), Software in the Public Interest, Linux Mint and Arch Linux, shown only to name them.');
notices.push(`shots/grapheneos/android17-ui.gif
GrapheneOS Android 17 UI preview, assembled from the home screenshot and an enlarged detail of its default apps. Phone screenshot; not an exact-build or tablet capture.
Source: https://commons.wikimedia.org/wiki/File:GrapheneOS_home_screen_Android_17.png
Copyright (c) GrapheneOS developers. MIT License.
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`);
notices.push('logos/postmarketos.svg\npostmarketOS logo, https://gitlab.postmarketos.org/postmarketOS/artwork, CC BY-SA 3.0, by the postmarketOS contributors.');
for (const { photo } of devices) if (photo) {
  assert(existsSync(`site/${photo.src}`), `missing ${photo.src}`);
  notices.push(photo.license === 'press' ? `${photo.src}\nPress image © ${photo.artist}, ${photo.page}; shown only to identify the device, not under this project's license.`
    : `${photo.src}\nPhoto by ${photo.artist}, ${photo.page}, ${photo.license}; resized and converted to WebP${photo.license === 'CC0' ? '' : `, this copy under the same license`}.`);
}
await writeFile('dist/THIRD-PARTY-NOTICES.txt', notices.join('\n\n'));
console.log(`built dist/: ${devices.length} devices, ${devices.reduce((n, d) => n + d.roms.length, 0)} ROMs, ${CONSOLES.length} console families`);
