// REQ-3.11, D-49: slicekitRun on the GitHub host, driven through an injected exec as ciStatus and the
// label calls are: the `gh run list` it asks, the `gh run view` of each run it judges, newest first
// until one is decided, and its refusal of a run with no databaseId (issues #52, #53).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubHost } from '../src/adapters/githost/github.js';
import { GitHostError } from '../src/adapters/githost/errors.js';

const SHA = 'c'.repeat(40);
const LIST = [
  'run',
  'list',
  '--commit',
  SHA,
  '--workflow',
  'slicekit.yml',
  '--event',
  'pull_request',
  '--limit',
  '20',
  '--json',
  'databaseId,status,conclusion,createdAt,startedAt,workflowName,workflowDatabaseId,event,url',
];
const run = (over) => ({
  status: 'completed',
  conclusion: 'success',
  createdAt: '2026-10-30T10:00:00Z',
  startedAt: '2026-10-30T10:00:00Z',
  workflowName: 'slicekit',
  workflowDatabaseId: 77,
  event: 'pull_request',
  url: `https://example.test/runs/${over.databaseId}`,
  ...over,
});
const jobs = (conclusion) => ({ jobs: [{ name: 'gate', status: 'completed', conclusion: 'success' }, { name: 'cmd-test (ubuntu-latest, 1/1)', status: 'completed', conclusion }] });

// A host whose gh answers `run list` with `runs` and `run view <id>` with `views[id]`; every call is recorded.
function hostWith(runs, views = {}) {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify(runs);
    if (args[0] === 'run' && args[1] === 'view') return JSON.stringify(views[args[2]] ?? { jobs: [] });
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { host: githubHost({ X: '1' }, '/the/project', exec), calls };
}

test("slicekitRun asks gh for the slicekit workflow's pull_request runs and views the chosen one", () => {
  // The newest run is in progress (the current one): it is passed over without a view.
  const { host, calls } = hostWith(
    [run({ databaseId: 7, status: 'in_progress', conclusion: '', createdAt: '2026-10-30T11:00:00Z', startedAt: '2026-10-30T11:00:00Z' }), run({ databaseId: 5 })],
    { 5: jobs('success') },
  );
  const found = host.slicekitRun(SHA);
  assert.equal(found.run.databaseId, 5);
  assert.deepEqual(found.jobs, [
    { name: 'gate', status: 'completed', conclusion: 'success' },
    { name: 'cmd-test (ubuntu-latest, 1/1)', status: 'completed', conclusion: 'success' },
  ]);
  assert.deepEqual(
    calls.map((c) => c.args),
    [LIST, ['run', 'view', '5', '--json', 'jobs']],
  );
  assert.ok(calls.every((c) => c.cmd === 'gh' && c.cwd === '/the/project'));

  // A completed run whose command jobs were skipped is viewed, then passed over for the older one.
  const skipped = hostWith(
    [run({ databaseId: 9, startedAt: '2026-10-30T12:00:00Z' }), run({ databaseId: 5 })],
    { 9: jobs('skipped'), 5: jobs('failure') },
  );
  assert.equal(skipped.host.slicekitRun(SHA).run.databaseId, 5);
  assert.deepEqual(
    skipped.calls.map((c) => c.args),
    [LIST, ['run', 'view', '9', '--json', 'jobs'], ['run', 'view', '5', '--json', 'jobs']],
  );

  // No decided run: null.
  assert.equal(hostWith([run({ databaseId: 9 })], { 9: jobs('skipped') }).host.slicekitRun(SHA), null);
  assert.equal(hostWith([]).host.slicekitRun(SHA), null);
});

test('a run with no databaseId is refused', () => {
  const { host } = hostWith([run({ databaseId: undefined })]);
  assert.throws(
    () => host.slicekitRun(SHA),
    (e) => e instanceof GitHostError && e.message === 'gh run list printed a run with no databaseId',
  );
});
