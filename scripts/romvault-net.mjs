// ROMvault net: `tree` prints category › vendor › line › series › device › ROM from the pages' own links;
// `fix` hangs every catalog device into that tree (and every device page with `soc:` onto its socs/ page), creating missing pages as stubs and adding the missing
// up/down links, README entries and log.md lines. Stubs stay lint-red (no sources yet) until someone researches them.
// Usage: node scripts/romvault-net.mjs tree | fix [--agent "Claude Code"]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontmatter } from './romvault-lint.mjs';
import { LEVELS, deviceLevel } from '../src/catalog.js';
import { catalogDevices, romFiles } from './load-catalog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORY_FILE = { phone: 'phones', tablet: 'tablets', tvmedia: 'tvmedia', television: 'tvs', misc: 'misc-iot', networking: 'networking', console: 'consoles', pc: 'os' };
/** Child page type per page type, top to bottom. */
const DOWN = { category: 'vendor', vendor: 'line', line: 'series', series: 'device', device: 'rom' };
const slug = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** In-memory vault: read pages, edit text, write once. @param {string} vault */
function open(vault) {
  /** @type {Map<string, string>} */
  const pages = new Map();
  const changed = { create: /** @type {Set<string>} */ (new Set()), update: /** @type {Set<string>} */ (new Set()) };
  const today = new Date().toISOString().slice(0, 10);
  const abs = (/** @type {string} */ rel) => join(vault, rel);
  const text = (/** @type {string} */ rel) => pages.get(rel) ?? (existsSync(abs(rel)) ? pages.set(rel, readFileSync(abs(rel), 'utf8')).get(rel) ?? '' : '');
  const has = (/** @type {string} */ rel) => pages.has(rel) || existsSync(abs(rel));
  const title = (/** @type {string} */ rel) => frontmatter(text(rel))?.title ?? rel;
  const href = (/** @type {string} */ from, /** @type {string} */ to) => relative(dirname(abs(from)), abs(to));
  /** Vault-relative pages a page links to. @param {string} rel */
  const links = rel => [...text(rel).matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)].map(m => m[1]).filter(h => !/^[a-z]+:/.test(h))
    .map(h => relative(vault, resolve(dirname(abs(rel)), decodeURI(h))));
  const folder = (/** @type {string} */ dir) => existsSync(abs(dir)) ? readdirSync(abs(dir), { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.md')).map(f => `${dir}/${f}`) : [];
  const set = (/** @type {string} */ rel, /** @type {string} */ body) => {
    if (!changed.create.has(rel)) { changed.update.add(rel); body = body.replace(/^updated: .*$/m, `updated: ${today}`); }
    pages.set(rel, body);
  };
  const create = (/** @type {string} */ rel, /** @type {string} */ body) => { changed.create.add(rel); pages.set(rel, body); };
  /** Append `line` as the last item of `## heading`, creating the section before `## Links` (or at the end). */
  const addItem = (/** @type {string} */ rel, /** @type {string} */ heading, /** @type {string} */ line) => {
    const lines = text(rel).split('\n');
    let at = lines.indexOf(`## ${heading}`);
    if (at < 0) {
      const before = heading === 'Links' ? -1 : lines.indexOf('## Links');
      const end = lines.at(-1) === '' ? lines.length - 1 : lines.length;
      lines.splice(before < 0 ? end : before, 0, ...(before < 0 ? ['', `## ${heading}`] : [`## ${heading}`, '']));
      at = lines.indexOf(`## ${heading}`);
    }
    let end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
    if (end < 0) end = lines.length;
    while (end - 1 > at && lines[end - 1] === '') end--;
    const none = lines.findIndex((l, i) => i > at && i < end && l === '- None yet.');
    if (none >= 0) lines.splice(none, 1, line); else lines.splice(end, 0, line);
    set(rel, lines.join('\n'));
  };
  /** child ↔ parent both ways: child's `## Links` gets `- kind: [parent]`, parent's `## section` lists the child. */
  const join2 = (/** @type {string} */ child, /** @type {string} */ parent, /** @type {string} */ kind, /** @type {string} */ section) => {
    if (!links(child).includes(parent)) addItem(child, 'Links', `- ${kind}: [${title(parent)}](${href(child, parent)})`);
    if (!links(parent).includes(child)) addItem(parent, section, `- [${title(child)}](${href(parent, child)})`);
  };
  const index = (/** @type {string} */ rel, /** @type {string} */ section) => { if (!links('README.md').includes(rel)) addItem('README.md', section, `- [${title(rel)}](${rel})`); };
  const save = (/** @type {string} */ agent) => {
    for (const rel of [...changed.create, ...changed.update]) { mkdirSync(dirname(abs(rel)), { recursive: true }); writeFileSync(abs(rel), pages.get(rel) ?? ''); }
    const log = Object.entries(changed).filter(([, s]) => s.size).map(([op, s]) => `\n## [${today}] ${op} | ${[...s].sort().join(', ')}: ${op === 'create' ? 'stubs' : 'net links'} from scripts/romvault-net.mjs (${agent})\n`).join('');
    if (log) writeFileSync(abs('log.md'), readFileSync(abs('log.md'), 'utf8').trimEnd() + '\n' + log);
    return changed;
  };
  return { text, has, title, links, folder, create, join: join2, index, save, today, addItem, href };
}

const page = (/** @type {Record<string, string>} */ fm, /** @type {string} */ about, /** @type {string[]} */ sections) =>
  `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n# ${fm.title.replace(/^"|"$/g, '')}\n\n## For future agent\n${about}\n\n${sections.map(s => `## ${s}\n`).join('\n')}`;

/** Hang every catalog device into category › vendor › line › series › device. @param {string} vault @param {string} agent */
export function fix(vault, agent = 'script') {
  const v = open(vault);
  const D = v.today, stub = `Stub made by scripts/romvault-net.mjs from the ROMinit catalog on ${D}; research it and replace this note.`;
  for (const d of catalogDevices()) {
    const cat = d.category, home = `vendors/${d.dir}`, vendor = `${home}/${d.dir}.md`, category = `categories/${CATEGORY_FILE[/** @type {keyof typeof CATEGORY_FILE} */ (cat)]}.md`;
    const device = `${d.path}/${d.codename}.md`; // mirrors catalog/devices/<category>/<vendor>/<codename>/
    const series = v.folder(`${home}/series`).find(s => v.links(device).includes(s) || v.links(s).includes(device)) ?? `${home}/series/${d.dir}-${slug(d.family)}.md`;
    const line = v.folder(`${home}/lines`).find(l => v.links(l).includes(series))
      ?? v.folder(`${home}/lines`).find(l => (frontmatter(v.text(l))?.catalog ?? '').split(', ').includes(d.series))
      ?? `${home}/lines/${d.dir}-${slug(d.series)}.md`;
    const seriesTag = `series/${basename(series, '.md')}`;
    if (!v.has(category)) throw new Error(`${category} missing: create the category page first`);
    if (!v.has(vendor)) v.create(vendor, page({ type: 'vendor', title: d.vendor, catalog: d.dir, date: D, updated: D, tags: `[${cat}, ${d.dir}]` }, stub, ['Lines', 'Sources', 'Links']));
    if (!v.has(line)) v.create(line, page({ type: 'line', title: `${d.vendor} ${d.series}`, catalog: d.series, date: D, updated: D, tags: `[${cat}, ${d.dir}]` }, stub, ['Series', 'Links']));
    if (!v.has(series)) v.create(series, page({ type: 'series', title: `${d.vendor} ${d.family}`, aliases: `[${d.vendor} ${d.family} series]`, catalog: d.family, date: D, updated: D, tags: `[${cat}, ${d.dir}, ${seriesTag}]` },
      `The ${d.vendor} ${d.family} family (${d.vendor} ${d.series} line): the devices in it and what they share. Built from the ROMinit catalog as of ${D} by scripts/romvault-net.mjs; per-device steps are on the device pages.`, ['Devices', 'Links']));
    if (!v.has(device)) v.create(device, page({ type: 'device', title: `"${d.vendor} ${d.name} (${d.codename})"`, aliases: `[${d.vendor} ${d.name}]`, catalog: d.codename, date: D, updated: D, tags: `[${cat}, ${d.dir}, device/${d.codename}, ${seriesTag}]` },
      `${stub} Catalog: [${d.codename}.json](${'../'.repeat(5)}catalog/${d.path}/${d.codename}.json).`, ['ROMs', 'Sources', 'Links']));
    v.join(vendor, category, 'Category', 'Vendors');
    v.join(line, vendor, 'Vendor', 'Lines');
    v.join(series, line, 'Line', 'Series');
    v.join(device, series, 'Series', 'Devices');
    v.index(vendor, 'Vendors'); // lines, series and devices are reached through the net, not the README
  }
  // Sideways: every device page with `soc:` (catalog or not) ↔ socs/<soc>.md.
  for (const device of v.folder('devices')) {
    const fm = frontmatter(v.text(device)) ?? {}, soc = `socs/${fm.soc}.md`;
    if (fm.type !== 'device' || !fm.soc) continue;
    const cls = (fm.tags ?? []).find((/** @type {string} */ t) => t in CATEGORY_FILE) ?? 'phone';
    if (!v.has(soc)) v.create(soc, page({ type: 'soc', title: fm.soc, catalog: fm.soc, date: D, updated: D, tags: `[${cls}, soc]` },
      `Devices built on the ${fm.soc} chip. They often share kernels, mainline ports, recoveries and flashing quirks, so a fix found for one is worth trying on the others. Built from the device pages' \`soc:\` by scripts/romvault-net.mjs on ${D}.`, ['Devices', 'Links']));
    v.join(device, soc, 'SoC', 'Devices');
    v.index(soc, 'SoCs');
  }
  // OS → device: an OS page lists every device that has a ROM page linking it (os/mobile/postmarketos.md → starlte).
  for (const rom of v.folder('devices').filter(r => /\/roms\/[^/]+\.md$/.test(r))) {
    const device = `${dirname(dirname(rom))}/${basename(dirname(dirname(rom)))}.md`;
    for (const os of v.links(rom).filter(l => l.startsWith('os/') && v.has(l) && frontmatter(v.text(l))?.type === 'project'))
      if (v.has(device) && !v.links(os).includes(device)) v.addItem(os, 'Devices in ROMvault', `- [${v.title(device)}](${v.href(os, device)})`);
  }
  return v.save(agent);
}

/** The tree as indented text, following each page's down links; lists catalog devices it never reaches. @param {string} vault */
export function tree(vault) {
  const v = open(vault), seen = new Set(), out = /** @type {string[]} */ ([]);
  const turns = v.text('log.md').split('\n').filter(l => /revision turn/i.test(l));
  const devices = new Map(catalogDevices().map(d => [d.codename, d]));
  const roms = /** @type {Map<string, any[]>} */ (new Map());
  for (const d of devices.values()) for (const [, entry] of romFiles(d.path)) {
    roms.set(entry.device, [...roms.get(entry.device) ?? [], ...entry.roms]);
  }
  /** Review state of a device or ROM page: confidence, revision turns logged, last full recheck, and (devices) the site's catalog level. @param {string} rel */
  const status = rel => {
    const fm = frontmatter(v.text(rel)) ?? {}, codename = rel.match(/^devices\/.+\/([^/]+)\/\1\.md$/)?.[1];
    const d = codename && devices.get(codename);
    // ponytail: no phone-test results here, so a tested device shows as approved or below
    const level = codename ? ` · ${d ? LEVELS[deviceLevel({ ...d, roms: roms.get(codename) ?? [] }, new Set())] : 'not in catalog'}` : '';
    return `  [${fm.confidence ?? 'no confidence'} · ${turns.filter(l => l.includes(rel)).length} turns · reviewed ${fm.reviewed ?? '–'}${level}]`;
  };
  const walk = (/** @type {string} */ rel, /** @type {number} */ depth) => {
    seen.add(rel);
    const type = /** @type {keyof typeof DOWN} */ (frontmatter(v.text(rel))?.type);
    out.push(`${'  '.repeat(depth)}${v.title(rel)}${['device', 'rom'].includes(type) ? status(rel) : `  (${rel})`}`);
    // ponytail: a vendor lists all its lines, so a vendor in two categories shows every line under both
    for (const child of v.links(rel).filter(l => DOWN[type] && v.has(l) && frontmatter(v.text(l))?.type === DOWN[type])) walk(child, depth + 1);
  };
  for (const c of Object.values(CATEGORY_FILE).map(f => `categories/${f}.md`).filter(v.has)) walk(c, 0);
  const lost = catalogDevices().filter(d => !seen.has(`${d.path}/${d.codename}.md`)).map(d => `${d.vendor} ${d.name} (${d.codename})`);
  return out.join('\n') + (lost.length ? `\n\nNot in the tree (run fix): ${lost.join(', ')}` : '');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2), vault = join(ROOT, 'romvault');
  if (cmd === 'tree') console.log(tree(vault));
  else if (cmd === 'fix') {
    const agent = rest[rest.indexOf('--agent') + 1] ?? 'script';
    const { create, update } = fix(vault, rest.includes('--agent') ? agent : 'script');
    console.log(`created ${create.size}: ${[...create].join(', ') || '–'}\nupdated ${update.size}: ${[...update].join(', ') || '–'}\nnext: node scripts/romvault-lint.mjs`);
  } else { console.log('usage: node scripts/romvault-net.mjs tree | fix [--agent "<name>"]'); process.exitCode = 2; }
}
