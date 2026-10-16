// What the user's own computer needs before WebUSB can reach a phone, per host OS and USB protocol.
// Plain data + pure functions (the CLI reuses them); the site picks the host and shows the matching lines.

/** Host machines the site gives instructions for. */
export const HOSTS = { linux: 'Linux', windows: 'Windows', mac: 'macOS', android: 'Android', chromeos: 'ChromeOS' };

/** Lets the logged-in user open phones over USB: ADB/fastboot interfaces of any brand, and Samsung's Download Mode. */
export const UDEV_RULE = `sudo tee /etc/udev/rules.d/51-rominit.rules >/dev/null <<'EOF'
# ADB and fastboot on any phone
SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", ENV{ID_USB_INTERFACES}=="*:ff420?:*", TAG+="uaccess"
# Samsung (Download Mode)
SUBSYSTEM=="usb", ATTR{idVendor}=="04e8", TAG+="uaccess"
EOF
sudo udevadm control --reload-rules && sudo udevadm trigger`;

const USB = ['fastboot', 'odin', 'adb', 'sideload'];
/** @typedef {{id:string, text:string, command?:string, url?:string, protocols:string[]}} Prereq */
/** One-time setup per host. `protocols` limits a line to the stages that need it; `command` is copy-paste. @type {Record<string, Prereq[]>} */
export const PREREQS = {
  linux: [
    { id: 'udev', text: 'Allow your user to open phones over USB (once, then replug the phone):', command: UDEV_RULE, protocols: USB },
    { id: 'snap', text: 'Chromium from Snap (Ubuntu) needs USB access granted:', command: 'sudo snap connect chromium:raw-usb', protocols: USB },
  ],
  windows: [
    { id: 'zadig', text: 'Windows only lets the browser reach a phone that uses the WinUSB driver. Put the phone in this stage\'s mode, run Zadig, Options › List All Devices, pick the phone, choose WinUSB, Replace Driver. Each mode (fastboot, ADB, Download Mode) shows up as its own device.', url: 'https://zadig.akeo.ie/', protocols: USB },
    { id: 'samsung-driver', text: 'Download Mode: Zadig replaces Samsung\'s own driver for that mode, so Odin and Smart Switch stop seeing it. Roll back in Device Manager › Driver › Roll Back Driver when you need them.', protocols: ['odin'] },
    { id: 'google-driver', text: 'Fastboot and ADB alternative to Zadig: Google\'s USB driver.', url: 'https://developer.android.com/studio/run/win-usb', protocols: ['fastboot', 'adb', 'sideload'] },
  ],
  mac: [],
  chromeos: [],
  android: [
    { id: 'otg', text: 'Flashing from a phone: connect with a USB OTG cable or adapter, use Chrome, and allow USB access when Chrome asks. Keep this phone charged; it powers the other one.', protocols: USB },
  ],
};

/** Applies to every host: only one program can hold the phone's USB interface. @type {Prereq} */
export const ALWAYS = { id: 'busy', text: 'Close other USB tools first: other ROMinit tabs, Android Studio, and the computer\'s own adb server:', command: 'adb kill-server', protocols: USB };

/** Best guess of the host from the browser. @param {{userAgent:string, userAgentData?:{platform?:string}}} nav @returns {keyof typeof HOSTS} */
export function detectHost(nav) {
  const text = `${nav.userAgentData?.platform ?? ''} ${nav.userAgent}`.toLowerCase();
  if (text.includes('android')) return 'android';
  if (text.includes('cros') || text.includes('chrome os')) return 'chromeos';
  if (text.includes('win')) return 'windows';
  if (text.includes('mac')) return 'mac';
  return 'linux';
}

/** Setup lines for one stage. @param {string} host @param {string} protocol */
export const prereqsFor = (host, protocol) => [...(PREREQS[host] ?? []), ALWAYS].filter(p => p.protocols.includes(protocol));

/** Browser problem, or null when this browser can flash. @param {{usb?:unknown, secure:boolean, host:string}} env */
export function browserProblem({ usb, secure, host }) {
  if (!secure) return 'Flashing needs the HTTPS page: open https://rominit.pages.dev.';
  if (usb) return null;
  if (host === 'android') return 'This browser cannot reach USB. Use Chrome for Android.';
  return `This browser cannot reach USB (no WebUSB; Firefox and Safari lack it). Use ${host === 'windows' ? 'Microsoft Edge (already on Windows) or Chrome' : 'Chrome, Chromium or Edge'}.`;
}

/** Host-specific fix for a USB error, or null. @param {string} error @param {string} host @param {string} protocol */
export function fixFor(error, host, protocol) {
  if (/no device selected/i.test(error)) return host === 'windows'
    ? 'Phone not in the list? Windows hides phones without the WinUSB driver: see the Zadig step above.'
    : 'Phone not in the list? Check the cable (data, not charge-only) and that the phone is in the right mode.';
  if (!/in use|claim|access denied|security|permission/i.test(error)) return null;
  const steps = prereqsFor(host, protocol).filter(p => p.id !== 'snap' && p.id !== 'google-driver');
  return `Fix: ${steps.map(p => p.command ? `${p.text.replace(/:$/, '')} (\`${p.command.split('\n')[0]}…\`)` : p.text).join(' · ')}`;
}
