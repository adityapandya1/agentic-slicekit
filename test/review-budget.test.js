// REQ-2.8, REQ-2.6, D-101: the independent round budget. One independent round, a second only when
// the first left a blocker; a third only with a decision row that names the slice and allows one more
// round. The last allowed round with a blocker stops the slice at changes-requested and prints the
// open findings and the three choices for a person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/git.js';
import { cli, stateIn, write } from './helpers/build-flow.js';
import {
  REVIEWS,
  finishOf,
  green,
  independent,
  independentFile,
  independentRound,
  reviewDir,
  reviewStart,
  setCi,
  setLiveHead,
  verdictText,
} from './helpers/review-fixture.js';

// A slice at ci-green after one clean in-loop round: B-1 is unused, so the first independent blocker
// takes it, as the scenario of REQ-2.8 names it.
async function greenAfterOneRound() {
  const p = await green();
  const opened = await p.pr();
  assert.equal(opened.code, 0, opened.stderr);
  write(p.root, `${REVIEWS}/P1-S-01-r1.md`, verdictText('APPROVE'));
  const one = await cli(p.root, ['build', 'verdict', 'P1/S-01', `${REVIEWS}/P1-S-01-r1.md`], p.env);
  assert.equal(one.code, 0, one.stderr);
  const head = git(p.wt, ['rev-parse', 'HEAD']);
  setLiveHead(p, head);
  setCi(p, head);
  const finished = await finishOf(p);
  assert.equal(finished.code, 0, finished.stderr);
  assert.equal(stateIn(p.wt).state, 'ci-green');
  return p;
}

// A row appended to the session root's decisions.md, not committed.
function appendRow(p, row) {
  fs.appendFileSync(path.join(p.root, 'docs', 'decisions.md'), `${row}\n`);
}

// A row appended to the session root's decisions.md, committed on main and pushed to origin's main.
function decide(p, row) {
  appendRow(p, row);
  git(p.root, ['add', 'docs/decisions.md']);
  const run = (args) => execFileSync('git', args, { cwd: p.root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ALLOW_PROTECTED_COMMIT: '1' } });
  run(['commit', '-q', '-m', 'docs: decision']);
  run(['push', '-q', 'origin', 'main']);
}

const ANOTHER_SLICE = '| D-02 | Decision | Another independent round for P1/S-02? | P1/S-02 may have one more round. | team, 2026-11-22 |';
const THIS_SLICE = '| D-03 | Decision | Another independent round for P1/S-01? | P1/S-01 may have one more round. | team, 2026-11-22 |';

// The three choices of REQ-2.8, as both refusals print them.
function assertChoices(text) {
  assert.ok(text.includes('by hand'), text);
  assert.ok(text.includes('re-scope the slice'), text);
  assert.ok(text.includes('decision row'), text);
}

// The review worktree as review start left it: still there, at the same commit, on the same branch.
const worktreeAt = (p) => ({ exists: fs.existsSync(reviewDir(p)), head: git(reviewDir(p), ['rev-parse', 'HEAD']), list: git(p.root, ['worktree', 'list', '--porcelain']) });

// Two independent rounds both holding B-1: the second is the last allowed, so the slice stops.
async function stoppedAfterTwoIndependent() {
  const p = await greenAfterOneRound();
  await independentRound(p, 2, verdictText('BLOCK', [['B-1', 'x is wrong']]));
  const started = await reviewStart(p);
  assert.equal(started.code, 0, started.stderr);
  assert.ok(started.stdout.includes('\nround 3\n'), started.stdout);
  const r = await independent(p, independentFile(p, 3, verdictText('BLOCK', [['B-1', 'x is still wrong']])), reviewDir(p));
  return { p, r };
}

test('review-budget.test.js » a second independent round starts only after a blocker', async () => {
  // After a clean first independent verdict, no second round starts.
  const clean = await greenAfterOneRound();
  try {
    await independentRound(clean, 2, verdictText('APPROVE'));
    const before = worktreeAt(clean);
    const r = await reviewStart(clean);
    assert.equal(r.code, 1, r.stdout);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.startsWith('slicekit: '), r.stderr);
    assert.deepEqual(worktreeAt(clean), before);
  } finally {
    clean.cleanup();
  }

  // After a first independent verdict with a blocker, the second round starts.
  const blocked = await greenAfterOneRound();
  try {
    await independentRound(blocked, 2, verdictText('BLOCK', [['B-1', 'x is wrong']]));
    const r = await reviewStart(blocked);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('\nround 3\n'), r.stdout);
  } finally {
    blocked.cleanup();
  }
});

test('review-budget.test.js » a third independent round with no decision row is refused naming the blocker and the three choices', async () => {
  const { p } = await stoppedAfterTwoIndependent();
  try {
    const refused = async () => {
      const before = worktreeAt(p);
      const r = await reviewStart(p);
      assert.equal(r.code, 1, r.stdout);
      assert.equal(r.stdout, '');
      assert.ok(r.stderr.includes('B-1'), r.stderr);
      assertChoices(r.stderr);
      // Refused before any worktree is touched.
      assert.deepEqual(worktreeAt(p), before);
    };
    await refused();
    // A row that names another slice allows nothing for this one.
    decide(p, ANOTHER_SLICE);
    await refused();
  } finally {
    p.cleanup();
  }
});

test('review-budget.test.js » a decision row naming the slice allows one more round', async () => {
  const p = await greenAfterOneRound();
  try {
    await independentRound(p, 2, verdictText('BLOCK', [['B-1', 'x is wrong']]));
    const started = await reviewStart(p);
    assert.equal(started.code, 0, started.stderr);
    decide(p, THIS_SLICE);
    // The second independent verdict still holds B-1; the row allows another round, so build verdict
    // names the review start command for it and the slice does not stop.
    const r = await independent(p, independentFile(p, 3, verdictText('BLOCK', [['B-1', 'x is still wrong']])), reviewDir(p));
    assert.equal(r.code, 0, r.stderr);
    assert.ok(`${r.stdout}${r.stderr}`.includes('review start 1'), `${r.stdout}${r.stderr}`);
    assert.notEqual(stateIn(reviewDir(p)).state, 'changes-requested');

    const third = await reviewStart(p);
    assert.equal(third.code, 0, third.stderr);
    assert.ok(third.stdout.includes('\nround 4\n'), third.stdout);
  } finally {
    p.cleanup();
  }
});

test('review-budget.test.js » an uncommitted decision row allows no round', async () => {
  const { p } = await stoppedAfterTwoIndependent();
  try {
    // The row names this slice and says "one more round", but only the working tree holds it.
    appendRow(p, THIS_SLICE);
    const before = worktreeAt(p);
    const r = await reviewStart(p);
    assert.equal(r.code, 1, r.stdout);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.includes('B-1'), r.stderr);
    assertChoices(r.stderr);
    assert.deepEqual(worktreeAt(p), before);
  } finally {
    p.cleanup();
  }
});

test('review-budget.test.js » a decision row merged on origin since the last fetch allows one more round', async () => {
  const { p } = await stoppedAfterTwoIndependent();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-other-'));
  try {
    // Another clone commits the row on main and pushes it; the session root's origin/main is not fetched.
    const run = (args, cwd = other) =>
      execFileSync('git', ['-c', 'user.name=Other', '-c', 'user.email=other@example.com', ...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ALLOW_PROTECTED_COMMIT: '1' },
      });
    run(['clone', '-q', '--branch', 'main', p.remote, other], os.tmpdir());
    fs.appendFileSync(path.join(other, 'docs', 'decisions.md'), `${THIS_SLICE}\n`);
    run(['add', 'docs/decisions.md']);
    run(['commit', '-q', '--no-verify', '-m', 'docs: decision']);
    run(['push', '-q', 'origin', 'main']);
    const onOrigin = git(other, ['rev-parse', 'HEAD']);
    assert.notEqual(git(p.root, ['rev-parse', 'refs/remotes/origin/main']), onOrigin);

    const r = await reviewStart(p);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('\nround 4\n'), r.stdout);
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
    p.cleanup();
  }
});

test('review-budget.test.js » the last independent round with a blocker sets changes-requested and prints the choices', async () => {
  const { p, r } = await stoppedAfterTwoIndependent();
  try {
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.code, 1, out);
    assert.equal(stateIn(reviewDir(p)).state, 'changes-requested');
    assert.ok(out.includes('B-1'), out);
    assertChoices(out);
  } finally {
    p.cleanup();
  }
});
