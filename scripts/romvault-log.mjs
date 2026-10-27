// ROMvault log rotation (romvault/AGENTS.md › Log): log.md over CAP lines keeps the newest ~KEEP;
// older entries move verbatim, oldest first, to logs/<YYYY>/log-<YYYY-MM>.md by entry date.
// `node scripts/romvault-log.mjs` rotates, `--check` only reports (exit 1 when over the cap).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VAULT = process.env.ROMVAULT_DIR ? resolve(process.env.ROMVAULT_DIR) : join(dirname(fileURLToPath(import.meta.url)), '..', 'romvault');
export const CAP = 400, KEEP = 200;
export const ARCHIVE = /^logs\/(\d{4})\/log-(\1-\d{2})\.md$/; // logs/<YYYY>/log-<YYYY-MM>.md
const ENTRY = /^## \[(\d{4}-\d{2})-\d{2}\]/;
const lineCount = (/** @type {string} */ text) => text.replace(/\n$/, '').split('\n').length;
const stamp = (/** @type {string} */ text, /** @type {string} */ today) => text.replace(/^updated: .*$/m, `updated: ${today}`);

/** Archive months on disk, oldest first. @param {string} vault */
const months = vault => !existsSync(join(vault, 'logs')) ? [] : readdirSync(join(vault, 'logs')).flatMap(y => existsSync(join(vault, 'logs', y)) && /^\d{4}$/.test(y)
  ? readdirSync(join(vault, 'logs', y)).flatMap(f => ARCHIVE.exec(`logs/${y}/${f}`)?.[2] ?? []) : []).sort();

/** Rotates log.md when over CAP. @returns {number} entries moved @param {string} [vault] @param {string} [today] */
export function rotate(vault = VAULT, today = new Date().toISOString().slice(0, 10)) {
  const file = join(vault, 'log.md'), text = readFileSync(file, 'utf8');
  if (lineCount(text) <= CAP) return 0;
  const lines = text.replace(/\n$/, '').split('\n'), start = lines.findIndex(l => ENTRY.test(l));
  const pre = lines.slice(0, start), entries = /** @type {{ month: string, lines: string[] }[]} */ ([]);
  for (const l of lines.slice(start)) { const m = l.match(ENTRY); if (m) entries.push({ month: m[1], lines: [l] }); else entries[entries.length - 1].lines.push(l); }
  let size = lines.length;
  const move = new Set(/** @type {typeof entries} */ ([]));
  for (const e of [...entries].sort((a, b) => a.month.localeCompare(b.month))) { if (size <= KEEP) break; move.add(e); size -= e.lines.length; } // stable: file order within a month
  for (const month of new Set([...move].map(e => e.month))) { // archives first: a crash never loses entries
    const path = join(vault, 'logs', month.slice(0, 4), `log-${month}.md`);
    const block = [...move].filter(e => e.month === month).map(e => e.lines.join('\n').replace(/\n+$/, '')).join('\n');
    mkdirSync(dirname(path), { recursive: true });
    const old = existsSync(path) ? stamp(readFileSync(path, 'utf8'), today).replace(/\n+$/, '\n') : `---\ntype: log\ntitle: ROMvault log ${month} (archive)\ndate: ${today}\nupdated: ${today}\n---\n\n# ROMvault log ${month} (archive)\n\n## For future agent\nEntries of [log.md](../../log.md) dated ${month}, moved verbatim by \`scripts/romvault-log.mjs\`, oldest first. Append-only; new entries go in log.md.\n\n`;
    writeFileSync(path, `${old}${block}\n`);
    if (!readFileSync(path, 'utf8').includes(block)) throw new Error(`${path}: archive write incomplete`);
  }
  const pointer = `Older entries: ${months(vault).map(m => `[${m}](logs/${m.slice(0, 4)}/log-${m}.md)`).join(' · ')}`;
  const head = pre.filter(l => !l.startsWith('Older entries:')).join('\n').replace(/\n+$/, '');
  writeFileSync(file, stamp(`${head}\n\n${pointer}\n\n${entries.filter(e => !move.has(e)).map(e => e.lines.join('\n')).join('\n')}\n`, today));
  return move.size;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const n = lineCount(readFileSync(join(VAULT, 'log.md'), 'utf8'));
  if (process.argv.includes('--check')) { console.log(`romvault/log.md: ${n} lines (cap ${CAP})`); process.exit(n > CAP ? 1 : 0); }
  console.log(`romvault/log.md: moved ${rotate()} entries`);
}
