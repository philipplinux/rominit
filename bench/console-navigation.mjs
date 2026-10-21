// Run after building: node --max-old-space-size=256 bench/console-navigation.mjs [preview URL]
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium-browser', args:['--disable-gpu']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}, reducedMotion:'reduce'});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.argv[2] ?? 'https://ps5-console.rominit.pages.dev';
  await page.goto(`${base}/ps5?model=original&firmware=13.60`);
  const matches = page.locator('.console-match-link');
  await matches.first().waitFor();
  assert.equal(await matches.count(), 1);
  assert.match(await matches.innerText(), /Relapse/);
  await matches.click();
  await page.waitForFunction(() => document.querySelector('.console-project:target')?.textContent.includes('Relapse'));
  assert.equal(await page.locator('.console-project:target').evaluate(el => getComputedStyle(el).outlineWidth), '3px');
  await page.locator('.progress-rail a[title="Deeper access"]').click();
  assert.equal(await page.locator('#console-kernel-section').evaluate(el => el.open), true);
  await page.waitForFunction(() => document.querySelector('.progress-rail a[aria-current="location"]')?.getAttribute('title') === 'Deeper access');
  await page.selectOption('#console-installed-firmware', '14.20');
  assert.equal(await matches.count(), 0);
  assert.equal(await page.locator('.console-project:target').count(), 0);
  assert.match(await page.locator('#console-match-status').innerText(), /No starting point/);
  await page.selectOption('#console-model', 'pro');
  await page.selectOption('#console-installed-firmware', '10.40');
  assert.match(await matches.allTextContents().then(items=>items.join(' ')), /Lua/);
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  assert.equal(await page.locator('.progress-rail').isVisible(), false);
  await page.goto(base + '/?device=laurel_sprout');
  await page.evaluate(() => localStorage.setItem('host','linux'));
  await page.reload();
  await page.waitForSelector('.progress-rail', {state:'attached'});
  assert.ok(await page.locator('.rail-fold').count());
  assert.deepEqual(errors, []);
  console.log('Console matches, target highlight, active rail, accordion navigation, firmware gaps, mobile fit and shared phone rail passed.');
} finally { await browser.close(); }
