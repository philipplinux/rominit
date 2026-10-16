// ROMvault lint: enforces romvault/AGENTS.md (frontmatter, tags, signposts, links, index, one device page per catalog codename).
// `npm run lint` prints problems; test/rominit.test.js fails on any.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = join(ROOT, 'romvault');
const TYPES = ['vendor', 'project', 'series', 'device', 'rom', 'scraping', 'skill', 'index', 'log'];
const FOLDER_TYPE = { vendors: 'vendor', projects: 'project', series: 'series', devices: 'device', roms: 'rom', scraping: 'scraping' };
const MAX_LINES = 200;

/** @param {string} dir @returns {string[]} */
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name.startsWith('.') ? [] : e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : []);

/** Flat YAML subset: `key: value`, `key: [a, b]`, quoted strings. @param {string} text */
export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  /** @type {Record<string, any>} */
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*?)\s*(#.*)?$/);
    if (!kv) continue;
    const raw = kv[2];
    const unq = (/** @type {string} */ s) => s.trim().replace(/^"(.*)"$/, '$1');
    out[kv[1]] = raw.startsWith('[') ? raw.slice(1, -1).split(',').map(unq).filter(Boolean) : unq(raw);
  }
  return out;
}

/** Controlled tags from the `## Tags` section of AGENTS.md. */
const allowedTags = () => {
  const section = readFileSync(join(VAULT, 'AGENTS.md'), 'utf8').split('\n## Tags')[1].split('\n## ')[0];
  return new Set([...section.matchAll(/^- \*\*[^*]+:\*\* (.+)$/gm)].flatMap(m => [...m[1].matchAll(/`([a-z0-9-]+)`/g)].map(t => t[1])));
};

/** @returns {string[]} problems, empty when the vault is clean */
export function lint() {
  const problems = /** @type {string[]} */ ([]);
  const say = (/** @type {string} */ file, /** @type {string} */ text) => problems.push(`${relative(ROOT, file)}: ${text}`);
  const tags = allowedTags();
  const files = walk(VAULT).filter(f => !relative(VAULT, f).startsWith('skills/') && relative(VAULT, f) !== 'AGENTS.md'); // rules file and skills keep harness format
  const pages = new Map(files.map(f => [f, readFileSync(f, 'utf8')]));
  const readme = pages.get(join(VAULT, 'README.md')) ?? '';
  const exists = (/** @type {string} */ rel) => existsSync(join(VAULT, rel));
  /** Resolved local link targets of a page. @param {string} file */
  const links = file => [...(pages.get(file) ?? '').matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)].map(m => m[1]).filter(h => !/^[a-z]+:/.test(h)).map(h => resolve(dirname(file), decodeURI(h)));
  const linksTo = (/** @type {string} */ from, /** @type {string} */ to) => links(from).includes(to);

  for (const [file, text] of pages) {
    const rel = relative(VAULT, file);
    const fm = frontmatter(text);
    if (!fm) { say(file, 'no frontmatter'); continue; }
    for (const key of ['type', 'title', 'date', 'updated']) if (!fm[key]) say(file, `frontmatter: missing ${key}`);
    if (!TYPES.includes(fm.type)) say(file, `frontmatter: type "${fm.type}" not one of ${TYPES.join(', ')}`);
    const folder = rel.split('/')[0];
    if (FOLDER_TYPE[folder] && fm.type !== FOLDER_TYPE[folder]) say(file, `frontmatter: type should be ${FOLDER_TYPE[folder]} in ${folder}/`);
    for (const key of ['date', 'updated']) if (fm[key] && !/^\d{4}-\d{2}-\d{2}$/.test(fm[key])) say(file, `frontmatter: ${key} is not YYYY-MM-DD`);
    for (const tag of fm.tags ?? []) {
      const nested = tag.match(/^(device|series)\/(.+)$/);
      if (nested ? !exists(`${nested[1] === 'device' ? 'devices' : 'series'}/${nested[2]}.md`) : !tags.has(tag)) say(file, `tag "${tag}" not in the AGENTS.md list (or its page is missing)`);
    }
    if (['rom', 'device', 'series'].includes(fm.type) && !(fm.aliases ?? []).length) say(file, 'frontmatter: aliases (the full phone name) missing');
    if (!text.includes('\n## For future agent\n')) say(file, 'missing "## For future agent"');
    if (text.split('\n').length > MAX_LINES) say(file, `over ${MAX_LINES} lines: split it`);
    for (const target of links(file)) if (!existsSync(target)) say(file, `broken link ${relative(dirname(file), target)}`);
    if (rel !== 'README.md' && !readme.includes(`](${rel})`)) say(file, 'not listed in README.md');
    if (['rom', 'device', 'series'].includes(fm.type) && !/\n## Links\n/.test(text)) say(file, 'missing "## Links"');
  }

  // The net: ROM ↔ device ↔ series ↔ vendor, both directions; every catalog device has a page.
  const catalogDevices = readdirSync(join(ROOT, 'catalog/devices')).flatMap(v => readdirSync(join(ROOT, 'catalog/devices', v)).map(f => JSON.parse(readFileSync(join(ROOT, 'catalog/devices', v, f), 'utf8'))));
  for (const d of catalogDevices) {
    const page = join(VAULT, 'devices', `${d.codename}.md`);
    if (!pages.has(page)) { problems.push(`romvault/devices/${d.codename}.md: missing (catalog has ${d.vendor} ${d.name})`); continue; }
    const fm = frontmatter(pages.get(page) ?? '') ?? {};
    const parents = [...pages.keys()].filter(f => relative(VAULT, f).startsWith('series/') && linksTo(f, page));
    if (!parents.length) problems.push(`romvault/devices/${d.codename}.md: no series page lists it`);
    for (const s of parents) if (!linksTo(page, s)) say(page, `does not link up to ${relative(VAULT, s)}`);
    if (!(fm.tags ?? []).includes(`device/${d.codename}`)) say(page, `tag device/${d.codename} missing`);
  }
  for (const [file, text] of pages) {
    const rel = relative(VAULT, file);
    const fm = frontmatter(text) ?? {};
    if (fm.type === 'rom') {
      const codename = rel.split('/')[1];
      const device = join(VAULT, 'devices', `${codename}.md`);
      if (!linksTo(file, device)) say(file, `does not link up to devices/${codename}.md`);
      if (pages.has(device) && !linksTo(device, file)) say(device, `does not list ${rel}`);
      if (!(fm.tags ?? []).includes(`device/${codename}`)) say(file, `tag device/${codename} missing`);
      if (!links(file).some(f => f.includes('/catalog/roms/'))) say(file, 'no link to its catalog JSON');
    }
    if (fm.type === 'series') {
      const vendors = [...pages.keys()].filter(f => relative(VAULT, f).startsWith('vendors/') && linksTo(file, f));
      if (!vendors.length) say(file, 'does not link up to a vendor page');
      for (const v of vendors) if (!linksTo(v, file)) say(v, `does not list ${rel}`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = lint();
  for (const p of problems) console.log(p);
  console.log(problems.length ? `✗ ${problems.length} problems` : '✓ ROMvault clean');
  process.exitCode = problems.length ? 1 : 0;
}
