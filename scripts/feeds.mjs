// Polls publisher release feeds and puts new entries in the admin inbox (08 RSS-Updates on /?view=inbox).
//   npm run feeds -- [--local] [--dry]     feeds come from catalog/feeds/<group>.json: { "<OS family>": "<RSS or Atom URL>" | null }
// The first poll of a family files what its feed already lists as "baseline", so only later entries show up as new.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const decode = (/** @type {string} */ s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').trim();
const tag = (/** @type {string} */ xml, /** @type {string} */ name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1];

/** RSS 2.0, RSS 1.0 (RDF) and Atom entries, newest first as the feed lists them. @param {string} xml */
export function parseFeed(xml) {
  return [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)].map(([entry]) => {
    const link = entry.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/)?.[1] ?? entry.match(/<link(?![^>]*rel=)[^>]*href=["']([^"']+)/)?.[1]
      ?? (decode(tag(entry, 'link') ?? '') || entry.match(/rdf:about=["']([^"']+)/)?.[1]);
    const title = decode(tag(entry, 'title') ?? '');
    const guid = decode(tag(entry, 'guid') ?? tag(entry, 'id') ?? '') || link || title;
    return { guid, title, link: /^https?:\/\//.test(link ?? '') ? link : null, published: decode(tag(entry, 'pubDate') ?? tag(entry, 'published') ?? tag(entry, 'updated') ?? tag(entry, 'dc:date') ?? '') || null };
  }).filter(e => e.guid && e.title);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), where = args.includes('--local') ? '--local' : '--remote', dry = args.includes('--dry');
  const quote = (/** @type {string|null} */ s) => s === null ? 'NULL' : `'${s.replaceAll("'", "''")}'`;
  const sql = (/** @type {string} */ command) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'rominit', where, '--json', '--command', command], { encoding: 'utf8', maxBuffer: 64 << 20 }))[0].results;
  // inserts go through a file: a 100-feed batch is larger than one command-line argument may be
  const sqlFile = (/** @type {string} */ statements) => { const file = join(mkdtempSync(join(tmpdir(), 'rominit-feeds-')), 'insert.sql'); writeFileSync(file, statements); execFileSync('npx', ['wrangler', 'd1', 'execute', 'rominit', where, '--yes', '--file', file], { stdio: 'inherit' }); };
  const dir = new URL('../catalog/feeds/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const group = file.slice(0, -5), feeds = Object.entries(JSON.parse(readFileSync(new URL(file, dir), 'utf8'))).filter(([, url]) => url);
    const known = new Set(dry ? [] : sql(`SELECT DISTINCT source FROM rss_items WHERE feed = ${quote(group)}`).map((/** @type {any} */ r) => r.source));
    const polled = await Promise.all(feeds.map(async ([source, url]) => {
      try {
        const r = await fetch(/** @type {string} */ (url), { headers: { 'user-agent': 'rominit-feeds (+https://rominit.pages.dev)' }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        return { source, entries: parseFeed(await r.text()).slice(0, 20) };
      } catch (e) { console.error(`${group}/${source}: ${url}: ${/** @type {Error} */ (e).message}`); return { source, entries: [] }; }
    }));
    // one INSERT per feed: D1 refuses statements over 100 KB
    const inserts = polled.filter(p => p.entries.length).map(({ source, entries }) => `INSERT OR IGNORE INTO rss_items (feed, source, guid, title, link, published) VALUES `
      + entries.map(e => `(${quote(group)}, ${quote(source)}, ${quote(e.guid.slice(0, 500))}, ${quote(e.title.slice(0, 300))}, ${quote(e.link?.slice(0, 1000) ?? null)}, ${quote(e.published)})`).join(', ') + ';');
    const fresh = polled.filter(p => p.entries.length && !known.has(p.source)).map(p => quote(p.source));
    console.log(`${group}: ${inserts.length}/${feeds.length} feeds read, ${polled.reduce((n, p) => n + p.entries.length, 0)} entries${fresh.length ? `, ${fresh.length} new families filed as baseline` : ''}`);
    if (dry || !inserts.length) continue;
    sqlFile(inserts.join('\n')
      + (fresh.length ? ` INSERT OR IGNORE INTO triage (inbox, ref, label, summary) SELECT ${quote(`rss-${group}`)}, CAST(id AS TEXT), 'other', 'baseline: listed when the feed was added' FROM rss_items WHERE feed = ${quote(group)} AND source IN (${fresh.join(', ')});` : ''));
  }
}
