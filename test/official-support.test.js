import test from 'node:test';
import assert from 'node:assert/strict';
import { officialSupportProblems, officialSupportText } from '../src/catalog.js';

test('unknown maker support needs a sourced explanation and no invented date', () => {
  const unknown = {
    status: 'unknown',
    summary: 'The manufacturer provides no support policy for this model.',
    source: 'https://example.com/router',
  };

  assert.deepEqual(officialSupportProblems(unknown), []);
  assert.match(officialSupportText(unknown, 'Stock OS: maker'), /^Stock OS: maker: /);
  assert.match(officialSupportText(unknown, 'Stock OS: maker'), /provides no support policy/);
  assert(officialSupportProblems(undefined).length);
  assert(officialSupportProblems(null).length);
  assert(officialSupportProblems({ ...unknown, until: '2026-10' }).length);
  assert(officialSupportProblems({ ...unknown, summary: '   ' }).length);
});

test('ongoing and dropped maker support retain dated display and validation', () => {
  const ongoing = { status: 'ongoing', until: '2027-04', source: 'https://example.com/router' };
  const dropped = { status: 'dropped', until: '2024-09', source: 'https://example.com/router' };

  assert.deepEqual(officialSupportProblems(ongoing), []);
  assert.deepEqual(officialSupportProblems(dropped), []);
  assert.match(officialSupportText(ongoing, 'Stock OS: maker'), /until 2027-04/);
  assert.match(officialSupportText(dropped, 'Stock OS: maker'), /ended 2024-09/);
});
