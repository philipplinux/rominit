// Website bench: every agreed site feature, end to end in a real browser against `wrangler pages dev` with a fresh local D1.
// Run: npm run build && npm run bench   (CHROMIUM=/path/to/chrome to override the browser)
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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
  server = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state, '--binding', 'SALT=bench'], { stdio: 'ignore', detached: true });
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
  assert.equal(await page.locator('p.rating', { has: page.locator('strong', { hasText: 'login' }) }).count(), 2);
  assert.match(await text('p.rating:has(strong:text-is("login"))'), /user: user[\s\S]*password: changeme/);
  for (const group of ['basics', 'multimedia', 'connectivity', 'modem', 'misc', 'sensors']) assert.equal(await page.locator('p.rating strong', { hasText: group }).count(), 1, group);
  for (const row of ['Includes', 'Lacks']) assert.equal(await page.locator('p.includes strong', { hasText: row }).count(), 1, row);
  assert.match(await text('.page-section summary small'), /as computer \d+% · as phone \d+% · downstream kernel/);
});

test('ROM select groups by origin; stock ROMs only under Recover / revert', async () => {
  await page.goto(`${BASE}/?device=laurel_sprout`);
  const labels = await page.locator('select optgroup').evaluateAll(groups => groups.map(g => g.getAttribute('label')));
  assert.ok(!labels.includes('stock'), 'stock is not offered as a ROM');
  const revert = page.locator('details.page-section', { hasText: '4 · Recover / revert' });
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
  assert.deepEqual((await page.locator('.page-section > summary > span').allInnerTexts()).map(t => t.slice(0, 1)).slice(0, 5), ['0', '1', '2', '3', '4']);
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
  await page.locator('button.star[title="Rate 4 of 5"]').click();
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

test('comment with screenshot stays hidden until approved, then shows capped', async () => {
  await page.goto(`${BASE}/?device=starlte`);
  const box = page.locator('.comment-box').first();
  await box.locator('textarea').fill('bench comment');
  await box.locator('input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await box.getByRole('button', { name: 'Post comment' }).click();
  await box.getByText('Posted. The screenshot shows after review.').waitFor();
  await box.getByText('Screenshot awaiting review.').waitFor();
  const [{ id }] = await (await fetch(`${BASE}/api/comments?rom=starlte/${await page.locator('select').inputValue()}`)).json();
  assert.equal((await fetch(`${BASE}/api/image?id=${id}`)).status, 404);
  d1('--command', `UPDATE comment_images SET approved = 1 WHERE comment_id = ${Number(id)}`);
  assert.equal((await fetch(`${BASE}/api/image?id=${id}`)).headers.get('content-type'), 'image/webp');
  await page.reload();
  const img = page.locator('.comments img');
  await img.waitFor();
  assert.ok(await img.evaluate(el => /** @type {HTMLImageElement} */ (el).naturalWidth > 0));
  assert.equal(await img.evaluate(el => getComputedStyle(el).maxHeight), '240px');
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
