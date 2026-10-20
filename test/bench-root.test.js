import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const linuxPath = fileURLToPath(new URL('../site/bench/linux.sh', import.meta.url));
const linux = await readFile(linuxPath, 'utf8');
const start = linux.indexOf('p_root() {'), end = linux.indexOf('\np_usb_net() {', start);
assert.ok(start >= 0 && end > start, 'missing p_root probe');
const probe = linux.slice(start, end);

test('Linux root probe verifies uid 0 without prompting and labels auth/package availability as unverified', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rominit-root-probe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  await mkdir(bin);
  const writeCommand = async (name, body) => {
    const path = join(bin, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
  };
  await writeCommand('id', '[ "$1" = -u ] && printf \'%s\\n\' "$ROMINIT_TEST_UID"');
  const has = 'has() { command -v "$1" >/dev/null 2>&1; }';
  const run = env => spawnSync('/bin/sh', ['-c', `${has}\n${probe}\np_root`], {
    encoding: 'utf8', env: { PATH: bin, ROMINIT_TEST_UID: '10000', ...env },
  });

  const rootUser = run({ ROMINIT_TEST_UID: '0' });
  assert.equal(rootUser.status, 0, rootUser.stderr);
  assert.equal(rootUser.stdout.trim(), 'available benchmark runs as uid 0');

  const noTools = run({});
  assert.equal(noTools.status, 0, noTools.stderr);
  assert.equal(noTools.stdout.trim(), 'missing uid 0 and noninteractive sudo/doas not found; interactive root not tested');

  const suCalled = join(root, 'su-called');
  await writeCommand('su', 'printf called > "$ROMINIT_SU_MARKER"');
  const suOnly = run({ ROMINIT_SU_MARKER: suCalled });
  assert.equal(suOnly.stdout.trim(), 'unverified su found; root access not checked');
  await assert.rejects(readFile(suCalled), { code: 'ENOENT' });

  for (const command of ['grep', 'tr', 'cut']) {
    const target = execFileSync('/bin/sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).trim();
    await symlink(target, join(bin, command));
  }
  await writeCommand('timeout', '[ "$1" = 3 ] || exit 90\nshift\nexec "$@"');
  await writeCommand('sudo', '[ "$1 $2 $3" = "-n id -u" ] || exit 91\nprintf \'%s\\n\' "$ROMINIT_TEST_SUDO_OUTPUT" >&2\nexit "\${ROMINIT_TEST_SUDO_EXIT:-0}"');

  const sudoWorks = run({ ROMINIT_TEST_SUDO_OUTPUT: '0' });
  assert.equal(sudoWorks.status, 0, sudoWorks.stderr);
  assert.equal(sudoWorks.stdout.trim(), 'available sudo grants uid 0 without a password');

  const sudoNeedsPassword = run({ ROMINIT_TEST_SUDO_OUTPUT: 'sudo: interactive authentication required', ROMINIT_TEST_SUDO_EXIT: '1' });
  assert.equal(sudoNeedsPassword.status, 0, sudoNeedsPassword.stderr);
  assert.equal(sudoNeedsPassword.stdout.trim(), 'unverified sudo requires interactive authentication');
});

test('Linux root marker stays separate from features and precedes package fallback', () => {
  assert.ok(linux.indexOf('say "@root $(p_root)"') < linux.indexOf('say "@pkgs '));
  assert.doesNotMatch(probe, /(?:timeout 3|exec)\s+su\b/, 'the probe never invokes su');
  assert.match(probe, /timeout 3 "\$tool" -n id -u/, 'privilege checks are noninteractive and bounded');
});
