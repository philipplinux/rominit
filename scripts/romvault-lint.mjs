// ROMvault lint: enforces romvault/AGENTS.md (frontmatter, tags, signposts, links, index, dated claims, log format, a page per catalog device and ROM).
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
    if (fm.updated < fm.date) say(file, 'frontmatter: updated is before date');
    if (['rom', 'project'].includes(fm.type) && !/\b(as of|checked|fetched) \d{4}-\d{2}/i.test(text)) say(file, 'no dated claim: add "(as of YYYY-MM)", "checked" or "fetched YYYY-MM-DD" to versions and support status');
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
    if (['device', 'vendor', 'project'].includes(fm.type) && !/\]\(https?:/.test(text.split('\n## Sources\n')[1]?.split('\n## ')[0] ?? '')) say(file, 'no "## Sources" resource map with links (AGENTS.md › Writing rules 7)');
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
  for (const f of readdirSync(join(ROOT, 'catalog/roms'), { recursive: true }).filter(f => String(f).endsWith('.json'))) {
    const entry = JSON.parse(readFileSync(join(ROOT, 'catalog/roms', String(f)), 'utf8'));
    for (const rom of entry.roms) if (!pages.has(join(VAULT, 'roms', entry.device, `${rom.id}.md`))) problems.push(`romvault/roms/${entry.device}/${rom.id}.md: missing (catalog has ${rom.name})`);
  }
  const log = pages.get(join(VAULT, 'log.md')) ?? '';
  for (const line of log.split('\n').filter(l => l.startsWith('## ') && !l.startsWith('## For future agent')))
    if (!/^## \[\d{4}-\d{2}-\d{2}\] (create|update|move|delete) \| .+ \(.+\)$/.test(line)) problems.push(`romvault/log.md: malformed entry "${line.slice(0, 60)}"`);
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
  // Optional path prefixes (`node scripts/romvault-lint.mjs romvault/roms/starlte`): a team checks only its own pages.
  const only = process.argv.slice(2);
  const problems = lint().filter(p => !only.length || only.some(o => p.startsWith(o.replace(/\/$/, ''))));
  for (const p of problems) console.log(p);
  console.log(problems.length ? `✗ ${problems.length} problems` : '✓ ROMvault clean');
  process.exitCode = problems.length ? 1 : 0;
}
