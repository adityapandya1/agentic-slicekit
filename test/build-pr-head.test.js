// P2/S-29 Done when 3: `build pr` at draft-pr records the new head when the worktree's head has
// moved since the recorded one, in a bookkeeping commit, so `build verdict` accepts the next verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { git } from '../src/git.js';
import { cli, commitAll, green, stateIn, write } from './helpers/build-flow.js';

const SLICE_BRANCH = 'refs/heads/slice/P1-S-01-thing-1';

const verdict = (head) => [
  'Verdict: APPROVE',
  `Head: ${head}`,
  '',
  '| ID | File:line | What is wrong | Why it matters | How verified |',
  '|---|---|---|---|---|',
  '',
  '## Checklists run',
  '',
  '- correctness',
  '',
  '## Not checked',
  '',
  '- performance',
  '',
].join('\n');

test('build pr at draft-pr records a head moved by a merge of the default branch', async () => {
  const p = await green();
  try {
    const opened = await p.pr();
    assert.equal(opened.code, 0, opened.stderr);
    const recorded = stateIn(p.wt).pr.headSha;
    assert.equal(stateIn(p.wt).state, 'draft-pr');

    // The default branch moves on origin, and the slice merges it.
    write(p.root, 'src/other.js', 'export const y = 1;\n');
    commitAll(p.root, 'other work on main');
    git(p.root, ['push', '-q', 'origin', 'main']);
    git(p.wt, ['fetch', '-q', 'origin']);
    git(p.wt, ['merge', '-q', '--no-ff', '-m', 'Merge main into the slice\n\nSlice: P1/S-01', 'origin/main']);
    const merged = git(p.wt, ['rev-parse', 'HEAD']);
    assert.notEqual(merged, recorded);

    const again = await p.pr();
    assert.equal(again.code, 0, again.stderr);
    const st = stateIn(p.wt);
    assert.equal(st.state, 'draft-pr');
    assert.equal(st.pr.headSha, merged);
    // Recorded in a bookkeeping commit on top of the merge, and pushed.
    assert.ok(git(p.wt, ['log', '-1', '--format=%s']).startsWith('chore(slicekit): P1/S-01 '));
    assert.equal(git(p.wt, ['rev-parse', 'HEAD^']), merged);
    const touched = git(p.wt, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n');
    assert.ok(touched.every((f) => f === '.slicekit/state/P1-S-01.json' || f === 'BUILD.md'), touched.join(', '));
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
    assert.equal(git(p.remote, ['rev-parse', SLICE_BRANCH]), git(p.wt, ['rev-parse', 'HEAD']));

    // The next verdict is taken on that head.
    const rel = '.slicekit/reviews/P1-S-01-r1.md';
    write(p.root, rel, verdict(git(p.wt, ['rev-parse', 'HEAD'])));
    const v = await cli(p.root, ['build', 'verdict', 'P1/S-01', rel], p.env);
    assert.equal(v.code, 0, v.stderr);
    assert.equal(stateIn(p.wt).state, 'in-review');
  } finally {
    p.cleanup();
  }
});
