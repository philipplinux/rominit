import test from 'node:test';
import assert from 'node:assert/strict';
import { GPUS, gpuFreshness } from '../src/gpus/index.js';
import { officialSupportProblems } from '../src/catalog.js';

test('gpu freshness: recent is active, a finished one-off is not stale, undated ships elsewhere', () => {
  assert.equal(gpuFreshness({ lastUpdate: '2026-08' }, '2026-10-28'), 'active');
  assert.equal(gpuFreshness({ lastUpdate: '2025-12' }, '2026-10-28'), 'slow');
  assert.equal(gpuFreshness({ lastUpdate: '2024-09' }, '2026-10-28'), 'quiet');
  assert.equal(gpuFreshness({ lastUpdate: '2021-03', oneOff: true }, '2026-10-28'), 'finished');
  assert.equal(gpuFreshness({}, '2026-10-28'), null);
});

test('gpu records carry sourced projects with a dated last update and no recipes', () => {
  for (const gpu of GPUS) {
    assert.match(gpu.checkedDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(officialSupportProblems(gpu.officialSupport), []);
    assert(!('roms' in gpu) && !('stages' in gpu));
    for (const project of gpu.projects) {
      assert(gpu.groups[project.group], `${project.name}: unknown group`);
      assert.match(project.source, /^https:\/\//);
      assert(project.pitch && project.suits && project.risk && project.updateNote, project.name);
      if (project.lastUpdate) assert.match(project.lastUpdate, /^\d{4}-\d{2}$/);
    }
  }
});
