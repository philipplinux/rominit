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
  await page.locator('img.os-logo').evaluate(img => /** @type {HTMLImageElement} */ (img).decode());
  assert.ok(await page.locator('img.os-logo').evaluate(img => /** @type {HTMLImageElement} */ (img).naturalWidth > 0), 'postmarketOS logo loads');
  await page.locator('.back-link').click();
  await page.waitForURL(`${BASE}/`);
});

test('ROM info: release chips, login in sections 0 and 2, feature groups, includes', async () => {
  await page.goto(`${BASE}/?device=starlte`);
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
  const revert = page.locator('details.page-section', { hasText: '5 · Recover / revert' });
  await revert.locator(':scope > summary').click();
  assert.equal(await revert.locator('.stage-card').count(), 1);
  assert.match(await revert.locator('.stage-card details summary').innerText(), /^\d+ steps$/, 'long step lists collapse');
});

test('S7 edge: TWRP via Odin, LineageOS via sideload', async () => {
  await page.goto(`${BASE}/?device=hero2lte`);
  assert.deepEqual(await page.locator('.version-chip').allInnerTexts(), ['ODIN', 'TWRP-SIDELOAD']);
  assert.match(await page.locator('select').inputValue(), /^lineage-21/);
});

test('page order: info, unlock guide with SamFW pivot, TWRP marked required, ROM, recover', async () => {
  await page.goto(`${BASE}/?device=hero2lte`);
  await page.locator('.page-section').nth(4).waitFor();
  assert.deepEqual((await page.locator('.page-section > summary > span').allInnerTexts()).map(t => t.slice(0, 1)).slice(0, 6), ['0', '1', '2', '3', '4', '5']);
  const unlock = page.locator('details.page-section', { hasText: '1 · Unlock bootloader' });
  assert.equal(await unlock.first().locator(':scope > summary .badge').innerText(), 'REQUIRED');
  assert.ok(await unlock.first().locator('.guide li').count() >= 4);
  await unlock.first().locator('.pivots summary').click();
  assert.equal(await unlock.first().locator('.pivots a[href="https://samfw.com/"]').count(), 1);
  assert.equal(await page.locator('details.page-section', { hasText: '2 · TWRP recovery' }).locator(':scope > summary .badge').innerText(), 'REQUIRED');
  const first = unlock.first();
  assert.match(await first.getAttribute('class') ?? '', /required(?! done)/);
  for (const box of await first.locator('.guide input[type=checkbox]').all()) await box.check();
  assert.match(await first.getAttribute('class') ?? '', /done/);
  assert.equal(await first.evaluate(el => /** @type {HTMLDetailsElement} */ (el).open), false);
  await page.reload(); // ticks are remembered
  assert.match(await page.locator('details.page-section', { hasText: '1 · Unlock bootloader' }).first().getAttribute('class') ?? '', /done/);
  const twrp = page.locator('details.page-section', { hasText: '2 · TWRP recovery' });
  await twrp.getByLabel('TWRP is already installed').check();
  assert.equal(await twrp.locator(':scope > summary .badge').innerText(), 'COMPLETED');
  assert.equal(await twrp.evaluate(el => /** @type {HTMLDetailsElement} */ (el).open), false, 'completed section collapses');
  await page.reload(); // every section's progress is remembered
  assert.equal(await page.locator('details.page-section.done').count(), 2);
  await page.locator('.start-over').click();
  await page.locator('.page-section').nth(4).waitFor();
  assert.equal(await page.locator('details.page-section.done').count(), 0);
  await page.getByLabel('Bootloader is already unlocked').check(); // skips the steps
  assert.equal(await page.locator('details.page-section', { hasText: '1 · Unlock bootloader' }).first().locator(':scope > summary .badge').innerText(), 'COMPLETED');
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
    device.roms[0].status = 'broken';
    await route.fulfill({ json: device });
  });
  await page.goto(`${BASE}/?device=starlte`);
  await page.getByText('Known broken:').waitFor();
  assert.equal(await page.locator('.stage-card').count(), 0);
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
  const rom = `laurel_sprout/${await page.locator('select').inputValue()}`;
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
  const rom = `starlte/${await page.locator('select').inputValue()}`;

  await signIn('ada', 'owner', `rom:${rom}`);
  await page.reload();
  await page.locator('.topbar-note').getByText('ada ·').waitFor();
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

test('phone test: one command, script output becomes a tappable report card with a few questions', async () => {
  await page.goto(`${BASE}/?device=laurel_sprout`);
  // The Mi A3 postmarketOS image needs no TWRP: the collapsed section says so instead of staying blank.
  assert.equal(await page.locator('details.page-section', { hasText: '2 · TWRP recovery' }).locator(':scope > summary .badge').innerText(), 'NOT REQUIRED');
  const test4 = page.locator('details.page-section', { hasText: '4 · Test your phone' });
  await test4.locator('summary').first().click();
  await test4.getByRole('button', { name: 'Start a phone test' }).click();
  const command = await test4.locator('.bench-command').innerText(); // USB is the default for postmarketOS
  const url = command.match(/curl -fsSL (\S+) \| ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new user@172\.16\.42\.1 sh \| curl -sS --data-binary @- (\S+)$/);
  assert.ok(url && url[1] === url[2], command);
  await test4.getByLabel('Also check speaker and vibration').check();
  assert.match(await test4.locator('.bench-command').innerText(), /user@172\.16\.42\.1 'ROMINIT_SOUND=1 sh' \|/);
  await test4.getByRole('tab', { name: 'Wi-Fi' }).click();
  await test4.getByLabel(/Phone IP address/).fill('192.168.1.77');
  assert.match(await test4.locator('.bench-command').innerText(), /\| ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new user@192\.168\.1\.77 'ROMINIT_SOUND=1 sh' \|/);
  await test4.getByRole('tab', { name: 'Terminal on the phone' }).click();
  assert.match(await test4.locator('.bench-command').innerText(), /\| ROMINIT_SOUND=1 sh \|/);
  const script = await (await fetch(url[1])).text();
  assert.match(script, /^#!\/bin\/sh\n# ROMinit phone test for Linux/, 'postmarketOS gets the Linux script');
  assert.equal((await fetch(url[1], { method: 'POST', body: 'hello' })).status, 400);
  const failed = await fetch(url[1], { method: 'POST', body: '' }); // SSH never connected: terminal and page both say so
  assert.match(await failed.text(), /nothing came from the phone/);
  await test4.getByText(/Nothing came from the phone last time/).waitFor({ timeout: 10000 });
  const output = ['@ script linux 1', '@ model Xiaomi Mi A3', '@debug tools nmcli', 'flashing full booted', 'wifi full wlan0 connected', 'touch ask Does touch follow your finger?',
    'audio ask Play any sound: does the speaker work?', 'camera broken no camera driver', 'sdcard blocked insert one', 'gps inconclusive probe p_gps exit 2: mmcli: not found', '@pkgs openssh-server phosh', '@ done'].join('\n');
  assert.equal((await fetch(url[1], { method: 'POST', body: output })).status, 200);
  await test4.getByText('Report card', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await test4.locator('.bench-tile.full').count(), 2);
  assert.match(await test4.locator('.bench-tile.inconclusive').innerText(), /GPS[\s\S]*\? inconclusive/);
  assert.match(await test4.locator('.bench-debug pre').textContent() ?? '', /gps: probe p_gps exit 2: mmcli: not found\ntools nmcli/);
  assert.match(await test4.locator('.rating', { hasText: 'found in 2 packages' }).innerText(), /✓ SSH[\s\S]*✗ Docker \*/);
  assert.match(await test4.locator('.hints', { hasText: 'Change the default password' }).innerText(), /ssh -t user@192\.168\.1\.77 passwd/);
  assert.equal(await test4.locator('.bench-q').count(), 3, 'three questions at first');
  assert.match(await test4.locator('.bench-q').first().innerText(), /Does touch follow your finger/);
  await test4.locator('.bench-q').first().getByRole('button', { name: '👍 yes' }).click();
  assert.match(await test4.locator('.bench-tile.full').filter({ hasText: 'touch' }).innerText(), /✓ full/);
  await test4.getByRole('button', { name: /Answer more/ }).click();
  assert.ok(await test4.locator('.bench-q').count() > 10, 'all questions on request');
  const camera = test4.locator('.bench-tile', { hasText: 'camera' }).first();
  await camera.click(); // broken → blocked
  assert.match(await camera.getAttribute('class') ?? '', /blocked/);
  await test4.getByRole('button', { name: 'Send report card' }).click();
  await test4.getByText('Thank you!').waitFor();
  assert.equal(await test4.locator('.bench-thanks a.bench-donate').getAttribute('href'), 'https://www.buymeacoffee.com/philipplinux');
  assert.equal(await test4.locator(':scope > summary .badge').innerText(), 'COMPLETED', 'optional section 4 goes green once sent');
  assert.ok(await test4.evaluate(el => el.classList.contains('done')));
  const code = url[1].split('/').pop();
  const row = d1('--command', `SELECT final, submitted FROM bench_runs WHERE code = '${code}'`);
  assert.match(row, /\\"touch\\":\\"full\\"/); assert.match(row, /\\"camera\\":\\"blocked\\"/); assert.match(row, /\\"gps\\":\\"inconclusive\\"/);
  assert.equal((await fetch(url[1])).status, 404, 'code closes after submit');
  assert.match(d1('--command', `SELECT inbox FROM inbox WHERE ref = '${code}'`), /"inbox": "benchmarks"/, 'submitted card lands in the benchmarks inbox');
});

test('report form', async () => {
  await page.goto(`${BASE}/?device=starlte`);
  await page.locator('.report summary').click();
  await page.locator('.report textarea').fill('bench report');
  await page.getByRole('button', { name: 'Send report' }).click();
  await page.getByText('Thanks, report sent.').waitFor();
  assert.match(d1('--command', 'SELECT page FROM reports'), /device=starlte/);
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
