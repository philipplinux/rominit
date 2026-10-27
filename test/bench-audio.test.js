import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeTest from 'node:test';
// bench scripts run under POSIX sh, which Windows lacks
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;

const scriptPath = fileURLToPath(new URL('../site/bench/linux.sh', import.meta.url));
const script = await readFile(scriptPath, 'utf8');
const start = script.indexOf('p_audio() {'), end = script.indexOf('\n}', start);
assert.ok(start >= 0 && end > start, 'missing p_audio function');
const audioProbe = script.slice(start, end + 2);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'rominit-bench-audio-'));
  const bin = join(root, 'bin'), proc = join(root, 'proc/asound'), dev = join(root, 'dev/snd');
  await mkdir(bin);
  await writeFile(join(bin, 'timeout'), '#!/bin/sh\n[ "$1" = 3 ] || exit 90\nshift\nexec "$@"\n');
  await writeFile(join(bin, 'speaker-test'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$ROMINIT_TEST_AUDIO_CALLS"\nexit "${ROMINIT_TEST_AUDIO_RC:-0}"\n');
  await Promise.all([chmod(join(bin, 'timeout'), 0o755), chmod(join(bin, 'speaker-test'), 0o755)]);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, bin, proc, dev, calls: join(root, 'audio-calls') };
}

async function inventory(f, { cards, pcm, nodes = [] }) {
  await mkdir(f.proc, { recursive: true });
  await mkdir(f.dev, { recursive: true });
  if (cards !== undefined) await writeFile(join(f.proc, 'cards'), cards);
  if (pcm !== undefined) await writeFile(join(f.proc, 'pcm'), pcm);
  await Promise.all(nodes.map(node => writeFile(join(f.dev, node), '')));
}

function run(f, { sound = '', toneRc = 0, hideTimeout = false } = {}) {
  const paths = audioProbe.replaceAll('/proc/asound', `${f.root}/proc/asound`).replaceAll('/dev/snd', `${f.root}/dev/snd`);
  const has = hideTimeout
    ? 'has() { [ "$1" = timeout ] && return 1; command -v "$1" >/dev/null 2>&1; }'
    : 'has() { command -v "$1" >/dev/null 2>&1; }';
  return spawnSync('/bin/sh', ['-c', `${has}\n${paths}\np_audio\n`], {
    encoding: 'utf8', env: { PATH: `${f.bin}:/usr/bin:/bin`, ROMINIT_SOUND: sound,
      ROMINIT_TEST_AUDIO_RC: String(toneRc), ROMINIT_TEST_AUDIO_CALLS: f.calls },
  });
}

const card = ' 0 [Madera         ]: SDW-Madera - Star-Madera\n';

test('ALSA playback and capture counts prompt manual listening without default sound output', async t => {
  const f = await fixture(t);
  await inventory(f, { cards: card,
    pcm: '00-00: RDMA0 (*) : playback 1 : capture 0\n00-01: WDMA0 (*) : playback 0 : capture 1\n',
    nodes: ['pcmC0D0p', 'pcmC0D1c'] });
  const result = run(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ask ALSA playback 1, capture 1; play a sound and confirm the speaker is audible');
  assert.equal(existsSync(f.calls), false);
});

test('capture-only and a card without PCM devices are partial, while missing inventory is inconclusive', async t => {
  const capture = await fixture(t);
  await inventory(capture, { cards: card, pcm: '00-01: WDMA0 (*) : playback 0 : capture 1\n', nodes: ['pcmC0D1c'] });
  assert.equal(run(capture).stdout.trim(), 'partial ALSA playback 0, capture 1; capture-only, speaker output unverified');

  const noPcm = await fixture(t);
  await inventory(noPcm, { cards: card, pcm: '' });
  assert.equal(run(noPcm).stdout.trim(), 'partial ALSA card 1; no playback/capture PCM devices');

  const nodesOnly = await fixture(t);
  await inventory(nodesOnly, { nodes: ['pcmC0D0p', 'pcmC0D1c'] });
  assert.equal(run(nodesOnly).stdout.trim(), 'ask ALSA playback 1, capture 1; play a sound and confirm the speaker is audible');

  const missing = await fixture(t);
  assert.equal(run(missing).stdout.trim(), 'inconclusive ALSA audio inventory unavailable');
});

test('opted-in tone failure is bounded and never reported as an audible tone', async t => {
  const f = await fixture(t);
  await inventory(f, { cards: card, pcm: '00-00: RDMA0 (*) : playback 1 : capture 0\n', nodes: ['pcmC0D0p'] });
  const failed = run(f, { sound: '1', toneRc: 1 });
  assert.equal(failed.status, 0, failed.stderr);
  assert.equal(failed.stdout.trim(), 'ask ALSA playback 1, capture 0; opted-in tone check failed, play a sound and confirm it is audible');
  assert.equal((await readFile(f.calls, 'utf8')).trim(), '-t sine -f 660 -l 1');
  assert.doesNotMatch(failed.stdout, /did you hear the short/);

  const noTimeout = run(f, { sound: '1', hideTimeout: true });
  assert.equal(noTimeout.status, 0, noTimeout.stderr);
  assert.match(noTimeout.stdout, /timeout or speaker-test unavailable/);
  assert.equal((await readFile(f.calls, 'utf8')).trim(), '-t sine -f 660 -l 1');
});

 test('bounded tone timeout asks for listening confirmation', async t => {
  const f = await fixture(t);
  await inventory(f, { cards: card, pcm: '00-00: speaker : playback 1\n', nodes: ['pcmC0D0p'] });
  assert.match(run(f, { sound: '1', toneRc: 124 }).stdout, /stopped after 3 seconds; did you hear anything/);
});
