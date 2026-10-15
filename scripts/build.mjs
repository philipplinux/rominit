import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { loadCatalog } from './load-catalog.mjs';

const { devices, errors } = await loadCatalog();
assert(!errors.length, `Catalog problems:\n${errors.join('\n')}`);

await rm('dist', { recursive: true, force: true });
await mkdir('dist/catalog', { recursive: true });
// The page loads the small index first, then one file per picked device.
const index = devices.map(({ codename, vendor, name, models, roms }) => ({ codename, vendor, name, models,
  roms: roms.map(({ id, os, name, version, origin, status, rating }) => ({ id, os, name, version, origin, status, rating })) }));
await writeFile('dist/catalog/index.json', JSON.stringify(index));
for (const device of devices) await writeFile(`dist/catalog/${device.codename}.json`, JSON.stringify(device));

await cp('site/style.css', 'dist/style.css');
await cp('site/logos', 'dist/logos', { recursive: true });
await build({ entryPoints: ['site/app.js'], outfile: 'dist/app.js', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'linked' });
// ?v=<content hash> so a redeploy is picked up despite the host's cache
const version = async file => createHash('sha256').update(await readFile(`dist/${file}`)).digest('hex').slice(0, 10);
let html = await readFile('site/index.html', 'utf8');
for (const file of ['app.js', 'style.css']) html = html.replace(`"./${file}"`, `"./${file}?v=${await version(file)}"`);
assert(html.includes('app.js?v=') && html.includes('style.css?v='), 'asset links not versioned');
await writeFile('dist/index.html', html);

const notices = [];
for (const path of ['android-fastboot/LICENSE', '@zip.js/zip.js/index.js', 'hash-wasm/LICENSE', 'hash-wasm/src/sha256.c',
  '@lineageos-infra/libmjolnir/LICENSE', '@yume-chan/adb/LICENSE', '@yume-chan/adb-daemon-webusb/LICENSE',
  '@yume-chan/adb-credential-web/LICENSE', '@yume-chan/stream-extra/LICENSE', '@yume-chan/struct/LICENSE',
  '@yume-chan/async/LICENSE', '@yume-chan/event/LICENSE', '@yume-chan/no-data-view/LICENSE']) {
  const source = await readFile(`node_modules/${path}`, 'utf8');
  const notice = path.endsWith('LICENSE') ? source : source.match(/^(?:\s*\/\*[\s\S]*?\*\/)+/)?.[0];
  assert(notice && /[Cc]opyright/.test(notice), `Missing third-party notice: ${path}`);
  notices.push(`${path}\n${notice}`);
}
notices.push('logos/postmarketos.svg\npostmarketOS logo, https://gitlab.postmarketos.org/postmarketOS/artwork, CC BY-SA 3.0, by the postmarketOS contributors.');
await writeFile('dist/THIRD-PARTY-NOTICES.txt', notices.join('\n\n'));
console.log(`built dist/: ${devices.length} devices, ${devices.reduce((n, d) => n + d.roms.length, 0)} ROMs`);
