/** Embed both probe families so a piped SSH/ADB run needs no network on the phone.
 * @param {string} linux @param {string} android @param {string} family */
export function benchmarkScript(linux, android, family) {
  const version = /^VERSION=(\d+)$/m.exec(family === 'linux' ? linux : android)?.[1];
  return `#!/bin/sh\nVERSION=${version}\nif command -v getprop >/dev/null 2>&1 && [ -n "$(getprop ro.build.version.sdk 2>/dev/null)" ]; then\n${android}\nelse\n${linux}\nfi\n`;
}
