// REQ-2.6, REQ-2.10, REQ-2.12, REQ-1.8: build finish at ci-green and its Proof, the next verdict
// path printed, the reviewer, fixer and build briefs, and build start at in-review. Part 3 of the old
// review-loop.test.js (issue #55).
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
