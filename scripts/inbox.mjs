// Inboxes for an LLM (or a person) to sort: `benchmarks` (submitted phone tests) and `reports` (page reports).
//   npm run inbox -- [--local] <inbox>                              unsorted items, one JSON object per line
//   npm run inbox -- [--local] sort <inbox> <ref> <label> <summary>   file one (labels: see LABELS)
// Benchmark bodies carry the script output: "inconclusive" lines are script fixes, "@pkgs" shows what the ROM ships,
// and differences between the card and the catalog rating are catalog updates.
import { execFileSync } from 'node:child_process';

const INBOXES = ['benchmarks', 'reports'];
const LABELS = ['script-fix', 'catalog-update', 'site-bug', 'device-report', 'spam', 'other'];
const args = process.argv.slice(2), where = args[0] === '--local' ? (args.shift(), '--local') : '--remote';
const quote = (/** @type {string} */ s) => `'${s.replaceAll("'", "''")}'`;
const sql = (/** @type {string} */ command) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'rominit', where, '--json', '--command', command], { encoding: 'utf8', maxBuffer: 64 << 20 }))[0].results;

if (args[0] === 'sort') {
  const [, inbox, ref, label, ...summary] = args;
  if (!INBOXES.includes(inbox) || !ref || !LABELS.includes(label) || !summary.length) throw Error(`usage: sort <${INBOXES.join('|')}> <ref> <${LABELS.join('|')}> <summary>`);
  sql(`INSERT OR REPLACE INTO triage (inbox, ref, label, summary) VALUES (${quote(inbox)}, ${quote(ref)}, ${quote(label)}, ${quote(summary.join(' '))})`);
  console.log(`filed ${inbox} ${ref} as ${label}`);
} else {
  if (!INBOXES.includes(args[0])) throw Error(`usage: <${INBOXES.join('|')}> or sort …`);
  for (const item of sql(`SELECT i.* FROM inbox i LEFT JOIN triage t ON t.inbox = i.inbox AND t.ref = i.ref WHERE i.inbox = ${quote(args[0])} AND t.ref IS NULL ORDER BY i.at`)) console.log(JSON.stringify(item));
}
