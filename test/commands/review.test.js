// S-16 Task 1: independent verdicts (D-39). `build verdict --independent` records a verdict from a
// review worktree, outside the two in-loop rounds, and can send a green slice back to review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../src/git.js';
import { cli, commitWorkCli, green, prCalls, reviewWorktree, stateIn, vpath, write } from '../helpers/build-flow.js';

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
    const r = await independent(p, file, p.wt);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'slicekit: an independent verdict is recorded from the review worktree; run slicekit review start 1 in a new session\n');
    assert.deepEqual(stateIn(p.wt), before);
    assert.ok(fs.existsSync(path.join(p.root, ...REVIEWS.split('/'), 'P1-S-01i-r3.md')));
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
