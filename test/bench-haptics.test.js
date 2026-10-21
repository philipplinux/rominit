import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const source = await readFile(new URL('../site/bench/linux.sh', import.meta.url), 'utf8');
const start = source.indexOf('p_haptics() {');
const probe = source.slice(start, source.indexOf('\n}', start) + 2);

test('timed-output vibration is detected silently and writes only after explicit opt-in', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rominit-haptics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'sys/class/timed_output/vibrator'), { recursive: true });
  const control = join(root, 'sys/class/timed_output/vibrator/enable');
  await writeFile(control, '0\n');
  const script = probe.replaceAll('/sys/', `${root}/sys/`).replaceAll('/proc/', `${root}/proc/`);
  const run = sound => spawnSync('/bin/sh', ['-c', `has() { return 1; }\n${script}\np_haptics`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ROMINIT_SOUND: sound } });
  assert.match(run('0').stdout, /^ask Vibrator interface found/);
  assert.equal(await readFile(control, 'utf8'), '0\n');
  assert.match(run('1').stdout, /^ask Did the phone just buzz/);
  assert.equal(await readFile(control, 'utf8'), '200\n');
  const failed = spawnSync('/bin/sh', ['-c', `has() { return 0; }\ntimeout() { return 1; }\n${script}\np_haptics`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ROMINIT_SOUND: '1' } });
  assert.match(failed.stdout, /^ask Vibration command failed/);
  assert.doesNotMatch(failed.stdout, /Did the phone just buzz/);
  await chmod(control, 0o444);
  if (process.getuid?.() !== 0) assert.match(run('1').stdout, /^blocked Vibrator found; this user cannot write/);
  assert.equal(await readFile(control, 'utf8'), '200\n');
  await rm(control);
  assert.match(run('1').stdout, /^inconclusive no vibrator interface detected/);
});
