// REQ-2.8, REQ-2.6, REQ-2.11: independent verdicts, recorded only from the review worktree (D-39)
// and outside the two in-loop rounds; the review branch name kept from build start; review start
// checking out the pull request head; build pr's notes. Part 1 of the old review.test.js (issue #55).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { getHost } from '../../src/adapters/githost/index.js';
import { GitHostError } from '../../src/adapters/githost/errors.js';
import { recordVerdict, reviewerBlocked } from '../../src/build/verdict.js';
import { getSection } from '../../src/prbody.js';
import { git } from '../../src/git.js';
import { cli, commitAll, commitIn, commitWorkCli, green as greenFlow, prCalls, project, reviewWorktree, stateIn, vpath, write } from '../helpers/build-flow.js';
import { briefProblems } from '../helpers/brief-lint.js';
import { TEMPLATES, renderProcedure } from '../../src/instructions.js';
import { REVIEWS, RUN_URL, reviewed, green, verdictText, prIn, setLiveHead, setCi, greenAfterTwoRounds, independentFile, independent, SLICE_BRANCH, REVIEW_BRANCH, fwd, reviewDir, liveHeadIsOrigin, reviewStart, commits, originHeads, originTip, localCommit, copyPr, cloneOf, WAITING, labelCalls, readyLabel, independentRound, stateFile, editState, markReadies, finishOf, setReviewMode } from '../helpers/review-fixture.js';

test('the verdict of an independent review is marked independent', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const wt = reviewWorktree(p);
    const file = independentFile(p, 3, verdictText('CHANGES', [['H-1', 'a long name']]));
    const r = await independent(p, file, wt);
    assert.equal(r.code, 0, r.stderr);
    // Should-haves alone give `ci` (ruling 1); no in-loop verdict path follows (ruling 5).
    assert.equal(r.stdout, 'next: ci\nblockers: none\nshould-haves: H-1\nrounds: 2 of 2\n');
    const st = stateIn(wt);
    assert.equal(st.state, 'in-review');
    assert.equal(st.history.at(-1).from, 'ci-green');
    assert.equal(st.verdicts.at(-1).independent, true);
    assert.equal(st.verdicts.at(-1).round, 3);
    assert.equal(st.verdicts.at(-1).path, `${REVIEWS}/P1-S-01i-r3.md`);
    assert.ok(fs.existsSync(path.join(wt, ...REVIEWS.split('/'), 'P1-S-01i-r3.md')));
    // A clean verdict leaves the pull request ready (whole-branch M-2); the slice branch has the round.
    assert.equal(prIn(p).isDraft, false);
    assert.equal(prCalls(p.host).filter((c) => c.op === 'markDraft').length, 0);
    assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), git(wt, ['rev-parse', 'HEAD']));

    // A re-run of the recorded round records nothing again and marks nothing again.
    const again = await independent(p, file, wt);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, r.stdout);
    assert.equal(stateIn(wt).verdicts.length, 3);
    assert.equal(prCalls(p.host).filter((c) => c.op === 'markDraft').length, 0);
  } finally {
    p.cleanup();
  }
});

test('an independent verdict does not use an in-loop round', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const wt = reviewWorktree(p);
    const r = await independent(p, independentFile(p, 3, verdictText('BLOCK', [['B-2', 'y is wrong']])), wt);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'next: fix\nblockers: B-2\nshould-haves: none\nrounds: 2 of 2\n');
    assert.equal(stateIn(wt).state, 'in-review');
    assert.equal(prIn(p).isDraft, true);
  } finally {
    p.cleanup();
  }
});

test('an independent verdict is recorded only from the review worktree', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const file = independentFile(p, 3, verdictText('APPROVE'));
    const before = stateIn(p.wt);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const refused = (r) => {
      assert.equal(r.code, 1, r.stderr);
      assert.equal(r.stderr, 'slicekit: an independent verdict is recorded from the review worktree; run slicekit review start 1 in a new session\n');
      assert.deepEqual(stateIn(p.wt), before);
      assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
      assert.ok(fs.existsSync(path.join(p.root, ...REVIEWS.split('/'), 'P1-S-01i-r3.md')));
    };
    // From the build worktree, named or found.
    refused(await independent(p, file, p.wt));
    refused(await cli(p.root, ['build', 'verdict', 'P1/S-01', file, '--independent'], p.env));

    // The build worktree with its branch renamed to the review name (I-2): the path decides too.
    git(p.wt, ['branch', '-m', 'slice/P1-S-01-review']);
    refused(await independent(p, file, p.wt));
    // Without --worktree a worktree on the review branch is never picked, so none is found.
    const none = await cli(p.root, ['build', 'verdict', 'P1/S-01', file, '--independent'], p.env);
    assert.equal(none.code, 1);
    assert.equal(none.stderr, 'slicekit: no worktree holds P1/S-01; run slicekit build start P1/S-01\n');
    assert.deepEqual(stateIn(p.wt), before);
    git(p.wt, ['branch', '-m', 'slice/P1-S-01-thing-1']);

    // The review branch in a worktree somewhere other than review start's path.
    const elsewhere = path.join(p.root, '.worktrees', 'elsewhere');
    git(p.root, ['fetch', '-q', 'origin']);
    git(p.root, ['worktree', 'add', '-q', '--track', '-b', 'slice/P1-S-01-review', elsewhere, 'origin/slice/P1-S-01-thing-1']);
    refused(await independent(p, file, elsewhere));
    git(p.root, ['worktree', 'remove', '--force', elsewhere]);
    git(p.root, ['branch', '-q', '-D', 'slice/P1-S-01-review']);

    // With the review worktree there, a call without --worktree records there (whole-branch M-1).
    const wt = reviewWorktree(p);
    const found = await cli(p.root, ['build', 'verdict', 'P1/S-01', file, '--independent'], p.env);
    assert.equal(found.code, 0, found.stderr);
    assert.equal(stateIn(wt).verdicts.at(-1).independent, true);
    assert.deepEqual(stateIn(p.wt), before);
  } finally {
    p.cleanup();
  }
});

test('an independent verdict and its name agree', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const wt = reviewWorktree(p);
    const plain = vpath(p.root, 'P1-S-01-r3.md');
    write(p.root, `${REVIEWS}/P1-S-01-r3.md`, verdictText('APPROVE'));
    const named = await independent(p, plain, wt);
    assert.equal(named.code, 2);
    assert.equal(named.stderr, 'slicekit: an independent verdict is named P1-S-01i-r<k>.md\n');

    const file = independentFile(p, 3, verdictText('APPROVE'));
    const flagless = await cli(p.root, ['build', 'verdict', 'P1/S-01', file, '--worktree', wt], p.env);
    assert.equal(flagless.code, 2);
    assert.equal(flagless.stderr, 'slicekit: an independent verdict is named P1-S-01i-r<k>.md\n');

    // An in-loop verdict after the two rounds is refused: only an independent one sends it back (D-39).
    const inLoop = await cli(p.root, ['build', 'verdict', 'P1/S-01', plain, '--worktree', wt], p.env);
    assert.equal(inLoop.code, 1);
    assert.ok(inLoop.stderr.includes('two review rounds used; the loop stopped (D-18)'), inLoop.stderr);
    assert.equal(stateIn(wt).state, 'ci-green');
  } finally {
    p.cleanup();
  }
});

// M-1: a host that cannot mark the pull request draft leaves the round recorded locally; the same
// command run again finishes it.
test('a failed markDraft says the round is recorded and to run the command again', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const wt = reviewWorktree(p);
    const file = independentFile(p, 3, verdictText('BLOCK', [['B-2', 'y is wrong']]));
    const cfg = loadConfig(p.root);
    const real = getHost(cfg, p.env, p.root);
    const down = {
      ...real,
      markDraft: () => {
        throw new GitHostError('gh: network down');
      },
    };
    assert.throws(
      () => recordVerdict(p.root, cfg, down, 'P1/S-01', file, { independent: true, worktree: wt }),
      (e) =>
        e.name === 'BuildError' &&
        e.code === 1 &&
        e.message === 'could not mark pull request #1 draft: gh: network down; round 3 is recorded locally; run the same command again to finish',
    );
    assert.equal(stateIn(wt).state, 'in-review');
    assert.equal(prIn(p).isDraft, false);
    const again = await independent(p, file, wt);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, 'next: fix\nblockers: B-2\nshould-haves: none\nrounds: 2 of 2\n');
    assert.equal(prIn(p).isDraft, true);
    assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), git(wt, ['rev-parse', 'HEAD']));
  } finally {
    p.cleanup();
  }
});

// I-1: the review branch name is never a build branch, whether --descr or the slice file gives it.
test('build start refuses the review branch name', async () => {
  const p = project({ slices: [{ n: 1, group: 'A' }] });
  try {
    for (const descr of ['review', 'Review']) {
      const r = await cli(p.root, ['build', 'start', 'P1/S-01', '--descr', descr]);
      assert.equal(r.code, 2, descr);
      assert.equal(r.stderr, `slicekit: the branch name slice/P1-S-01-${descr} is kept for the review worktree; choose another --descr\n`);
    }
    const dir = path.join(p.root, 'docs', 'phases', 'P1-x');
    fs.renameSync(path.join(dir, 'S-01-thing-1.md'), path.join(dir, 'S-01-review.md'));
    commitAll(p.root, 'rename');
    const r = await cli(p.root, ['build', 'start', 'P1/S-01']);
    assert.equal(r.code, 2);
    assert.equal(
      r.stderr,
      'slicekit: the branch name slice/P1-S-01-review is kept for the review worktree; the slice file S-01-review.md gives that name, so choose another --descr\n',
    );
    assert.equal(git(p.root, ['branch', '--list', 'slice/*']), '');
    const ok = await cli(p.root, ['build', 'start', 'P1/S-01', '--descr', 'reviewed']);
    assert.equal(ok.code, 0, ok.stderr);
  } finally {
    p.cleanup();
  }
});

test('start checks out the pull request head in a fresh worktree', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const dir = reviewDir(p);
    const r = await reviewStart(p);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `slice P1/S-01\nworktree ${fwd(dir)}\nround 3\nverdict ${vpath(p.root, 'P1-S-01i-r3.md')}\n`);
    // The head of the pull request's branch, tracking it (M-3): a push from here goes to the slice branch.
    assert.equal(git(dir, ['rev-parse', 'HEAD']), originTip(p));
    assert.equal(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), REVIEW_BRANCH);
    assert.equal(git(dir, ['rev-parse', '--abbrev-ref', '@{u}']), `origin/${SLICE_BRANCH}`);

    // A clean review worktree is made again from the pull request head.
    const again = await reviewStart(p);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, r.stdout);
    assert.equal(git(dir, ['rev-parse', 'HEAD']), originTip(p));

    // One with an untracked file is refused, and left as it is.
    write(dir, 'notes.txt', 'mine');
    const dirty = await reviewStart(p);
    assert.equal(dirty.code, 1);
    assert.equal(dirty.stderr, `slicekit: ${fwd(dir)} has uncommitted changes\n`);
    assert.ok(fs.existsSync(path.join(dir, 'notes.txt')));
    fs.rmSync(path.join(dir, 'notes.txt'));

    // One holding a commit origin does not have is refused too: starting fresh would lose it.
    localCommit(dir, 'export const x = () => 2; // review\n', 'review only');
    const ahead = await reviewStart(p);
    assert.equal(ahead.code, 1);
    assert.equal(ahead.stderr, `slicekit: ${fwd(dir)} has 1 commit not on origin; push them with slicekit build pr P1/S-01 --worktree ${fwd(dir)}, or remove the worktree by hand\n`);
  } finally {
    p.cleanup();
  }
});

test('review start refuses a pull request that is not an open slice pull request', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const raw = prIn(p);
    write(p.host, 'pr-2.json', JSON.stringify({ ...raw, number: 2, title: 'chore: tidy' }));
    const notSlice = await reviewStart(p, '2');
    assert.equal(notSlice.code, 2);
    assert.equal(notSlice.stderr, 'slicekit: pull request #2 is not a slice pull request\n');
    write(p.host, 'pr-3.json', JSON.stringify({ ...raw, number: 3, state: 'CLOSED' }));
    const closed = await reviewStart(p, '3');
    assert.equal(closed.code, 1);
    assert.equal(closed.stderr, 'slicekit: pull request #3 is closed; review start runs on an open pull request\n');
    for (const args of [['review', 'start'], ['review', 'start', 'x'], ['review', 'start', '0'], ['review', 'go', '1']]) {
      const usage = await cli(p.root, args, p.env);
      assert.equal(usage.code, 2, args.join(' '));
    }
    assert.equal(fs.existsSync(reviewDir(p)), false);
  } finally {
    p.cleanup();
  }
});

test('a push from the review worktree lands on the slice branch', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const started = await reviewStart(p);
    assert.equal(started.code, 0, started.stderr);
    const dir = reviewDir(p);
    const v = await independent(p, independentFile(p, 3, verdictText('BLOCK', [['B-2', 'y is wrong']])), dir);
    assert.equal(v.code, 0, v.stderr);
    // The reviewing session fixes it and opens the round with no notes: the live body's sections stay.
    const before = prIn(p).body;
    write(dir, 'src/t1.js', 'export const x = () => 2; // fix 2\n');
    const done = await cli(p.root, ['build', 'commit', 'P1/S-01', '--message', 'fix: B-2', '--require-green', '--worktree', dir], p.env);
    assert.equal(done.code, 0, done.stderr);
    const pr = await cli(p.root, ['build', 'pr', 'P1/S-01', '--worktree', dir], p.env);
    assert.equal(pr.code, 0, pr.stderr);
    assert.equal(originTip(p), git(dir, ['rev-parse', 'HEAD']));
    assert.ok(!originHeads(p).includes(REVIEW_BRANCH), originHeads(p).join(' '));
    const line = (b, section) => b.split('\n').find((l) => l.startsWith(`**${section}:**`));
    const body = prIn(p).body;
    for (const section of ['Decisions', 'Runbook', 'Infra / migration', 'Try it', 'Skipped / not checked']) {
      assert.ok(line(before, section), section);
      assert.equal(line(body, section), line(before, section), section);
    }
    assert.equal(stateIn(dir).state, 'draft-pr');
  } finally {
    p.cleanup();
  }
});

test('build pr needs the notes for a slice with no pull request', async () => {
  const p = await green();
  try {
    const r = await cli(p.root, ['build', 'pr', 'P1/S-01'], p.env);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, 'slicekit: P1/S-01 has no pull request yet; build pr needs --notes to open it\n');
    assert.deepEqual(prCalls(p.host), []);
  } finally {
    p.cleanup();
  }
});
