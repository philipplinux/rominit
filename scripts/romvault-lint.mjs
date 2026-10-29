// ROMvault lint: enforces romvault/AGENTS.md (frontmatter, tags, signposts, links, index, dated claims, log format, a page per catalog device and ROM).
// `npm run lint` prints problems; test/rominit.test.js fails on any.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogDevices as devicesInCatalog, romFiles } from './load-catalog.mjs';
import { ARCHIVE, CAP as LOG_CAP } from './romvault-log.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = process.env.ROMVAULT_DIR ? resolve(process.env.ROMVAULT_DIR) : join(ROOT, 'romvault'); // ROMVAULT_DIR: lint a worktree
const TYPES = ['category', 'line', 'vendor', 'project', 'series', 'device', 'soc', 'rom', 'scraping', 'skill', 'index', 'log'];
/** Page type a path demands, undefined when free (topic pages beside a device). @param {string} rel */
const folderType = rel => {
  const [top, a, b, c, d, e] = rel.split('/'), file = rel.split('/').at(-1)?.slice(0, -3);
  if (top === 'devices') return d === 'roms' ? 'rom' : e === undefined && d === `${c}.md` ? 'device' : undefined; // devices/<category>/<vendor>/<codename>/<codename>.md, …/roms/<rom>.md
  if (top === 'vendors') return b === 'lines' ? 'line' : b === 'series' ? 'series' : c === undefined && file === a ? 'vendor' : undefined; // vendors/<vendor>/<vendor>.md, lines/, series/
  if (top === 'os') return b === `${a}-os.md` ? 'index' : 'project'; // os/<group>/<group>-os.md lists the group's OS pages
  return { categories: 'category', socs: 'soc', scraping: 'scraping' }[top];
};
/** Pages reached through the net (category → vendor → line → series → device → ROM), so README does not list them. @param {string} rel */
const inNet = rel => rel.startsWith('devices/') || /^vendors\/[^/]+\/(lines|series)\//.test(rel) || (rel.startsWith('os/') && folderType(rel) === 'project');
/** Parent folders of the net above the device. */
/** Net level of a vendor/category page, for the one-up rule. @param {string} r */
const netLevel = r => r.startsWith('categories/') ? 'category' : /^vendors\/[^/]+\/lines\//.test(r) ? 'line' : /^vendors\/[^/]+\/series\//.test(r) ? 'series' : /^vendors\/([^/]+)\/\1\.md$/.test(r) ? 'vendor' : null;
/** One link up: net levels a page's `## Links` must not skip to (its parent lists the rest). */
const SKIP_UP = { rom: ['series', 'line', 'vendor', 'category'], device: ['line', 'vendor', 'category'], series: ['vendor', 'category'], line: ['category'] };
const UP_PAGE = { series: (/** @type {string} */ r) => /^vendors\/[^/]+\/lines\//.test(r), line: (/** @type {string} */ r) => /^vendors\/([^/]+)\/\1\.md$/.test(r), vendor: (/** @type {string} */ r) => r.startsWith('categories/') };
const MAX_LINES = 300; // raised from 200 (2026-10-28): OS pages were being squeezed to fit
const CLASSES = ['phone', 'tablet', 'tvmedia', 'television', 'misc', 'networking', 'console', 'pc']; // catalog device.category values

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
const allowedTags = (/** @type {string} */ vault) => {
  const section = readFileSync(join(vault, 'AGENTS.md'), 'utf8').split('\n## Tags')[1].split('\n## ')[0];
  return new Set([...section.matchAll(/^- \*\*[^*]+:\*\* (.+)$/gm)].flatMap(m => [...m[1].matchAll(/`([a-z0-9-]+)`/g)].map(t => t[1])));
};

/** @returns {string[]} problems, empty when the vault is clean
 * @param {string} [vault] the ROMvault folder (tests pass a copy) */
export function lint(vault = VAULT) {
  const problems = /** @type {string[]} */ ([]);
  const say = (/** @type {string} */ file, /** @type {string} */ text) => problems.push(`${join('romvault', relative(vault, file))}: ${text}`);
  const tags = allowedTags(vault);
  const files = walk(vault).filter(f => !relative(vault, f).startsWith('skills/') && relative(vault, f) !== 'AGENTS.md'); // rules file and skills keep harness format
  const pages = new Map(files.map(f => [f, readFileSync(f, 'utf8')]));
  // `reviewed` is enforced once a vault has started recording it: an un-migrated checkout is not failed
  // wholesale, but from the first page that has the field every device/rom/project page must.
  const reviewedAdopted = [...pages.values()].some(t => frontmatter(t)?.reviewed);
  const readme = pages.get(join(vault, 'README.md')) ?? '';
  /** `device/<codename>` and `series/<name>` tags: the page a tag names, wherever it is nested. */
  const pageNamed = new Set([...pages.keys()].flatMap(f => { const r = relative(vault, f), t = folderType(r); return t === 'device' || t === 'series' ? [`${t}/${basename(f, '.md')}`] : []; }));
  /** Resolved local link targets of a page. @param {string} file */
  const links = file => [...(pages.get(file) ?? '').matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)].map(m => m[1]).filter(h => !/^[a-z]+:/.test(h)).map(h => resolve(dirname(file), decodeURI(h)));
  const linksTo = (/** @type {string} */ from, /** @type {string} */ to) => links(from).includes(to);

  for (const [file, text] of pages) {
    const rel = relative(vault, file);
    const fm = frontmatter(text);
    if (!fm) { say(file, 'no frontmatter'); continue; }
    for (const key of ['type', 'title', 'date', 'updated']) if (!fm[key]) say(file, `frontmatter: missing ${key}`);
    if (!TYPES.includes(fm.type)) say(file, `frontmatter: type "${fm.type}" not one of ${TYPES.join(', ')}`);
    const want = folderType(rel);
    if (want && fm.type !== want) say(file, `frontmatter: type should be ${want} at ${rel}`);
    for (const key of ['date', 'updated', 'reviewed']) if (fm[key] && !/^\d{4}-\d{2}-\d{2}$/.test(fm[key])) say(file, `frontmatter: ${key} is not YYYY-MM-DD`);
    if (fm.updated < fm.date) say(file, 'frontmatter: updated is before date');
    if (fm.reviewed && (fm.reviewed < fm.date || fm.reviewed > fm.updated)) say(file, 'frontmatter: reviewed must fall between date and updated');
    if (reviewedAdopted && ['device', 'rom', 'project'].includes(fm.type) && !fm.reviewed) say(file, 'frontmatter: missing reviewed (last date the page was rechecked)');
    // `high` = every claim checked within 3 months (AGENTS.md › Revision turns); `reviewed` is the last full recheck
    if (fm.confidence === 'high' && Date.now() - Date.parse(fm.reviewed ?? fm.updated) > 92 * 864e5) say(file, `confidence high but last checked ${fm.reviewed ?? fm.updated}: give it a revision turn or lower confidence`);
    if (['rom', 'project'].includes(fm.type) && !/\b(as of|checked|fetched) \d{4}-\d{2}/i.test(text)) say(file, 'no dated claim: add "(as of YYYY-MM)", "checked" or "fetched YYYY-MM-DD" to versions and support status');
    for (const tag of fm.tags ?? []) {
      const nested = tag.match(/^(device|series)\/(.+)$/);
      if (nested ? !pageNamed.has(`${nested[1]}/${nested[2]}`) : !tags.has(tag)) say(file, `tag "${tag}" not in the AGENTS.md list (or its page is missing)`);
    }
    if (fm.type !== 'log' && !(fm.tags ?? []).some(t => CLASSES.includes(t))) say(file, `no device-class tag (${CLASSES.join(', ')})`);
    if (['rom', 'device', 'series'].includes(fm.type) && !(fm.aliases ?? []).length) say(file, 'frontmatter: aliases (the full phone name) missing');
    if (!text.includes('\n## For future agent\n')) say(file, 'missing "## For future agent"');
    const archive = ARCHIVE.test(rel); // logs/<YYYY>/log-<YYYY-MM>.md: one month, append-only, no cap (scripts/romvault-log.mjs)
    if (rel.startsWith('logs/') && !archive) say(file, 'log archives are logs/<YYYY>/log-<YYYY-MM>.md');
    const max = rel === 'log.md' ? LOG_CAP : archive ? Infinity : MAX_LINES;
    if (rel !== 'README.md' && text.replace(/\n$/, '').split('\n').length > max) say(file, rel === 'log.md' ? `over ${max} lines: run node scripts/romvault-log.mjs` : `over ${max} lines: split it`); // trailing newline is not a line
    for (const target of links(file)) if (!existsSync(relative(vault, target).startsWith('..') ? resolve(ROOT, 'romvault', relative(vault, target)) : target)) say(file, `broken link ${relative(dirname(file), target)}`); // links leaving the vault (../catalog) resolve from the rominit root, also for a worktree
    if (archive) { if (!linksTo(join(vault, 'log.md'), file)) say(file, 'not on the "Older entries:" line of log.md'); }
    else if (rel !== 'README.md' && !inNet(rel) && !readme.includes(`](${rel})`)) say(file, 'not listed in README.md');
    if (['rom', 'device', 'series'].includes(fm.type) && !/\n## Links\n/.test(text)) say(file, 'missing "## Links"');
    const skip = SKIP_UP[/** @type {keyof typeof SKIP_UP} */ (fm.type)], linksPart = text.split('\n## Links\n')[1]?.split('\n## ')[0] ?? '';
    if (skip) for (const m of linksPart.matchAll(/\]\(([^)#\s]+)/g)) {
      const to = relative(vault, resolve(dirname(file), decodeURI(m[1])));
      if (skip.includes(netLevel(to) ?? '')) say(file, `## Links skips up to ${to}: link only the direct parent (AGENTS.md › Signposts)`);
    }
    if (fm.type === 'device' && fm.soc) { // sideways: device ↔ socs/<soc>.md, so devices sharing a chip find each other
      const soc = join(vault, 'socs', `${fm.soc}.md`);
      if (!pages.has(soc)) say(file, `soc: ${fm.soc} has no socs/${fm.soc}.md (run scripts/romvault-net.mjs fix)`);
      else { if (!linksTo(file, soc)) say(file, `does not link socs/${fm.soc}.md`); if (!linksTo(soc, file)) say(soc, `does not list ${rel}`); }
    }
    if (['device', 'vendor', 'project'].includes(fm.type) && !/\]\(https?:/.test(text.split('\n## Sources\n')[1]?.split('\n## ')[0] ?? '')) say(file, 'no "## Sources" resource map with links (AGENTS.md › Writing rules 7)');
  }

  // The net: ROM ↔ device ↔ series ↔ line ↔ vendor ↔ category, both directions; every catalog device has a page.
  const catalogDevices = devicesInCatalog();
  const families = /** @type {Map<string, Set<string>>} */ (new Map());
  for (const d of catalogDevices) {
    const page = join(vault, d.path, `${d.codename}.md`);
    if (!pages.has(page)) { problems.push(`romvault/${d.path}/${d.codename}.md: missing (catalog has ${d.vendor} ${d.name})`); continue; }
    const fm = frontmatter(pages.get(page) ?? '') ?? {};
    const parents = [...pages.keys()].filter(f => /^vendors\/[^/]+\/series\//.test(relative(vault, f)) && linksTo(f, page));
    if (!parents.length) problems.push(`romvault/${d.path}/${d.codename}.md: no series page lists it`);
    for (const s of parents) if (!linksTo(page, s)) say(page, `does not link up to ${relative(vault, s)}`);
    if (!(fm.tags ?? []).includes(`device/${d.codename}`)) say(page, `tag device/${d.codename} missing`);
    if (!(fm.tags ?? []).includes(d.category)) say(page, `tag ${d.category} missing (catalog category)`);
    for (const s of parents) families.set(s, (families.get(s) ?? new Set()).add(d.family));
  }
  // A series page is one catalog family (Pixel 7, Galaxy S9), not a brand line: lines/ holds those.
  for (const [s, fams] of families) {
    const catalog = frontmatter(pages.get(s) ?? '')?.catalog;
    if (fams.size > 1) say(s, `mixes catalog families ${[...fams].join(', ')}: one series page per family`);
    else if (catalog && !fams.has(catalog)) say(s, `catalog: "${catalog}" but its devices are family "${[...fams][0]}"`);
  }
  for (const d of catalogDevices) for (const [, entry] of romFiles(d.path)) {
    for (const rom of entry.roms) if (!pages.has(join(vault, d.path, 'roms', `${rom.id}.md`))) problems.push(`romvault/${d.path}/roms/${rom.id}.md: missing (catalog has ${rom.name})`);
  }
  for (const [file, text] of pages) { // log.md and its archive months
    const rel = relative(vault, file), month = ARCHIVE.exec(rel)?.[2];
    if (rel !== 'log.md' && !month) continue;
    for (const line of text.split('\n').filter(l => l.startsWith('## ') && !l.startsWith('## For future agent'))) {
      if (!/^## \[\d{4}-\d{2}-\d{2}\] (create|update|move|delete) \| .+ \(.+\)$/.test(line)) say(file, `malformed entry "${line.slice(0, 60)}"`);
      else if (month && !line.startsWith(`## [${month}-`)) say(file, `entry from another month "${line.slice(0, 60)}"`);
    }
  }
  const isOs = (/** @type {string} */ f) => relative(vault, f).startsWith('os/');
  for (const [file, text] of pages) {
    const rel = relative(vault, file);
    const fm = frontmatter(text) ?? {};
    // OS links come from ROM pages, or from a device page without a ROM page for that OS; vendor/line/series pages never carry them.
    if (rel.startsWith('vendors/')) for (const o of new Set(links(file).filter(isOs))) say(file, `links ${relative(vault, o)}: OS pages are linked from device or ROM pages only`);
    if (fm.type === 'device') {
      const viaRoms = new Set([...pages.keys()].filter(f => f.startsWith(join(dirname(file), 'roms') + '/')).flatMap(links));
      for (const o of new Set(links(file).filter(f => isOs(f) && viaRoms.has(f)))) say(file, `links ${relative(vault, o)}, which its ROM page already links`);
    }
    if (fm.type === 'rom') {
      const folder = dirname(dirname(file)), codename = basename(folder); // devices/…/<codename>/roms/<rom>.md
      const device = join(folder, `${codename}.md`);
      if (!linksTo(file, device)) say(file, `does not link up to ${relative(vault, device)}`);
      if (pages.has(device) && !linksTo(device, file)) say(device, `does not list ${rel}`);
      if (!(fm.tags ?? []).includes(`device/${codename}`)) say(file, `tag device/${codename} missing`);
      if (!links(file).some(f => /\/catalog\/devices\/.+\/roms\//.test(f))) say(file, 'no link to its catalog JSON');
      for (const os of links(file).filter(f => /^os\//.test(relative(vault, f)) && pages.has(f) && folderType(relative(vault, f)) === 'project'))
        if (!linksTo(os, device)) say(os, `does not list ${relative(vault, device)} (its ROM ${rel} links here; run scripts/romvault-net.mjs fix)`);
    }
    if (rel.startsWith('os/') && fm.type === 'project') { // OS → group page up (or a release child → the OS page that lists it), and something in the group links down to it
      const group = join(vault, 'os', rel.split('/')[1], `${rel.split('/')[1]}-os.md`);
      const parentOs = [...pages.keys()].some(f => f !== file && f !== group && dirname(f) === dirname(file) && linksTo(f, file) && linksTo(file, f));
      if (!linksTo(file, group) && !parentOs) say(file, `does not link up to ${relative(vault, group)} or its parent OS page`);
      if (![...pages.keys()].some(f => f !== file && dirname(f) === dirname(file) && linksTo(f, file))) say(file, `not listed by ${relative(vault, group)} or a sibling OS page`);
    }
    const up = UP_PAGE[/** @type {keyof typeof UP_PAGE} */ (fm.type)];
    if (up) {
      const parents = [...pages.keys()].filter(f => up(relative(vault, f)) && linksTo(file, f));
      if (!parents.length) say(file, `does not link up to its ${{ series: 'line', line: 'vendor', vendor: 'category' }[/** @type {string} */ (fm.type)]} page`);
      for (const v of parents) if (!linksTo(v, file)) say(v, `does not list ${rel}`);
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
