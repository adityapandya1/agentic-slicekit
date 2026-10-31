// REQ-2.6, REQ-2.10, REQ-2.11: blockers fixed and independent rounds within the loop, the Reviewer
// blocked line, and build finish: an unrecorded head, open blockers, a declined should-have, and
// ci-green only on success. Part 2 of the old review-loop.test.js (issue #55).
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
