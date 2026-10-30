// REQ-4.5, REQ-4.3: S-18 review round 1, B-1 (commit time order across time zones) and H-1 (a test
// file over 1 MiB is still judged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newestFirst, timeOf } from '../../src/graph/trace.js';
import citations, { TEST_FILE_MESSAGE } from '../../src/check/rules/citations.js';
import { check } from '../../src/check/index.js';
import { init } from '../../src/init.js';
import { makeRepo } from '../helpers/tmp-repo.js';
import { gitIn } from '../helpers/graph-fixture.js';

test('commits are ordered by instant, not by the text of their dates', () => {
  // 10:00+05:30 is 04:30 UTC, earlier than 06:00+00:00, though its text sorts later.
  const india = { id: 'commit:a', date: '2026-10-30T10:00:00+05:30' };
  const london = { id: 'commit:b', date: '2026-10-30T06:00:00+00:00' };
  assert.ok(timeOf(london.date) > timeOf(india.date));
  assert.deepEqual([india, london].sort(newestFirst).map((c) => c.id), ['commit:b', 'commit:a']);
  assert.deepEqual([london, india].sort(newestFirst).map((c) => c.id), ['commit:b', 'commit:a']);
  // A commit with no date sorts last; equal instants fall back to the id.
  const none = { id: 'commit:c' };
  const same = { id: 'commit:0', date: '2026-10-30T04:30:00Z' };
  assert.deepEqual([none, india, same].sort(newestFirst).map((c) => c.id), ['commit:0', 'commit:a', 'commit:c']);
});

test('a test file over one MiB naming no requirement is still a finding', () => {
  const repo = makeRepo({ branch: 'main' });
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    gitIn(repo.root, ['add', '-A']);
    gitIn(repo.root, ['-c', 'core.hooksPath=.nohooks', 'commit', '-q', '-m', 'base']);
    gitIn(repo.root, ['checkout', '-q', '-b', 'slice/P1-S-01-x']);
    fs.mkdirSync(path.join(repo.root, 'test'), { recursive: true });
    fs.writeFileSync(path.join(repo.root, 'test', 'big.test.js'), `${'// filler line\n'.repeat(110000)}`);
    gitIn(repo.root, ['add', '-A']);
    gitIn(repo.root, ['-c', 'core.hooksPath=.nohooks', 'commit', '-q', '-m', 'big\n\nSlice: P1/S-01']);
    assert.ok(fs.statSync(path.join(repo.root, 'test', 'big.test.js')).size > 1024 * 1024);
    const found = check(repo.root, { rules: [citations] }).findings.filter((f) => f.message === TEST_FILE_MESSAGE);
    assert.deepEqual(found.map((f) => `${f.file}:${f.line} ${f.message}`), [`test/big.test.js:1 ${TEST_FILE_MESSAGE}`]);
  } finally {
    repo.cleanup();
  }
});
