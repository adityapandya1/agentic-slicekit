// REQ-2.8, REQ-3.11, REQ-1.8, REQ-2.12: the ready decision at finish and in the label, with
// review.independent read from the default branch; the review and parallel procedures' brief lint;
// the independent verdict in the state machine. Part 3 of the old review.test.js (issue #55).
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

// M-1: at ready the decision is made again; a failed one records and marks nothing.
test('finish at a ready set by hand makes the decision again', async () => {
  const p = await greenAfterTwoRounds();
  try {
    editState(p, (st) => ({ ...st, state: 'ready' }));
    fs.writeFileSync(path.join(p.host, 'pr-1.json'), `${JSON.stringify({ ...prIn(p), isDraft: true }, null, 2)}\n`);
    const before = markReadies(p);
    const r = await finishOf(p);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `ci-green\n${RUN_URL}\n${WAITING}`);
    assert.equal(markReadies(p), before);
    assert.equal(prIn(p).isDraft, true);
  } finally {
    p.cleanup();
  }
});

// M-2, M-3: optional only in the pull request's branch or a working tree switches nothing off.
test('optional set outside the default branch still requires the independent review', async () => {
  const p = await greenAfterTwoRounds();
  try {
    setReviewMode(path.join(p.wt, '.slicekit', 'config.json'), 'optional');
    setReviewMode(path.join(p.root, '.slicekit', 'config.json'), 'optional');
    const r = await finishOf(p);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `ci-green\n${RUN_URL}\n${WAITING}`);
    assert.equal(stateIn(p.wt).state, 'ci-green');
    const label = await readyLabel(p);
    assert.ok(label.stdout.includes('not ready: independent review missing'), label.stdout);
    assert.deepEqual(labelCalls(p), [{ number: 1, name: 'ready', present: false }]);
  } finally {
    p.cleanup();
  }
});

// M-2, M-3: optional committed on the default branch lets both pass without an independent review.
test('optional committed on the default branch lets finish and the label pass', async () => {
  const p = await greenAfterTwoRounds();
  try {
    setReviewMode(path.join(p.root, '.slicekit', 'config.json'), 'optional');
    commitAll(p.root, 'chore: independent review optional');
    git(p.root, ['push', '-q', '--no-verify', 'origin', 'HEAD:refs/heads/main']);
    const r = await finishOf(p);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `ci-green\n${RUN_URL}\nready\n`);
    assert.equal(stateIn(p.wt).state, 'ready');
    liveHeadIsOrigin(p);
    const label = await readyLabel(p);
    assert.ok(label.stdout.includes('P1/S-01 ready'), label.stdout);
    assert.deepEqual(labelCalls(p).at(-1), { number: 1, name: 'ready', present: true });
  } finally {
    p.cleanup();
  }
});

test('the review and parallel procedures pass the brief lint', () => {
  const read = (rel) => fs.readFileSync(path.join(TEMPLATES, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
  const review = read('commands/review.md');
  const build = read('commands/build.md');
  assert.deepEqual(briefProblems(review, { kind: 'command' }), []);
  assert.deepEqual(briefProblems(build, { kind: 'command' }), []);
  for (const s of ['review start', '--independent', 'build finish']) assert.ok(review.includes(s), s);
  for (const s of ['build parallel', 'plan defect']) assert.ok(build.includes(s), s);
  // The review session: D-18 left to the person, every build call in the review worktree, the
  // reviewer given the verdict path review start printed, should-haves declined or left.
  assert.ok(review.includes('D-18'));
  assert.ok(review.includes('`{{cli}} review start {{args}}`'));
  assert.ok(review.includes('`(none)`'));
  assert.ok(review.includes('`{{cli}} instructions reviewer <id> --worktree <wt>`'));
  assert.ok(review.includes('`{{cli}} build verdict <id> <path> --independent --worktree <wt>`'));
  assert.ok(review.includes('`{{cli}} build decline <id> <H-n> --worktree <wt>`'));
  assert.ok(review.includes('`{{cli}} instructions fixer <id> --worktree <wt>`'));
  assert.ok(review.includes('`{{cli}} build commit <id> --worktree <wt> --message "fix: <ids>" --require-green`'));
  assert.ok(review.includes('`{{cli}} build pr <id> --worktree <wt>`'));
  assert.ok(review.includes('`{{cli}} build finish <id> --worktree <wt>`'));
  assert.ok(review.includes('`{{cli}} build sync <id> --worktree <wt>`'));
  for (const s of ['next: fix', 'next: ci', 'ready: not yet', 'a human merges']) assert.ok(review.includes(s), s);
  for (const line of review.split('\n').filter((l) => l.includes('{{cli}} build '))) {
    for (const m of line.matchAll(/`\{\{cli\}\} build (?:verdict|decline|commit|pr|finish|sync) [^`]*`/g)) assert.match(m[0], /--worktree <(wt|dir)>/, m[0]);
  }
  // The build procedure: a slice branch behind origin is synced, not sent to the human; finish's
  // three outcomes; the parallel section.
  assert.ok(build.includes('`{{cli}} build sync <id> --worktree <path>`'));
  assert.ok(build.includes('`ready: waiting for an independent review; run /slicekit review <n> in a new session`'));
  assert.ok(build.includes('`ready: not yet: <reason>`'));
  assert.ok(build.includes('next review: /slicekit review <n> in a new session'));
  assert.ok(build.includes('`{{cli}} build parallel P<n>`'));
  assert.ok(build.includes('`slicekit: <id> not started: <reason>`'));
  assert.ok(build.includes('`slicekit: <id> not started: held in origin/<branch>`'));
  assert.match(review, /run the same command again\s+in a minute/);
  for (const text of [review, build]) assert.doesNotMatch(text, /pull first`:/);
  assert.match(build, /^## Building a step in parallel$/m);
  assert.doesNotMatch(build, /A refusal that says `pull first`, or that the default\s+branch/);
  // `/slicekit review` is built now: the procedure renders, the arguments filled in.
  const rendered = renderProcedure(process.cwd(), { cli: 'npx slicekit' }, 'review', ['7']);
  assert.ok(rendered.includes('`npx slicekit review start 7`'));
  assert.ok(!rendered.includes('{{'));
});

// Whole-branch I-1: the review-worktree rule lives in the in-review transition, so `slicekit state
// set --independent` from the build worktree is refused as `build verdict --independent` is.
test('state set records an independent verdict only in the review worktree', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const rel = `${REVIEWS}/P1-S-01i-r3.md`;
    const args = ['state', 'set', 'P1/S-01', 'in-review', '--verdict', rel, '--round', '3', '--blockers', '0', '--independent'];
    write(p.wt, rel, verdictText('APPROVE'));
    commitIn(p.wt, 'chore(slicekit): P1/S-01 verdict r3');
    const before = stateIn(p.wt);
    const r = await cli(p.wt, args, p.env);
    assert.equal(r.code, 1, r.stdout);
    assert.ok(r.stderr.includes('an independent verdict is recorded from the review worktree; run slicekit review start 1 in a new session'), r.stderr);
    assert.deepEqual(stateIn(p.wt), before);

    const wt = reviewWorktree(p);
    write(wt, rel, verdictText('APPROVE'));
    commitIn(wt, 'chore(slicekit): P1/S-01 verdict r3');
    const ok = await cli(wt, args, p.env);
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(stateIn(wt).verdicts.at(-1).independent, true);
  } finally {
    p.cleanup();
  }
});

// Whole-branch I-2: a blocker an independent verdict does not raise again, with no fix commit between,
// is not "fixed".
test('a blocker gone without a fix commit is not raised, not fixed', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const wt = reviewWorktree(p);
    const three = await independent(p, independentFile(p, 3, verdictText('BLOCK', [['B-2', 'y is wrong']])), wt);
    assert.equal(three.code, 0, three.stderr);
    const four = await independent(p, independentFile(p, 4, verdictText('APPROVE')), wt);
    assert.equal(four.code, 0, four.stderr);
    assert.equal(
      getSection(prIn(p).body, 'Reviewer blocked'),
      'B-1 `x is wrong` — fixed in round 2; B-2 `y is wrong` — not raised by the independent review in round 4',
    );
  } finally {
    p.cleanup();
  }
  const f = (id) => ({ id, kind: 'blocker', wrong: 'x' });
  const sha = 'a'.repeat(40);
  assert.equal(reviewerBlocked([{ round: 1, findings: [f('B-1')], headSha: sha }, { round: 2, findings: [], headSha: sha }]), 'B-1 `x` — not raised in round 2');
  assert.equal(reviewerBlocked([{ round: 1, findings: [f('B-1')], headSha: sha }, { round: 2, findings: [], headSha: 'b'.repeat(40) }]), 'B-1 `x` — fixed in round 2');
});

// Whole-branch M-1: without --worktree, an independent verdict goes to the review worktree when there is one.
test('an independent verdict without --worktree uses the review worktree', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const wt = reviewWorktree(p);
    const r = await cli(p.root, ['build', 'verdict', 'P1/S-01', independentFile(p, 3, verdictText('APPROVE')), '--independent'], p.env);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(stateIn(wt).verdicts.at(-1).round, 3);
    assert.equal(stateIn(wt).verdicts.at(-1).independent, true);
  } finally {
    p.cleanup();
  }
});

// Whole-branch M-2: only an independent verdict with blockers sends the pull request back to draft.
test('a clean independent verdict at ready leaves the pull request ready', async () => {
  const p = await greenAfterTwoRounds();
  try {
    const wt = reviewWorktree(p);
    const three = await independent(p, independentFile(p, 3, verdictText('APPROVE')), wt);
    assert.equal(three.code, 0, three.stderr);
    const head = git(wt, ['rev-parse', 'HEAD']);
    setLiveHead(p, head);
    setCi(p, head);
    const done = await cli(p.root, ['build', 'finish', 'P1/S-01', '--worktree', wt], p.env);
    assert.equal(done.code, 0, done.stderr);
    assert.equal(stateIn(wt).state, 'ready');
    const four = await independent(p, independentFile(p, 4, verdictText('APPROVE')), wt);
    assert.equal(four.code, 0, four.stderr);
    assert.equal(stateIn(wt).state, 'in-review');
    assert.equal(prIn(p).isDraft, false);
    assert.equal(prCalls(p.host).filter((c) => c.op === 'markDraft').length, 0);
  } finally {
    p.cleanup();
  }
});

// Whole-branch queued item: once an independent verdict is recorded, the next review is a new
// session's, so `build pr` prints no in-loop verdict path even with an in-loop round left.
test('build pr prints no in-loop verdict path after an independent verdict', async () => {
  const p = await green();
  try {
    assert.equal((await p.pr()).code, 0);
    write(p.root, `${REVIEWS}/P1-S-01-r1.md`, verdictText('APPROVE'));
    const one = await cli(p.root, ['build', 'verdict', 'P1/S-01', `${REVIEWS}/P1-S-01-r1.md`], p.env);
    assert.equal(one.code, 0, one.stderr);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    setLiveHead(p, head);
    setCi(p, head);
    assert.equal((await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env)).code, 0);
    const wt = reviewWorktree(p);
    const two = await independent(p, independentFile(p, 2, verdictText('BLOCK', [['B-1', 'x is wrong']])), wt);
    assert.equal(two.code, 0, two.stderr);
    write(wt, 'src/t1.js', 'export const x = () => 2; // fix\n');
    const fixed = await cli(p.root, ['build', 'commit', 'P1/S-01', '--worktree', wt, '--message', 'fix: B-1', '--require-green'], p.env);
    assert.equal(fixed.code, 0, fixed.stderr);
    const pushed = await cli(p.root, ['build', 'pr', 'P1/S-01', '--worktree', wt], p.env);
    assert.equal(pushed.code, 0, pushed.stderr);
    assert.match(pushed.stdout, /^#1 \S+\n$/);
  } finally {
    p.cleanup();
  }
});

// S-25 review M-7: the verdict path review start prints can be written at once, without a mkdir first.
test('review start creates the directory of the verdict path it prints', async () => {
  const p = await greenAfterTwoRounds();
  try {
    fs.rmSync(path.join(p.root, ...REVIEWS.split('/')), { recursive: true, force: true });
    const r = await reviewStart(p);
    assert.equal(r.code, 0, r.stderr);
    const printed = r.stdout.split('\n').find((l) => l.startsWith('verdict ')).slice('verdict '.length);
    assert.equal(fs.statSync(path.dirname(printed)).isDirectory(), true);
  } finally {
    p.cleanup();
  }
});
