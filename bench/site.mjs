import { ALPINE, alpineImage } from '../src/alpine.js';
// Website bench: every agreed site feature, end to end in a real browser against `wrangler pages dev` with a fresh local D1.
// Run: npm run build && npm run bench   (CHROMIUM=/path/to/chrome to override the browser)
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.BENCH_PORT ?? 8797), BASE = `http://127.0.0.1:${PORT}`;
const DONATE = 'https://www.buymeacoffee.com/philipplinux';
const state = mkdtempSync(join(tmpdir(), 'rominit-bench-'));
const d1 = (/** @type {string[]} */ ...args) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'rominit', '--local', '--persist-to', state, ...args], { stdio: 'pipe' }).toString();
const d1Rows = command => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'rominit', '--local', '--persist-to', state, '--json', '--command', command], { stdio: 'pipe' }).toString()).flatMap(result => result.results);
// 1x1 PNG; the page re-encodes it to WebP like any upload.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** @type {import('node:child_process').ChildProcess} */ let server;
/** @type {import('playwright-core').Browser} */ let browser;
/** @type {import('playwright-core').Page} */ let page;
/** @type {string[]} */ const errors = [];

before(async () => {
  if (await fetch(BASE).then(() => true, () => false)) throw Error(`port ${PORT} is busy; set BENCH_PORT`);
  d1('--file', 'schema.sql');
  server = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state, '--binding', 'SALT=bench', '--binding', 'GITHUB_CLIENT_ID=bench', '--binding', 'GITHUB_CLIENT_SECRET=bench'], { stdio: 'ignore', detached: true });
  for (let i = 0; ; i++) {
    if (await fetch(BASE).then(r => r.ok, () => false)) break;
    if (i > 120) throw Error('wrangler pages dev did not start');
    await new Promise(done => setTimeout(done, 500));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium-browser' });
  page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem('host', 'linux'));
  page.on('pageerror', error => errors.push(error.message));
});
after(async () => {
  await browser?.close();
  try { if (server?.pid) process.kill(-server.pid); } catch { /* already gone */ }
  rmSync(state, { recursive: true, force: true });
});

const text = (/** @type {string} */ selector) => page.locator(selector).first().evaluate(el => el.textContent ?? '');

test('coffee link in header and footer', async () => {
  await page.goto(BASE);
  assert.equal(await page.locator(`.topbar a[href="${DONATE}"]`).count(), 1);
  assert.equal(await page.locator(`.footer a[href="${DONATE}"]`).count(), 1);
});

test('header nav: search, Brands, Popular; disclaimer names Chrome/Edge and × hides it for good', async () => {
await page.goto(`${BASE}/?view=brands`);
assert.match(await page.locator('.disclaimer').innerText(), /Use at your own risk[\s\S]*Chrome or Edge/i);
await page.locator('.brand-tile', { hasText: 'Xiaomi' }).click();
assert.equal(await page.locator('#main input[type=search]').inputValue(), 'Xiaomi');
await page.goto(`${BASE}/?view=projects`);
await page.locator('.brand-tile', { hasText: 'LineageOS' }).click();
await page.locator('#main a', { hasText: 'S7 edge' }).waitFor();
await page.goto(`${BASE}/?view=popular`);
await page.locator('.sitenav a[aria-current]', { hasText: 'Popular' }).waitFor();
await page.locator('.flash-card', { hasText: 'Popular phones' }).waitFor();
await page.locator('.disclaimer-close').click();
assert.equal(await page.locator('.disclaimer').count(), 0);
await page.reload();
assert.equal(await page.locator('.disclaimer').count(), 0);
await page.evaluate(() => localStorage.removeItem('rominit.noticeHidden'));
});

test('section 0 opens with ROM source and source code links', async () => {
  await page.goto(`${BASE}/?device=laurel_sprout`);
  const row = page.locator('.lock-path > .source-row');
  assert.equal(await row.locator('a', { hasText: 'Source code' }).getAttribute('href'), 'https://github.com/philipplinux/mia3-postmarketos');
  assert.equal(await page.locator('.lock-path > *').first().getAttribute('class'), 'slideshow');
  assert.ok(await row.locator('a', { hasText: 'ROM source' }).count());
});

test('header: SIGN IN under EXPERIMENTAL opens a popup with provider badges', async () => {
  await page.goto(`${BASE}/?device=starlte`);
  await page.locator('.topbar-side .account button', { hasText: 'SIGN IN' }).click();
  const badge = page.locator('#signin .signin-badge.github');
  await badge.waitFor();
  assert.match(await badge.getAttribute('href') ?? '', /^\.\/auth\/github\/login\?return=%2F%3Fdevice%3Dstarlte$/);
  await page.keyboard.press('Escape');
  assert.equal(await badge.isVisible(), false);
});

test('device tree: All › vendor › series › family › variant, unsupported greyed with why', async () => {
  await page.goto(BASE);
  const tree = page.locator('.device-tree');
  await tree.locator('summary', { hasText: 'Samsung' }).waitFor();
  for (const label of ['Samsung', 'Xiaomi', 'Galaxy S', 'Mi A']) assert.equal(await tree.locator('summary', { hasText: label }).count() > 0, true, label);
  for (const family of ['Galaxy S7', 'Galaxy S9', 'Mi A3']) assert.equal(await tree.locator('.family strong', { hasText: family }).count(), 1, family);
  assert.equal(await tree.locator('a', { hasText: 'S9+ · Exynos' }).count(), 1);
  const unsupported = tree.locator('li.unsupported', { hasText: 'SM-G9600' });
  assert.match(await unsupported.innerText(), /not supported: .+/);
  assert.notEqual(await unsupported.evaluate(el => getComputedStyle(el).color), await tree.locator('a').first().evaluate(el => getComputedStyle(el).color));
});

test('search matches unsupported models, ?q= prefills, no-match message', async () => {
  await page.goto(`${BASE}/?q=SM-G9650`);
  assert.equal(await page.locator('input[type=search]').inputValue(), 'SM-G9650');
  assert.equal(await page.locator('.device-tree .family strong').allInnerTexts().then(t => t.join()), 'Galaxy S9');
  await page.goto(`${BASE}/?q=Xiaomi`);
  assert.equal(await page.locator('.device-tree summary', { hasText: 'Samsung' }).count(), 0);
  await page.locator('input[type=search]').fill('nokia 3310');
  await page.getByText('No device matches').waitFor();
});

test('device page: back link, breadcrumb, one-line title, section 0 first, OS logo', async () => {
  await page.goto(BASE);
  await page.locator('.device-tree a', { hasText: 'S9 · Exynos' }).click();
  await page.waitForURL(/device=starlte/);
  assert.equal(await text('.intro .eyebrow'), 'ALL / SAMSUNG / GALAXY S / GALAXY S9 / S9 · EXYNOS');
  assert.equal(await page.locator('.intro .eyebrow a', { hasText: 'GALAXY S9' }).getAttribute('href'), './?q=Galaxy%20S9');
  assert.equal(await page.locator('h1').evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
  const h1 = await page.locator('h1').boundingBox();
  assert.ok(h1 && h1.height < 120, 'title fits one line');
  assert.match(await text('.page-section summary'), /^0 · ROM, features & info/);
  await page.goto(`${BASE}/?device=starlte&rom=philipplinux-pmos-server`); // official /e/OS ranks first and has no logo file
  await page.locator('img.os-logo').evaluate(img => /** @type {HTMLImageElement} */ (img).decode());
  assert.ok(await page.locator('img.os-logo').evaluate(img => /** @type {HTMLImageElement} */ (img).naturalWidth > 0), 'postmarketOS logo loads');
  await page.locator('.back-link').click();
  await page.waitForURL(`${BASE}/`);
});

test('ROM info: release chips, login in sections 0 and 2, feature groups, includes', async () => {
  await page.goto(`${BASE}/?device=starlte&rom=philipplinux-pmos-server`);
  const release = page.locator('p.rating', { has: page.locator('strong', { hasText: 'release' }) });
  assert.match(await release.innerText(), /unofficial[\s\S]*experimental[\s\S]*curated ★/);
  assert.equal(await page.locator('.login-box').count(), 2);
  assert.match(await text('.login-box pre'), /user\s+user\npassword\s+changeme/);
  for (const group of ['basics', 'multimedia', 'connectivity', 'modem', 'misc', 'sensors']) assert.equal(await page.locator('p.rating strong', { hasText: group }).count(), 1, group);
  for (const row of ['Includes', 'Lacks']) assert.equal(await page.locator('p.includes strong', { hasText: row }).count(), 1, row);
  assert.match(await text('.page-section summary small'), /as computer \d+% · as phone \d+% · downstream kernel/);
});

test('ROM select groups by origin; stock ROMs only under Recover / revert', async () => {
  await page.goto(`${BASE}/?device=laurel_sprout`);
  const labels = await page.locator('select optgroup').evaluateAll(groups => groups.map(g => g.getAttribute('label')));
  assert.ok(!labels.includes('stock'), 'stock is not offered as a ROM');
  const revert = page.locator('details.page-section', { hasText: 'R · Recover / revert' });
  await revert.locator(':scope > summary').click();
  assert.equal(await revert.locator('.stage-card').count(), 1);
  assert.match(await revert.locator('.stage-card details:not(.debug-box) summary').innerText(), /^\d+ steps$/, 'long step lists collapse');
});

test('S7 edge: TWRP via Odin, LineageOS via sideload', async () => {
  await page.goto(`${BASE}/?device=hero2lte`);
  await page.locator('.version-chip').nth(1).waitFor();
  assert.deepEqual(await page.locator('.version-chip').allInnerTexts(), ['ODIN', 'TWRP-SIDELOAD']);
  assert.match(await page.locator('#main select').first().inputValue(), /-lineage-21$/);
});

test('page order: info, unlock guide with SamFW pivot, TWRP marked required, ROM, recover', async () => {
  await page.goto(`${BASE}/?device=hero2lte`);
  await page.locator('.page-section').nth(4).waitFor();
  assert.deepEqual((await page.locator('.page-section > summary > span:first-child').allInnerTexts()).map(t => t.slice(0, 1)).slice(0, 6), ['0', '1', '2', '3', '4', 'R']);
  await page.locator('.side-divider').waitFor();
  const unlock = page.locator('details.page-section', { hasText: '1 · Unlock bootloader' });
  assert.equal(await unlock.first().locator(':scope > summary .badge').innerText(), 'REQUIRED');
  assert.ok(await unlock.first().locator('.guide li').count() >= 4);
  await unlock.first().locator('.pivots summary').click();
  assert.equal(await unlock.first().locator('.pivots a[href="https://samfw.com/"]').count(), 1);
  assert.equal(await page.locator('details.page-section', { hasText: '2 · Custom recovery' }).locator(':scope > summary .badge').innerText(), 'REQUIRED');
  const first = unlock.first();
  assert.match(await first.getAttribute('class') ?? '', /required(?! done)/);
  for (const box of await first.locator('.guide input[type=checkbox]').all()) await box.check();
  assert.match(await first.getAttribute('class') ?? '', /done/);
  assert.equal(await first.evaluate(el => /** @type {HTMLDetailsElement} */ (el).open), false);
  await page.reload(); // ticks are remembered
  assert.match(await page.locator('details.page-section', { hasText: '1 · Unlock bootloader' }).first().getAttribute('class') ?? '', /done/);
  const twrp = page.locator('details.page-section', { hasText: '2 · Custom recovery' });
  await twrp.getByLabel('custom recovery (TWRP or similar) is already installed').check();
  assert.equal(await twrp.locator(':scope > summary .badge').innerText(), 'COMPLETED');
  assert.equal(await twrp.evaluate(el => /** @type {HTMLDetailsElement} */ (el).open), false, 'completed section collapses');
  await page.reload(); // every section's progress is remembered
  await page.locator('details.page-section', { hasText: 'T · Submit ticket' }).waitFor(); // page fully drawn before counting
  assert.equal(await page.locator('details.page-section.done').count(), 2);
  page.once('dialog', d => d.dismiss()); // Start over asks first; cancel keeps everything
  await page.locator('.start-over').click();
  assert.equal(await page.locator('details.page-section.done').count(), 2);
  page.once('dialog', d => d.accept());
  await page.locator('.start-over').click();
  await page.locator('.page-section').nth(4).waitFor();
  assert.equal(await page.locator('details.page-section.done').count(), 0);
  await page.getByLabel('Bootloader is already unlocked').check(); // skips the steps
  assert.equal(await page.locator('details.page-section', { hasText: '1 · Unlock bootloader' }).first().locator(':scope > summary .badge').innerText(), 'COMPLETED');
  page.once('dialog', d => d.accept());
  await page.locator('.start-over').click();
});

test('section 0 completes by locking in the ROM; install requirements and A/B flag shown', async () => {
  await page.goto(`${BASE}/?device=laurel_sprout`);
  const info = page.locator('details.page-section').first();
  await info.locator('.requirements').getByText('A/B slots').waitFor();
  assert.equal(await page.locator('.hints').count(), 1, 'vendor hints in the unlock guide');
  assert.equal(await info.locator('.lock-in').count(), 2, 'by the select and under the features');
  await info.locator('.lock-in').last().click();
  assert.equal(await info.locator(':scope > summary .badge').innerText(), 'COMPLETED');
  assert.equal(await info.evaluate(el => /** @type {HTMLDetailsElement} */ (el).open), false);
  await page.reload();
  const again = page.locator('details.page-section').first();
  assert.match(await again.getAttribute('class') ?? '', /done/);
  await again.locator(':scope > summary').click();
  await again.locator('.lock-in').first().click(); // unlock again for the later tests
  assert.equal(await again.locator(':scope > summary .badge').innerText(), 'REQUIRED');
});

test('broken ROMs are listed but not flashable', async () => {
  await page.route('**/catalog/starlte.json', async route => {
    const device = await (await route.fetch()).json();
    for (const rom of device.roms) rom.status = 'broken';
    await route.fulfill({ json: device });
  });
  await page.goto(`${BASE}/?device=starlte`);
  await page.getByText('Known broken:').waitFor();
  assert.equal(await page.locator('.stage-card:not(.pivots .stage-card)').count(), 0, 'opt-in recovery installers in R stay');
  await page.unroute('**/catalog/starlte.json');
});

test('section 0 screenshot slideshow: arrows and counter, wraps around', async () => {
  await page.route('**/catalog/starlte.json', async route => {
    const device = await (await route.fetch()).json();
    device.roms[0].screenshots = [1, 2, 3].map(n => ({ src: `data:image/png;base64,${PNG.toString('base64')}`, caption: `shot ${n}` }));
    await route.fulfill({ json: device });
  });
  await page.goto(`${BASE}/?device=starlte`);
  const show = page.locator('.slideshow');
  await show.getByText('1 / 3').waitFor();
  await show.locator('.slide-next').click();
  await show.getByText('2 / 3').waitFor();
  await show.locator('.slide-prev').click(); await show.getByText('1 / 3').waitFor();
  await show.locator('.slide-prev').click(); await show.getByText('3 / 3').waitFor();
  await page.unroute('**/catalog/starlte.json');
});

test('flash button stays locked without phone, files, consent and confirm phrase', async () => {
  await page.goto(`${BASE}/?device=starlte`);
  const card = page.locator('.stage-card').first();
  await card.locator('input.confirmation-input').fill('FLASH TWRP');
  await card.locator('.risk-check input').last().check();
  assert.equal(await card.locator('.button-primary').isDisabled(), true);
});

test('unknown device', async () => {
  await page.goto(`${BASE}/?device=nope`);
  await page.getByText('Unknown device nope.').waitFor();
});

test('user stars', async () => {
  await page.goto(`${BASE}/?device=starlte`);
  await page.getByRole('button', { name: '4 of 5 stars' }).click();
  await page.getByText('Thanks, you rated 4 / 5.').waitFor();
  await page.getByText('★ 4 / 5 · 1 vote').waitFor();
});

test('view and flash counters per ROM, once per window', async () => {
  await page.goto(`${BASE}/?device=laurel_sprout`);
  await page.getByText('1 view', { exact: true }).waitFor();
  await page.getByText('0 successful flashes').waitFor();
  const rom = `laurel_sprout/${await page.locator('#main select').first().inputValue()}`;
  const post = () => fetch(`${BASE}/api/counts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rom, kind: 'flash' }) }).then(r => r.json());
  assert.deepEqual([await post(), await post()], [{ ok: true, counted: true }, { ok: true, counted: false }]);
  await page.reload();
  await page.getByText('1 successful flash', { exact: true }).waitFor();
  await page.getByText('1 view', { exact: true }).waitFor();
});

/** Signs the page in as a fresh local account; null signs out. @param {string|null} name @param {string} [role] @param {string} [scope] */
async function signIn(name, role, scope) {
  await page.context().clearCookies();
  if (!name) return;
  const token = `bench-${name}`, hash = createHash('sha256').update(token).digest('hex');
  d1('--command', `INSERT OR IGNORE INTO users (provider, subject, name) VALUES ('github', '${name}', '${name}');
    INSERT OR IGNORE INTO sessions (token, user_id, expires) SELECT '${hash}', id, datetime('now', '+1 day') FROM users WHERE subject = '${name}';
    ${role ? `INSERT INTO roles (user_id, role, scope) SELECT id, '${role}', '${scope}' FROM users WHERE subject = '${name}';` : ''}`);
  await page.context().addCookies([{ name: 'sid', value: token, url: BASE }]);
}

test('comments need sign-in; owner badge; moderator approves screenshots and hides comments in the page', async () => {
  await signIn(null);
  await page.goto(`${BASE}/?device=starlte`);
  const box = page.locator('.comment-box').first();
  await box.getByText('Sign in to comment:').waitFor();
  assert.match(await box.getByRole('link', { name: 'GitHub' }).getAttribute('href') ?? '', /^\.\/auth\/github\/login\?return=%2F%3Fdevice%3Dstarlte/);
  assert.equal(await box.locator('textarea').isVisible(), false);
  const rom = `starlte/${await page.locator('#main select').first().inputValue()}`;

  await signIn('ada', 'owner', `rom:${rom}`);
  await page.reload();
  await page.locator('.topbar-side .account').getByText('ada ✎').waitFor();
  await page.locator('.rating', { hasText: 'maintainer' }).getByText('✓ ada').waitFor();
  await box.locator('textarea').fill('bench comment');
  await box.locator('input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await box.getByRole('button', { name: 'Post comment' }).click();
  await box.getByText('Posted. The screenshot shows after review.').waitFor();
  assert.equal(await box.locator('.comments .role').first().innerText(), 'maintainer');
  const [{ id }] = await (await fetch(`${BASE}/api/comments?rom=${rom}`)).json();
  assert.equal((await fetch(`${BASE}/api/image?id=${id}`)).status, 404, 'pending screenshot hidden from the public');

  await signIn('mo', 'moderator', 'vendor:Samsung');
  await page.reload();
  await box.locator('.comments img').waitFor(); // moderators see it for review
  await box.getByRole('button', { name: 'approve' }).click();
  await box.getByRole('button', { name: 'approve' }).waitFor({ state: 'detached' });
  assert.equal((await fetch(`${BASE}/api/image?id=${id}`)).headers.get('content-type'), 'image/webp');

  await signIn(null);
  await page.reload();
  const img = box.locator('.comments img');
  await img.waitFor();
  assert.ok(await img.evaluate(el => /** @type {HTMLImageElement} */ (el).naturalWidth > 0));
  assert.equal(await img.evaluate(el => getComputedStyle(el).maxHeight), '240px');
  assert.equal(await box.getByRole('button', { name: 'hide' }).count(), 0, 'no moderation for the public');

  await signIn('mo');
  await page.reload();
  await box.getByRole('button', { name: 'hide' }).click();
  await box.getByText('· hidden').waitFor();
  await signIn(null);
  await page.reload();
  await box.getByText('No comments yet.').waitFor();
});

test('phone test autosubmits and saves report corrections on the same code', async () => {
  await page.goto(`${BASE}/?device=laurel_sprout`);
  // The Mi A3 postmarketOS image needs no TWRP: the collapsed section says so instead of staying blank.
  assert.equal(await page.locator('details.page-section', { hasText: '2 · Custom recovery' }).locator(':scope > summary .badge').innerText(), 'NOT REQUIRED');
  const test4 = page.locator('details.page-section', { hasText: '4 · Test your phone' });
  await test4.locator('summary').first().click();
  await test4.getByRole('button', { name: 'Start a phone test' }).click();
  const command = await test4.locator('.bench-command').innerText(); // USB is the default for postmarketOS
  const url = command.match(/curl -fsSL (\S+) \| ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -- 'user@172\.16\.42\.1' sh \| curl -sS --data-binary @- (\S+)$/);
  assert.ok(url && url[1] === url[2], command);
  await test4.getByLabel('Also check speaker and vibration').check();
  assert.match(await test4.locator('.bench-command').innerText(), /-- 'user@172\.16\.42\.1' 'ROMINIT_SOUND=1 sh' \|/);
  await test4.getByRole('tab', { name: 'Wi-Fi' }).click();
  await test4.getByLabel(/Phone IP address/).fill('192.168.1.77');
  assert.match(await test4.locator('.bench-command').innerText(), /\| ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -- 'user@192\.168\.1\.77' 'ROMINIT_SOUND=1 sh' \|/);
  await test4.getByRole('tab', { name: 'Terminal on the phone' }).click();
  assert.match(await test4.locator('.bench-command').innerText(), /\| ROMINIT_SOUND=1 sh \|/);
  const script = await (await fetch(url[1])).text();
  assert.match(script, /if command -v getprop/, 'entry script detects the phone OS');
  assert.match(script, /@ script linux/, 'bootstrap includes Linux probes');
  assert.match(script, /@ script android/, 'bootstrap includes Android probes');
  assert.equal((await fetch(url[1], { method: 'POST', body: 'hello' })).status, 400);
  const failed = await fetch(url[1], { method: 'POST', body: '' }); // SSH never connected: terminal and page both say so
  assert.match(await failed.text(), /nothing came from the phone/);
  await test4.getByText(/Nothing came from the phone last time/).waitFor({ timeout: 10000 });
  const output = ['@ script linux 1', '@ model Xiaomi Mi A3', '@debug tools nmcli', 'flashing full booted', 'wifi full wlan0 connected', 'touch ask Does touch follow your finger?',
    'audio ask Play any sound: does the speaker work?', 'camera broken no camera driver', 'sdcard blocked insert one', 'gps inconclusive probe p_gps exit 2: mmcli: not found',
    '@root unverified sudo requires interactive authentication', '@pkgs openssh-server phosh', '@ done'].join('\n');
  assert.equal((await fetch(url[1], { method: 'POST', body: output })).status, 200);
  await test4.getByText('Report card', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await test4.locator('.bench-tile.full').count(), 2);
  assert.match(await test4.locator('.bench-tile.needs-confirmation').filter({ hasText: 'touch' }).innerText(), /needs confirmation/);
  assert.match(await test4.locator('.bench-tile.needs-confirmation').filter({ hasText: 'audio' }).innerText(), /needs confirmation/);
  assert.match(await test4.locator('.bench-tile.inconclusive').innerText(), /GPS[\s\S]*\? inconclusive/);
  assert.match(await test4.locator('.bench-debug pre').textContent() ?? '', /gps: probe p_gps exit 2: mmcli: not found\ntools nmcli/);
  assert.match(await test4.locator('.rating', { hasText: 'found in 2 packages' }).innerText(), /✓ SSH[\s\S]*✗ Docker \*/);
  const root = test4.locator('.rating', { hasText: 'found in 2 packages' }).locator('.feature.partial', { hasText: 'Root' });
  assert.equal(await root.innerText(), '~ Root');
  assert.match(await root.getAttribute('title') ?? '', /sudo requires interactive authentication/);
  assert.match(await test4.locator('.hints', { hasText: 'Change the default password' }).innerText(), /ssh -t -- 'user@192\.168\.1\.77' passwd/);
  assert.equal(await test4.locator('.bench-q').count(), 3, 'three questions at first');
  assert.match(await test4.locator('.bench-q').first().innerText(), /Does touch follow your finger/);
  await test4.locator('.bench-q').first().getByRole('button', { name: '👍 yes' }).click();
  assert.match(await test4.locator('.bench-tile.full').filter({ hasText: 'touch' }).innerText(), /✓ full/);
  assert.equal(await test4.locator('.bench-tile.needs-confirmation').filter({ hasText: 'touch' }).count(), 0, 'answer clears the pending confirmation label');
  await test4.getByRole('button', { name: /Answer more/ }).click();
  assert.ok(await test4.locator('.bench-q').count() > 10, 'all questions on request');
  const camera = test4.locator('.bench-tile', { hasText: 'camera' }).first();
  await camera.click(); // broken → blocked
  assert.match(await camera.getAttribute('class') ?? '', /blocked/);
  const note = test4.locator('textarea.confirmation-input');
  await note.fill('Saved correction after autosubmit');
  await test4.getByText('Report autosubmitted. Changes save automatically until review starts.', { exact: true }).waitFor();
  assert.equal(await test4.getByRole('button', { name: 'Send report card' }).count(), 0, 'there is no manual submit step');
  assert.equal(await test4.locator(':scope > summary .badge').innerText(), 'COMPLETED', 'optional section 4 goes green once sent');
  assert.ok(await test4.evaluate(el => el.classList.contains('done')));
  const code = url[1].split('/').pop();
  const row = d1Rows(`SELECT final, note, submitted FROM bench_runs WHERE code = '${code}'`)[0];
  assert.ok(row?.submitted, 'the initial report autosubmits before edits');
  const submittedAt = row.submitted;
  const savedFinal = JSON.parse(row.final);
  assert.equal(savedFinal.touch, 'full'); assert.equal(savedFinal.camera, 'blocked'); assert.equal(savedFinal.gps, 'inconclusive');
  assert.equal(row.note, 'Saved correction after autosubmit');
  assert.equal(d1Rows(`SELECT code FROM bench_runs WHERE code = '${code}'`).length, 1, 'corrections update the same report');
  assert.equal(d1Rows(`SELECT submitted FROM bench_runs WHERE code = '${code}'`)[0].submitted, submittedAt, 'edits retain the original submission time');
  assert.equal((await fetch(url[1])).status, 404, 'code closes after submit');
  assert.match(d1('--command', `SELECT inbox FROM inbox WHERE ref = '${code}'`), /"inbox": "benchmarks"/, 'submitted card lands in the benchmarks inbox');
});

test('autosave retries a failed submit, locks edits on review conflict, and Retest resets the card', async () => {
  const writes = [];
  await page.route('**/api/bench', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    if (body.discard === true || !body.code) return route.continue();
    writes.push(body.code);
    if (writes.length === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporary backend failure' }) });
    if (writes.length === 2) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'This report has entered review' }) });
  });
  try {
    await page.goto(`${BASE}/?device=laurel_sprout`);
    const test4 = page.locator('details.page-section', { hasText: '4 · Test your phone' });
    await test4.locator('summary').first().click();
    await test4.getByRole('button', { name: 'Start a phone test' }).click();
    const command = await test4.locator('.bench-command').innerText();
    const url = command.match(/curl -fsSL (\S+)/)[1];
    const code = url.split('/').pop();
    await fetch(url, { method: 'POST', body: '@ script linux 2\n@ model Xiaomi Mi A3\nbattery full 50%\n@ done\n' });
    await test4.getByText('Report card', { exact: true }).waitFor({ timeout: 10000 });
    await test4.getByText('Not saved: temporary backend failure. Retry when connected.').waitFor();
    assert.equal(await test4.getByRole('button', { name: 'Retry saving' }).isVisible(), true);
    assert.deepEqual(writes, [code], 'the initial failed write targets the active report code');
    await test4.getByRole('button', { name: 'Retry saving' }).click();
    await test4.getByText('Report autosubmitted. Changes save automatically until review starts.', { exact: true }).waitFor();
    assert.deepEqual(writes, [code, code], 'retry updates the same code and completes autosubmit');

    await test4.locator('.bench-tile', { hasText: 'battery' }).first().click();
    await test4.getByText(/Not saved: This report has entered review/).waitFor();
    assert.deepEqual(writes, [code, code, code], 'review conflict is returned for an edit on the same code');
    assert.equal(await test4.locator('textarea.confirmation-input').isDisabled(), true, 'notes lock after review begins');
    assert.equal(await test4.locator('.bench-tile').first().isDisabled(), true, 'feature tiles lock after review begins');
    assert.equal(await test4.locator('.bench-q button').first().isDisabled(), true, 'answers lock after review begins');
    assert.equal(await test4.getByRole('button', { name: /Answer more/ }).isDisabled(), true, 'the extra question control also locks');
    assert.equal(await test4.getByRole('button', { name: 'Retry saving' }).isVisible(), false, 'a review conflict cannot be retried as an autosave');
    assert.equal(await test4.getByRole('button', { name: 'Retest', exact: true }).isEnabled(), true, 'Retest remains available');

    await test4.getByRole('button', { name: 'Retest', exact: true }).click();
    await test4.getByRole('button', { name: 'Start a phone test' }).waitFor();
    assert.equal(await test4.locator('.bench-tile').count(), 0, 'Retest clears the locked report card');
    const discarded = await page.evaluate(async code => (await fetch('./api/bench', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, discard: true }) })).status, code);
    assert.equal(discarded, 200, 'remove the test report created by this fixture');
    await page.evaluate(() => localStorage.removeItem('progress:laurel_sprout'));
  } finally {
    await page.unroute('**/api/bench');
  }
});

test('old benchmark output uses root packages as unverified evidence', async () => {
  await page.goto(`${BASE}/?device=laurel_sprout`);
  const test4 = page.locator('details.page-section', { hasText: '4 · Test your phone' });
  await test4.locator('summary').first().click();
  await test4.getByRole('button', { name: 'Start a phone test' }).click();
  const command = await test4.locator('.bench-command').innerText();
  const url = command.match(/curl -fsSL (\S+) \|/);
  assert.ok(url, command);
  assert.equal((await fetch(url[1], { method: 'POST', body: '@ script linux 1\n@pkgs sudo-rs\n@ done' })).status, 200);
  await test4.getByText('Report card', { exact: true }).waitFor({ timeout: 10000 });
  const root = test4.locator('.rating', { hasText: 'found in 1 packages' }).locator('.feature.partial', { hasText: 'Root' });
  assert.equal(await root.innerText(), '~ Root');
  assert.match(await root.getAttribute('title') ?? '', /root package found; access not verified/);
  await test4.getByRole('button', { name: 'Discard test' }).click();
});

test('root marker renders alone when package inventory is unavailable', async () => {
  await page.goto(`${BASE}/?device=laurel_sprout`);
  const test4 = page.locator('details.page-section', { hasText: '4 · Test your phone' });
  await test4.locator('summary').first().click();
  await test4.getByRole('button', { name: 'Start a phone test' }).click();
  const command = await test4.locator('.bench-command').innerText();
  const url = command.match(/curl -fsSL (\S+) \|/);
  assert.ok(url, command);
  const output = '@ script linux 1\n@root missing uid 0 and noninteractive sudo/doas not found; interactive root not tested\n@ done';
  assert.equal((await fetch(url[1], { method: 'POST', body: output })).status, 200);
  await test4.getByText('Report card', { exact: true }).waitFor({ timeout: 10000 });
  const root = test4.locator('.rating', { hasText: 'Root' });
  assert.equal(await root.locator('.feature').count(), 1);
  assert.equal(await root.locator('.feature').innerText(), '· Root');
  assert.match(await root.locator('.feature').getAttribute('title') ?? '', /interactive root not tested/);
  await test4.getByRole('button', { name: 'Discard test' }).click();
});

test('Android phone test offers SSH and sends its password only to the paired local CLI', async () => {
  const helperCalls = [], webBenchPosts = [], localPort = 49153, localUrl = `http://127.0.0.1:${localPort}`;
  let helperUploadStatus;
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 77, name: 'Local test user', roles: [] }, providers: [] } }));
  await page.route('**/api/bench', async route => {
    if (route.request().method() === 'POST') webBenchPosts.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.route('**/catalog/laurel_sprout.json', async route => {
    const response = await route.fetch(), device = await response.json();
    for (const rom of device.roms) { rom.os = 'Android'; rom.login = 'catalog-user / catalog-password'; }
    await route.fulfill({ response, json: device });
  });
  await page.route(`${localUrl}/**`, async route => {
    const request = route.request(), headers = {
      'access-control-allow-origin': BASE,
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-private-network': 'true',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const call = { path: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON() };
    helperCalls.push(call);
    if (call.path === '/bench') {
      const upload = await fetch(`${BASE}/b/${call.body.code}`, { method: 'POST', body: '@ script linux 1\n@ model Xiaomi Mi A3\nbattery full 80%\n@ done\n' });
      helperUploadStatus = upload.status;
    }
    return route.fulfill({ headers, json: request.url().endsWith('/status')
      ? { user: { id: 77, name: 'Local test user' }, capabilities: ['bench'] } : { ok: true } });
  });
  try {
    await page.goto(`${BASE}/?device=laurel_sprout`);
    const hostDialog = page.locator('.host-confirm');
    if (await hostDialog.isVisible().catch(() => false)) await hostDialog.getByRole('button', { name: 'Confirm' }).click();
    await page.evaluate(({ url, expiresAt }) => localStorage.setItem('rominit.helper', JSON.stringify({
      url, token: 't'.repeat(43), user: { id: 77, name: 'Local test user' }, expiresAt,
    })), { url: localUrl, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const test4 = page.locator('details.page-section', { hasText: '4 · Test your phone' });
    await test4.locator('summary').first().click();
    await test4.getByRole('button', { name: 'Start a phone test' }).click();
    await test4.getByRole('tab', { name: 'SSH from a computer' }).click();
    const login = test4.locator('.bench-login');
    assert.equal(await login.isVisible(), true);
    assert.equal(await login.getByLabel('Password').getAttribute('type'), 'password');
    assert.equal(await login.getByLabel('User').inputValue(), 'catalog-user', 'user defaults from the ROM login');
    assert.equal(await login.getByLabel('Password').inputValue(), 'catalog-password', 'password defaults from the ROM login');
    await test4.getByLabel(/Phone IP address/).fill('192.0.2.10');
    await login.getByLabel('User').fill('tester');
    await login.getByLabel('Password').fill('local-only-password');
    assert.match(await test4.locator('.bench-command').innerText(), /ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -- 'tester@192\.0\.2\.10'/);
    assert.doesNotMatch(await test4.locator('.bench-command').innerText(), /local-only-password/);
    await login.getByLabel('User').fill('tester$(touch /tmp/rominit-ui-injection)');
    assert.match(await test4.locator('.bench-command').innerText(), /-- 'tester\$\(touch \/tmp\/rominit-ui-injection\)@192\.0\.2\.10'/, 'hostile text stays quoted as one literal SSH destination');
    await login.getByLabel('User').fill('tester');
    await test4.getByRole('button', { name: 'Run with CLI' }).click();
    await test4.locator('.bench-card-header').waitFor({ timeout: 10000 });
    assert.equal(helperUploadStatus, 200, 'the paired helper sends its script output to the browser report');
    await test4.getByText('Report autosubmitted. Changes save automatically until review starts.', { exact: true }).waitFor();
    assert.equal(await test4.getByRole('button', { name: 'Send report card' }).count(), 0);
    const firstCode = helperCalls.find(call => call.path === '/bench')?.body.code;
    assert.ok(firstCode);
    assert.deepEqual(helperCalls.filter(call => call.path === '/bench').map(call => call.body), [{
      code: firstCode, rom: webBenchPosts[0].rom,
      host: '192.0.2.10', user: 'tester', password: 'local-only-password',
    }]);
    assert(!/catalog-user|catalog-password|tester|local-only-password|192\.0\.2\.10/.test(JSON.stringify(webBenchPosts)), 'website API receives no SSH credentials or IP');
    const storage = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
    assert(!/catalog-user|catalog-password|tester|local-only-password|192\.0\.2\.10/.test(storage), 'credentials and custom IP stay out of persistent browser storage');
    await test4.locator('.bench-tile', { hasText: 'battery' }).first().click();
    await test4.locator('textarea.confirmation-input').fill('Retest should flush this note');
    await test4.getByRole('button', { name: 'Retest', exact: true }).click();
    await test4.getByRole('button', { name: 'Start a phone test' }).waitFor();
    await test4.getByRole('button', { name: 'Start a phone test' }).click();
    await test4.getByRole('tab', { name: 'SSH from a computer' }).click();
    assert.equal(await test4.getByLabel(/Phone IP address/).inputValue(), '192.0.2.10', 'Retest keeps the custom IP in tab memory');
    assert.equal(await test4.locator('.bench-login').getByLabel('User').inputValue(), 'tester');
    assert.equal(await test4.locator('.bench-login').getByLabel('Password').inputValue(), 'local-only-password');
    await test4.getByRole('button', { name: 'Discard test', exact: true }).click();
    await test4.getByRole('button', { name: 'Start a phone test' }).waitFor();
    const cleaned = await page.evaluate(async code => (await fetch('./api/bench', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, discard: true }) })).status, firstCode);
    assert.equal(cleaned, 200, 'clean up the first autosubmitted report after checking Retest');
    await page.evaluate(() => localStorage.removeItem('progress:laurel_sprout'));
    await page.route(`${localUrl}/status`, route => route.abort());
    await page.reload();
    await test4.locator('summary').first().click();
    await test4.getByRole('button', { name: 'Start a phone test' }).click();
    await test4.getByRole('tab', { name: 'SSH from a computer' }).click();
    assert.equal(await test4.getByLabel(/Phone IP address/).inputValue(), '', 'custom IP is tab memory, not persisted across reload');
    await test4.getByLabel(/Phone IP address/).fill('192.0.2.10');
    await test4.getByRole('button', { name: 'Run with CLI' }).click();
    await test4.getByText(/Could not find a running ROMinit CLI/).waitFor();
    assert.equal(await test4.getByRole('link', { name: 'Reconnect CLI', exact: true }).count(), 0, 'connection failures do not send users through a redundant pairing page');
    assert.doesNotMatch(await test4.locator('[role=status]').innerText(), /check the phone address and SSH login/);
    await test4.getByRole('button', { name: 'Discard test', exact: true }).click();

  } finally {
    await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); }).catch(() => {});
    await page.unroute('**/api/me'); await page.unroute('**/api/bench'); await page.unroute('**/catalog/laurel_sprout.json'); await page.unroute(`${localUrl}/**`); await page.unroute(`${localUrl}/status`);
  }
});

test('Linux CLI USB targets scope IPv6 and send SSH credentials only to the loopback helper', async () => {
  const helperCalls = [], webBenchPosts = [], localPort = 49154, localUrl = `http://127.0.0.1:${localPort}`;
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 88, name: 'USB test user', roles: [] }, providers: [] } }));
  await page.route('**/api/bench', async route => {
    if (route.request().method() === 'POST') webBenchPosts.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.route(`${localUrl}/**`, async route => {
    const request = route.request(), headers = {
      'access-control-allow-origin': BASE,
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-private-network': 'true',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const call = { path: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON() };
    helperCalls.push(call);
    const json = call.path === '/status'
      ? { user: { id: 88, name: 'USB test user' }, capabilities: ['bench', 'bench-targets', 'bench-sound'] }
      : call.path === '/bench/targets'
        ? { targets: [
          { host: '192.0.2.2', interface: 'usb0', label: 'USB peer' },
          { host: 'fe80::2', interface: 'usb0', label: 'IPv6 peer' },
        ], interfaces: [{ name: 'rndis1', addresses: [] }] }
        : { ok: true };
    return route.fulfill({ headers, json });
  });
  try {
    await page.goto(`${BASE}/?device=laurel_sprout`);
    const hostDialog = page.locator('.host-confirm');
    if (await hostDialog.isVisible().catch(() => false)) await hostDialog.getByRole('button', { name: 'Confirm' }).click();
    await page.evaluate(({ url, expiresAt }) => localStorage.setItem('rominit.helper', JSON.stringify({
      url, token: 'u'.repeat(43), user: { id: 88, name: 'USB test user' }, expiresAt,
    })), { url: localUrl, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const test4 = page.locator('#phone-test');
    await test4.locator('summary').first().click();
    await test4.getByRole('button', { name: /^(Start a phone test|Run with CLI)$/ }).click();
    await test4.getByRole('tab', { name: 'USB cable' }).click();
    const targets = test4.getByRole('combobox', { name: 'USB-network phone' });
    await targets.waitFor({ state: 'visible' });
    await targets.locator('option', { hasText: 'IPv6 peer' }).waitFor({ state: 'attached' });
    await test4.getByLabel(/Phone IP address/).waitFor({ state: 'visible' });
    assert.equal(await test4.getByLabel(/Phone IP address/).inputValue(), '172.16.42.1', 'manual address entry remains available');
    assert.equal(helperCalls.filter(call => call.path === '/bench').length, 0, 'discovery never starts a benchmark by itself');
    await targets.selectOption('fe80::2%usb0');
    assert.equal(await test4.getByLabel(/Phone IP address/).inputValue(), 'fe80::2%usb0');
    assert.match(await test4.locator('.bench-command').innerText(), /-- 'user@fe80::2%usb0'/, 'IPv6 link-local host keeps its interface zone');
    await test4.locator('.bench-login').getByLabel('User').fill('usb-tester');
    await test4.locator('.bench-login').getByLabel('Password').fill('loopback-secret');
    await test4.getByLabel('Also check speaker and vibration').check();
    await test4.getByRole('button', { name: 'Run with CLI' }).click();
    await test4.getByRole('button', { name: 'CLI run complete' }).waitFor();
    const run = helperCalls.find(call => call.path === '/bench');
    assert.match(run?.body.code ?? '', /^[a-z2-9]{8}$/, 'helper receives the active run code');
    assert.equal(run.body.rom, webBenchPosts[0].rom);
    assert.equal(run.body.host, 'fe80::2%usb0');
    assert.equal(run.body.user, 'usb-tester'); assert.equal(run.body.password, 'loopback-secret');
    assert.equal(run.body.sound, true, 'checked sound preference is sent to a CLI that advertises bench-sound');
    assert(!/usb-tester|loopback-secret|fe80::2%usb0|192\.0\.2\.2/.test(JSON.stringify(webBenchPosts)), 'website API receives no SSH credentials or discovered targets');
    const storage = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
    assert(!/usb-tester|loopback-secret|fe80::2%usb0|192\.0\.2\.2/.test(storage), 'credentials and discovered addresses stay out of persistent browser storage');
    await test4.getByRole('button', { name: 'Discard test', exact: true }).click();
  } finally {
    await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); }).catch(() => {});
    await page.unroute('**/api/me'); await page.unroute('**/api/bench'); await page.unroute(`${localUrl}/**`);
  }
});

test('old CLI blocks a checked sound run until bench-sound support is available', async () => {
  const helperCalls = [], localPort = 49155, localUrl = `http://127.0.0.1:${localPort}`;
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 89, name: 'Sound test user', roles: [] }, providers: [] } }));
  await page.route('**/catalog/laurel_sprout.json', async route => {
    const response = await route.fetch(), device = await response.json();
    for (const rom of device.roms) rom.os = 'Android';
    await route.fulfill({ response, json: device });
  });
  await page.route(`${localUrl}/**`, async route => {
    const request = route.request(), headers = {
      'access-control-allow-origin': BASE,
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-private-network': 'true',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const call = { path: new URL(request.url()).pathname, body: request.postDataJSON() };
    helperCalls.push(call);
    const json = call.path === '/status'
      ? { user: { id: 89, name: 'Sound test user' }, capabilities: ['bench'] }
      : { ok: true };
    return route.fulfill({ headers, json });
  });
  try {
    await page.goto(`${BASE}/?device=laurel_sprout`);
    const hostDialog = page.locator('.host-confirm');
    if (await hostDialog.isVisible().catch(() => false)) await hostDialog.getByRole('button', { name: 'Confirm' }).click();
    await page.evaluate(({ url, expiresAt }) => localStorage.setItem('rominit.helper', JSON.stringify({
      url, token: 's'.repeat(43), user: { id: 89, name: 'Sound test user' }, expiresAt,
    })), { url: localUrl, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const test4 = page.locator('#phone-test');
    await test4.locator('summary').first().click();
    await test4.getByRole('button', { name: 'Start a phone test' }).click();
    await test4.getByRole('tab', { name: 'SSH from a computer' }).click();
    await test4.getByLabel(/Phone IP address/).fill('192.0.2.10');
    await test4.getByLabel('Also check speaker and vibration').check();
    await test4.getByRole('button', { name: 'Run with CLI' }).click();
    await test4.getByText('Update and reconnect the CLI to run speaker and vibration checks, or use the copied terminal command.', { exact: true }).waitFor();
    assert.equal(helperCalls.filter(call => call.path === '/bench').length, 0, 'old CLI never receives a sound run it cannot honor');
    await test4.getByRole('button', { name: 'Discard test', exact: true }).click();
  } finally {
    await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); }).catch(() => {});
    await page.unroute('**/api/me'); await page.unroute('**/catalog/laurel_sprout.json'); await page.unroute(`${localUrl}/**`);
  }
});

test('USB discovery shows detected interfaces without an IP and keeps manual entry available', async () => {
  const helperCalls = [], localPort = 49156, localUrl = `http://127.0.0.1:${localPort}`;
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 90, name: 'USB metadata user', roles: [] }, providers: [] } }));
  await page.route(`${localUrl}/**`, async route => {
    const request = route.request(), headers = {
      'access-control-allow-origin': BASE,
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-private-network': 'true',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const call = { path: new URL(request.url()).pathname, body: request.postDataJSON() };
    helperCalls.push(call);
    const json = call.path === '/status'
      ? { user: { id: 90, name: 'USB metadata user' }, capabilities: ['bench', 'bench-targets'] }
      : call.path === '/bench/targets'
        ? { targets: [], interfaces: [{ name: 'rndis0', addresses: [] }] }
        : { ok: true };
    return route.fulfill({ headers, json });
  });
  try {
    await page.goto(`${BASE}/?device=laurel_sprout`);
    const hostDialog = page.locator('.host-confirm');
    if (await hostDialog.isVisible().catch(() => false)) await hostDialog.getByRole('button', { name: 'Confirm' }).click();
    await page.evaluate(({ url, expiresAt }) => localStorage.setItem('rominit.helper', JSON.stringify({
      url, token: 'i'.repeat(43), user: { id: 90, name: 'USB metadata user' }, expiresAt,
    })), { url: localUrl, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const test4 = page.locator('#phone-test');
    await test4.locator('summary').first().click();
    await test4.getByRole('button', { name: /^(Start a phone test|Run with CLI)$/ }).click();
    await test4.getByRole('tab', { name: 'USB cable' }).click();
    const targets = test4.getByRole('combobox', { name: 'USB-network phone' });
    await targets.waitFor({ state: 'visible' });
    const noAddress = targets.getByRole('option', { name: 'rndis0 — no IP address configured' });
    await noAddress.waitFor({ state: 'attached' });
    const optionState = await noAddress.evaluate(option => ({ disabled: option.disabled, html: option.outerHTML }));
    assert.equal(optionState.disabled, true, `interface without an address is informational, not selectable: ${JSON.stringify(optionState)}`);
    await test4.getByText('USB-network adapter detected, but no usable phone address. Configure the USB network connection or use Wi-Fi; the helper does not change network settings.', { exact: true }).waitFor();
    await test4.getByText('USB-network adapter detected without a peer address. Wi-Fi SSH or manual entry is available.', { exact: true }).waitFor();
    assert.equal(await test4.getByLabel(/Phone IP address/).isVisible(), true, 'manual IP entry remains available');
    assert.equal(helperCalls.filter(call => call.path === '/bench').length, 0, 'interface discovery does not start a benchmark');
    await test4.getByRole('button', { name: 'Discard test', exact: true }).click();
  } finally {
    await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); }).catch(() => {});
    await page.unroute('**/api/me'); await page.unroute(`${localUrl}/**`);
  }
});

test('pick a username: checked, unique, kept; email never shown', async () => {
  await signIn('grace');
  await page.goto(`${BASE}/?device=starlte`);
  const edit = page.locator('.topbar-side .account button', { hasText: 'grace ✎' });
  await edit.click();
  const form = page.locator('#username');
  await form.locator('input').fill('grace@example.com');
  await form.getByRole('button', { name: 'Save' }).click();
  await form.getByText('2 to 30 letters').waitFor();
  await form.locator('input').fill('ADA');
  await form.getByRole('button', { name: 'Save' }).click();
  await form.getByText('that name is taken').waitFor();
  await form.locator('input').fill('Grace H');
  await form.getByRole('button', { name: 'Save' }).click();
  await page.locator('.topbar-side .account button', { hasText: 'Grace H ✎' }).waitFor();
  await signIn(null);
});

test('favorites: ♡ asks signed-out users to sign in; signed in it toggles and lists on the favorites page', async () => {
  await signIn(null);
  await page.goto(`${BASE}/?device=laurel_sprout`);
  await page.locator('.favorite', { hasText: '♡ Favorite · 0' }).click();
  await page.locator('#signin .signin-badge').first().waitFor();
  await page.keyboard.press('Escape');
  await signIn('linus');
  await page.reload();
  await page.locator('.favorite', { hasText: '♡ Favorite · 0' }).click();
  await page.locator('.favorite', { hasText: '♥ Favorited · 1' }).waitFor();
  await page.goto(`${BASE}/?view=favorites`);
  await page.locator('.flash-card', { hasText: 'Your favorites' }).getByRole('link', { name: 'Xiaomi Mi A3' }).waitFor();
  await page.goto(`${BASE}/?device=laurel_sprout`);
  await page.locator('.favorite', { hasText: '♥ Favorited · 1' }).click();
  await page.locator('.favorite', { hasText: '♡ Favorite · 0' }).waitFor();
  await signIn(null);
});

test('maintainer: scraped placeholder is marked unverified until someone claims the ROM', async () => {
  await page.goto(`${BASE}/?device=laurel_sprout`);
  const row = page.locator('.rating', { has: page.locator('strong', { hasText: 'maintainer' }) });
  await row.locator('.maintainer-hint', { hasText: 'philipplinux' }).waitFor();
  assert.match(await row.innerText(), /unverified · found at github\.com · subject to verification/);
});

test('report form', async () => {
  await page.goto(`${BASE}/?device=starlte`);
  await page.locator('.report summary').click();
  await page.locator('.report textarea').fill('bench report');
  await page.getByRole('button', { name: 'Send ticket' }).click();
  await page.getByText('Thanks, ticket sent.').waitFor();
  assert.match(d1('--command', 'SELECT page FROM reports'), /device=starlte/);
});

test('admin OS-USB inbox shows safe operational outcomes and files them without ROM approval', async () => {
  const leaked = ['PRIVATE_USER', 'PRIVATE_HOST', 'PRIVATE_PATH', 'PRIVATE_SERIAL', 'PRIVATE_IP', 'PRIVATE_RAW_LOG', 'PRIVATE_DRIVE_ID', 'PRIVATE_HASH'];
  let filed = null;
  const inbox = {
    reports: [], benchmarks: { new: [], review: [], approved: [], rejected: [] }, cli: { new: [], review: [], approved: [], rejected: [] },
    failures: [], requests: { new: [], update: [], mirror: [] }, agents: { success: [], partial: [], failed: [], abandoned: [] },
    osUsb: {
      success: [{ jobId: 'safeSuccessJob_123', method: 'direct', action: 'direct', outcome: 'success', at: '2026-10-21 05:10:00',
        image: { id: 'genericLocalISO', name: 'Local ISO', size: 64 * 1024 ** 2, sha256: 'PRIVATE_HASH', path: 'PRIVATE_PATH' },
        drive: { capacityBytes: 2 * 1024 ** 3, id: 'PRIVATE_DRIVE_ID', path: 'PRIVATE_PATH', model: 'PRIVATE_HOST', serial: 'PRIVATE_SERIAL' },
        verification: { source: 'verified' }, readback: { size: 64 * 1024 ** 2, matched: true, sha256: 'PRIVATE_HASH' },
        environment: { hostOs: 'linux', hostOsVersion: '44', hostDistro: 'fedora', hostArch: 'x64', kernelVersion: '6.12.4', cliVersion: 'e7ac927798be', nodeVersion: '24.18.0', browser: 'chrome', browserVersion: '140.0.7339.0', browserOs: 'linux', browserOsVersion: '6.12.4' },
        user: 'PRIVATE_USER', host: 'PRIVATE_HOST', ip: 'PRIVATE_IP', log: 'PRIVATE_RAW_LOG' }],
      failed: [{ jobId: 'safeFailedJob_456', method: 'ventoy', action: 'install', outcome: 'failed', at: '2026-10-21 05:20:00',
        image: { id: 'none', name: 'No ISO', size: 0 }, drive: { capacityBytes: 16 * 1024 ** 3 },
        verification: { source: 'none' }, failureCode: 'readback', rawError: 'PRIVATE_RAW_LOG', account: 'PRIVATE_USER' }]
    },
    labels: ['script-fix', 'recipe-fix', 'user-side', 'catalog-update', 'site-bug', 'device-report', 'spam', 'other']
  };
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 901, name: 'Inbox tester', roles: [{ role: 'admin' }] }, providers: [] } }));
  await page.route('**/api/inbox', async route => {
    if (route.request().method() === 'POST') { filed = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: inbox });
  });
  await page.route('**/api/searches', route => route.fulfill({ json: [] }));
  try {
    await page.goto(`${BASE}/?view=inbox`);
    const folders = page.locator('.inbox-group');
    await folders.nth(4).locator(':scope > summary').getByText('05 OS-USB · 2').waitFor();
    await folders.nth(5).locator(':scope > summary').getByText('06 Searches · 0').waitFor();
    await folders.nth(6).locator(':scope > summary').getByText('07 Requests · 0').waitFor();
    const osUsb = folders.nth(4), reports = osUsb.locator('.os-usb-report');
    assert.equal(await reports.count(), 2);
    const success = reports.filter({ hasText: 'USB operation succeeded' });
    assert.match(await success.innerText(), /Local ISO · ID genericLocalISO · 64\.0 MiB/);
    assert.match(await success.innerText(), /Direct image write · write image · USB capacity 2\.00 GiB/);
    assert.match(await success.innerText(), /Source checksum verified · USB readback matched · 64\.0 MiB/);
    assert.match(await success.innerText(), /Technical environment: Host Fedora Linux 44 · x64 · kernel 6\.12\.4 · Chrome 140\.0\.7339\.0 on Linux platform 6\.12\.4 · ROMinit CLI e7ac927798be · Node\.js 24\.18\.0/);
    const failed = reports.filter({ hasText: 'USB operation failed' });
    assert.match(await failed.innerText(), /Ventoy · install Ventoy · USB capacity 16\.00 GiB/);
    assert.match(await failed.innerText(), /Source checksum not reported · USB readback not available/);
    assert.match(await failed.innerText(), /USB readback verification failed/);
    const rendered = await osUsb.innerText();
    for (const secret of leaked) assert.equal(rendered.includes(secret), false, `UI leaked ${secret}`);
    assert.match(rendered, /Filing classifies this report; it does not approve or change any phone ROM rating/);
    assert.equal(await osUsb.getByRole('button', { name: 'Approve' }).count(), 0, 'USB outcomes do not get phone-rating approval controls');
    await failed.locator('select').selectOption('device-report');
    const post = page.waitForRequest(request => request.url().endsWith('/api/inbox') && request.method() === 'POST');
    await failed.getByRole('button', { name: 'File' }).click();
    await post;
    assert.deepEqual(filed, { inbox: 'os-usb', ref: 'safeFailedJob_456', label: 'device-report' });
    await failed.waitFor({ state: 'detached' });
    await osUsb.locator(':scope > summary').getByText('05 OS-USB · 1').waitFor();
    assert.match(await osUsb.locator(':scope > summary').innerText(), /1 success · 0 failed · unreviewed outcomes/i);
    assert.match(await osUsb.innerText(), /Failed · 0/i);
  } finally {
    await page.unroute('**/api/me'); await page.unroute('**/api/inbox'); await page.unroute('**/api/searches');
  }
});

test('phone width: no horizontal scroll', async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['/', '/?device=starlte', '/?device=laurel_sprout']) {
    await page.goto(BASE + path);
    await page.locator('main > *').first().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} scrolls sideways`);
  }
});

test('no script errors on any page', () => assert.deepEqual(errors, []));

test('discard a phone test removes its report and invalidates the pending run', async () => {
  await page.goto(`${BASE}/?device=laurel_sprout`);
  await page.evaluate(() => localStorage.removeItem('progress:laurel_sprout'));
  await page.reload();
  const box = page.locator('details.page-section', { hasText: '4 · Test your phone' });
  await box.locator('summary').first().click();
  await box.getByRole('button', { name: 'Start a phone test' }).click();
  const command = await box.locator('.bench-command').innerText();
  const url = command.match(/curl -fsSL (\S+)/)[1];
  await fetch(url, { method: 'POST', body: '@ script linux 2\n@ model Xiaomi Mi A3\nbattery full 50%\n@ done\n' });
  await box.getByText('Report card', { exact: true }).waitFor({ timeout: 10000 });
  await box.getByText('Report autosubmitted. Changes save automatically until review starts.', { exact: true }).waitFor();
  const code = url.split('/').pop();
  const before = d1Rows(`SELECT code, rom, submitted FROM bench_runs WHERE code = '${code}'`)[0];
  assert.ok(before?.submitted, 'the report is already submitted before the user discards it');
  const tile = await box.locator('.bench-tile').first().boundingBox();
  assert.ok(tile && tile.height >= 44 && tile.height <= 80, 'compact tiles retain a usable touch target');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile report has no horizontal overflow');
  await page.screenshot({ path: '/tmp/rominit-compact-report-mobile.png', fullPage: true });
  await box.getByRole('button', { name: 'Discard test', exact: true }).click();
  await box.getByRole('button', { name: 'Start a phone test' }).waitFor();
  assert.equal(await box.locator('.bench-tile').count(), 0);
  assert.equal(d1Rows(`SELECT code FROM bench_runs WHERE code = '${code}'`).length, 0, 'discard removes the autosubmitted pending report');
  assert.equal((await fetch(url)).status, 404, 'discarded run cannot receive another upload');
  assert.equal(await box.locator(':scope > summary .badge').innerText(), 'OPTIONAL', 'discard clears the completed badge');
  assert.equal(await box.evaluate(el => el.classList.contains('done')), false);
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('progress:laurel_sprout') ?? '{}'));
  const romId = before.rom.split('/')[1];
  assert.equal((progress.cards?.[romId] ?? []).includes(code), false, 'discard removes this code from the browser card list');
  assert.equal((progress.tested ?? []).includes(romId), false, 'discard clears tested progress when no card remains');
});

test('benchmark ROM picker reminds the installed ROM and stays on the benchmark when switching', async () => {
  await page.goto(`${BASE}/?device=starlte`);
  let box = page.locator('#phone-test');
  await box.locator('summary').first().click();
  const picker = box.getByRole('combobox', { name: 'Installed ROM for this test' });
  assert.notEqual(await picker.inputValue(), 'philipplinux-pmos-server');
  await picker.selectOption('philipplinux-pmos-server');
  await page.waitForURL(/rom=philipplinux-pmos-server#phone-test$/);
  box = page.locator('#phone-test');
  await box.getByRole('button', { name: 'Start a phone test' }).waitFor();
  assert.equal(await box.evaluate(el => el.open), true);
  assert.equal(await box.getByRole('combobox', { name: 'Installed ROM for this test' }).inputValue(), 'philipplinux-pmos-server');
  assert.match(await box.innerText(), /Testing postmarketOS/);
  assert.equal(await page.locator('.rom-pick select').inputValue(), 'philipplinux-pmos-server', 'both selectors agree');
});

test('Alpine Linux parent defaults to Extended and shows architecture badges, downloads, logo and auto-looping operation GIF', async () => {
  await page.goto(`${BASE}/alpine.html`);
  await page.getByRole('heading', { name: 'Alpine Linux.' }).waitFor();
  const ventoySupportedCount = ALPINE.editions.flatMap(edition => edition.images).filter(image => image.usb === true).length;
  assert.equal(ventoySupportedCount, 9, 'catalog marks nine images as Ventoy supported');
  assert.equal(await page.locator('#alpine-edition').inputValue(), 'extended', 'Extended is the default edition when no query selection exists');
  assert.equal(await page.locator('.alpine-image').count(), 2, 'the default Extended edition has two ISO choices');
  assert.equal(await page.locator('#alpine-edition option').count(), 8);
  assert.equal(await page.locator('#alpine-version').innerText(), 'Version 3.24.2 · Stable');
  assert.equal(await page.getByLabel('USB install type').isDisabled(), true, 'USB method placeholder is visible before image selection');
  assert.equal(await page.getByLabel('USB drive', { exact: true }).isDisabled(), true, 'USB selector remains visible before pairing');
  assert.equal(await page.locator('#alpine-usb-method').evaluate(node => !!(node.compareDocumentPosition(document.querySelector('#alpine-usb-drive')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'method placeholder precedes the drive selector');
  await page.locator('#alpine-edition').selectOption('standard');
  assert.equal(await page.locator('.alpine-image').count(), 8);
  assert.equal(await page.locator('.ventoy-supported').count(), ALPINE.editions[0].images.filter(image => image.usb === true).length);
  assert.equal(await page.locator('.ventoy-supported').count(), 3, 'Standard shows a Ventoy badge only on its three supported ISO cards');
  const desktopEditionMetrics = await page.evaluate(() => {
    const row = document.querySelector('.alpine-selection').getBoundingClientRect();
    const description = document.querySelector('#alpine-edition-description').getBoundingClientRect();
    const select = document.querySelector('#alpine-edition').getBoundingClientRect();
    const release = document.querySelector('#alpine-release');
    const releaseStyle = getComputedStyle(release);
    return { gap: description.top - row.bottom, selectHeight: select.height, releaseLineHeight: parseFloat(releaseStyle.lineHeight), releasePadding: parseFloat(releaseStyle.paddingTop) };
  });
  assert.ok(desktopEditionMetrics.gap >= 12, `desktop edition summary gap ${desktopEditionMetrics.gap}px`);
  assert.ok(desktopEditionMetrics.selectHeight >= 48, `desktop edition selector is ${desktopEditionMetrics.selectHeight}px high`);
  assert.ok(desktopEditionMetrics.releaseLineHeight >= 15 && desktopEditionMetrics.releasePadding >= 4, `release summary line height/padding: ${JSON.stringify(desktopEditionMetrics)}`);
  assert.deepEqual(await page.locator('.alpine-image').evaluateAll(rows => rows.slice(0, 3).map(row => row.id)), ['alpine-standard-x86', 'alpine-standard-x86_64', 'alpine-standard-aarch64']);
  assert.equal(await page.locator('.alpine-image .ventoy-supported').count(), 3);
  assert.ok(await page.getByAltText('Alpine Linux logo').evaluate(img => img.naturalWidth > 0));
  const preview = page.locator('#alpine-operation');
  assert.match(await preview.getAttribute('src'), /\.gif$/);
  assert.equal(await page.getByRole('button', { name: /operation GIF/i }).count(), 0, 'the looping recording has no play/pause control');
  assert.equal(await page.getByRole('link', { name: /Official Alpine Linux website/ }).getAttribute('href'), 'https://alpinelinux.org/');
  assert.equal(await page.getByRole('link', { name: /Watch a YouTube demo/ }).getAttribute('href'), 'https://www.youtube.com/watch?v=YNYtJ3jyMRs');
  await page.screenshot({ path: '/tmp/rominit-alpine-desktop.png', fullPage: true });
  await page.locator('#alpine-edition').selectOption('rpi');
  assert.equal(await page.locator('.alpine-image').count(), 6);
  assert.equal(await page.getByRole('button', { name: /USB via CLI/ }).count(), 0);
  await page.locator('#alpine-edition').selectOption('extended');
  assert.equal(await page.locator('.alpine-image').count(), 2);
  assert.equal(await page.locator('#alpine-extended-x86_64 a', { hasText: 'Download' }).getAttribute('href'), 'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/alpine-extended-3.24.2-x86_64.iso');
  await page.getByRole('button', { name: 'Prepare Extended x86_64 USB' }).click();
  await page.getByText('Sign in to ROMinit before preparing an Alpine USB.', { exact: true }).waitFor();
  assert.match(page.url(), /image=alpine-extended-x86_64/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile page fits viewport');
  const mobileEditionMetrics = await page.evaluate(() => {
    const panel = document.querySelector('.alpine-downloads').getBoundingClientRect();
    const row = document.querySelector('.alpine-selection').getBoundingClientRect();
    const description = document.querySelector('#alpine-edition-description').getBoundingClientRect();
    const select = document.querySelector('#alpine-edition').getBoundingClientRect();
    const release = document.querySelector('#alpine-release').getBoundingClientRect();
    return { gap: description.top - row.bottom, selectHeight: select.height, releaseHeight: release.height, releaseLeft: release.left, releaseRight: release.right, panelLeft: panel.left, panelRight: panel.right };
  });
  assert.ok(mobileEditionMetrics.gap >= 12, `mobile edition summary gap ${mobileEditionMetrics.gap}px`);
  assert.ok(mobileEditionMetrics.selectHeight >= 48, `mobile edition selector is ${mobileEditionMetrics.selectHeight}px high`);
  assert.ok(mobileEditionMetrics.releaseHeight >= desktopEditionMetrics.releaseLineHeight + 2 * desktopEditionMetrics.releasePadding, 'release summary keeps its padded line box when narrow');
  assert.ok(mobileEditionMetrics.releaseLeft >= mobileEditionMetrics.panelLeft && mobileEditionMetrics.releaseRight <= mobileEditionMetrics.panelRight, 'release summary wraps within the edition panel');
  await page.screenshot({ path: '/tmp/rominit-alpine-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('OS category shows Alpine Linux parent with architecture tags and search', async () => {
  await page.goto(BASE);
  const hostDialog = page.locator('.host-confirm');
  if (await hostDialog.isVisible().catch(() => false)) await hostDialog.getByRole('button', { name: 'Confirm' }).click();
  await page.locator('input[name="category"][value="pc"]').check();
  await page.locator('.os-entry').waitFor();
  assert.equal(await page.locator('.os-entry .architecture-tag', { hasText: /^ARM$/ }).count(), 1);
  assert.equal(await page.locator('.os-entry a').getAttribute('href'), './alpine.html');
  assert.match(await page.locator('.category summary').first().innerText(), /^OS$/);
  await page.locator('#main input[type=search]').fill('alpine');
  await page.locator('.os-entry').waitFor();
  assert.equal(await page.locator('.empty-files').count(), 0);
});

test('Alpine warning is yellow and an authenticated CLI action auto-discovers without a saved browser session', async () => {
  const calls = [], localUrl = 'http://127.0.0.1:18787';
  const discovery = { state: 's'.repeat(43), challenge: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const drive = { id: '/dev/disk/by-id/usb-auto-test', path: '/dev/sdz', model: 'Auto USB', size: 2 * 1024 ** 3, available: true, mounted: false, mounts: [] };
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); });
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 98, name: 'Alpine tester' }, providers: [] } }));
  await page.route('**/api/helper', async route => {
    const body = route.request().postDataJSON(); calls.push({ path: '/api/helper', body });
    return route.fulfill({ json: { code: 'c'.repeat(43), expiresIn: 60 } });
  });
  await page.route(`${localUrl}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-private-network': 'true' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    calls.push({ path, body, headers: request.headers() });
    const json = path === '/discover' ? discovery
      : path === '/pair' ? { token: 'z'.repeat(43), user: { id: 98, name: 'Alpine tester' }, expiresAt: new Date(Date.now() + 60_000).toISOString() }
        : path === '/status' ? { user: { id: 98, name: 'Alpine tester' }, expiresAt: new Date(Date.now() + 60_000).toISOString(), capabilities: ['usb-media', 'usb-images'] }
          : path === '/usb/drives' ? [drive] : {};
    return route.fulfill({ headers, json });
  });
  try {
    await page.goto(`${BASE}/alpine.html`);
    const caution = page.locator('.alpine-cautions');
    assert.equal(await caution.locator('h2').innerText(), 'Note this before installation');
    const warningStyle = await caution.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderTopColor, stripe: getComputedStyle(node, '::before').backgroundImage }));
    assert.equal(warningStyle.background, await page.locator('.alpine-card').first().evaluate(node => getComputedStyle(node).backgroundColor));
    assert.equal(warningStyle.border, 'rgb(224, 180, 0)');
    assert.match(warningStyle.stripe, /repeating-linear-gradient.*rgb\(242, 194, 0\).*rgb\(20, 20, 20\)/);
    assert.equal(await page.evaluate(() => localStorage.getItem('rominit.helper')), null, 'begin with no saved browser bearer');
    await page.locator('#alpine-edition').selectOption('extended');
  await page.getByRole('button', { name: 'Prepare Extended x86_64 USB' }).click();
    await page.locator('#usb-media-drive option[value="/dev/disk/by-id/usb-auto-test"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#usb-media-method option[value="direct"]').isDisabled(), true, 'older CLI cannot offer direct writes');
  await page.getByText('Direct image writing needs an updated CLI.', { exact: false }).waitFor();
    assert.deepEqual(calls.filter(call => call.path === '/api/helper').map(call => call.body), [{ action: 'approve-existing', challenge: discovery.challenge }]);
    assert.deepEqual(calls.find(call => call.path === '/pair').body, { state: discovery.state, code: 'c'.repeat(43) });
    assert.equal(calls.find(call => call.path === '/discover').headers.authorization, undefined, 'discovery exposes no bearer credential');
    assert.equal(calls.find(call => call.path === '/pair').headers.authorization, undefined, 'the website sends only the one-use grant to loopback');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('rominit.helper')), null);
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('rominit.helper')));
    assert.equal(stored.url, localUrl);
    assert.equal(stored.token, 'z'.repeat(43));
    assert.deepEqual(stored.user, { id: 98, name: 'Alpine tester' });
    assert.ok(Date.parse(stored.expiresAt) > Date.now());
  } finally {
    await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); });
    await page.unroute(`${localUrl}/**`); await page.unroute('**/api/helper'); await page.unroute('**/api/me');
  }
});

test('Alpine architecture flows through the paired CLI plan and requires typed drive confirmation', async () => {
  const localUrl = 'http://127.0.0.1:49158', calls = [];
  let wrongImage = true, copyOnly = false;
  const drive = { id: '/dev/disk/by-id/usb-test', path: '/dev/sdz', model: 'Fixture USB', size: 2 * 1024 ** 3, available: true, mounted: false, mounts: [] };
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 98, name: 'Alpine tester' }, providers: [] } }));
  await page.route(`${localUrl}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-private-network': 'true' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push({ path, body: request.postDataJSON() });
    const json = path === '/status' ? { user: { id: 98, name: 'Alpine tester' }, capabilities: ['usb-media', 'usb-images'] }
      : path === '/usb/drives' ? [drive]
      : path === '/usb/plan' ? { id: 'fixture-plan', method: 'ventoy', action: copyOnly ? 'copy' : 'install', confirm: copyOnly ? 'COPY' : 'ERASE', drive, expiresAt: new Date(Date.now()+60000).toISOString(), warning: 'Erases the fixture drive', image: { ...alpineImage('alpine-extended-x86_64'), name: 'alpine-extended-3.24.2-x86_64.iso', ...(wrongImage ? { sha256: 'a'.repeat(64) } : {}) } }
      : { state: 'succeeded', log: ['fixture-only'], drive, readback: { size: alpineImage('alpine-extended-x86_64').size, sha256: alpineImage('alpine-extended-x86_64').sha256, matched: true } };
    return route.fulfill({ headers, json });
  });
  try {
    await page.goto(`${BASE}/alpine.html`);
    await page.evaluate(url => localStorage.setItem('rominit.helper', JSON.stringify({ url, token: 'u'.repeat(43), user: { id: 98, name: 'Alpine tester' }, expiresAt: new Date(Date.now()+60000).toISOString() })), localUrl);
    await page.locator('#alpine-edition').selectOption('extended');
    await page.getByRole('button', { name: 'Prepare Extended x86_64 USB' }).click();
    await page.locator('#usb-media-drive option[value="/dev/disk/by-id/usb-test"]').waitFor({ state: 'attached' });
    await page.locator('#usb-media-drive').selectOption(drive.id);
    await page.getByRole('button', { name: 'Review USB preparation' }).click();
    await page.getByText('The CLI did not prepare the selected Alpine ISO. Update and reconnect the helper.', { exact: true }).waitFor();
    assert.equal(await page.locator('#usb-media-confirm').count(), 0);
    assert.equal(calls.some(call => call.path === '/usb/write'), false);
    wrongImage = false;
    await page.getByRole('button', { name: 'Review USB preparation' }).click();
    await page.locator('#usb-media-confirm').waitFor();
    assert.deepEqual(calls.find(call => call.path === '/usb/plan').body, { driveId: drive.id, method: 'ventoy', imageId: 'alpine-extended-x86_64' });
    assert.equal(calls.some(call => call.path === '/usb/write'), false);
    assert.match(await page.locator('#usb-media-panel').innerText(), /x86_64/);
    await page.locator('#usb-media-confirm').fill('WRONG');
    assert.equal(await page.locator('#usb-media-panel button.button-primary').last().isDisabled(), true);
    await page.locator('#usb-media-confirm').fill('ERASE');
    await page.locator('#usb-media-panel button.button-primary').last().click();
    await page.waitForFunction(() => document.querySelector('#usb-media-panel')?.textContent?.includes('fixture-only'));
    assert.deepEqual(calls.find(call => call.path === '/usb/write').body, { planId: 'fixture-plan', confirm: 'ERASE' });
    copyOnly = true;
    await page.getByRole('button', { name: 'Review USB preparation' }).click();
    await page.getByText(/Copy-only plan ready/).waitFor();
    const copyButton = page.getByRole('button', { name: 'Copy ISO to existing Ventoy USB' });
    assert.equal(await copyButton.isDisabled(), true);
    await page.locator('#usb-media-confirm').fill('COPY');
    await copyButton.click();
    await page.waitForFunction(() => document.querySelector('#usb-media-panel')?.textContent?.includes('files preserved'));
    assert.deepEqual(calls.filter(call => call.path === '/usb/write').at(-1).body, { planId: 'fixture-plan', confirm: 'COPY' });
  } finally {
    await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); });
    await page.unroute(`${localUrl}/**`); await page.unroute('**/api/me');
  }
});

test('checksum mismatch offers retry or cancel and requires explicit opt-in plus COPY/ERASE', async () => {
  const localUrl = 'http://127.0.0.1:49159', calls = [];
  let planCount = 0, mismatch = true, action = 'copy', supportsOverride = false, statusPolls = 0, lastWrite = null;
  const drive = { id: '/dev/disk/by-id/usb-mismatch-test', path: '/dev/sdz', model: 'Fixture USB', size: 2 * 1024 ** 3, available: true, mounted: false, mounts: [] };
  let omitReadback = false;
  const pinned = alpineImage('alpine-extended-x86_64');
  const actual = { size: pinned.size - 100 * 1024 ** 2, sha256: 'b'.repeat(64) };
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 99, name: 'Checksum tester' }, providers: [] } }));
  await page.route(`${localUrl}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-private-network': 'true' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    calls.push({ path, body });
    let json;
    if (path === '/status') json = { user: { id: 99, name: 'Checksum tester' }, capabilities: ['usb-media', 'usb-images', 'usb-direct', ...(supportsOverride ? ['usb-unverified'] : [])] };
    else if (path === '/usb/drives') json = [drive];
    else if (path === '/usb/plan') {
      planCount++;
      const expected = { size: pinned.size, sha256: pinned.sha256 };
      json = { id: `fixture-plan-${planCount}`, method: 'ventoy', action, confirm: action === 'copy' ? 'COPY' : 'ERASE', drive,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), image: { ...pinned, name: 'alpine-extended-3.24.2-x86_64.iso' },
        verification: mismatch ? { status: 'mismatch', expected, actual } : { status: 'verified', expected, actual: expected } };
    } else if (path === '/usb/write') {
      lastWrite = body; statusPolls = 0;
      json = { state: 'pending', log: [], verification: body?.allowUnverified
        ? { status: 'mismatch', accepted: true, expected: { size: pinned.size, sha256: pinned.sha256 }, actual }
        : { status: 'verified', accepted: false, expected: { size: pinned.size, sha256: pinned.sha256 }, actual: { size: pinned.size, sha256: pinned.sha256 } } };
    } else {
      statusPolls++;
      const verification = lastWrite?.allowUnverified
        ? { status: 'mismatch', accepted: true, expected: { size: pinned.size, sha256: pinned.sha256 }, actual }
        : { status: 'verified', accepted: false, expected: { size: pinned.size, sha256: pinned.sha256 }, actual: { size: pinned.size, sha256: pinned.sha256 } };
      json = { state: statusPolls < 2 ? 'running' : 'succeeded', phase: statusPolls < 2 ? 'verifying' : 'complete', log: statusPolls < 2 ? ['Copy finished. Checking the USB file SHA-256 again.'] : ['copied bytes match the reviewed download'], verification, ...(statusPolls >= 2 && !omitReadback ? { readback: { ...verification.actual, matched: true } } : {}) };
    }
    return route.fulfill({ headers, json });
  });
  try {
    await page.goto(`${BASE}/alpine.html`);
    await page.evaluate(url => localStorage.setItem('rominit.helper', JSON.stringify({ url, token: 'v'.repeat(43), user: { id: 99, name: 'Checksum tester' }, expiresAt: new Date(Date.now() + 60_000).toISOString() })), localUrl);
    await page.locator('#alpine-edition').selectOption('extended');
    await page.getByRole('button', { name: 'Prepare Extended x86_64 USB' }).click();
    await page.locator('#usb-media-drive option[value="/dev/disk/by-id/usb-mismatch-test"]').waitFor({ state: 'attached' });
    await page.locator('#usb-media-drive').selectOption(drive.id);
    assert.match(await page.locator('#usb-media-selected-image').innerText(), /Alpine Linux 3\.24\.2 · Extended · x86_64 · alpine-extended-3\.24\.2-x86_64\.iso · 1\.36 GiB/);
    assert.equal(await page.locator('#usb-media-selected-image').evaluate(node => !!(node.compareDocumentPosition(document.querySelector('#usb-media-drive')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'selected image summary sits before the USB selector');
    const reviewButton = page.getByRole('button', { name: 'Review USB preparation' });
    await reviewButton.click();
    await page.getByText('This CLI cannot safely review a checksum mismatch. Download the updated CLI and restart rominit serve.', { exact: true }).waitFor();
    assert.equal(await page.locator('.usb-verification-warning').count(), 0, 'old helpers never expose an unsafe bypass');
    assert.equal(await page.locator('#usb-media-confirm').count(), 0);
    assert.equal(calls.some(call => call.path === '/usb/write'), false);

    supportsOverride = true;
    await reviewButton.click();
    const warning = page.locator('.usb-verification-warning');
    await warning.getByText('Checksum does not match. We don’t recommend using this file; it may be damaged or different from the selected release.', { exact: true }).waitFor();
    assert.match(await warning.innerText(), new RegExp(pinned.sha256));
    assert.match(await warning.innerText(), new RegExp(actual.sha256));
    await page.locator('#usb-media-method').selectOption('direct');
    assert.equal(await page.locator('.usb-verification-warning').count(), 0, 'changing method clears the reviewed mismatch and opt-in');
    assert.equal(await page.locator('#usb-media-confirm').count(), 0, 'changing method clears typed confirmation');
    assert.equal(calls.some(call => call.path === '/usb/write'), false, 'method changes never start a write');
    await page.locator('#usb-media-method').selectOption('ventoy');
    await reviewButton.click();
    await page.locator('.usb-verification-warning').waitFor();
    await page.locator('#usb-media-panel').screenshot({ path: '/tmp/rominit-usb-mismatch-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'USB mismatch review fits mobile');
    await page.locator('#usb-media-panel').screenshot({ path: '/tmp/rominit-usb-mismatch-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.match(await page.locator('#usb-media-selected-image').innerText(), /Alpine Linux 3\.24\.2 · Extended · x86_64/);
    assert.match(await page.locator('#usb-media-selected-image').innerText(), /1\.26 GiB/);
    await page.locator('#usb-media-confirm').fill('COPY');
    const copyButton = page.getByRole('button', { name: 'Copy ISO to existing Ventoy USB' });
    assert.equal(await copyButton.isDisabled(), true, 'correct phrase alone cannot bypass the mismatch');
    await warning.getByRole('button', { name: 'Cancel' }).click();
    await page.getByText('USB preparation cancelled. No changes were made.', { exact: true }).waitFor();
    assert.equal(calls.some(call => call.path === '/usb/write'), false);

    await reviewButton.click();
    await page.locator('.usb-verification-warning').waitFor();
    const retryResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/usb/plan' && response.request().method() === 'POST');
    await page.locator('.usb-verification-warning').getByRole('button', { name: 'Download again' }).click();
    await retryResponse;
    assert.equal(planCount, 5, 'retry requested a fresh plan/download after method change and cancellation');
    await page.locator('.usb-verification-warning').waitFor();
    await page.locator('#usb-media-confirm').fill('COPY');
    assert.equal(await copyButton.isDisabled(), true, 'confirmation stays blocked before opt-in');
    assert.equal(await page.locator('#usb-media-confirm').evaluate(node => node.parentElement.classList.contains('usb-confirm-row')), true);
    assert.match(await page.locator('.usb-confirm-row').innerText(), /Type COPY/);
    await page.locator('.usb-verification-warning').getByRole('button', { name: 'Use this file anyway' }).click();
    await page.locator('#usb-media-confirm').fill('NO');
    assert.equal(await copyButton.isDisabled(), true, 'opt-in does not bypass the typed phrase');
    await page.locator('#usb-media-confirm').fill('COPY');
    assert.equal(await copyButton.isDisabled(), false, 'explicit opt-in plus COPY enables the write');
    assert.match(await page.locator('#usb-media-selected-image').innerText(), /checksum mismatch accepted/);
    const copyResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/usb/write' && response.request().method() === 'POST');
    await copyButton.click();
    await copyResponse;
    await page.getByText(/Ventoy installation pending/).waitFor();
    assert.equal(await page.locator('#usb-media-progress').getAttribute('value'), null, 'Ventoy copy without byte progress stays indeterminate');
    assert.match(await page.locator('#usb-media-progress-label').innerText(), /Copying .*existing Ventoy USB|Verifying the Ventoy USB copy/);
    assert.match(await page.locator('#usb-media-progress-detail').innerText(), /Progress is not reported by this CLI/);
    assert.match(await page.locator('#usb-media-selected-image').innerText(), /1\.26 GiB downloaded; checksum mismatch accepted/);
    await page.getByText('Copy finished. Checking the USB file’s SHA-256…', { exact: true }).waitFor();
    await page.getByText(/Complete — .*source checksum mismatch accepted, and USB copy matched the downloaded file/).waitFor();
    assert.deepEqual(calls.filter(call => call.path === '/usb/write').at(-1).body, { planId: 'fixture-plan-5', confirm: 'COPY', allowUnverified: true });

    mismatch = false; action = 'install';
    await reviewButton.click();
    await page.locator('#usb-media-confirm').waitFor();
    const eraseButton = page.getByRole('button', { name: 'Install Ventoy and erase this USB drive' });
    await page.locator('#usb-media-confirm').fill('ERASE');
    assert.equal(await eraseButton.isDisabled(), false);
    const eraseResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/usb/write' && response.request().method() === 'POST');
    await eraseButton.click();
    await eraseResponse;
    await page.getByText(/Ventoy installation pending/).waitFor();
    await page.getByText('Copy finished. Checking the USB file’s SHA-256…', { exact: true }).waitFor();
    await page.getByText(/Complete — .*copied and verified/).waitFor();
    assert.deepEqual(calls.filter(call => call.path === '/usb/write').at(-1).body, { planId: 'fixture-plan-6', confirm: 'ERASE' });
    omitReadback = true;
    await reviewButton.click();
    await page.locator('#usb-media-confirm').fill('ERASE');
    await page.getByRole('button', { name: 'Install Ventoy and erase this USB drive' }).click();
    await page.getByText('Operation finished, but the final USB checksum was not confirmed. Check the log before using the USB.', { exact: true }).waitFor();
  } finally {
    await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); });
    await page.unroute(`${localUrl}/**`); await page.unroute('**/api/me');
  }
});

test('direct ISO writing is available for non-Ventoy architectures and waits for typed ERASE', async () => {
  const localUrl = 'http://127.0.0.1:49160', calls = [];
  let statusPolls = 0;
  const pinned = alpineImage('alpine-standard-armv7');
  const measured = { size: pinned.size, sha256: pinned.sha256 };
  const drive = { id: '/dev/disk/by-id/usb-direct-test', path: '/dev/sdz', model: 'Fixture USB', size: 2 * 1024 ** 3, available: true, mounted: false, mounts: [] };
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 100, name: 'Direct ISO tester' }, providers: [] } }));
  await page.route(`${localUrl}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-private-network': 'true' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    calls.push({ path, body });
    let json;
    if (path === '/status') json = { user: { id: 100, name: 'Direct ISO tester' }, capabilities: ['usb-media', 'usb-images', 'usb-direct'] };
    else if (path === '/usb/drives') json = [drive];
    else if (path === '/usb/plan') json = { id: 'fixture-direct-plan', method: 'direct', action: 'direct', confirm: 'ERASE', drive,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), warning: 'This erases the whole drive; boot compatibility is not guaranteed.',
      image: { ...pinned, name: 'alpine-standard-3.24.2-armv7.iso' }, verification: { status: 'verified', expected: measured, actual: measured } };
    else if (path === '/usb/write') json = { state: 'running', method: 'direct', phase: 'writing', progress: { phase: 'writing', completedBytes: measured.size / 2, totalBytes: measured.size }, log: ['fixture-only; no real USB write'] };
    else if (path === '/usb/status') {
      statusPolls++;
      if (statusPolls === 1) json = { state: 'running', method: 'direct', phase: 'writing', progress: { phase: 'writing', completedBytes: measured.size / 2, totalBytes: measured.size + 1 }, log: ['fixture-only; deliberately invalid progress total'] };
      else if (statusPolls === 2) json = { state: 'running', method: 'direct', phase: 'verifying', progress: { phase: 'verifying', completedBytes: measured.size / 4, totalBytes: measured.size }, log: ['fixture-only; no real USB write'] };
      else if (statusPolls === 3) json = { state: 'running', method: 'direct', phase: 'verifying', progress: { phase: 'verifying', completedBytes: measured.size, totalBytes: measured.size }, log: ['fixture-only; readback scan finished but hash match pending'] };
      else json = { state: 'succeeded', method: 'direct', phase: 'complete', log: ['fixture-only; no real USB write'], verification: { status: 'verified', accepted: false, expected: measured, actual: measured }, readback: { ...measured, matched: true } };
    } else json = {};
    return route.fulfill({ headers, json });
  });
  try {
    await page.goto(`${BASE}/alpine.html`);
    await page.locator('#alpine-edition').selectOption('standard');
    await page.evaluate(url => localStorage.setItem('rominit.helper', JSON.stringify({ url, token: 'w'.repeat(43), user: { id: 100, name: 'Direct ISO tester' }, expiresAt: new Date(Date.now() + 60_000).toISOString() })), localUrl);
    await page.getByRole('button', { name: 'Prepare Standard armv7 USB' }).click();
    await page.locator('#usb-media-drive option[value="/dev/disk/by-id/usb-direct-test"]').waitFor({ state: 'attached' });
    const method = page.locator('#usb-media-method');
    assert.equal(await method.inputValue(), 'direct', 'non-Ventoy ISO defaults to the available direct method');
    assert.equal(await method.locator('option[value="ventoy"]').isDisabled(), true, 'Ventoy support is not implied for this architecture');
    assert.equal(await method.evaluate(node => !!(node.compareDocumentPosition(document.querySelector('#usb-media-drive')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'method selector is before the USB drive selector');
    const driveControls = await page.evaluate(() => {
      const heading = document.querySelector('.usb-drive-heading'), drive = document.querySelector('#usb-media-drive'), info = document.querySelector('.usb-drive-info');
      const refresh = heading.querySelector('.usb-refresh-button');
      return { refreshInHeading: !!refresh, headingBeforeDrive: !!(heading.compareDocumentPosition(drive) & Node.DOCUMENT_POSITION_FOLLOWING), driveBeforeInfo: !!(drive.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING), refreshWidth: refresh.getBoundingClientRect().width };
    });
    assert.equal(driveControls.refreshInHeading, true, 'Refresh drives stays beside the USB drive label');
    assert.equal(driveControls.headingBeforeDrive && driveControls.driveBeforeInfo, true, 'drive label/button and selector precede drive details');
    assert.ok(driveControls.refreshWidth < 160, `Refresh drives is a compact button (${driveControls.refreshWidth}px)`);
    assert.match(await method.locator('option[value="ventoy"]').innerText(), /not supported for this image/);
    assert.match(await page.locator('#usb-media-method-help').innerText(), /Boot compatibility is not guaranteed/);
    assert.match(await page.locator('#usb-media-selected-image').innerText(), /Standard · armv7 · alpine-standard-3\.24\.2-armv7\.iso/);
    await page.locator('#usb-media-drive').selectOption(drive.id);
    await page.getByRole('button', { name: 'Review USB preparation' }).click();
    await page.locator('#usb-media-confirm').waitFor();
    assert.deepEqual(calls.find(call => call.path === '/usb/plan').body, { driveId: drive.id, method: 'direct', imageId: pinned.id });
    assert.match(await page.locator('#usb-media-panel').innerText(), /erases the whole drive; boot compatibility is not guaranteed/i);
    assert.match(await page.locator('#usb-media-panel').innerText(), /ISO: armv7 · iso · alpine-standard-3\.24\.2-armv7\.iso · 113\.8 MiB · SHA-256/);
    assert.doesNotMatch(await page.locator('#usb-media-panel').innerText(), /\nnull\n/);
    await page.locator('#usb-media-panel').screenshot({ path: '/tmp/rominit-usb-direct-review.png' });
    const write = page.getByRole('button', { name: 'Erase and write image to USB' });
    await page.locator('#usb-media-confirm').fill('COPY');
    assert.equal(await write.isDisabled(), true, 'COPY cannot authorize a direct write');
    assert.equal(calls.some(call => call.path === '/usb/write'), false, 'review alone never writes');
    await page.locator('#usb-media-confirm').fill('ERASE');
    assert.equal(await write.isDisabled(), false);
    await write.click();
    const progressBar = page.locator('#usb-media-progress');
    await page.waitForFunction(() => document.querySelector('#usb-media-progress')?.value === 50);
    assert.match(await page.locator('#usb-media-progress-detail').innerText(), /50% · 59,686,912 \/ 119,373,824 bytes/);
    const invalidProgress = page.waitForResponse(response => new URL(response.url()).pathname === '/usb/status');
    await invalidProgress;
    await page.waitForFunction(() => {
      const bar = document.querySelector('#usb-media-progress');
      return bar && !bar.hasAttribute('value') && document.querySelector('#usb-media-progress-detail')?.textContent?.includes('Progress is not reported');
    });
    const verifyResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/usb/status');
    await verifyResponse;
    await page.waitForFunction(() => document.querySelector('#usb-media-progress')?.value === 25);
    assert.match(await page.locator('#usb-media-progress-label').innerText(), /Verifying USB readback/);
    const verifyCompleteResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/usb/status');
    await verifyCompleteResponse;
    await page.waitForFunction(() => document.querySelector('#usb-media-progress')?.value === 100);
    assert.match(await page.locator('#usb-media-progress-detail').innerText(), /waiting for the readback checksum match/);
    assert.doesNotMatch(await page.locator('#usb-media-panel .status').innerText(), /^Complete —/);
    await page.getByText(/Complete — alpine-standard-3\.24\.2-armv7\.iso .* written directly to USB and readback SHA-256 verified\. Boot compatibility untested\./).waitFor();
    assert.equal(await progressBar.isHidden(), true, 'matching readback, not a 100% scan, ends the operation bar');
    assert.deepEqual(calls.find(call => call.path === '/usb/write').body, { planId: 'fixture-direct-plan', confirm: 'ERASE' });
    assert.match(await page.locator('#usb-media-selected-image').innerText(), /113\.8 MiB/);
    assert.deepEqual(calls.filter(call => call.path === '/usb/plan').map(call => call.body.method), ['direct'], 'no Ventoy or automatic fallback request was sent');
  } finally {
    await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); });
    await page.unroute(`${localUrl}/**`); await page.unroute('**/api/me');
  }
});

test('generic CLI USB panel offers a configured ISO direct write with the same typed ERASE and readback gate', async () => {
  const localUrl = 'http://127.0.0.1:49161', calls = [];
  const configured = { name: 'local-alpine.iso', size: 64 * 1024 ** 2, sha256: 'e'.repeat(64) };
  const drive = { id: '/dev/disk/by-id/usb-cli-direct-test', path: '/dev/sdz', model: 'Fixture USB', size: 2 * 1024 ** 3, available: true, mounted: false, mounts: [] };
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 101, name: 'Generic USB tester' }, providers: [] } }));
  await page.route(`${localUrl}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-private-network': 'true' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    calls.push({ path, body });
    const json = path === '/status' ? { user: { id: 101, name: 'Generic USB tester' }, capabilities: ['usb-media', 'usb-direct'] }
      : path === '/usb/drives' ? [drive]
        : path === '/usb/plan' ? { id: 'fixture-generic-direct', method: 'direct', action: 'direct', confirm: 'ERASE', drive,
          expiresAt: new Date(Date.now() + 60_000).toISOString(), warning: 'This erases the whole drive.', image: configured,
          verification: { status: 'verified', expected: configured, actual: configured } }
          : path === '/usb/write' ? { state: 'succeeded', method: 'direct', log: ['fixture-only; no real USB write'], verification: { status: 'verified', accepted: false, expected: configured, actual: configured }, readback: { ...configured, matched: true } }
            : {};
    return route.fulfill({ headers, json });
  });
  try {
    await page.goto(BASE);
    await page.evaluate(url => localStorage.setItem('rominit.helper', JSON.stringify({ url, token: 'x'.repeat(43), user: { id: 101, name: 'Generic USB tester' }, expiresAt: new Date(Date.now() + 60_000).toISOString() })), localUrl);
    await page.goto(`${BASE}/?view=cli`);
    await page.locator('#usb-media-drive option[value="/dev/disk/by-id/usb-cli-direct-test"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#usb-media-panel h2').innerText(), 'Prepare USB');
    assert.match(await page.locator('#usb-media-panel > p').first().innerText(), /Choose Ventoy .* or Direct image .* CLI-configured ISO/);
    const method = page.locator('#usb-media-method');
    assert.equal(await method.inputValue(), 'ventoy', 'generic USB panel keeps Ventoy as its default');
    await method.selectOption('direct');
    assert.equal(await page.locator('#usb-media-panel h2').innerText(), 'Prepare USB', 'generic panel heading stays neutral when the method changes');
    assert.match(await page.locator('#usb-media-method-help').innerText(), /CLI-configured ISO/);
    await page.locator('#usb-media-drive').selectOption(drive.id);
    const review = page.getByRole('button', { name: 'Review direct image write' });
    assert.equal(await review.isDisabled(), false, `direct review should be enabled; ${await page.locator('#usb-media-panel').innerText()}`);
    await review.click();
    await page.locator('#usb-media-confirm').waitFor({ timeout: 5000 }).catch(() => null);
    assert.equal(await page.locator('#usb-media-confirm').count(), 1, `plan review failed: ${await page.locator('#usb-media-panel').innerText()} calls=${JSON.stringify(calls)}`);
    assert.deepEqual(calls.find(call => call.path === '/usb/plan').body, { driveId: drive.id, method: 'direct' }, 'generic local ISO uses direct method without a catalog image ID');
    assert.match(await page.locator('#usb-media-selected-image').innerText(), /local-alpine\.iso · 64\.0 MiB/);
    assert.equal(calls.some(call => call.path === '/usb/write'), false, 'review does not write');
    await page.locator('#usb-media-confirm').fill('ERASE');
    await page.getByRole('button', { name: 'Erase and write image to USB' }).click();
    await page.getByText(/Complete — local-alpine\.iso .* written directly to USB and readback SHA-256 verified/).waitFor();
    assert.deepEqual(calls.find(call => call.path === '/usb/write').body, { planId: 'fixture-generic-direct', confirm: 'ERASE' });
  } finally {
    await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); });
    await page.unroute(`${localUrl}/**`); await page.unroute('**/api/me');
  }
});

test('USB outcome report delivery stays separate from success and failure of the USB write', async () => {
  const localUrl = 'http://127.0.0.1:49162', calls = [];
  const configured = { id: 'genericLocalISO', name: 'Local ISO', size: 64 * 1024 ** 2, sha256: 'f'.repeat(64) };
  const drive = { id: 'fixture-drive-id', path: '/fixture/path', model: 'Fixture USB', size: 2 * 1024 ** 3, available: true, mounted: false, mounts: [] };
  let finalReportStatus = 'sent', currentJobId = 'reportStatusJob_001', statusChecks = 0;
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 902, name: 'Report status tester' }, providers: [] } }));
  await page.route(`${localUrl}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-private-network': 'true' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    calls.push({ path, body });
    const job = { state: 'succeeded', method: 'direct', phase: 'complete', log: ['fixture-only; no real USB write'],
      verification: { status: 'verified', accepted: false, expected: { size: configured.size, sha256: configured.sha256 }, actual: { size: configured.size, sha256: configured.sha256 } },
      readback: { size: configured.size, sha256: configured.sha256, matched: true }, jobId: currentJobId };
    let json;
    if (path === '/status') json = { user: { id: 902, name: 'Report status tester' }, capabilities: ['usb-media', 'usb-direct'] };
    else if (path === '/usb/drives') json = [drive];
    else if (path === '/usb/plan') json = { id: 'report-status-plan', method: 'direct', action: 'direct', confirm: 'ERASE', drive,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), image: configured,
      verification: { status: 'verified', expected: { size: configured.size, sha256: configured.sha256 }, actual: { size: configured.size, sha256: configured.sha256 } } };
    else if (path === '/usb/write') json = job; // outcome reporting starts after the USB job succeeds
    else if (path === '/usb/status') {
      statusChecks++;
      json = { ...job, reportStatus: statusChecks === 1 ? 'pending' : finalReportStatus };
    } else json = {};
    return route.fulfill({ headers, json });
  });
  const runWrite = async () => {
    await page.goto(BASE);
    await page.evaluate(url => localStorage.setItem('rominit.helper', JSON.stringify({ url, token: 'q'.repeat(43), user: { id: 902, name: 'Report status tester' }, expiresAt: new Date(Date.now() + 60_000).toISOString() })), localUrl);
    await page.goto(`${BASE}/?view=cli`);
    await page.locator('#usb-media-drive option[value="fixture-drive-id"]').waitFor({ state: 'attached' });
    await page.locator('#usb-media-method').selectOption('direct');
    await page.locator('#usb-media-drive').selectOption(drive.id);
    await page.getByRole('button', { name: 'Review direct image write' }).click();
    await page.locator('#usb-media-confirm').waitFor();
    await page.locator('#usb-media-confirm').fill('ERASE');
    const write = page.waitForRequest(request => new URL(request.url()).pathname === '/usb/write' && request.method() === 'POST');
    await page.getByRole('button', { name: 'Erase and write image to USB' }).click();
    const request = await write;
    assert.equal(Object.hasOwn(request.postDataJSON(), 'browser'), false, 'older helpers do not receive optional browser metadata');
  };
  try {
    await runWrite();
    const flashSuccess = page.getByText(/Complete — Local ISO .* written directly to USB and readback SHA-256 verified/);
    await flashSuccess.waitFor();
    const notice = page.locator('#usb-media-report-status');
    await notice.getByText('Checking USB outcome report delivery to the OS-USB inbox. The USB operation result above is unchanged.').waitFor();
    await notice.getByText('USB outcome report is being sent to the OS-USB inbox. The USB operation result above is unchanged.').waitFor();
    assert.equal(await flashSuccess.count(), 1, 'pending report does not turn USB success into a pending operation');
    await notice.getByText('USB outcome report sent to the OS-USB inbox.').waitFor();
    assert.equal(await flashSuccess.count(), 1, 'report delivery does not change the USB result');

    finalReportStatus = 'failed'; currentJobId = 'reportStatusJob_002'; statusChecks = 0;
    await runWrite();
    await page.getByText(/Complete — Local ISO .* written directly to USB and readback SHA-256 verified/).waitFor();
    await page.locator('#usb-media-report-status').getByText('USB outcome report is being sent to the OS-USB inbox. The USB operation result above is unchanged.').waitFor();
    await page.locator('#usb-media-report-status').getByText('USB outcome report could not be delivered to the OS-USB inbox. The USB operation result above is unchanged.').waitFor();
    await page.getByText(/Complete — Local ISO .* written directly to USB and readback SHA-256 verified/).waitFor();
    assert.equal(calls.filter(call => call.path === '/usb/write').length, 2);
    assert.equal(calls.filter(call => call.path === '/usb/status').length, 4, 'each terminal report is polled until sent or failed');
  } finally {
    await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); }).catch(() => {});
    await page.unroute('**/api/me'); await page.unroute(`${localUrl}/**`);
  }
});

test('USB write includes bounded browser metadata only when the helper advertises support', async () => {
  const previousPage = page, calls = [], localUrl = 'http://127.0.0.1:49163';
  const configured = { name: 'Local ISO', size: 64 * 1024 ** 2, sha256: 'f'.repeat(64) };
  const drive = { id: 'fixture-metadata-drive', path: '/fixture/path', model: 'Fixture USB', size: 2 * 1024 ** 3, available: true, mounted: false, mounts: [] };
  page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('host', 'linux');
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: {
      brands: [{ brand: 'Not A(Brand', version: '99' }, { brand: 'Google Chrome', version: '140' }],
      platform: 'Windows',
      getHighEntropyValues: async () => ({
        fullVersionList: [{ brand: 'Not A(Brand', version: '99' }, { brand: 'Google Chrome', version: '140.0.7339.0' }],
        platform: 'Windows', platformVersion: '15.0.0'
      })
    } });
  });
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 903, name: 'Environment tester' }, providers: [] } }));
  await page.route(`${localUrl}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-private-network': 'true' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    calls.push({ path, body });
    const json = path === '/status' ? { user: { id: 903, name: 'Environment tester' }, capabilities: ['usb-media', 'usb-direct', 'usb-environment'] }
      : path === '/usb/drives' ? [drive]
        : path === '/usb/plan' ? { id: 'fixture-environment-plan', method: 'direct', action: 'direct', confirm: 'ERASE', drive,
          expiresAt: new Date(Date.now() + 60_000).toISOString(), image: configured,
          verification: { status: 'verified', expected: configured, actual: configured } }
          : path === '/usb/write' ? { state: 'succeeded', method: 'direct', log: ['fixture-only; no real USB write'], verification: { status: 'verified', accepted: false, expected: configured, actual: configured }, readback: { size: configured.size, sha256: configured.sha256, matched: true }, jobId: 'environmentJob_001', reportStatus: 'sent' }
            : {};
    return route.fulfill({ headers, json });
  });
  try {
    await page.goto(BASE);
    await page.evaluate(url => localStorage.setItem('rominit.helper', JSON.stringify({ url, token: 'y'.repeat(43), user: { id: 903, name: 'Environment tester' }, expiresAt: new Date(Date.now() + 60_000).toISOString() })), localUrl);
    await page.goto(`${BASE}/?view=cli`);
    await page.locator('.usb-environment-notice').getByText(/automatic USB report includes OS, browser and CLI technical versions only/i).waitFor();
    await page.locator('#usb-media-drive option[value="fixture-metadata-drive"]').waitFor({ state: 'attached' });
    await page.locator('#usb-media-method').selectOption('direct');
    await page.locator('#usb-media-drive').selectOption(drive.id);
    await page.getByRole('button', { name: 'Review direct image write' }).click();
    await page.locator('#usb-media-confirm').fill('ERASE');
    await page.getByRole('button', { name: 'Erase and write image to USB' }).click();
    await page.getByText(/Complete — Local ISO .* written directly to USB and readback SHA-256 verified/).waitFor();
    const write = calls.find(call => call.path === '/usb/write');
    assert.deepEqual(write.body, { planId: 'fixture-environment-plan', confirm: 'ERASE', browser: {
      browser: 'chrome', browserVersion: '140.0.7339.0', browserOs: 'windows', browserOsVersion: '15.0.0'
    } });
    assert.equal(JSON.stringify(write.body).includes('Mozilla/'), false, 'raw user-agent text is never transmitted');
  } finally {
    await page.evaluate(() => { localStorage.removeItem('rominit.helper'); sessionStorage.removeItem('rominit.helper'); }).catch(() => {});
    await page.unroute(`${localUrl}/**`).catch(() => {}); await page.unroute('**/api/me').catch(() => {});
    await page.close(); page = previousPage;
  }
});
