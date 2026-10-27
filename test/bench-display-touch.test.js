import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import nodeTest from 'node:test';
// bench scripts run under POSIX sh, which Windows lacks
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;

const linux = await readFile(new URL('../site/bench/linux.sh', import.meta.url), 'utf8');
const probes = linux.slice(linux.indexOf('p_screen() {'), linux.indexOf('\ngpu_probe() {'));
async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'rominit-display-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  let code = probes;
  for (const prefix of ['/sys/class/graphics', '/sys/class/drm', '/sys/class/backlight', '/sys/class/input', '/dev/dri', '/dev/input', '/dev/fb0'])
    code = code.replaceAll(prefix, root + prefix);
  return command => {
    const result = spawnSync('/bin/sh', ['-c', code + '\n' + command], { encoding: 'utf8', timeout: 2000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
}

test('framebuffer resolution and backlight state are evidence, not automatic visual success', async t => {
  const run = await fixture(t, {
    'sys/class/graphics/fb0/modes': 'U:1440x2960p-0\n',
    'sys/class/graphics/fb0/bits_per_pixel': '32\n',
    'sys/class/backlight/display/brightness': '0\n',
    'sys/class/backlight/display/max_brightness': '255\n',
    'sys/class/backlight/display/actual_brightness': '0\n',
    'sys/class/backlight/display/bl_power': '4\n',
  });
  assert.match(run('p_screen'), /^ask .*fb0 listed mode U:1440x2960p-0 32bpp; backlight requested 0\/255 actual=0 power=off \(4\); visual output not verified/);
});

test('DRM connector probe works without a framebuffer and does not call a missing output broken', async t => {
  const run = await fixture(t, {
    'sys/class/drm/card0-eDP-1/status': 'connected\n',
    'sys/class/drm/card0-eDP-1/enabled': 'enabled\n',
    'sys/class/drm/card0-eDP-1/modes': '1920x1080\n1280x720\n',
  });
  assert.match(run('p_screen'), /^ask .*card0-eDP-1 listed mode 1920x1080 enabled/);
  const empty = await fixture(t, {});
  assert.match(empty('p_screen'), /^inconclusive /);
});

test('generic direct-touch capabilities work across 32-bit and 64-bit bitmap groupings', async t => {
  for (const absolute of ['4263800000000003', '42638000 00000003', '3']) {
    const run = await fixture(t, {
      'sys/class/input/event7/device/name': 'Generic HID touchscreen\n',
      'sys/class/input/event7/device/properties': '2\n',
      'sys/class/input/event7/device/capabilities/abs': absolute + '\n',
    });
    const output = run('p_touch');
    assert.match(output, /^ask .*Generic HID touchscreen/);
    assert.match(output, absolute === '3' ? /absolute XY/ : /multitouch XY/);
    assert.match(output, /event access requires permission; events not sampled/);
  }
});

test('a pointer touchpad does not satisfy the touchscreen check', async t => {
  const run = await fixture(t, {
    'sys/class/input/event2/device/name': 'Generic touchpad\n',
    'sys/class/input/event2/device/properties': '1\n',
    'sys/class/input/event2/device/capabilities/abs': '60000000000000\n',
  });
  assert.match(run('p_touch'), /^inconclusive /);
});
