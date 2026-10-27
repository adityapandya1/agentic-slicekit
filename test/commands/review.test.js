// S-16 Task 1: independent verdicts (D-39). `build verdict --independent` records a verdict from a
// review worktree, outside the two in-loop rounds, and can send a green slice back to review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { getHost } from '../../src/adapters/githost/index.js';
import { GitHostError } from '../../src/adapters/githost/errors.js';
import { recordVerdict } from '../../src/build/verdict.js';
import { git } from '../../src/git.js';
import { cli, commitAll, commitWorkCli, green, prCalls, project, reviewWorktree, stateIn, vpath, write } from '../helpers/build-flow.js';

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
    refused(await cli(p.root, ['build', 'verdict', 'P1/S-01', file, '--independent'], p.env));
    git(p.wt, ['branch', '-m', 'slice/P1-S-01-thing-1']);

    // The review branch in a worktree somewhere other than review start's path.
    const elsewhere = path.join(p.root, '.worktrees', 'elsewhere');
    git(p.root, ['fetch', '-q', 'origin']);
    git(p.root, ['worktree', 'add', '-q', '--track', '-b', 'slice/P1-S-01-review', elsewhere, 'origin/slice/P1-S-01-thing-1']);
    refused(await independent(p, file, elsewhere));
    git(p.root, ['worktree', 'remove', '--force', elsewhere]);
    git(p.root, ['branch', '-q', '-D', 'slice/P1-S-01-review']);

    // With the review worktree there, two worktrees hold the slice: --worktree is needed (M-2).
    reviewWorktree(p);
    const both = await cli(p.root, ['build', 'verdict', 'P1/S-01', file, '--independent'], p.env);
    assert.equal(both.code, 2);
    assert.match(both.stderr, /two worktrees hold P1\/S-01: .*; pass --worktree/);
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
