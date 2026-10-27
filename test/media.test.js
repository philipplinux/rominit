import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

// Pictures ship as reviewed local copies: a swapped or hotlinked file must fail here, not reach the site.
const SITE = new URL('../site/', import.meta.url);
const MEDIA_DIRS = ['logos', 'shots', 'devices', 'consoles', 'avatars'];
const MAGIC = { webp: b => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP', png: b => b.readUInt32BE(0) === 0x89504e47,
  jpg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, gif: b => /^GIF8[79]a/.test(b.toString('latin1', 0, 6)) };
// An SVG may draw, never run or fetch: no script, event handler, embedded HTML, entity or outside reference.
const SVG_UNSAFE = /<script|\son[a-z]+\s*=|<foreignObject|<!ENTITY|<!DOCTYPE|javascript:|data:text|(?:xlink:)?href\s*=\s*["'](?!#)|url\(\s*["']?(?!#)|@import|<(?:iframe|embed|object)\b/i;

const files = MEDIA_DIRS.flatMap(dir => readdirSync(new URL(dir, SITE), { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => `${e.parentPath.slice(new URL(SITE).pathname.length)}/${e.name}`));

test('every site media file is an allowed type whose bytes match its extension', () => {
  assert.ok(files.length > 50);
  for (const file of files) {
    const ext = file.split('.').pop().toLowerCase().replace('jpeg', 'jpg'), bytes = readFileSync(new URL(file, SITE));
    if (ext === 'svg') assert.doesNotMatch(bytes.toString('utf8'), SVG_UNSAFE, `${file}: SVG with script, handler or outside reference`);
    else assert.ok(MAGIC[ext]?.(bytes), `${file}: not a ${ext} file (allowed: svg webp png jpg gif)`);
  }
});

test('every catalog picture is a local file under a site media folder', () => {
  const refs = [];
  const walk = (value, key) => {
    if (typeof value === 'string' && ['src', 'avatar'].includes(key)) refs.push(value);
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  for (const f of readdirSync(new URL('../catalog/', import.meta.url), { recursive: true })) if (String(f).endsWith('.json')) walk(JSON.parse(readFileSync(new URL(`../catalog/${f}`, import.meta.url), 'utf8')));
  assert.ok(refs.length > 50);
  for (const ref of refs) {
    const path = ref.replace(/^\.\//, '');
    assert.ok(!/^[a-z][a-z0-9+.-]*:|^\/|(^|\/)\.\.(\/|$)/i.test(path) && MEDIA_DIRS.includes(path.split('/')[0]), `${ref}: pictures must be local copies under site/{${MEDIA_DIRS}}/, never a URL`);
    assert.ok(existsSync(new URL(path, SITE)), `${ref}: file missing`);
  }
});
