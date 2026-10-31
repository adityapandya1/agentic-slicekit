// REQ-2.8, REQ-2.10, REQ-3.11: review start, build sync and the behind-origin refusals; build pr's
// live body; the ready label withheld without an independent verdict, and hand edits of the verdicts
// caught. Part 2 of the old review.test.js (issue #55).
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

test('build start resumes the build worktree, not the review worktree', async () => {
  const p = await greenAfterTwoRounds();
  try {
    assert.equal((await reviewStart(p)).code, 0);
    const v = await independent(p, independentFile(p, 3, verdictText('BLOCK', [['B-2', 'y is wrong']])), reviewDir(p));
    assert.equal(v.code, 0, v.stderr);
    const synced = await cli(p.root, ['build', 'sync', 'P1/S-01', '--worktree', p.wt], p.env);
    assert.equal(synced.code, 0, synced.stderr);
    const r = await cli(p.root, ['build', 'start', 'P1/S-01']);
    assert.equal(r.code, 0, r.stderr);
    // After an independent round the next review is a new session's, not an `i` path to re-run.
    assert.equal(r.stdout, `resumed ${fwd(p.wt)} at in-review\nnext review: /slicekit review 1 in a new session\n`);
  } finally {
    p.cleanup();
  }
});

test('a worktree behind origin is refused until synced', async () => {
  const p = await greenAfterTwoRounds();
  try {
    assert.equal((await reviewStart(p)).code, 0);
    const dir = reviewDir(p);
    const v = await independent(p, independentFile(p, 3, verdictText('BLOCK', [['B-2', 'y is wrong']])), dir);
    assert.equal(v.code, 0, v.stderr);
    const at = ['--worktree', p.wt];
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const n = Number(git(p.remote, ['rev-list', '--count', `${head}..refs/heads/${SLICE_BRANCH}`]));
    assert.ok(n > 0);
    const behind = `slicekit: ${SLICE_BRANCH} is ${commits(n)} behind origin; run slicekit build sync P1/S-01\n`;
    const calls = prCalls(p.host).length;
    const tip = originTip(p);
    const refusedHere = (r) => {
      assert.equal(r.code, 1, r.stderr);
      assert.equal(r.stderr, behind);
      assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
      assert.equal(originTip(p), tip);
      assert.equal(prCalls(p.host).length, calls);
    };
    // build pr names the behind branch before the head it has already seen (S-15's refusal).
    refusedHere(await cli(p.root, ['build', 'pr', 'P1/S-01', '--notes', p.notes, ...at], p.env));
    write(p.root, `${REVIEWS}/P1-S-01-r4.md`, verdictText('APPROVE'));
    refusedHere(await cli(p.root, ['build', 'verdict', 'P1/S-01', `${REVIEWS}/P1-S-01-r4.md`, ...at], p.env));
    refusedHere(await cli(p.root, ['build', 'finish', 'P1/S-01', ...at], p.env));

    const synced = await cli(p.root, ['build', 'sync', 'P1/S-01', ...at], p.env);
    assert.equal(synced.code, 0, synced.stderr);
    assert.equal(synced.stdout, `${tip}\n`);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), tip);
    assert.equal(stateIn(p.wt).verdicts.at(-1).independent, true);

    write(p.wt, 'src/t1.js', 'export const x = () => 2; // fix 2\n');
    const done = await commitWorkCli(p, '--message', 'fix: B-2', '--require-green', ...at);
    assert.equal(done.code, 0, done.stderr);
    // From the main checkout with no --worktree: the build worktree, never the review one (ruling 1).
    const pr = await cli(p.root, ['build', 'pr', 'P1/S-01', '--notes', p.notes], p.env);
    assert.equal(pr.code, 0, pr.stderr);
    assert.equal(stateIn(p.wt).state, 'draft-pr');
    assert.equal(originTip(p), git(p.wt, ['rev-parse', 'HEAD']));
  } finally {
    p.cleanup();
  }
});

test('build sync refuses a branch that has diverged from origin', async () => {
  const p = await greenAfterTwoRounds();
  try {
    assert.equal((await reviewStart(p)).code, 0);
    const v = await independent(p, independentFile(p, 3, verdictText('BLOCK', [['B-2', 'y is wrong']])), reviewDir(p));
    assert.equal(v.code, 0, v.stderr);
    localCommit(p.wt, 'export const x = () => 2; // local\n', 'local');
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const r = await cli(p.root, ['build', 'sync', 'P1/S-01', '--worktree', p.wt], p.env);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `slicekit: ${SLICE_BRANCH} has diverged from origin; resolve it by hand\n`);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
    // Up to date: sync prints the head and changes nothing.
    const review = await cli(p.root, ['build', 'sync', 'P1/S-01', '--worktree', reviewDir(p)], p.env);
    assert.equal(review.code, 0, review.stderr);
    assert.equal(review.stdout, `${git(reviewDir(p), ['rev-parse', 'HEAD'])}\n`);
  } finally {
    p.cleanup();
  }
});

test('review start takes only the pull request whose head origin holds', async () => {
  const p = await greenAfterTwoRounds();
  try {
    // I-1: a fork's pull request with the slice branch's name: its head is not origin's.
    copyPr(p, 7, { title: '[P1/S-01] Fork copy', headRefOid: 'deadbeef'.repeat(5) });
    const fork = await cli(p.root, ['review', 'start', '7'], p.env);
    assert.equal(fork.code, 1);
    assert.equal(fork.stderr, `slicekit: pull request #7's head deadbee is not origin/${SLICE_BRANCH}; is it from a fork? If the branch was just pushed, run the same command again in a minute\n`);
    assert.equal(fs.existsSync(reviewDir(p)), false);

    // The same head, but the slice's state records another pull request.
    copyPr(p, 8, {});
    const other = await cli(p.root, ['review', 'start', '8'], p.env);
    assert.equal(other.code, 1);
    assert.equal(other.stderr, 'slicekit: pull request #8 is not the one recorded for P1/S-01 (#1)\n');
    assert.equal(fs.existsSync(reviewDir(p)), false);
    assert.equal(git(p.root, ['branch', '--list', REVIEW_BRANCH]), '');

    // M-1: a branch origin does not have.
    copyPr(p, 9, { headRefName: 'slice/P1-S-01-nothere' });
    const gone = await cli(p.root, ['review', 'start', '9'], p.env);
    assert.equal(gone.code, 1);
    assert.equal(gone.stderr, "slicekit: pull request #9's branch slice/P1-S-01-nothere is not on origin; a fork's pull request cannot be reviewed here\n");

    // M-2: a name git does not take as a branch is refused before any fetch.
    for (const bad of ['slice/P1-S-01-a*b', 'slice/P1-S-01-a:b', 'slice/P1-S-01-@{u}']) {
      copyPr(p, 10, { headRefName: bad });
      const r = await cli(p.root, ['review', 'start', '10'], p.env);
      assert.equal(r.code, 2, bad);
      assert.equal(r.stderr, `slicekit: pull request #10's branch ${bad} is not a valid branch name\n`, bad);
    }
    assert.equal(fs.existsSync(reviewDir(p)), false);

    // M-3: a review worktree whose folder was deleted by hand is pruned, and the start goes on.
    assert.equal((await reviewStart(p)).code, 0);
    fs.rmSync(reviewDir(p), { recursive: true, force: true });
    const again = await reviewStart(p);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(git(reviewDir(p), ['rev-parse', 'HEAD']), originTip(p));
  } finally {
    p.cleanup();
  }
});

test('a new verdict is refused when origin cannot be reached', async () => {
  const p = await greenAfterTwoRounds();
  const other = cloneOf(p.remote);
  try {
    assert.equal((await reviewStart(p)).code, 0);
    const dir = reviewDir(p);
    // Another clone moves the slice branch on; this worktree has not fetched it.
    git(other.root, ['switch', '-q', SLICE_BRANCH]);
    git(other.root, ['commit', '-q', '--allow-empty', '-m', 'elsewhere\n\nSlice: P1/S-01']);
    git(other.root, ['push', '-q', 'origin', SLICE_BRANCH]);
    const url = git(p.root, ['remote', 'get-url', 'origin']);
    git(p.root, ['remote', 'set-url', 'origin', path.join(p.root, 'no-such-remote')]);
    const head = git(dir, ['rev-parse', 'HEAD']);
    const before = stateIn(dir);
    const calls = prCalls(p.host).length;
    const file = independentFile(p, 3, verdictText('BLOCK', [['B-2', 'y is wrong']]));
    const off = await independent(p, file, dir);
    assert.equal(off.code, 1);
    assert.equal(off.stderr, `slicekit: could not reach origin to check ${REVIEW_BRANCH}; a new verdict needs a fresh fetch\n`);
    assert.equal(git(dir, ['rev-parse', 'HEAD']), head);
    assert.deepEqual(stateIn(dir), before);
    assert.equal(prCalls(p.host).length, calls);
    assert.equal(prIn(p).isDraft, false);

    // Online again: behind, synced, then recorded.
    git(p.root, ['remote', 'set-url', 'origin', url]);
    const behind = await independent(p, file, dir);
    assert.equal(behind.code, 1);
    assert.equal(behind.stderr, `slicekit: ${REVIEW_BRANCH} is 1 commit behind origin; run slicekit build sync P1/S-01\n`);
    assert.equal((await cli(p.root, ['build', 'sync', 'P1/S-01', '--worktree', dir], p.env)).code, 0);
    const on = await independent(p, file, dir);
    assert.equal(on.code, 0, on.stderr);
    assert.equal(stateIn(dir).verdicts.length, 3);
    assert.equal(originTip(p), git(dir, ['rev-parse', 'HEAD']));
  } finally {
    other.cleanup();
    p.cleanup();
  }
});

test('build pr without notes needs every section in the live body', async () => {
  const p = await greenAfterTwoRounds();
  try {
    assert.equal((await reviewStart(p)).code, 0);
    const dir = reviewDir(p);
    const v = await independent(p, independentFile(p, 3, verdictText('BLOCK', [['B-2', 'y is wrong']])), dir);
    assert.equal(v.code, 0, v.stderr);
    const file = path.join(p.host, 'pr-1.json');
    const raw = prIn(p);
    fs.writeFileSync(file, JSON.stringify({ ...raw, body: raw.body.split('\n').filter((l) => !l.startsWith('**Try it:**')).join('\n') }));
    // A fix that fails its test: were the commands run first, the refusal would be the test's.
    write(dir, 'src/t1.js', 'export const x = () => 3;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'fix: B-2\n\nSlice: P1/S-01']);
    const calls = prCalls(p.host).length;
    const r = await cli(p.root, ['build', 'pr', 'P1/S-01', '--worktree', dir], p.env);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'slicekit: the pull request body has no "Try it"; pass --notes <file> to supply it\n');
    assert.equal(prCalls(p.host).length, calls);
  } finally {
    p.cleanup();
  }
});

test('the ready label is withheld without an independent verdict', async () => {
  const p = await greenAfterTwoRounds();
  try {
    // greenAfterTwoRounds ran finish: ci-green, not ready, and the pull request is ready for the reviewer.
    const st = stateIn(p.wt);
    assert.equal(st.state, 'ci-green');
    assert.ok(!st.history.some((h) => h.to === 'ready'));
    const again = await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, `ci-green\n${RUN_URL}\n${WAITING}`);
    assert.equal(stateIn(p.wt).state, 'ci-green');

    const label = await readyLabel(p);
    assert.equal(label.code, 0, label.stderr);
    assert.ok(label.stdout.includes('independent review missing'), label.stdout);
    assert.deepEqual(labelCalls(p), [{ number: 1, name: 'ready', present: false }]);

    await independentRound(p, 3, verdictText('APPROVE'));
    assert.equal(stateIn(p.wt).state, 'in-review');
    const done = await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);
    assert.equal(done.code, 0, done.stderr);
    assert.equal(done.stdout, `ci-green\n${RUN_URL}\nready\n`);
    const after = stateIn(p.wt);
    assert.equal(after.state, 'ready');
    assert.deepEqual(after.history.slice(-2).map((h) => h.to), ['ci-green', 'ready']);
    assert.equal(prIn(p).isDraft, false);
    assert.equal(git(p.remote, ['rev-parse', `refs/heads/${SLICE_BRANCH}`]), git(p.wt, ['rev-parse', 'HEAD']));

    // The label job reaches the same answer from the same state.
    liveHeadIsOrigin(p);
    const added = await readyLabel(p);
    assert.equal(added.code, 0, added.stderr);
    assert.ok(added.stdout.includes('P1/S-01 ready'), added.stdout);
    assert.deepEqual(labelCalls(p).at(-1), { number: 1, name: 'ready', present: true });
  } finally {
    p.cleanup();
  }
});

// Task 1's review, M-4: a clean independent verdict at ready sends the pull request back to draft;
// finish brings it to ready again only once CI is green and the ready decision passes.
test('a clean independent verdict at ready ends at ready with the pull request ready', async () => {
  const p = await greenAfterTwoRounds();
  try {
    await independentRound(p, 3, verdictText('APPROVE'));
    assert.equal((await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env)).code, 0);
    assert.equal(stateIn(p.wt).state, 'ready');

    await independentRound(p, 4, verdictText('APPROVE'));
    const back = stateIn(p.wt);
    assert.equal(back.state, 'in-review');
    assert.equal(back.history.at(-1).from, 'ready');
    // A clean verdict keeps the pull request ready (whole-branch M-2): no draft, no second markReady.
    assert.equal(prIn(p).isDraft, false);
    const readies = prCalls(p.host).filter((c) => c.op === 'markReady').length;

    // CI still running: nothing is recorded.
    write(p.host, `ci-${originTip(p)}.json`, JSON.stringify([{ status: 'in_progress', conclusion: null, url: RUN_URL, createdAt: '2026-10-26T00:00:00Z' }]));
    const pending = await cli(p.root, ['build', 'finish', 'P1/S-01', '--wait', '0'], p.env);
    assert.equal(pending.code, 1);
    assert.equal(prIn(p).isDraft, false);
    assert.equal(stateIn(p.wt).state, 'in-review');

    setCi(p, originTip(p));
    const done = await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);
    assert.equal(done.code, 0, done.stderr);
    assert.equal(done.stdout, `ci-green\n${RUN_URL}\nready\n`);
    assert.equal(stateIn(p.wt).state, 'ready');
    assert.equal(prIn(p).isDraft, false);
    assert.equal(prCalls(p.host).filter((c) => c.op === 'markReady').length, readies);

    // A re-run at ready pushes and marks nothing new.
    const again = await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, `ci-green\n${RUN_URL}\nready\n`);
    assert.equal(prCalls(p.host).filter((c) => c.op === 'markReady').length, readies);
  } finally {
    p.cleanup();
  }
});

// I-1: an in-loop APPROVE flipped to independent in the state file.
test('an in-loop verdict marked independent by hand reaches neither ready nor the label', async () => {
  const p = await greenAfterTwoRounds();
  try {
    editState(p, (st) => ({ ...st, verdicts: st.verdicts.map((v) => (v.round === 2 ? { ...v, independent: true } : v)) }));
    const r = await finishOf(p);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `ci-green\n${RUN_URL}\nready: not yet: state does not match ${REVIEWS}/P1-S-01-r2.md: the state records it as independent\n`);
    assert.equal(stateIn(p.wt).state, 'ci-green');
    const label = await readyLabel(p);
    assert.ok(label.stdout.includes(`not ready: state does not match ${REVIEWS}/P1-S-01-r2.md`), label.stdout);
    assert.deepEqual(labelCalls(p), [{ number: 1, name: 'ready', present: false }]);
  } finally {
    p.cleanup();
  }
});

// I-1: an independent BLOCK cleared by hand, hidden behind an appended clean in-loop verdict.
test('an independent blocker cleared by hand behind a later clean verdict is caught', async () => {
  const p = await greenAfterTwoRounds();
  try {
    await independentRound(p, 3, verdictText('BLOCK', [['B-2', 'y is wrong']]));
    write(p.wt, `${REVIEWS}/P1-S-01-r4.md`, verdictText('APPROVE'));
    editState(p, (st) => ({
      ...st,
      verdicts: [
        ...st.verdicts.map((v) => (v.round === 3 ? { ...v, blockers: 0 } : v)),
        { round: 4, path: `${REVIEWS}/P1-S-01-r4.md`, blockers: 0, independent: false, headSha: st.pr.headSha },
      ],
    }));
    commitIn(p.wt, 'chore(slicekit): P1/S-01 hand edit\n\nSlice: P1/S-01');
    const r = await finishOf(p);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `ci-green\n${RUN_URL}\nready: not yet: state does not match ${REVIEWS}/P1-S-01i-r3.md: the state records 0 blockers, the file holds 1\n`);
    assert.equal(stateIn(p.wt).state, 'ci-green');
    assert.equal(prIn(p).isDraft, true);
    const label = await readyLabel(p);
    assert.ok(label.stdout.includes(`not ready: state does not match ${REVIEWS}/P1-S-01i-r3.md`), label.stdout);
    assert.deepEqual(labelCalls(p).at(-1), { number: 1, name: 'ready', present: false });
  } finally {
    p.cleanup();
  }
});

// I-1: the latest verdict, an independent BLOCK, cleared by hand.
test('the latest blocker cleared by hand is refused by finish and the label', async () => {
  const p = await greenAfterTwoRounds();
  try {
    await independentRound(p, 3, verdictText('BLOCK', [['B-2', 'y is wrong']]));
    editState(p, (st) => ({ ...st, verdicts: st.verdicts.map((v) => (v.round === 3 ? { ...v, blockers: 0 } : v)) }));
    const r = await finishOf(p);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`the state says round 3 has 0 blockers but ${REVIEWS}/P1-S-01i-r3.md holds 1`), r.stderr);
    assert.equal(stateIn(p.wt).state, 'in-review');
    const label = await readyLabel(p);
    assert.ok(label.stdout.includes(`not ready: state does not match ${REVIEWS}/P1-S-01i-r3.md`), label.stdout);
    assert.deepEqual(labelCalls(p).at(-1), { number: 1, name: 'ready', present: false });
  } finally {
    p.cleanup();
  }
});
