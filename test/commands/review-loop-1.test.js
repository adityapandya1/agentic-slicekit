// REQ-2.6, REQ-2.11, REQ-1.8: the in-loop review rounds: each round's verdict file, refusals of a
// malformed or misnamed verdict, finding numbers, hand commits to a verdict, re-runs, and the stop at
// changes-requested. Part 1 of the old review-loop.test.js (issue #55).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { getHost } from '../../src/adapters/githost/index.js';
import { recordVerdict, reviewerBlocked } from '../../src/build/verdict.js';
import { FINISH_WAIT, finish, proofWithCi } from '../../src/build/finish.js';
import { git } from '../../src/git.js';
import { getSection, prBodyProblems } from '../../src/prbody.js';
import { cli, commitIn, commitWorkCli, green as greenFlow, leaveReview, prCalls, reviewWorktree, stateIn, vpath, write } from '../helpers/build-flow.js';
import { briefProblems } from '../helpers/brief-lint.js';
import { TEMPLATES } from '../../src/instructions.js';
import { REVIEWS, reviewed, green, verdictText, review, drafted, fixPush, at, prIn, bodyUpdates, setLiveHead, RUN_URL, WAITING, setCi, finishCli, approved } from '../helpers/review-loop-fixture.js';

test('each round writes a verdict file', async () => {
  const p = await drafted();
  try {
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const file = review(p, 1, verdictText('BLOCK', [['B-1', 'x returns the wrong value']]));
    const r = await p.verdict(file);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `next: fix\nblockers: B-1\nshould-haves: none\nrounds: 1 of 2\nverdict ${vpath(p.root, 'P1-S-01-r2.md')}\n`);
    assert.ok(fs.existsSync(at(p.wt, `${REVIEWS}/P1-S-01-r1.md`)));
    assert.ok(!fs.existsSync(at(p.root, file)));

    // The verdict's own bookkeeping commit adds it and nothing else, then the state is recorded.
    const added = git(p.wt, ['log', '--format=%H %s', `${head}..HEAD`]).split('\n');
    const verdictCommit = added.find((l) => l.endsWith('chore(slicekit): P1/S-01 verdict r1'));
    assert.ok(verdictCommit, added.join('\n'));
    const sha = verdictCommit.split(' ')[0];
    assert.equal(git(p.wt, ['diff-tree', '--no-commit-id', '--name-status', '-r', sha]), `A\t${REVIEWS}/P1-S-01-r1.md`);
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
    assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), git(p.wt, ['rev-parse', 'HEAD']));

    const st = stateIn(p.wt);
    assert.equal(st.state, 'in-review');
    assert.equal(st.verdicts.length, 1);
    assert.deepEqual(
      { ...st.verdicts[0], headSha: undefined },
      { round: 1, path: `${REVIEWS}/P1-S-01-r1.md`, blockers: 1, independent: false, headSha: undefined },
    );

    await fixPush(p, 1);
    const second = await p.verdict(review(p, 2, verdictText('APPROVE')));
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.stdout, 'next: ci\nblockers: none\nshould-haves: none\nrounds: 2 of 2\n');
    assert.ok(fs.existsSync(at(p.wt, `${REVIEWS}/P1-S-01-r2.md`)));
    assert.equal(stateIn(p.wt).verdicts.length, 2);
  } finally {
    p.cleanup();
  }
});

test('a verdict with a finding not verified is refused', async () => {
  const p = await drafted();
  try {
    const text = verdictText('BLOCK', [['B-1', 'x is wrong']]).replace('`node --test` printed "fail 1" |', ' |');
    const file = review(p, 1, text);
    const before = stateIn(p.wt);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const r = await p.verdict(file);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`verdict ${file}: finding B-1 has no "how verified"`), r.stderr);
    assert.ok(fs.existsSync(at(p.root, file)));
    assert.ok(!fs.existsSync(at(p.wt, `${REVIEWS}/P1-S-01-r1.md`)));
    assert.deepEqual(stateIn(p.wt), before);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
  } finally {
    p.cleanup();
  }
});

test('a verdict named for another round or slice is refused', async () => {
  const p = await drafted();
  try {
    const wrongRound = review(p, 2, verdictText('APPROVE'));
    const r = await p.verdict(wrongRound);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /the next verdict of P1\/S-01 is round 1, not 2/);
    assert.ok(fs.existsSync(at(p.root, wrongRound)));

    write(p.root, `${REVIEWS}/P1-S-02-r1.md`, verdictText('APPROVE'));
    const other = await p.verdict(`${REVIEWS}/P1-S-02-r1.md`);
    assert.equal(other.code, 2);
    assert.match(other.stderr, /a verdict of P1\/S-01 is named P1-S-01-r<k>\.md/);
    assert.equal(stateIn(p.wt).state, 'draft-pr');
  } finally {
    p.cleanup();
  }
});

test('should-haves alone ask, and say fix is gone after round 2', async () => {
  const p = await drafted();
  try {
    const first = await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x is wrong']])));
    assert.equal(first.code, 0, first.stderr);
    await fixPush(p, 1);
    const second = await p.verdict(review(p, 2, verdictText('CHANGES', [['H-1', 'a long name']])));
    assert.equal(second.code, 0, second.stderr);
    assert.equal(
      second.stdout,
      'next: ask\nblockers: none\nshould-haves: H-1\nrounds: 2 of 2\nfix: not available after round 2; decline or leave for the independent review\n',
    );
  } finally {
    p.cleanup();
  }
});

// A finding ID names one finding for the whole slice. A finding that survives keeps its ID; a new
// one takes a number never used before in the slice, so an ID that vanished and came back is new.
test('a finding that disappears and comes back takes a new number', async () => {
  const p = await drafted();
  try {
    const cfg = loadConfig(p.root);
    const host = getHost(cfg, p.env, p.root);
    const one = await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x is wrong'], ['B-2', 'y is wrong'], ['H-1', 'a name']])));
    assert.equal(one.code, 0, one.stderr);
    await fixPush(p, 1);

    // A new blocker numbered B-2 while B-2 is still open would be a survivor; B-1 survives, H-2 is new.
    // A blocker that survives round 2 stops the loop (Task 3), but the verdict is recorded either way.
    await p.verdict(review(p, 2, verdictText('BLOCK', [['B-1', 'x is still wrong'], ['H-2', 'another name']])));
    assert.equal(stateIn(p.wt).verdicts.length, 2);
    await fixPush(p, 2);

    // Round 3 (independent, outside the loop's cap): B-2 vanished in round 2, so it is new and reused.
    const file = `${REVIEWS}/P1-S-01i-r3.md`;
    write(p.root, file, verdictText('BLOCK', [['B-2', 'y is wrong again'], ['H-1', 'a name again']]));
    // An independent verdict is recorded from the review worktree (S-16 ruling 6).
    const rwt = reviewWorktree(p);
    const before = stateIn(rwt);
    assert.throws(
      () => recordVerdict(p.root, cfg, host, 'P1/S-01', file, { independent: true, worktree: rwt }),
      (e) =>
        e.code === 1 &&
        e.message ===
          [
            `verdict ${file}: B-2 is new but reuses a number; new findings take the next unused number (B-3)`,
            `verdict ${file}: H-1 is new but reuses a number; new findings take the next unused number (H-3)`,
          ].join('\n'),
    );
    assert.ok(fs.existsSync(at(p.root, file)));
    assert.deepEqual(stateIn(rwt), before);

    // Numbered afresh, the same findings are recorded.
    write(p.root, file, verdictText('BLOCK', [['B-3', 'y is wrong again'], ['H-3', 'a name again']]));
    const ok = recordVerdict(p.root, cfg, host, 'P1/S-01', file, { independent: true, worktree: rwt });
    assert.deepEqual(ok.blockers, ['B-3']);
    assert.equal(ok.roundsUsed, 2);
    assert.equal(ok.next, 'fix');
    assert.equal(stateIn(rwt).verdicts.at(-1).independent, true);
  } finally {
    p.cleanup();
  }
});

// I-1: the kit's verdict commit adds one verdict file, the round its subject names. A hand commit
// under the kit's subject that rewrites, deletes, adds two, or adds another round is forged.
test('a hand commit to a verdict file is refused at the next build commit', async () => {
  const p = await drafted();
  try {
    const one = await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x is wrong']])));
    assert.equal(one.code, 0, one.stderr);
    const base = git(p.wt, ['rev-parse', 'HEAD']);
    const r1 = at(p.wt, `${REVIEWS}/P1-S-01-r1.md`);
    const cases = {
      rewrite: ['verdict r1', () => fs.writeFileSync(r1, verdictText('APPROVE'))],
      delete: ['verdict r1', () => fs.rmSync(r1)],
      'two files': ['verdict r2', () => {
        write(p.wt, `${REVIEWS}/P1-S-01-r2.md`, verdictText('APPROVE'));
        write(p.wt, `${REVIEWS}/P1-S-01-r3.md`, verdictText('APPROVE'));
      }],
      'round mismatch': ['verdict r3', () => write(p.wt, `${REVIEWS}/P1-S-01-r2.md`, verdictText('APPROVE'))],
    };
    for (const [name, [what, change]] of Object.entries(cases)) {
      change();
      commitIn(p.wt, `chore(slicekit): P1/S-01 ${what}\n\nSlice: P1/S-01`);
      const r = await commitWorkCli(p, '--message', 'fix: B-1');
      assert.equal(r.code, 1, `${name}: ${r.stdout}`);
      assert.match(r.stderr, /\.slicekit\/reviews\/P1-S-01-r\d\.md was changed in [0-9a-f]{7} outside the kit/, name);
      git(p.wt, ['reset', '-q', '--hard', base]);
    }
  } finally {
    p.cleanup();
  }
});

// I-2: a verdict is given on the recorded head; code committed after it has not been through build pr.
test('a verdict over commits since build pr is refused', async () => {
  const p = await drafted();
  try {
    write(p.wt, 'src/t1.js', 'export const x = () => 2; // unreviewed\n');
    commitIn(p.wt, 'fix: unreviewed\n\nSlice: P1/S-01');
    const pushed = git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const before = stateIn(p.wt);
    const file = review(p, 1, verdictText('APPROVE'));
    const r = await p.verdict(file);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes('P1/S-01 has commits since build pr; run slicekit build pr P1/S-01 first'), r.stderr);
    assert.ok(fs.existsSync(at(p.root, file)));
    assert.ok(!fs.existsSync(at(p.wt, `${REVIEWS}/P1-S-01-r1.md`)));
    assert.deepEqual(stateIn(p.wt), before);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
    assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), pushed);
  } finally {
    p.cleanup();
  }
});

// I-3: a run that stopped after the move, before the commit, finishes on a re-run with the same name.
test('a verdict moved but not committed is finished on a re-run', async () => {
  const p = await drafted();
  try {
    const file = `${REVIEWS}/P1-S-01-r1.md`;
    write(p.wt, file, verdictText('BLOCK', [['B-1', 'x is wrong']]));
    assert.ok(!fs.existsSync(at(p.root, file)));
    const r = await p.verdict(file);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `next: fix\nblockers: B-1\nshould-haves: none\nrounds: 1 of 2\nverdict ${vpath(p.root, 'P1-S-01-r2.md')}\n`);
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
    assert.ok(git(p.wt, ['log', '--format=%s']).split('\n').includes('chore(slicekit): P1/S-01 verdict r1'));
    assert.equal(stateIn(p.wt).verdicts.length, 1);
    assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), git(p.wt, ['rev-parse', 'HEAD']));
  } finally {
    p.cleanup();
  }
});

// I-3: a run that recorded the round but could not push pushes on a re-run, recording nothing again.
test('a recorded verdict whose push failed is pushed on a re-run', async () => {
  const p = await drafted();
  try {
    const file = review(p, 1, verdictText('CHANGES', [['H-1', 'a long name']]));
    // Only the push fails: a new round needs a fresh fetch (S-16), so the fetch still reaches origin.
    git(p.root, ['remote', 'set-url', '--push', 'origin', path.join(p.root, 'no-such-remote')]);
    const failed = await p.verdict(file);
    assert.equal(failed.code, 1);
    const recorded = stateIn(p.wt);
    assert.equal(recorded.state, 'in-review');
    const head = git(p.wt, ['rev-parse', 'HEAD']);

    git(p.root, ['remote', 'set-url', '--push', 'origin', p.remote]);
    const again = await p.verdict(file);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, `next: ask\nblockers: none\nshould-haves: H-1\nrounds: 1 of 2\nverdict ${vpath(p.root, 'P1-S-01-r2.md')}\n`);
    assert.deepEqual(stateIn(p.wt), recorded);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
    assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), head);
  } finally {
    p.cleanup();
  }
});

// M-1: the file's own Independent line agrees with how it is recorded.
test('a verdict whose Independent line disagrees with its name is refused', async () => {
  const p = await drafted();
  try {
    const file = review(p, 1, verdictText('APPROVE').replace('Verdict: APPROVE\n', 'Verdict: APPROVE\n\nIndependent: yes\n'));
    const r = await p.verdict(file);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`verdict ${file}: Independent does not match P1-S-01-r1.md`), r.stderr);
    assert.ok(fs.existsSync(at(p.root, file)));
    assert.equal(stateIn(p.wt).state, 'draft-pr');
  } finally {
    p.cleanup();
  }
});

test('a blocker that survives round two stops at changes-requested', async () => {
  const p = await drafted();
  try {
    const one = await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x returns the wrong value']])));
    assert.equal(one.code, 0, one.stderr);
    await fixPush(p, 1);
    const two = await p.verdict(review(p, 2, verdictText('BLOCK', [['B-1', 'x still returns the wrong value']])));
    assert.equal(two.code, 1, two.stderr);
    assert.equal(two.stdout, 'next: stuck\nblockers: B-1\nshould-haves: none\nrounds: 2 of 2\n');
    assert.ok(two.stderr.includes('stopped: B-1 survive round 2; the pull request stays draft'), two.stderr);
    const st = stateIn(p.wt);
    assert.equal(st.state, 'changes-requested');
    assert.equal(st.verdicts.length, 2);
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
    assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), git(p.wt, ['rev-parse', 'HEAD']));

    const pr = prIn(p);
    assert.equal(pr.isDraft, true);
    const blocked = getSection(pr.body, 'Reviewer blocked');
    assert.equal(blocked, 'B-1 `x still returns the wrong value` — not fixed after round 2');
    assert.deepEqual(prBodyProblems(pr.title, pr.body, {}), []);
  } finally {
    p.cleanup();
  }
});

test('a stopped round whose push failed is finished on a re-run, recording nothing twice', async () => {
  const p = await drafted();
  try {
    const one = await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x is wrong']])));
    assert.equal(one.code, 0, one.stderr);
    await fixPush(p, 1);
    const file = review(p, 2, verdictText('BLOCK', [['B-1', 'x is still wrong']]));
    // Only the push fails; the fetch still reaches origin.
    git(p.root, ['remote', 'set-url', '--push', 'origin', path.join(p.root, 'no-such-remote')]);
    const failed = await p.verdict(file);
    assert.equal(failed.code, 1);
    const recorded = stateIn(p.wt);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    // The push failed before the body was touched.
    const updates = bodyUpdates(p).length;

    git(p.root, ['remote', 'set-url', '--push', 'origin', p.remote]);
    const again = await p.verdict(file);
    assert.equal(again.code, 1, again.stderr);
    assert.equal(again.stdout, 'next: stuck\nblockers: B-1\nshould-haves: none\nrounds: 2 of 2\n');
    assert.ok(again.stderr.includes('stopped: B-1 survive round 2; the pull request stays draft'), again.stderr);
    assert.equal(stateIn(p.wt).state, 'changes-requested');
    assert.deepEqual(stateIn(p.wt), recorded);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
    assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), head);
    assert.equal(getSection(prIn(p).body, 'Reviewer blocked'), 'B-1 `x is still wrong` — not fixed after round 2');
    assert.equal(bodyUpdates(p).length, updates + 1);
  } finally {
    p.cleanup();
  }
});

test('a third in-loop verdict is refused', async () => {
  const p = await drafted();
  try {
    const one = await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x is wrong']])));
    assert.equal(one.code, 0, one.stderr);
    await fixPush(p, 1);
    const two = await p.verdict(review(p, 2, verdictText('BLOCK', [['B-1', 'x is still wrong']])));
    assert.equal(two.code, 1, two.stderr);
    await fixPush(p, 2);

    const file = review(p, 3, verdictText('APPROVE'));
    const before = stateIn(p.wt);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const r = await p.verdict(file);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes('two review rounds used; the loop stopped (D-18)'), r.stderr);
    assert.ok(fs.existsSync(at(p.root, file)));
    assert.ok(!fs.existsSync(at(p.wt, `${REVIEWS}/P1-S-01-r3.md`)));
    assert.deepEqual(stateIn(p.wt), before);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
  } finally {
    p.cleanup();
  }
});
