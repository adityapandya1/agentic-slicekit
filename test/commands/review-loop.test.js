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

const REVIEWS = '.slicekit/reviews';

// The worktree whose head the next verdict names (D-43): each slice this file builds sets it.
let reviewed = null;
const green = async () => {
  const p = await greenFlow();
  reviewed = p.wt;
  return p;
};

// A well-formed verdict file on the head `reviewed` holds: `findings` are [id, what is wrong] pairs.
function verdictText(verdict, findings = []) {
  const rows = findings.map(([id, wrong]) => `| ${id} | src/t1.js:1 | ${wrong} | it matters | \`node --test\` printed "fail 1" |`);
  return [
    `Verdict: ${verdict}`,
    `Head: ${git(reviewed, ['rev-parse', 'HEAD'])}`,
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

// The reviewer writes round `k` into the session root; -> its path relative to the root.
function review(p, k, text) {
  const rel = `${REVIEWS}/P1-S-01-r${k}.md`;
  write(p.root, rel, text);
  return rel;
}

// A slice at draft-pr: green, then build pr against the fixture host.
async function drafted() {
  const p = await green();
  const r = await p.pr();
  assert.equal(r.code, 0, r.stderr);
  return { ...p, verdict: (file) => cli(p.root, ['build', 'verdict', 'P1/S-01', file], p.env) };
}

// A fix push: a code change committed green, then build pr again (back to draft-pr).
async function fixPush(p, n) {
  write(p.wt, 'src/t1.js', `export const x = () => 2; // fix ${n}\n`);
  const done = await commitWorkCli(p, '--message', `fix: round ${n}`, '--require-green');
  assert.equal(done.code, 0, done.stderr);
  const again = await p.pr();
  assert.equal(again.code, 0, again.stderr);
  assert.equal(stateIn(p.wt).state, 'draft-pr');
}

const at = (root, rel) => path.join(root, ...rel.split('/'));

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

// The pull request as the fixture host holds it.
const prIn = (p) => JSON.parse(fs.readFileSync(path.join(p.host, 'pr-1.json'), 'utf8'));
const bodyUpdates = (p) => prCalls(p.host).filter((c) => c.op === 'updatePullRequestBody');

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

test('a blocker fixed in round 2 is named as fixed', async () => {
  const p = await drafted();
  try {
    const one = await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x returns the wrong value']])));
    assert.equal(one.code, 0, one.stderr);
    // While the loop runs, an open blocker shows as open after its round.
    assert.equal(getSection(prIn(p).body, 'Reviewer blocked'), 'B-1 `x returns the wrong value` — open after round 1');
    assert.equal(bodyUpdates(p).length, 1);
    await fixPush(p, 1);
    const two = await p.verdict(review(p, 2, verdictText('APPROVE')));
    assert.equal(two.code, 0, two.stderr);
    const pr = prIn(p);
    assert.equal(getSection(pr.body, 'Reviewer blocked'), 'B-1 `x returns the wrong value` — fixed in round 2');
    assert.deepEqual(prBodyProblems(pr.title, pr.body, {}), []);
  } finally {
    p.cleanup();
  }
});

// D-18 caps the in-loop rounds only: an independent verdict with blockers asks for a fix, whatever
// the in-loop count, and never stops the loop.
test('an independent verdict after two rounds asks for a fix and does not stop the loop', async () => {
  const p = await drafted();
  try {
    const cfg = loadConfig(p.root);
    const host = getHost(cfg, p.env, p.root);
    const one = await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x is wrong']])));
    assert.equal(one.code, 0, one.stderr);
    await fixPush(p, 1);
    const two = await p.verdict(review(p, 2, verdictText('APPROVE')));
    assert.equal(two.code, 0, two.stderr);
    // The independent review is given on a pushed head, so the slice goes back through build pr.
    await fixPush(p, 2);

    const file = `${REVIEWS}/P1-S-01i-r3.md`;
    write(p.root, file, verdictText('BLOCK', [['B-3', 'z is wrong']]));
    const rwt = reviewWorktree(p);
    const before = stateIn(rwt).verdicts.length;
    // recordVerdict throws on every refusal and the CLI exits 1 only on `stuck`, so `fix` is exit 0.
    const r = recordVerdict(p.root, cfg, host, 'P1/S-01', file, { independent: true, worktree: rwt });
    assert.equal(r.next, 'fix');
    assert.deepEqual(r.blockers, ['B-3']);
    assert.equal(r.roundsUsed, 2);
    assert.equal(stateIn(rwt).state, 'in-review');
    assert.equal(stateIn(rwt).verdicts.length, before + 1);
    assert.equal(
      getSection(prIn(p).body, 'Reviewer blocked'),
      'B-1 `x is wrong` — fixed in round 2; B-3 `z is wrong` — open after round 3',
    );
  } finally {
    p.cleanup();
  }
});

// I-1: a re-run of a recorded round pushes only what build pr has seen.
for (const [name, rounds] of [['after the loop stopped', 2], ['from in-review', 1]]) {
  test(`a re-run ${name} over a commit since build pr is refused and pushes nothing`, async () => {
    const p = await drafted();
    try {
      const one = await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x is wrong']])));
      assert.equal(one.code, 0, one.stderr);
      let file = `${REVIEWS}/P1-S-01-r1.md`;
      if (rounds === 2) {
        await fixPush(p, 1);
        file = review(p, 2, verdictText('BLOCK', [['B-1', 'x is still wrong']]));
        const two = await p.verdict(file);
        assert.equal(two.code, 1, two.stderr);
        assert.equal(stateIn(p.wt).state, 'changes-requested');
      }
      write(p.wt, 'src/t1.js', 'export const x = () => 2; // unbuilt\n');
      const done = await commitWorkCli(p, '--message', 'fix: B-1', '--require-green');
      assert.equal(done.code, 0, done.stderr);
      const pushed = git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']);
      const before = stateIn(p.wt);
      const r = await p.verdict(file);
      assert.equal(r.code, 1);
      assert.ok(r.stderr.includes('P1/S-01 has commits since build pr; run slicekit build pr P1/S-01 first'), r.stderr);
      assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), pushed);
      assert.deepEqual(stateIn(p.wt), before);
    } finally {
      p.cleanup();
    }
  });
}

// I-2: the line the verdict would write is judged before anything moves.
test('a verdict whose Reviewer blocked line would break the body is refused before anything moves', async () => {
  const p = await drafted();
  try {
    const file = review(p, 1, verdictText('BLOCK', [['B-1', 'x opens <!-- a comment']]));
    const before = stateIn(p.wt);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const updates = bodyUpdates(p).length;
    const r = await p.verdict(file);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`verdict ${file}: the Reviewer blocked line would break the pull request body: pull request body is missing "Should-haves declined"`), r.stderr);
    assert.ok(fs.existsSync(at(p.root, file)));
    assert.ok(!fs.existsSync(at(p.wt, `${REVIEWS}/P1-S-01-r1.md`)));
    assert.deepEqual(stateIn(p.wt), before);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
    assert.equal(bodyUpdates(p).length, updates);
  } finally {
    p.cleanup();
  }
});

// I-3: a banned phrase in a verdict would reach the body and the committed file's style check.
test('a verdict with a banned phrase is refused before anything moves', async () => {
  const p = await drafted();
  try {
    const file = review(p, 1, verdictText('BLOCK', [['B-1', 'x is not robust to empty input']]));
    const before = stateIn(p.wt);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const r = await p.verdict(file);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`verdict ${file}: B-1 uses "robust"; reword it`), r.stderr);
    assert.ok(fs.existsSync(at(p.root, file)));
    assert.ok(!fs.existsSync(at(p.wt, `${REVIEWS}/P1-S-01-r1.md`)));
    assert.deepEqual(stateIn(p.wt), before);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
  } finally {
    p.cleanup();
  }
});

// M-1: round numbers are shared with independent rounds, so the line and the stop name real rounds.
test('with an independent round mid-loop the line and the stop name the real rounds', async () => {
  const p = await drafted();
  try {
    const cfg = loadConfig(p.root);
    const host = getHost(cfg, p.env, p.root);
    const one = await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x is wrong']])));
    assert.equal(one.code, 0, one.stderr);
    await fixPush(p, 1);
    const file = `${REVIEWS}/P1-S-01i-r2.md`;
    write(p.root, file, verdictText('BLOCK', [['B-1', 'x is wrong'], ['B-2', 'y is wrong']]));
    const rwt = reviewWorktree(p);
    assert.equal(recordVerdict(p.root, cfg, host, 'P1/S-01', file, { independent: true, worktree: rwt }).next, 'fix');
    assert.equal(getSection(prIn(p).body, 'Reviewer blocked'), 'B-1 `x is wrong` — open after round 1; B-2 `y is wrong` — open after round 2');
    // The build session takes up what the review pushed, then fixes.
    leaveReview(p, rwt);
    await fixPush(p, 2);
    const three = await p.verdict(review(p, 3, verdictText('BLOCK', [['B-3', 'z is wrong']])));
    assert.equal(three.code, 1, three.stderr);
    assert.ok(three.stderr.includes('stopped: B-3 survive round 3; the pull request stays draft'), three.stderr);
    assert.equal(stateIn(p.wt).state, 'changes-requested');
    assert.equal(
      getSection(prIn(p).body, 'Reviewer blocked'),
      'B-1 `x is wrong` — fixed in round 3; B-2 `y is wrong` — fixed in round 3; B-3 `z is wrong` — not fixed after round 3',
    );
  } finally {
    p.cleanup();
  }
});

// I-2, M-2: each "what is wrong" is quoted as a code span, its backticks removed, cut to 160 characters.
test('Reviewer blocked quotes each finding without backticks and cuts long text', () => {
  const f = (id, wrong) => ({ id, kind: 'blocker', wrong });
  assert.equal(reviewerBlocked([{ round: 1, findings: [f('B-1', 'x `returns` 3')] }]), 'B-1 `x returns 3` — open after round 1');
  const long = 'a'.repeat(300);
  assert.equal(reviewerBlocked([{ round: 1, findings: [f('B-1', long)] }]), `B-1 \`${'a'.repeat(159)}…\` — open after round 1`);
  assert.equal(reviewerBlocked([{ round: 1, findings: [] }]), 'nothing');
});

// Task 4: `build finish`, and `build decline` end to end.

// The fixture host never moves headRefOid, so a test sets the live head it means by hand.
function setLiveHead(p, sha) {
  const file = path.join(p.host, 'pr-1.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...raw, headRefOid: sha }, null, 2)}\n`);
}
const RUN_URL = 'https://example.test/runs/1';
// S-16: with independent review required, finish stops at ci-green until an independent verdict.
const WAITING = 'ready: waiting for an independent review; run /slicekit review 1 in a new session\n';
function setCi(p, sha, status, conclusion = null) {
  write(p.host, `ci-${sha}.json`, JSON.stringify([{ status, conclusion, url: RUN_URL, createdAt: '2026-10-26T00:00:00Z' }]));
}
const finishCli = (p, ...args) => cli(p.root, ['build', 'finish', 'P1/S-01', ...args], p.env);

// A slice in review with a clean round 1 on its head; the live head is the pushed verdict head.
async function approved(findings = []) {
  const p = await drafted();
  const r = await p.verdict(review(p, 1, verdictText('APPROVE', findings)));
  assert.equal(r.code, 0, r.stderr);
  const head = git(p.wt, ['rev-parse', 'HEAD']);
  setLiveHead(p, head);
  return { ...p, head };
}

test('finish refuses a live head the state has not recorded', async () => {
  const p = await approved();
  try {
    write(p.wt, 'src/t1.js', 'export const x = () => 2; // later\n');
    commitIn(p.wt, 'fix: unrecorded');
    const later = git(p.wt, ['rev-parse', 'HEAD']);
    setLiveHead(p, later);
    setCi(p, later, 'completed', 'success');
    const r = await finishCli(p);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes('a fix push is not recorded; run slicekit build pr P1/S-01'), r.stderr);
    assert.equal(stateIn(p.wt).state, 'in-review');
    assert.equal(prIn(p).isDraft, true);
    assert.ok(!prCalls(p.host).some((c) => c.op === 'markReady'));
  } finally {
    p.cleanup();
  }
});

test('finish refuses while the latest verdict on the head has blockers', async () => {
  const p = await drafted();
  try {
    const r = await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x is wrong']])));
    assert.equal(r.code, 0, r.stderr);
    setLiveHead(p, git(p.wt, ['rev-parse', 'HEAD']));
    const f = await finishCli(p);
    assert.equal(f.code, 1);
    assert.ok(f.stderr.includes('P1/S-01 has open blockers; finish needs a clean verdict'), f.stderr);
    assert.equal(prIn(p).isDraft, true);
  } finally {
    p.cleanup();
  }
});

test('a declined should-have becomes one issue and a body line', async () => {
  const p = await approved([['H-1', 'names are long']]);
  const tracker = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-tracker-'));
  try {
    const env = { ...p.env, SLICEKIT_TRACKER_FIXTURE: tracker };
    const decline = () => cli(p.root, ['build', 'decline', 'P1/S-01', 'H-1'], env);
    const first = await decline();
    assert.equal(first.code, 0, first.stderr);
    const url = first.stdout.trim();
    assert.match(url, /^https:\/\/example\.test\/issues\/\d+$/);
    const second = await decline();
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.stdout, `${url} (already filed)\n`);

    const calls = fs.readFileSync(path.join(tracker, 'issue-calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const opens = calls.filter((c) => c.op === 'open');
    assert.equal(opens.length, 1);
    assert.equal(opens[0].title, '[P1/S-01] H-1: names are long');
    assert.ok(opens[0].body.includes(`${REVIEWS}/P1-S-01-r1.md`), opens[0].body);

    const body = prIn(p).body;
    assert.equal(getSection(body, 'Should-haves declined'), url);
    assert.equal(body.split(url).length - 1, 1);
  } finally {
    fs.rmSync(tracker, { recursive: true, force: true });
    p.cleanup();
  }
});

test('finish records ci-green only when CI succeeds on the head', async () => {
  const p = await approved();
  try {
    const sha7 = p.head.slice(0, 7);
    const none = await finishCli(p, '--wait', '0');
    assert.equal(none.code, 1);
    assert.ok(none.stderr.includes(`no CI run found for ${sha7}; check that the workflow ran`), none.stderr);
    assert.equal(prIn(p).isDraft, true);

    setCi(p, p.head, 'completed', 'failure');
    const failed = await finishCli(p, '--wait', '0');
    assert.equal(failed.code, 1);
    assert.ok(failed.stderr.includes(`CI failed on ${sha7}: ${RUN_URL}`), failed.stderr);
    assert.equal(stateIn(p.wt).state, 'in-review');
    assert.match(getSection(prIn(p).body, 'Proof'), /CI: pending$/);
    assert.equal(prIn(p).isDraft, true);

    setCi(p, p.head, 'in_progress');
    const pending = await finishCli(p, '--wait', '0');
    assert.equal(pending.code, 1);
    assert.ok(pending.stderr.includes(`CI still running on ${sha7}; run slicekit build finish P1/S-01 again`), pending.stderr);
    assert.equal(stateIn(p.wt).state, 'in-review');
    assert.equal(prIn(p).isDraft, true);
    assert.ok(!prCalls(p.host).some((c) => c.op === 'markReady'));

    setCi(p, p.head, 'completed', 'success');
    const ok = await finishCli(p);
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(ok.stdout, `ci-green\n${RUN_URL}\n${WAITING}`);
    const st = stateIn(p.wt);
    assert.equal(st.state, 'ci-green');
    assert.deepEqual(st.ci, { sha: p.head, status: 'success', url: RUN_URL });
    const pr = prIn(p);
    assert.equal(pr.isDraft, false);
    const proof = getSection(pr.body, 'Proof');
    assert.ok(proof.endsWith(`CI: ${RUN_URL}`), proof);
    assert.ok(!proof.includes('CI: pending'), proof);
    assert.deepEqual(prBodyProblems(pr.title, pr.body, loadConfig(p.wt)), []);
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
    assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), git(p.wt, ['rev-parse', 'HEAD']));
  } finally {
    p.cleanup();
  }
});

test('finish polls every interval through the sleep it is given, up to the wait', async () => {
  const p = await approved();
  try {
    const cfg = loadConfig(p.wt);
    setCi(p, p.head, 'queued');
    const slept = [];
    const r = finish(p.root, cfg, getHost(cfg, p.env, p.root), 'P1/S-01', {
      wait: 40,
      interval: 15,
      sleep: (s) => {
        slept.push(s);
        if (slept.length === 2) setCi(p, p.head, 'completed', 'success');
      },
    });
    assert.deepEqual(slept, [15, 15]);
    assert.deepEqual(r.ci, { status: 'success', sha: p.head, url: RUN_URL });
    assert.equal(stateIn(p.wt).state, 'ci-green');
  } finally {
    p.cleanup();
  }
  const q = await approved();
  try {
    const cfg = loadConfig(q.wt);
    setCi(q, q.head, 'queued');
    const naps = [];
    assert.throws(
      () => finish(q.root, cfg, getHost(cfg, q.env, q.root), 'P1/S-01', { wait: 40, interval: 15, sleep: (s) => naps.push(s) }),
      /CI still running/,
    );
    assert.deepEqual(naps, [15, 15, 10]);
    assert.equal(stateIn(q.wt).state, 'in-review');
  } finally {
    q.cleanup();
  }
});

test('a return to draft-pr after finish marks the pull request draft again', async () => {
  const p = await approved();
  try {
    setCi(p, p.head, 'completed', 'success');
    const ok = await finishCli(p);
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(prIn(p).isDraft, false);
    await fixPush(p, 1);
    assert.equal(prIn(p).isDraft, true);
    assert.deepEqual(prCalls(p.host).filter((c) => c.op === 'markDraft'), [{ op: 'markDraft', number: 1 }]);
  } finally {
    p.cleanup();
  }
});

// Review I-1: a re-run at ci-green never pushes a commit build pr has not seen.
test('finish at ci-green refuses a code commit made since, and pushes nothing', async () => {
  const p = await approved();
  try {
    setCi(p, p.head, 'completed', 'success');
    assert.equal((await finishCli(p)).code, 0);
    write(p.wt, 'src/t1.js', 'export const x = () => 2; // unreviewed\n');
    const c = await commitWorkCli(p, '--message', 'fix: later', '--require-green');
    assert.equal(c.code, 0, c.stderr);
    const remote = git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']);
    const again = await finishCli(p);
    assert.equal(again.code, 1);
    assert.ok(again.stderr.includes('P1/S-01 has commits since build pr; run slicekit build pr P1/S-01 first'), again.stderr);
    assert.equal(git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']), remote);
    assert.equal(stateIn(p.wt).state, 'ci-green');
  } finally {
    p.cleanup();
  }
});

// Review M-2: a re-run at ci-green cites the run recorded with ci-green, not what the host says now.
test('finish at ci-green cites the recorded run', async () => {
  const p = await approved();
  try {
    setCi(p, p.head, 'completed', 'success');
    assert.equal((await finishCli(p)).code, 0);
    write(p.host, `ci-${p.head}.json`, JSON.stringify([{ status: 'completed', conclusion: 'failure', url: 'https://example.test/runs/2', createdAt: '2026-10-27T00:00:00Z' }]));
    const again = await finishCli(p);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, `ci-green\n${RUN_URL}\n${WAITING}`);
    assert.ok(getSection(prIn(p).body, 'Proof').endsWith(`CI: ${RUN_URL}`));
  } finally {
    p.cleanup();
  }
});

// Review M-6: a live head this worktree does not hold is a pull, not a fix push.
test('finish says build sync for a live head missing from the worktree', async () => {
  const p = await approved();
  try {
    const missing = 'a'.repeat(40);
    setLiveHead(p, missing);
    setCi(p, missing, 'completed', 'success');
    const r = await finishCli(p);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("P1/S-01's pull request head aaaaaaa is not in the worktree; run slicekit build sync P1/S-01"), r.stderr);
    assert.equal(prIn(p).isDraft, true);
  } finally {
    p.cleanup();
  }
});

// Review M-1: the run URL is taken literally, and a CI part already there is replaced, not doubled.
test('Proof takes the run URL literally and replaces the CI part it holds', () => {
  assert.equal(proofWithCi('`node --test` → 3 pass · CI: pending', 'https://x/runs/1?a=$&b'), '`node --test` → 3 pass · CI: https://x/runs/1?a=$&b');
  assert.equal(proofWithCi("t · CI: pending", "https://x/$'tail"), "t · CI: https://x/$'tail");
  assert.equal(proofWithCi('t · CI: https://old/run · notes', RUN_URL), `t · CI: ${RUN_URL} · notes`);
  assert.equal(proofWithCi('t · CI: https://old/run', 'https://x/$&'), 't · CI: https://x/$&');
  assert.equal(proofWithCi('tests pass', RUN_URL), `tests pass · CI: ${RUN_URL}`);
});

// Task 5: the procedure never computes k. `build pr` and `build verdict` print, last, the session-root
// path the next in-loop reviewer writes; no path once no further in-loop round is allowed.
test('build pr and build verdict print the next verdict path last', async () => {
  const p = await green();
  try {
    const verdict = (file) => cli(p.root, ['build', 'verdict', 'P1/S-01', file], p.env);
    const first = await p.pr();
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stdout, `#1 https://example.test/pull/1\nverdict ${vpath(p.root, 'P1-S-01-r1.md')}\n`);
    // A re-run at draft-pr prints the same path.
    const rerun = await p.pr();
    assert.equal(rerun.stdout.split('\n').at(-2), `verdict ${vpath(p.root, 'P1-S-01-r1.md')}`);

    const one = await verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x returns the wrong value']])));
    assert.equal(one.code, 0, one.stderr);
    assert.equal(one.stdout, `next: fix\nblockers: B-1\nshould-haves: none\nrounds: 1 of 2\nverdict ${vpath(p.root, 'P1-S-01-r2.md')}\n`);

    write(p.wt, 'src/t1.js', 'export const x = () => 2; // fix 1\n');
    assert.equal((await commitWorkCli(p, '--message', 'fix: B-1', '--require-green')).code, 0);
    const fixed = await p.pr();
    assert.equal(fixed.code, 0, fixed.stderr);
    assert.equal(fixed.stdout.split('\n').at(-2), `verdict ${vpath(p.root, 'P1-S-01-r2.md')}`);

    // next: stuck allows no further in-loop round: no path.
    const two = await verdict(review(p, 2, verdictText('BLOCK', [['B-1', 'x still returns the wrong value']])));
    assert.equal(two.code, 1);
    assert.equal(two.stdout, 'next: stuck\nblockers: B-1\nshould-haves: none\nrounds: 2 of 2\n');
    // A fix push after the loop stopped: build pr names no round either.
    write(p.wt, 'src/t1.js', 'export const x = () => 2; // fix 2\n');
    assert.equal((await commitWorkCli(p, '--message', 'fix: B-1 again', '--require-green')).code, 0);
    const after = await p.pr();
    assert.equal(after.code, 0, after.stderr);
    assert.equal(after.stdout, '#1 https://example.test/pull/1\n');
  } finally {
    p.cleanup();
  }
});

test('next: ci prints no verdict path, and a round-1 ask prints the next', async () => {
  const p = await drafted();
  try {
    const ci = await p.verdict(review(p, 1, verdictText('APPROVE')));
    assert.equal(ci.stdout, 'next: ci\nblockers: none\nshould-haves: none\nrounds: 1 of 2\n');
  } finally {
    p.cleanup();
  }
  const q = await drafted();
  try {
    const ask = await q.verdict(review(q, 1, verdictText('CHANGES', [['H-1', 'names are long']])));
    assert.equal(ask.stdout, `next: ask\nblockers: none\nshould-haves: H-1\nrounds: 1 of 2\nverdict ${vpath(q.root, 'P1-S-01-r2.md')}\n`);
  } finally {
    q.cleanup();
  }
});

test('the reviewer, fixer and build briefs pass the brief lint', () => {
  const read = (rel) => fs.readFileSync(path.join(TEMPLATES, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
  const reviewer = read('agents/reviewer.md');
  const fixer = read('agents/fixer.md');
  const build = read('commands/build.md');
  assert.deepEqual(briefProblems(reviewer, { kind: 'agent' }), []);
  assert.deepEqual(briefProblems(fixer, { kind: 'agent' }), []);
  assert.deepEqual(briefProblems(build, { kind: 'command' }), []);
  for (const s of ['build verdict', 'build decline', 'build finish', 'next: stuck', 'next: ask', 'next: fix', 'next: ci', '/slicekit review']) {
    assert.ok(build.includes(s), s);
  }
  assert.doesNotMatch(build, /Steps 6 to 9 are not in this version/);
  // Whole-branch review: finish's wait fits a Bash call; the independent review comes before a merge.
  assert.ok(build.includes('at most 90 seconds'));
  assert.ok(build.includes('after five tries'));
  assert.match(build, /`\/slicekit review <n>`[^.]*new session[^.]*\. A human merges once the slice is `ready`\./);
  assert.ok(build.includes('- `in-review`: step 6'));
  assert.ok(reviewer.includes('the absolute path'));
  assert.ok(reviewer.includes('"Should-haves declined"'));
  assert.match(reviewer, /^## Reviewing a slice$/m);
  assert.ok(reviewer.includes('Verdict: BLOCK|CHANGES|APPROVE'));
  assert.ok(reviewer.includes('How verified'));
  assert.match(fixer, /^## Fixing findings$/m);
  assert.ok(fixer.includes('no test the verdict did not ask for'));
  assert.ok(fixer.includes('`<ID>: <what changed> (<file>)`'));
});

// Whole-branch review I-1: a Claude Code Bash call stops at 120 s, so finish waits 90 s by default.
test('finish waits 90 seconds by default', async () => {
  const p = await approved();
  try {
    const cfg = loadConfig(p.wt);
    setCi(p, p.head, 'queued');
    const naps = [];
    assert.throws(() => finish(p.root, cfg, getHost(cfg, p.env, p.root), 'P1/S-01', { sleep: (s) => naps.push(s) }), /CI still running/);
    assert.equal(naps.reduce((a, b) => a + b, 0), 90);
    assert.equal(FINISH_WAIT, 90);
    const usage = await cli(p.root, ['build', 'finish'], p.env);
    assert.ok(usage.stderr.includes('build finish <id> [--wait <s>, default 90]'), usage.stderr);
  } finally {
    p.cleanup();
  }
});

// Whole-branch review I-2: the reviewer works in the worktree, but its verdict goes at the absolute
// session-root path the command prints.
test('the reviewer brief names the verdict file as the one exception to the worktree', async () => {
  const p = await drafted();
  try {
    const where = p.wt.split(path.sep).join('/');
    const reviewer = await cli(p.root, ['instructions', 'reviewer', 'P1/S-01', '--worktree', p.wt], p.env);
    assert.equal(reviewer.code, 0, reviewer.stderr);
    assert.ok(
      reviewer.stdout.includes(`## Where\n\nWork only under ${where}; use absolute paths. The one exception is the verdict file: write it at the absolute path the command gives you, in the session root.`),
      reviewer.stdout,
    );
    const developer = await cli(p.root, ['instructions', 'developer', 'P1/S-01', '--worktree', p.wt], p.env);
    assert.ok(developer.stdout.includes(`Work only under ${where}; use absolute paths.\n`), developer.stdout);
    assert.doesNotMatch(developer.stdout, /verdict file/);
    // The printed path is absolute, in the session root, and build verdict takes it as given.
    const printed = vpath(p.root, 'P1-S-01-r1.md');
    assert.ok(path.isAbsolute(printed));
    fs.mkdirSync(path.dirname(printed), { recursive: true });
    fs.writeFileSync(printed, verdictText('APPROVE'));
    const r = await p.verdict(printed);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(stateIn(p.wt).verdicts[0].path, `${REVIEWS}/P1-S-01-r1.md`);
  } finally {
    p.cleanup();
  }
});

// Whole-branch review M-1: a re-run of a recorded round judges the committed verdict, not the disk.
test('a re-run of a recorded round reads the verdict from its commit', async () => {
  const p = await drafted();
  try {
    const file = review(p, 1, verdictText('BLOCK', [['B-1', 'x returns the wrong value']]));
    assert.equal((await p.verdict(file)).code, 0);
    write(p.wt, `${REVIEWS}/P1-S-01-r1.md`, verdictText('APPROVE'));
    const again = await p.verdict(file);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, `next: fix\nblockers: B-1\nshould-haves: none\nrounds: 1 of 2\nverdict ${vpath(p.root, 'P1-S-01-r2.md')}\n`);
    assert.equal(getSection(prIn(p).body, 'Reviewer blocked'), 'B-1 `x returns the wrong value` — open after round 1');
  } finally {
    p.cleanup();
  }
});

// Whole-branch review M-2: finish counts the committed verdict's blockers, not the state's number.
test('finish refuses when the state and the committed verdict disagree on blockers', async () => {
  const p = await drafted();
  try {
    assert.equal((await p.verdict(review(p, 1, verdictText('BLOCK', [['B-1', 'x is wrong']])))).code, 0);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    setLiveHead(p, head);
    setCi(p, head, 'completed', 'success');
    const stateFile = path.join(p.wt, '.slicekit', 'state', 'P1-S-01.json');
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    st.verdicts[0].blockers = 0;
    fs.writeFileSync(stateFile, `${JSON.stringify(st, null, 2)}\n`);
    const r = await finishCli(p);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`the state says round 1 has 0 blockers but ${REVIEWS}/P1-S-01-r1.md holds 1`), r.stderr);
    assert.equal(prIn(p).isDraft, true);
  } finally {
    p.cleanup();
  }
});

// Queued item: a session that restarts at in-review re-reads the latest round's next step through
// build verdict, so build start names that round's file; changes-requested names none.
test('build start at in-review names the latest verdict, and not at changes-requested', async () => {
  const p = await drafted();
  try {
    const file = review(p, 1, verdictText('BLOCK', [['B-1', 'x is wrong']]));
    assert.equal((await p.verdict(file)).code, 0);
    const where = p.wt.split(path.sep).join('/');
    const resumed = await cli(p.root, ['build', 'start', 'P1/S-01'], p.env);
    assert.equal(resumed.code, 0, resumed.stderr);
    const latest = vpath(p.root, 'P1-S-01-r1.md');
    assert.equal(resumed.stdout, `resumed ${where} at in-review\nverdict ${latest}\n`);
    // That path re-prints the round's next step and records nothing again.
    const before = stateIn(p.wt);
    const again = await p.verdict(latest);
    assert.equal(again.code, 0, again.stderr);
    assert.ok(again.stdout.startsWith('next: fix\n'), again.stdout);
    assert.deepEqual(stateIn(p.wt), before);

    await fixPush(p, 1);
    assert.equal((await p.verdict(review(p, 2, verdictText('BLOCK', [['B-1', 'x is still wrong']])))).code, 1);
    const stopped = await cli(p.root, ['build', 'start', 'P1/S-01'], p.env);
    assert.equal(stopped.stdout, `resumed ${where} at changes-requested\n`);
  } finally {
    p.cleanup();
  }
});
