// REQ-2.6: a commit is judged by the newest run of each workflow and event (issues #33, #41, #42).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceRuns } from '../src/adapters/githost/gh-json.js';

// REQ-2.6 step 9: a commit is judged by the newest run of each workflow and event (issue #33).
const run = (over) => ({ status: 'completed', conclusion: 'success', url: 'https://example.test/runs/1', workflowName: 'slicekit', event: 'pull_request', createdAt: '2026-10-30T10:00:00Z', ...over });

test('a run cancelled by a newer run of the same workflow does not fail the commit', () => {
  const runs = [
    run({ conclusion: 'success', url: 'https://example.test/runs/2', createdAt: '2026-10-30T10:00:05Z' }),
    run({ conclusion: 'cancelled', url: 'https://example.test/runs/1', createdAt: '2026-10-30T10:00:01Z' }),
  ];
  assert.deepEqual(reduceRuns(runs), { status: 'success', url: 'https://example.test/runs/2' });
  // Order in the list does not matter: the newest by createdAt counts.
  assert.deepEqual(reduceRuns([...runs].reverse()), { status: 'success', url: 'https://example.test/runs/2' });
  // A cancelled run of another workflow or event is judged in its own group.
  const other = run({ conclusion: 'cancelled', workflowName: 'other', url: 'https://example.test/runs/3' });
  assert.equal(reduceRuns([...runs, other]).status, 'failure');
});

test('the newest run failing or cancelled still fails the commit', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    const runs = [
      run({ conclusion: 'success', url: 'https://example.test/runs/1', createdAt: '2026-10-30T10:00:01Z' }),
      run({ conclusion, url: 'https://example.test/runs/2', createdAt: '2026-10-30T10:00:05Z' }),
    ];
    assert.deepEqual(reduceRuns(runs), { status: 'failure', url: 'https://example.test/runs/2' }, conclusion);
  }
  const going = [run({ createdAt: '2026-10-30T10:00:01Z' }), run({ status: 'in_progress', conclusion: '', url: 'https://example.test/runs/9', createdAt: '2026-10-30T10:00:05Z' })];
  assert.deepEqual(reduceRuns(going), { status: 'pending', url: 'https://example.test/runs/9' });
});

test('runs without a workflow name are judged together as before', () => {
  const bare = (over) => ({ status: 'completed', conclusion: 'success', url: 'https://example.test/runs/1', ...over });
  assert.equal(reduceRuns([bare({}), bare({ conclusion: 'cancelled', url: 'https://example.test/runs/2' })]).status, 'failure');
  assert.deepEqual(reduceRuns([bare({})]), { status: 'success', url: 'https://example.test/runs/1' });
  assert.deepEqual(reduceRuns([]), { status: 'unknown', url: null });
});

// Issue #41: two workflow files that declare one name are told apart by their workflow id.
test('two workflow files with one name are judged apart by their workflow id', () => {
  const runs = [
    run({ workflowName: 'CI', workflowDatabaseId: 11, conclusion: 'failure', url: 'https://example.test/runs/1', createdAt: '2026-10-30T10:00:01Z' }),
    run({ workflowName: 'CI', workflowDatabaseId: 22, conclusion: 'success', url: 'https://example.test/runs/2', createdAt: '2026-10-30T10:00:05Z' }),
  ];
  assert.deepEqual(reduceRuns(runs), { status: 'failure', url: 'https://example.test/runs/1' });
  // One workflow id: the newer run replaced the older one.
  assert.deepEqual(reduceRuns(runs.map((r) => ({ ...r, workflowDatabaseId: 11 }))), { status: 'success', url: 'https://example.test/runs/2' });
  // A run without a workflow id: grouped by name and event, as before.
  assert.equal(reduceRuns([runs[0], { ...runs[1], workflowDatabaseId: undefined }]).status, 'success');
});

// Issue #42: a re-run moves startedAt and leaves createdAt alone.
test('an older run re-run to success after a newer run failed is the answer', () => {
  const rerun = run({ conclusion: 'success', url: 'https://example.test/runs/1', createdAt: '2026-10-30T10:00:00Z', startedAt: '2026-10-30T11:00:00Z' });
  const newer = run({ conclusion: 'failure', url: 'https://example.test/runs/2', createdAt: '2026-10-30T10:05:00Z', startedAt: '2026-10-30T10:05:00Z' });
  assert.deepEqual(reduceRuns([newer, rerun]), { status: 'success', url: 'https://example.test/runs/1' });
  assert.deepEqual(reduceRuns([rerun, newer]), { status: 'success', url: 'https://example.test/runs/1' });
  // A run with no startedAt is placed by its createdAt.
  const bare = { ...newer, startedAt: undefined, createdAt: '2026-10-30T12:00:00Z' };
  assert.deepEqual(reduceRuns([rerun, bare]), { status: 'failure', url: 'https://example.test/runs/2' });
});
