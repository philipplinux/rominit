import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { CONSOLES, consoleCompatibility } from '../src/consoles/index.js';
import { FAMILIES } from '../src/consoles/families.js';
import { CONSOLE_SECTIONS, consoleCopy } from '../src/consoles/labels.js';
import { officialSupportProblems } from '../src/catalog.js';

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
  assert(CONSOLES.some(entry => entry.id === 'ps5'));
  for (const entry of CONSOLES) {
    assert.match(entry.firmware.checkedDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.firmware.source, /^https:\/\//);
    if (entry.officialSupport) assert.deepEqual(officialSupportProblems(entry.officialSupport), []);
    assert(entry.variants.length);
    assert(!('roms' in entry) && !('stages' in entry));
    for (const project of entry.homebrew) {
      assert.match(project.source, /^https:\/\//);
      assert.match(project.checkedDate, /^\d{4}-\d{2}-\d{2}$/);
      assert(Array.isArray(project.requirements) && Array.isArray(project.warnings) && Array.isArray(project.links));
      assert(project.firmware && project.models.length && Array.isArray(project.compatibility));
      for (const rule of project.compatibility) {
        assert(rule.models.every(model => entry.models.some(known => known.id === model)), `${entry.id}: ${project.name} lists an unknown model`);
        assert(['documented', 'unverified'].includes(rule.status));
        if (rule.status === 'documented') assert(rule.supportedFirmware.length || rule.note, `${entry.id}: ${project.name} calls a model rule documented without firmware or an explanation`);
        assert(rule.supportedFirmware.every(firmware => typeof firmware === 'string' && firmware.length));
      }
    }
  }
});

test('PS5 sample exposes a legacy entry point and preserves unofficial-port exclusions', () => {
  const ps5 = CONSOLES.find(entry => entry.id === 'ps5');
  assert(ps5.variants.some(variant => /Pro/.test(variant.model)));
  assert(ps5.homebrew.filter(project => project.kind === 'entrypoint').length >= 3);
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

test('console pages belong to family hubs, which only link catalog pages', () => {
  assert.deepEqual(FAMILIES.map(family => family.id), ['playstation', 'nintendo', 'anbernic', 'asus-rog-ally']);
  for (const entry of CONSOLES) assert.equal(FAMILIES.filter(family => family.consoles.some(item => item.page === entry.id)).length, 1, `${entry.id} must appear in exactly one family hub`);
  for (const entry of CONSOLES) if (entry.family) assert.equal(entry.family, FAMILIES.find(family => family.consoles.some(item => item.page === entry.id))?.id, `${entry.id}: optional family field must match its hub`);
  for (const family of FAMILIES) {
    assert(family.name && family.summary && family.consoles.length, `${family.id}: hub needs a name, a line and consoles`);
    for (const item of family.consoles) {
      assert(item.name, `${family.id}: a console has no name`);
      assert(item.year === undefined || Number.isInteger(item.year) && item.year > 1900, `${family.id}: ${item.name} has a bad year`);
      if (item.page) assert(CONSOLES.some(entry => entry.id === item.page), `${family.id}: ${item.page} has no console page`);
    }
  }
});

test('every console project kind has a section on the page', () => {
  const known = new Set(CONSOLE_SECTIONS.flatMap(([, kinds]) => kinds));
  for (const entry of CONSOLES) for (const project of entry.homebrew)
    assert(known.has(project.kind), `${entry.id}: ${project.name} uses kind "${project.kind}" with no page section`);
});

test('console projects are console-specific and cite a source the page lists', () => {
  const host = /** @param {string} url */ url => { try { return new URL(url).host; } catch { return `bad url ${url}`; } };
  const seen = new Map();
  for (const entry of CONSOLES) {
    const declared = new Set((entry.sources ?? []).map(source => host(source.url)));
    for (const project of entry.homebrew) {
      const key = project.name.toLowerCase();
      assert(!seen.has(key), `${entry.id}: ${project.name} is also listed for ${seen.get(key)}; check its source before reusing a project on another console`);
      seen.set(key, entry.id);
      assert(declared.has(host(project.source)), `${entry.id}: ${project.name} cites ${host(project.source)}, which is not in this console's sources list`);
    }
  }
});

test('highlight links target a section this console actually shows', () => {
  const sections = new Map(CONSOLE_SECTIONS.map(([name, kinds]) => [name, kinds]));
  const always = ['community', 'source'];
  // Research is a fold inside Emulation, so it has no section anchor of its own.
  const anchors = [...sections.keys()].filter(name => name !== 'research');
  for (const entry of CONSOLES) for (const highlight of entry.highlights ?? []) {
    assert(highlight.source && highlight.checkedDate, `${entry.id}: highlight ${highlight.name} needs a source and a checked date`);
    const name = /^console-(.+)-section$/.exec(highlight.target)?.[1];
    assert(name, `${entry.id}: highlight ${highlight.name} targets "${highlight.target}", not a console section id`);
    if (always.includes(name)) continue;
    assert(anchors.includes(name), `${entry.id}: highlight ${highlight.name} targets "${highlight.target}"; use one of ${[...anchors, ...always].map(section => `console-${section}-section`).join(', ')}`);
    assert(entry.homebrew.some(project => sections.get(name).includes(project.kind)), `${entry.id}: highlight ${highlight.name} targets ${highlight.target}, which this console hides (it has no ${sections.get(name).join('/')} project)`);
  }
});

test('console copy stays generic to its console and keeps the PS5 wording', () => {
  const defaults = consoleCopy({ manufacturer: 'Maker' });
  for (const [key, text] of Object.entries(defaults)) assert(!/PS5|PlayStation|Sony/.test(text), `default copy ${key} names PlayStation or Sony`);
  for (const entry of CONSOLES) {
    const copy = consoleCopy(entry);
    for (const [key, text] of Object.entries(copy)) {
      assert(text.trim(), `${entry.id}: copy ${key} is empty`);
      if (entry.id !== 'ps5') assert(!/PS5|PlayStation/.test(text), `${entry.id}: copy ${key} mentions PlayStation`);
      if (entry.manufacturer !== 'Sony') assert(!/Sony/.test(text), `${entry.id}: copy ${key} mentions Sony`);
    }
  }
  const copy = consoleCopy(CONSOLES.find(entry => entry.id === 'ps5'));
  assert.equal(copy['pc.title'], 'Play PS5 games on other devices');
  assert.equal(copy['pc.nav'], 'PS5 games elsewhere');
  assert.equal(copy['linux.title'], 'Run Linux on your PS5');
});

test('console template has a default for every copy hook and no console-specific wording', () => {
  const template = readFileSync(new URL('../site/console.html', import.meta.url), 'utf8');
  const hooks = [...template.matchAll(/data-copy="([^"]+)"/g)].map(match => match[1]);
  const defaults = new Set(Object.keys(consoleCopy({ manufacturer: 'Maker' })));
  assert(hooks.length >= 20, 'console.html lost its copy hooks');
  for (const hook of hooks) assert(defaults.has(hook), `data-copy="${hook}" has no default copy`);
  assert(!/PS5|PlayStation|Sony/.test(template), 'console.html contains PS5/PlayStation/Sony wording');
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
