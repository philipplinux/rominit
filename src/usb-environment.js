// Store selected diagnostic values, never raw user agents or operating-system descriptions.
export const USB_OS = ['linux', 'windows', 'macos', 'android', 'ios', 'chromeos', 'unknown'];
export const USB_DISTROS = ['fedora', 'ubuntu', 'debian', 'alpine', 'arch', 'manjaro', 'opensuse', 'nixos', 'linuxmint', 'centos', 'rhel', 'rocky', 'other'];
export const USB_ARCHES = ['x64', 'arm64', 'arm', 'ia32', 'riscv64', 'ppc64', 's390x', 'other'];
export const USB_BROWSERS = ['chrome', 'chromium', 'edge', 'firefox', 'safari', 'opera', 'brave', 'other'];
const VERSION = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/;
const browserFields = { browser: USB_BROWSERS, browserVersion: null, browserOs: USB_OS, browserOsVersion: null };
const fields = { hostOs: USB_OS, hostOsVersion: null, hostDistro: USB_DISTROS, hostArch: USB_ARCHES,
  kernelVersion: null, cliVersion: /^[a-f0-9]{12}$/, nodeVersion: null, ...browserFields };
function validate(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length ||
      Object.keys(value).some(key => !Object.hasOwn(allowed, key))) return null;
  const result = {};
  for (const [key, rule] of Object.entries(allowed)) {
    if (!Object.hasOwn(value, key)) continue;
    const item = value[key];
    if (typeof item !== 'string' || item.length > 32 ||
        (Array.isArray(rule) ? !rule.includes(item) : !(rule ?? VERSION).test(item))) return null;
    result[key] = item;
  }
  return result;
}
export const validateUsbEnvironment = value => validate(value, fields);
export const validateUsbBrowser = value => validate(value, browserFields);
