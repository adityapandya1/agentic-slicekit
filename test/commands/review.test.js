// S-16 Task 1: independent verdicts (D-39). `build verdict --independent` records a verdict from a
// review worktree, outside the two in-loop rounds, and can send a green slice back to review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { getHost } from '../../src/adapters/githost/index.js';
import { GitHostError } from '../../src/adapters/githost/errors.js';
import { recordVerdict } from '../../src/build/verdict.js';
import { git } from '../../src/git.js';
import { cli, commitAll, commitIn, commitWorkCli, green, prCalls, project, reviewWorktree, stateIn, vpath, write } from '../helpers/build-flow.js';
import { briefProblems } from '../helpers/brief-lint.js';
import { TEMPLATES, renderProcedure } from '../../src/instructions.js';

const REVIEWS = '.slicekit/reviews';
const RUN_URL = 'https://example.test/runs/1';

function verdictText(verdict, findings = []) {
  const rows = findings.map(([id, wrong]) => `| ${id} | src/t1.js:1 | ${wrong} | it matters | \`node --test\` printed "fail 1" |`);
  return [
    `Verdict: ${verdict}`,
    '',
    '| ID | File:line | What is wrong | Why it matters | How verified |',
    '|---|---|---|---|---|',
    ...rows,
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
}

const prIn = (p) => JSON.parse(fs.readFileSync(path.join(p.host, 'pr-1.json'), 'utf8'));
function setLiveHead(p, sha) {
  const file = path.join(p.host, 'pr-1.json');
  fs.writeFileSync(file, `${JSON.stringify({ ...prIn(p), headRefOid: sha }, null, 2)}\n`);
}
const setCi = (p, sha) => write(p.host, `ci-${sha}.json`, JSON.stringify([{ status: 'completed', conclusion: 'success', url: RUN_URL, createdAt: '2026-10-26T00:00:00Z' }]));

// A slice at ci-green after two in-loop rounds (a blocker, a fix push, a clean round 2), its pull
// request marked ready.
async function greenAfterTwoRounds() {
  const p = await green();
  const opened = await p.pr();
  assert.equal(opened.code, 0, opened.stderr);
  const verdict = (k, text) => {
    write(p.root, `${REVIEWS}/P1-S-01-r${k}.md`, text);
    return cli(p.root, ['build', 'verdict', 'P1/S-01', `${REVIEWS}/P1-S-01-r${k}.md`], p.env);
  };
  const one = await verdict(1, verdictText('BLOCK', [['B-1', 'x is wrong']]));
  assert.equal(one.code, 0, one.stderr);
  write(p.wt, 'src/t1.js', 'export const x = () => 2; // fix 1\n');
  const done = await commitWorkCli(p, '--message', 'fix: B-1', '--require-green');
  assert.equal(done.code, 0, done.stderr);
  const again = await p.pr();
  assert.equal(again.code, 0, again.stderr);
  const two = await verdict(2, verdictText('APPROVE'));
  assert.equal(two.code, 0, two.stderr);
  const head = git(p.wt, ['rev-parse', 'HEAD']);
  setLiveHead(p, head);
  setCi(p, head);
  const finished = await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);
  assert.equal(finished.code, 0, finished.stderr);
  assert.equal(stateIn(p.wt).state, 'ci-green');
  assert.equal(prIn(p).isDraft, false);
  return p;
}

// Round `k` of the independent review, written into the session root by its absolute path.
function independentFile(p, k, text) {
  const file = vpath(p.root, `P1-S-01i-r${k}.md`);
  write(p.root, `${REVIEWS}/P1-S-01i-r${k}.md`, text);
  return file;
}
const independent = (p, file, wt) => cli(p.root, ['build', 'verdict', 'P1/S-01', file, '--independent', '--worktree', wt], p.env);

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
    // The pull request goes back to draft with the state (ruling 4), and the slice branch has the round.
    assert.equal(prIn(p).isDraft, true);
    assert.equal(prCalls(p.host).filter((c) => c.op === 'markDraft').length, 1);
    assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), git(wt, ['rev-parse', 'HEAD']));

    // A re-run of the recorded round records nothing again and marks nothing again.
    const again = await independent(p, file, wt);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, r.stdout);
    assert.equal(stateIn(wt).verdicts.length, 3);
    assert.equal(prCalls(p.host).filter((c) => c.op === 'markDraft').length, 1);
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

    // With the review worktree there, a call without --worktree finds the build worktree, and is refused.
    reviewWorktree(p);
    refused(await cli(p.root, ['build', 'verdict', 'P1/S-01', file, '--independent'], p.env));
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

// ---- Task 2: review start, build sync, the behind-origin refusals ----

const SLICE_BRANCH = 'slice/P1-S-01-thing-1';
const REVIEW_BRANCH = 'slice/P1-S-01-review';
const fwd = (p) => path.resolve(p).split(path.sep).join('/');
const reviewDir = (p) => path.join(p.root, '.worktrees', 'review-P1-S-01');
// The fixture's head of pull request #1 is origin's tip, as the git host reports it.
function liveHeadIsOrigin(p) {
  const file = path.join(p.host, 'pr-1.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...raw, headRefOid: git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']) }, null, 2)}\n`);
}
const reviewStart = (p, n = '1') => {
  liveHeadIsOrigin(p);
  return cli(p.root, ['review', 'start', n], p.env);
};
const commits = (n) => `${n} commit${n === 1 ? '' : 's'}`;
const originHeads = (p) => git(p.remote, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).split('\n');
const originTip = (p) => git(p.remote, ['rev-parse', `refs/heads/${SLICE_BRANCH}`]);

// A commit of the worktree's own, never pushed.
function localCommit(wt, text, message) {
  write(wt, 'src/t1.js', text);
  git(wt, ['add', '-A']);
  git(wt, ['commit', '-q', '-m', `${message}\n\nSlice: P1/S-01`]);
}

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

// ---- Task 2 fix round 1 ----

// A copy of pull request #1 in the fixture as #<n>, with `over` changed.
function copyPr(p, n, over) {
  liveHeadIsOrigin(p);
  write(p.host, `pr-${n}.json`, JSON.stringify({ ...prIn(p), number: n, ...over }));
}

test('review start takes only the pull request whose head origin holds', async () => {
  const p = await greenAfterTwoRounds();
  try {
    // I-1: a fork's pull request with the slice branch's name: its head is not origin's.
    copyPr(p, 7, { title: '[P1/S-01] Fork copy', headRefOid: 'deadbeef'.repeat(5) });
    const fork = await cli(p.root, ['review', 'start', '7'], p.env);
    assert.equal(fork.code, 1);
    assert.equal(fork.stderr, `slicekit: pull request #7's head deadbee is not origin/${SLICE_BRANCH}; is it from a fork?\n`);
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

// A clone of the bare origin with an identity.
function cloneOf(remote) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-clone-'));
  git(dir, ['clone', '-q', remote, '.']);
  git(dir, ['config', 'user.name', 'Other']);
  git(dir, ['config', 'user.email', 'other@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return { root: dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

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

// ---- Task 3: ready only after an independent verdict ----

const WAITING = 'ready: waiting for an independent review; run /slicekit review 1 in a new session\n';
const labelCalls = (p) => {
  const file = path.join(p.host, 'label-calls.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};
// The ready-label job, run in the slice worktree on an event for pull request #1 at its live head
// that already carries the label.
function readyLabel(p) {
  const pr = prIn(p);
  const event = path.join(p.host, 'event.json');
  fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 1, title: pr.title, head: { sha: pr.headRefOid }, labels: [{ name: 'ready' }] } }));
  return cli(p.wt, ['ready-label'], { ...p.env, GITHUB_EVENT_PATH: event, SLICEKIT_CHECKS_OK: 'true', GH_TOKEN: 'x' });
}
// An independent round `k` from a fresh review worktree, then the build worktree synced and CI green
// on origin's new tip, which is the pull request's live head.
async function independentRound(p, k, text) {
  const started = await reviewStart(p);
  assert.equal(started.code, 0, started.stderr);
  const r = await independent(p, independentFile(p, k, text), reviewDir(p));
  assert.equal(r.code, 0, r.stderr);
  const synced = await cli(p.root, ['build', 'sync', 'P1/S-01'], p.env);
  assert.equal(synced.code, 0, synced.stderr);
  liveHeadIsOrigin(p);
  setCi(p, originTip(p));
  return r;
}

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
    assert.equal(prIn(p).isDraft, true);
    const readies = prCalls(p.host).filter((c) => c.op === 'markReady').length;

    // CI still running: the pull request stays draft and nothing is recorded.
    write(p.host, `ci-${originTip(p)}.json`, JSON.stringify([{ status: 'in_progress', conclusion: null, url: RUN_URL, createdAt: '2026-10-26T00:00:00Z' }]));
    const pending = await cli(p.root, ['build', 'finish', 'P1/S-01', '--wait', '0'], p.env);
    assert.equal(pending.code, 1);
    assert.equal(prIn(p).isDraft, true);
    assert.equal(stateIn(p.wt).state, 'in-review');

    setCi(p, originTip(p));
    const done = await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);
    assert.equal(done.code, 0, done.stderr);
    assert.equal(done.stdout, `ci-green\n${RUN_URL}\nready\n`);
    assert.equal(stateIn(p.wt).state, 'ready');
    assert.equal(prIn(p).isDraft, false);
    assert.equal(prCalls(p.host).filter((c) => c.op === 'markReady').length, readies + 1);

    // A re-run at ready pushes and marks nothing new.
    const again = await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, `ci-green\n${RUN_URL}\nready\n`);
    assert.equal(prCalls(p.host).filter((c) => c.op === 'markReady').length, readies + 1);
  } finally {
    p.cleanup();
  }
});

// ---- Task 3 fix round 1: hand edits, the base branch's gate ----

const stateFile = (p) => path.join(p.wt, '.slicekit', 'state', 'P1-S-01.json');
function editState(p, fn) {
  const st = JSON.parse(fs.readFileSync(stateFile(p), 'utf8'));
  fs.writeFileSync(stateFile(p), `${JSON.stringify(fn(st), null, 2)}\n`);
}
const markReadies = (p) => prCalls(p.host).filter((c) => c.op === 'markReady').length;
const finishOf = (p) => cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);
function setReviewMode(file, mode) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...cfg, review: { ...cfg.review, independent: mode } }, null, 2)}\n`);
}

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
  assert.ok(build.includes('<id> not started: <reason>'));
  assert.match(build, /^## Building a step in parallel$/m);
  assert.doesNotMatch(build, /A refusal that says `pull first`, or that the default\s+branch/);
  // `/slicekit review` is built now: the procedure renders, the arguments filled in.
  const rendered = renderProcedure(process.cwd(), { cli: 'npx slicekit' }, 'review', ['7']);
  assert.ok(rendered.includes('`npx slicekit review start 7`'));
  assert.ok(!rendered.includes('{{'));
});
