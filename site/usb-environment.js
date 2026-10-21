import { validateUsbBrowser } from '../src/usb-environment.js';

const VERSION = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/;

function version(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replaceAll('_', '.');
  return normalized.length <= 32 && VERSION.test(normalized) ? normalized : undefined;
}

function browserName(value = '') {
  const name = String(value).toLowerCase();
  if (/microsoft edge|\bedge\b/.test(name)) return 'edge';
  if (/opera/.test(name)) return 'opera';
  if (/brave/.test(name)) return 'brave';
  if (/google chrome|\bchrome\b/.test(name)) return 'chrome';
  if (/chromium/.test(name)) return 'chromium';
  if (/firefox/.test(name)) return 'firefox';
  if (/safari/.test(name)) return 'safari';
  return null;
}

function platformName(value = '') {
  const platform = String(value).toLowerCase();
  if (platform.includes('chrome os') || platform.includes('chromeos')) return 'chromeos';
  if (platform.includes('windows') || platform === 'win32' || platform === 'win64') return 'windows';
  if (platform.includes('mac') || platform.includes('darwin')) return 'macos';
  if (platform.includes('android')) return 'android';
  if (platform === 'ios' || platform.includes('iphone') || platform.includes('ipad')) return 'ios';
  if (platform.includes('linux') || platform.includes('x11')) return 'linux';
  return null;
}

function fromBrands(brands) {
  if (!Array.isArray(brands)) return {};
  const entries = brands.filter(item => item && typeof item.brand === 'string');
  const order = ['edge', 'opera', 'brave', 'chrome', 'chromium', 'firefox', 'safari'];
  for (const known of order) {
    const entry = entries.find(item => browserName(item.brand) === known);
    if (!entry) continue;
    const browserVersion = version(entry.version);
    return { browser: known, ...(browserVersion ? { browserVersion } : {}) };
  }
  return {};
}

/** Parse only recognized UA tokens; the raw user-agent string is never returned. */
export function parseUsbUserAgent(userAgent = '') {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 2048) : '';
  let browser = null, browserVersion;
  /** @type {[string, RegExp][]} */
  const matches = [
    ['edge', /\bEdg(?:A|iOS)?\/([\d.]+)/i],
    ['opera', /\b(?:OPR|Opera)\/([\d.]+)/i],
    ['brave', /\bBrave\/([\d.]+)/i],
    ['firefox', /\bFirefox\/([\d.]+)/i],
    ['chromium', /\bChromium\/([\d.]+)/i],
    ['chrome', /\bChrome\/([\d.]+)/i],
    ['safari', /\bVersion\/([\d.]+).*\bSafari\//i],
  ];
  for (const [name, pattern] of matches) {
    const found = pattern.exec(ua);
    if (!found) continue;
    browser = name;
    browserVersion = version(found[1]);
    break;
  }

  let browserOs = null, browserOsVersion;
  /** @type {[string, RegExp][]} */
  const osRules = [
    ['android', /\bAndroid\s+([\d.]+)/i],
    ['ios', /\b(?:iPhone|iPad|iPod).*?\bOS\s+([\d_]+)/i],
    ['chromeos', /\bCrOS\s+[^;]+?\s([\d.]+)(?:\s|$)/i],
  ];
  for (const [name, pattern] of osRules) {
    const found = pattern.exec(ua);
    if (!found) continue;
    browserOs = name;
    browserOsVersion = version(found[1]);
    break;
  }
  if (!browserOs) {
    if (/\bWindows NT\s+[\d.]+/i.test(ua)) browserOs = 'windows';
    else if (/\bMacintosh\b|\bMac OS X\b/i.test(ua)) browserOs = 'macos';
    else if (/\bLinux\b|\bX11\b/i.test(ua)) browserOs = 'linux';
  }

  // Chromium reduces Android's UA to Android 10 and desktop Windows/macOS to
  // compatibility values. Report those precise platform versions only from Client Hints.
  if (browserOs === 'android' && ['chrome', 'chromium', 'edge', 'opera', 'brave'].includes(browser)) browserOsVersion = undefined;
  if (browserOs === 'macos') browserOsVersion = undefined;
  if (browserOs === 'windows') browserOsVersion = undefined;
  return validateUsbBrowser({ browser: browser ?? 'other', ...(browserVersion ? { browserVersion } : {}),
    browserOs: browserOs ?? 'unknown', ...(browserOsVersion ? { browserOsVersion } : {}) });
}

function parseUserAgentData(data, highEntropy = {}) {
  const browser = fromBrands(highEntropy.fullVersionList ?? data?.brands);
  const platform = platformName(highEntropy.platform ?? data?.platform);
  const browserOsVersion = version(highEntropy.platformVersion);
  return {
    ...browser,
    ...(platform ? { browserOs: platform } : {}),
    ...(platform && browserOsVersion ? { browserOsVersion } : {}),
  };
}

/**
 * Return the small allowlisted browser diagnostic object for an OS-USB report.
 * The high-entropy User-Agent Client Hints request is bounded to 500 ms.
 * @param {any} [navigatorObject]
 * @param {{timeoutMs?:number}} [options]
 */
export async function collectUsbBrowserEnvironment(navigatorObject = globalThis.navigator, { timeoutMs = 500 } = {}) {
  const fallback = parseUsbUserAgent(navigatorObject?.userAgent ?? '');
  const data = navigatorObject?.userAgentData;
  if (!data || typeof data.getHighEntropyValues !== 'function') return fallback;

  let timer;
  try {
    const request = Promise.resolve().then(() => data.getHighEntropyValues(['fullVersionList', 'platformVersion']));
    const highEntropy = await Promise.race([request, new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
    if (!highEntropy || typeof highEntropy !== 'object') return fallback;
    const enriched = parseUserAgentData(data, highEntropy);
    return validateUsbBrowser({ ...fallback, ...enriched }) ?? fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
