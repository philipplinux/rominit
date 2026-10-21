import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CONSOLES, consoleCompatibility } from '../src/consoles/index.js';

test('console compatibility preserves firmware gaps and model boundaries', () => {
  const project = { compatibility: [{ models: ['original', 'slim'], supportedFirmware: ['13.00', '13.60'], status: 'documented' }, { models: ['pro'], supportedFirmware: ['13.60'], status: 'documented' }] };
  assert.equal(consoleCompatibility(project, 'original', '13.60'), 'Documented by project');
  assert.equal(consoleCompatibility(project, 'original', '13.20'), 'Not listed as supported');
  assert.equal(consoleCompatibility(project, 'pro', '13.00'), 'Not listed as supported');
  assert.equal(consoleCompatibility(project, 'pro', '14.20'), 'Not listed as supported');
  assert.equal(consoleCompatibility({ compatibility: [] }, 'pro', '13.60'), 'Unverified');
  assert.equal(consoleCompatibility({ compatibility: [{ models: ['pro'], supportedFirmware: ['13.60'], status: 'unverified' }] }, 'pro', '13.60'), 'Unverified');
  assert.equal(consoleCompatibility({ compatibility: [{ models: ['pro'], supportedFirmware: ['13.00'], status: 'unverified' }] }, 'pro', '14.20'), 'Not listed as supported');
});

test('console records carry sources, explicit project limits and no executable recipes', () => {
  assert.equal(CONSOLES.length, 1);
  for (const entry of CONSOLES) {
    assert.match(entry.firmware.checkedDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.firmware.source, /^https:\/\//);
    assert(entry.variants.some(variant => /Pro/.test(variant.model)));
    assert(entry.homebrew.filter(project => project.kind === 'entrypoint').length >= 3);
    assert(!('roms' in entry) && !('stages' in entry));
    for (const project of entry.homebrew) {
      assert.match(project.source, /^https:\/\//);
      assert.match(project.checkedDate, /^\d{4}-\d{2}-\d{2}$/);
      assert(Array.isArray(project.requirements) && Array.isArray(project.warnings) && Array.isArray(project.links));
      assert(project.firmware && project.models.length && Array.isArray(project.compatibility));
      for (const rule of project.compatibility) {
        assert(rule.models.every(model => ['original', 'slim', 'pro'].includes(model)));
        assert(['documented', 'unverified'].includes(rule.status));
        if (rule.status === 'documented') assert(rule.supportedFirmware.length, 'Documented compatibility needs an exact firmware list');
        assert(rule.supportedFirmware.every(firmware => /^\d+\.\d{2}$/.test(firmware)));
      }
    }
  }
});

test('PS5 sample exposes a legacy entry point and preserves unofficial-port exclusions', () => {
  const ps5 = CONSOLES.find(entry => entry.id === 'ps5');
  const umtx = ps5.homebrew.find(project => project.name === 'UMTX2');
  assert.equal(consoleCompatibility(umtx, 'original', '4.03'), 'Documented by project');
  assert(!consoleCompatibility(umtx, 'pro', '4.03').startsWith('Documented'));
  const port = ps5.homebrew.find(project => project.name.includes('unofficial port'));
  assert.equal(consoleCompatibility(port, 'original', '13.60'), 'Documented by project');
  assert.equal(consoleCompatibility(port, 'original', '11.40'), 'Not listed as supported');
  assert(ps5.homebrew.filter(project => project.kind === 'entrypoint').every(project =>
    !consoleCompatibility(project, 'original', ps5.firmware.shortVersion).startsWith('Documented')));
});

test('PS5 overview has credited local assets and separates emulation readiness from recovery', () => {
  const ps5 = CONSOLES.find(entry => entry.id === 'ps5');
  for (const media of Object.values(ps5.media)) {
    assert(existsSync(new URL(`../site/${media.src}`, import.meta.url)));
    assert(media.page && media.artist && media.license && media.width > 0 && media.height > 0);
  }
  assert.equal(ps5.highlights.length, 2);
  for (const item of ps5.highlights) assert(item.source && item.checkedDate && item.target);
  const emulators = ps5.homebrew.filter(project => project.kind.startsWith('emulation'));
  assert(emulators.length > 0);
  for (const project of emulators) {
    assert('availability' in project && 'runtime' in project);
    if (project.availability.toLowerCase().includes('source-only')) assert.equal(project.kind, 'emulation-research');
  }
  const sony = ps5.homebrew.find(project => project.kind === 'recovery' && project.source.includes('playstation.com'));
  assert(sony.compatibility.some(rule => rule.supportedFirmware.includes(ps5.firmware.shortVersion)));
  assert(sony.warnings.some(warning => /deletes|erases/i.test(warning)));
});

test('emulator pages are sourced, link a known console and are linked back from it', async () => {
  const { EMULATORS } = await import('../src/emulators/index.js');
  for (const emulator of EMULATORS) {
    assert.match(emulator.source, /^https:\/\//);
    assert.match(emulator.checkedDate, /^\d{4}-\d{2}-\d{2}$/);
    assert(emulator.links.every(link => link.url.startsWith('https://')));
    for (const id of emulator.plays) assert(CONSOLES.find(c => c.id === id).homebrew.some(project => project.page === emulator.id), `${id} does not link ${emulator.id}`);
  }
});
