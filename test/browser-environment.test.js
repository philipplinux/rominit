import assert from 'node:assert/strict';
import test from 'node:test';
import { collectUsbBrowserEnvironment, parseUsbUserAgent } from '../site/usb-environment.js';

test('known Chrome and Firefox user agents yield only normalized browser and OS fields', () => {
  assert.deepEqual(parseUsbUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.7339.0 Safari/537.36'), {
    browser: 'chrome', browserVersion: '140.0.7339.0', browserOs: 'windows'
  });
  assert.deepEqual(parseUsbUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0'), {
    browser: 'firefox', browserVersion: '132.0', browserOs: 'linux'
  });
});

test('User-Agent Client Hints reports numeric browser and platform versions for Windows, macOS and Android', async () => {
  for (const [platform, platformVersion, browserOs] of [
    ['Windows', '15.0.0', 'windows'], ['macOS', '14.6.1', 'macos'], ['Android', '14.0.0', 'android']
  ]) {
    const result = await collectUsbBrowserEnvironment({
      userAgent: 'Mozilla/5.0 Chrome/140.0.7339.0 Safari/537.36',
      userAgentData: {
        brands: [{ brand: 'Not A(Brand', version: '99' }, { brand: 'Google Chrome', version: '140' }],
        platform,
        getHighEntropyValues: async () => ({
          fullVersionList: [{ brand: 'Not A(Brand', version: '99' }, { brand: 'Google Chrome', version: '140.0.7339.0' }],
          platform, platformVersion
        })
      }
    });
    assert.deepEqual(result, {
      browser: 'chrome', browserVersion: '140.0.7339.0', browserOs, browserOsVersion: platformVersion
    });
  }
});

test('reduced Android and macOS UA versions are omitted rather than guessed', () => {
  assert.deepEqual(parseUsbUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'), {
    browser: 'chrome', browserVersion: '140.0.0.0', browserOs: 'android'
  });
  assert.deepEqual(parseUsbUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15'), {
    browser: 'safari', browserVersion: '17.4', browserOs: 'macos'
  });
});

test('untrusted UA text is never copied to the report and Client Hints timeout is bounded', async () => {
  const malicious = 'Chrome/123.4 https://private.example/path<script>SECRET</script>';
  const parsed = parseUsbUserAgent(malicious);
  assert.deepEqual(parsed, { browser: 'chrome', browserVersion: '123.4', browserOs: 'unknown' });
  assert.equal(JSON.stringify(parsed).includes(malicious), false);
  assert.equal(JSON.stringify(parsed).includes('SECRET'), false);

  const started = Date.now();
  const fallback = await collectUsbBrowserEnvironment({ userAgent: 'Firefox/132.0', userAgentData: {
    getHighEntropyValues: () => new Promise(() => {})
  } }, { timeoutMs: 25 });
  assert.ok(Date.now() - started < 250, 'a stalled Client Hints API must not hold up the USB action');
  assert.deepEqual(fallback, { browser: 'firefox', browserVersion: '132.0', browserOs: 'unknown' });
});
