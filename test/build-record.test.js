// REQ-1.6, D-100 (P8/S-58): every state move of the build loop on a slice branch makes a bookkeeping
// commit that holds the slice's state file and no BUILD.md, so the branch never changes BUILD.md
// against the default branch and BUILD.md leaves the merge path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { git } from '../src/git.js';
import { cli, stateIn } from './helpers/build-flow.js';
import { greenAfterTwoRounds, independentRound, verdictText } from './helpers/review-fixture.js';

const STATE = '.slicekit/state/P1-S-01.json';

// The kit's bookkeeping commits the slice branch adds to main: [{ sha, subject, files }].
function bookkeepingCommits(wt) {
  const out = git(wt, ['log', '--first-parent', '--no-merges', '--format=%H%x1f%s', 'main..HEAD']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, subject] = l.split('\x1f');
      const files = git(wt, ['show', '--no-renames', '--name-only', '--format=', sha]).split('\n').filter(Boolean);
      return { sha, subject, files };
    })
    .filter((c) => c.subject.startsWith('chore(slicekit): P1/S-01 '));
}

test('a state move on a slice branch commits the state file and not BUILD.md', async () => {
  const p = await greenAfterTwoRounds();
  try {
    await independentRound(p, 3, verdictText('APPROVE'));
    const done = await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);
    assert.equal(done.code, 0, done.stderr);
    assert.equal(stateIn(p.wt).state, 'ready');

    const moves = bookkeepingCommits(p.wt);
    // red, commit, pr (twice), verdict (three rounds), finish: at least one commit for each.
    assert.ok(moves.length >= 6, JSON.stringify(moves.map((c) => c.subject)));
    for (const c of moves) {
      assert.ok(!c.files.includes('BUILD.md'), `${c.subject} commits BUILD.md: ${c.files.join(', ')}`);
    }
    const stateMoves = moves.filter((c) => c.files.includes(STATE));
    assert.ok(stateMoves.length >= 6, JSON.stringify(moves.map((c) => [c.subject, c.files])));
    assert.equal(git(p.wt, ['diff', '--name-only', 'main...HEAD', '--', 'BUILD.md']), '');
  } finally {
    p.cleanup();
  }
});
