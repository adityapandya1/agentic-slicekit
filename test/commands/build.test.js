import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.js';
import { commitsOnBranch, git, parseTrailers } from '../../src/git.js';
import { BuildError, findWorktree, startSlice } from '../../src/build/worktree.js';
import { recordState } from '../../src/build/record.js';
import { runCommand } from '../../src/build/red.js';
import { prBodyProblems } from '../../src/prbody.js';
import { binPath, runCli } from '../helpers/run-cli.js';
import { briefProblems } from '../helpers/brief-lint.js';
import { TEMPLATES } from '../../src/instructions.js';
import { commit, makeRemote, makeRepo } from '../helpers/tmp-repo.js';
import {
  cli,
  write,
  writePhase,
  project,
  commitAll,
  startedWithTest,
  stateIn,
  red1,
  commitIn,
  building,
  commitWorkCli,
  GREEN,
  green,
  prCalls,
  vpath,
} from '../helpers/build-flow.js';

// Writes and commits a state file: build next and build start refuse uncommitted state changes.
function setSliceState(root, id, state) {
  write(root, `.slicekit/state/${id.replace('/', '-')}.json`, `${JSON.stringify({ slice: id, state, history: [] }, null, 2)}\n`);
  git(root, ['add', '--', '.slicekit/state']);
  commit(root, `state ${id} ${state}`);
}

test('next skips a slice whose group waits on an unmerged step', async () => {
  const p = project({ order: 'A; B', slices: [{ n: 1, group: 'A' }, { n: 2, group: 'B' }] });
  try {
    setSliceState(p.root, 'P1/S-01', 'draft-pr');
    const blocked = await cli(p.root, ['build', 'next']);
    assert.equal(blocked.code, 1, blocked.stderr);
    const lines = blocked.stdout.trim().split('\n');
    assert.equal(lines[0], 'no slice is ready to build');
    assert.ok(lines.includes('P1/S-02 waits on P1/S-01 (draft-pr)'), blocked.stdout);

    setSliceState(p.root, 'P1/S-01', 'merged');
    const ready = await cli(p.root, ['build', 'next']);
    assert.equal(ready.code, 0, ready.stderr);
    assert.equal(ready.stdout, 'P1/S-02\n');

    const started = await cli(p.root, ['build', 'start', 'P1/S-02']);
    assert.equal(started.code, 0, started.stderr);
    const [wt, branch] = started.stdout.trim().split('\n');
    assert.equal(path.resolve(wt), path.resolve(p.root, '.worktrees', 'P1-S-02'));
    assert.equal(branch, 'slice/P1-S-02-thing-2');
    assert.equal(git(wt, ['symbolic-ref', '--short', 'HEAD']), branch);
    assert.match(started.stderr, /slicekit: no origin; other clones will not see slice\/P1-S-02-thing-2/);

    const after = await cli(p.root, ['build', 'next']);
    assert.ok(!after.stdout.includes('P1/S-02'), after.stdout);
    assert.equal(after.code, 1);

    // A second start in this clone resumes it; the path is printed with forward slashes.
    assert.ok(!wt.includes('\\'), wt);
    const again = await cli(p.root, ['build', 'start', 'P1/S-02']);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, `resumed ${wt} at todo\n`);
  } finally {
    p.cleanup();
  }
});

test('a docs root of . does not read the worktrees', () => {
  const repo = makeRepo();
  try {
    const { root } = repo;
    const init = runCli(['init', '--shape', 'backend', '--name', 'demo', '--docs', '.'], { cwd: root });
    assert.equal(init.code, 0, init.stderr);
    writePhase(root, '.', { order: 'A', slices: [{ n: 1, group: 'A' }] });
    commitAll(root, 'scaffold');
    assert.equal(git(root, ['status', '--porcelain']), '');

    const before = runCli(['check'], { cwd: root });
    const started = runCli(['build', 'start', 'P1/S-01'], { cwd: root });
    assert.equal(started.code, 0, started.stderr);
    assert.ok(fs.existsSync(path.join(root, '.worktrees', 'P1-S-01', 'phases', 'P1-x', 'S-01-thing-1.md')));

    const after = runCli(['check'], { cwd: root });
    assert.ok(!/duplicate/.test(after.stdout), after.stdout);
    assert.equal(after.stdout, before.stdout);
    assert.equal(after.code, before.code);
    assert.equal(git(root, ['status', '--porcelain']), '');
  } finally {
    repo.cleanup();
  }
});

test('a slice started in one clone is skipped by next in another', async () => {
  const a = project({ slices: [{ n: 1, group: 'A' }, { n: 2, group: 'A' }], remote: true });
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-clone-'));
  try {
    git(b, ['clone', '-q', a.remote, '.']);
    git(b, ['config', 'user.name', 'Other']);
    git(b, ['config', 'user.email', 'other@example.com']);
    assert.equal((await cli(b, ['build', 'next'])).stdout, 'P1/S-01\n');

    const started = await cli(a.root, ['build', 'start', 'P1/S-01']);
    assert.equal(started.code, 0, started.stderr);
    assert.equal(started.stderr, '');
    const [wt, branch] = started.stdout.trim().split('\n');
    assert.equal(git(a.remote, ['rev-parse', '--verify', `refs/heads/${branch}`]).length, 40);
    // The new branch tracks its own copy on origin, never main.
    assert.equal(git(wt, ['rev-parse', '--abbrev-ref', '@{u}']), `origin/${branch}`);

    const next = await cli(b, ['build', 'next']);
    assert.equal(next.code, 0, next.stderr);
    assert.ok(!next.stdout.includes('P1/S-01'), next.stdout);
    assert.equal(next.stdout, 'P1/S-02\n');
  } finally {
    fs.rmSync(b, { recursive: true, force: true });
    a.cleanup();
  }
});

// A clone of `remote` in its own temp directory, with an identity; `cleanup` removes it.
function cloneOf(remote) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-clone-'));
  git(dir, ['clone', '-q', remote, '.']);
  git(dir, ['config', 'user.name', 'Other']);
  git(dir, ['config', 'user.email', 'other@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return { root: dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('build start resumes a slice this clone started, at the state its worktree holds', async () => {
  const p = await building({ remote: true });
  try {
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const r = await cli(p.root, ['build', 'start', 'P1/S-01']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `resumed ${path.resolve(p.wt).split(path.sep).join('/')} at building\n`);
    // A resume makes no commit and pushes nothing.
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
  } finally {
    p.cleanup();
  }
});

test('build start refuses a slice another clone started', async () => {
  const a = project({ slices: [{ n: 1, group: 'A' }], remote: true });
  const b = cloneOf(a.remote);
  try {
    const started = await cli(a.root, ['build', 'start', 'P1/S-01']);
    assert.equal(started.code, 0, started.stderr);
    const r = await cli(b.root, ['build', 'start', 'P1/S-01']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /P1\/S-01 is already started in origin\/slice\/P1-S-01-thing-1; another clone holds it/);
    assert.equal(r.stdout, '');
  } finally {
    b.cleanup();
    a.cleanup();
  }
});

const quiet = { onWarning: () => {} };
const READ_HERE = /build next and build start read slice states from the checkout they run in; run them in the main checkout on main/;

test('next and start run only in the main checkout on the default branch', async () => {
  const p = project({ slices: [{ n: 1, group: 'A' }, { n: 2, group: 'A' }] });
  try {
    git(p.root, ['switch', '-q', '-c', 'feature']);
    for (const args of [['build', 'next'], ['build', 'start', 'P1/S-01']]) {
      const r = await cli(p.root, args);
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.stderr, READ_HERE);
      assert.match(r.stderr, /\(this one is on feature\)/);
    }
    git(p.root, ['switch', '-q', '--detach', 'main']);
    const detached = await cli(p.root, ['build', 'next']);
    assert.equal(detached.code, 1);
    assert.match(detached.stderr, /\(this one is on a detached HEAD\)/);

    git(p.root, ['switch', '-q', 'main']);
    const started = await cli(p.root, ['build', 'start', 'P1/S-01']);
    assert.equal(started.code, 0, started.stderr);
    const wt = started.stdout.split('\n')[0];
    const inside = await cli(wt, ['build', 'start', 'P1/S-02']);
    assert.equal(inside.code, 1);
    assert.match(inside.stderr, READ_HERE);
    assert.match(inside.stderr, /\(this one is on slice\/P1-S-01-thing-1\)/);
    assert.ok(!fs.existsSync(path.join(wt, '.worktrees')));
  } finally {
    p.cleanup();
  }
});

test('a default branch behind or ahead of origin is refused', async () => {
  const a = project({ slices: [{ n: 1, group: 'A' }, { n: 2, group: 'A' }], remote: true });
  const b = cloneOf(a.remote);
  const c = cloneOf(a.remote);
  try {
    // C merges S-01 on origin and deletes its branch; B has not pulled.
    setSliceState(c.root, 'P1/S-01', 'merged');
    git(c.root, ['add', '-A']);
    commit(c.root, 'merge S-01');
    git(c.root, ['push', '-q', 'origin', 'main']);
    for (const args of [['build', 'next'], ['build', 'start', 'P1/S-01']]) {
      const r = await cli(b.root, args);
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.stderr, /main is behind origin; pull first/);
    }
    assert.ok(!fs.existsSync(path.join(b.root, '.worktrees')));

    git(b.root, ['pull', '-q', '--ff-only']);
    assert.equal((await cli(b.root, ['build', 'next'])).stdout, 'P1/S-02\n');
    commit(b.root, 'local only');
    const ahead = await cli(b.root, ['build', 'next']);
    assert.equal(ahead.code, 1);
    assert.match(ahead.stderr, /main has commits origin does not; push or reset first/);
  } finally {
    c.cleanup();
    b.cleanup();
    a.cleanup();
  }
});

test('build start claims the slice with one commit on origin', async () => {
  const a = project({ slices: [{ n: 1, group: 'A' }], remote: true });
  try {
    const r = await cli(a.root, ['build', 'start', 'P1/S-01']);
    assert.equal(r.code, 0, r.stderr);
    const [wt, branch] = r.stdout.trim().split('\n');
    const head = git(wt, ['rev-parse', 'HEAD']);
    assert.equal(git(a.remote, ['rev-parse', `refs/heads/${branch}`]), head);
    assert.equal(git(wt, ['rev-parse', 'HEAD^']), git(a.root, ['rev-parse', 'origin/main']));
    assert.equal(git(wt, ['log', '-1', '--format=%s']), 'chore(slicekit): P1/S-01 started');
    assert.equal(parseTrailers(git(wt, ['log', '-1', '--format=%B'])).Slice, 'P1/S-01');
    assert.equal(git(wt, ['diff', '--name-only', 'HEAD^', 'HEAD']), '');
  } finally {
    a.cleanup();
  }
});

test('two clones starting one slice at once claim it once', async () => {
  // B checks origin after A has pushed and checked, so A kept the slice: B backs out whichever name
  // sorts first, or both would hold it ('other' sorts before 'thing-1', 'zzz' after).
  for (const descr of [undefined, 'other', 'zzz']) {
    const a = project({ slices: [{ n: 1, group: 'A' }], remote: true });
    const b = cloneOf(a.remote);
    try {
      let aStarted;
      const race = () => {
        aStarted = startSlice(a.root, loadConfig(a.root), 'P1/S-01', quiet);
      };
      assert.throws(
        () => startSlice(b.root, loadConfig(b.root), 'P1/S-01', { ...quiet, descr, beforePush: race }),
        (e) => e instanceof BuildError && e.code === 1 && /^P1\/S-01 was claimed by slice\/P1-S-01-thing-1 while starting$/.test(e.message),
        String(descr),
      );
      assert.equal(aStarted.branch, 'slice/P1-S-01-thing-1');
      // Only A's branch is on origin, at A's claim; B kept nothing.
      const heads = git(a.remote, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/slice/']);
      assert.equal(heads, `refs/heads/slice/P1-S-01-thing-1 ${git(aStarted.worktree, ['rev-parse', 'HEAD'])}`);
      assert.ok(!fs.existsSync(path.join(b.root, '.worktrees', 'P1-S-01')));
      assert.equal(git(b.root, ['branch', '--list', 'slice/*']), '');
      assert.equal(git(b.root, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree ')).length, 1);
    } finally {
      b.cleanup();
      a.cleanup();
    }
  }
});

test('a failed push takes the start back', async () => {
  const a = project({ slices: [{ n: 1, group: 'A' }], remote: true });
  const hook = path.join(a.remote, 'hooks', 'pre-receive');
  try {
    fs.writeFileSync(hook, '#!/bin/sh\necho refused by the test >&2\nexit 1\n', { mode: 0o755 });
    const r = await cli(a.root, ['build', 'start', 'P1/S-01']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /could not push slice\/P1-S-01-thing-1 .*; P1\/S-01 was not started/);
    assert.ok(!fs.existsSync(path.join(a.root, '.worktrees', 'P1-S-01')));
    assert.equal(git(a.root, ['branch', '--list', 'slice/*']), '');
    fs.rmSync(hook);
    const again = await cli(a.root, ['build', 'start', 'P1/S-01']);
    assert.equal(again.code, 0, again.stderr);
  } finally {
    a.cleanup();
  }
});

test('a failed fetch refuses next and start', async () => {
  const a = project({ slices: [{ n: 1, group: 'A' }], remote: true });
  try {
    git(a.root, ['remote', 'set-url', 'origin', path.join(os.tmpdir(), 'slicekit-no-such-remote.git')]);
    for (const args of [['build', 'next'], ['build', 'start', 'P1/S-01']]) {
      const r = await cli(a.root, args);
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.stderr, /git fetch/);
    }
    assert.ok(!fs.existsSync(path.join(a.root, '.worktrees')));
    assert.equal(git(a.root, ['branch', '--list', 'slice/*']), '');
  } finally {
    a.cleanup();
  }
});

test('findWorktree finds one, refuses none and two, and takes --worktree', async () => {
  const p = project({ slices: [{ n: 1, group: 'A' }, { n: 2, group: 'A' }] });
  try {
    const { worktree } = startSlice(p.root, loadConfig(p.root), 'P1/S-01', quiet);
    assert.equal(path.resolve(findWorktree(p.root, 'P1/S-01').path), path.resolve(worktree));
    assert.throws(
      () => findWorktree(p.root, 'P1/S-02'),
      (e) => e instanceof BuildError && e.code === 1 && e.message === 'no worktree holds P1/S-02; run slicekit build start P1/S-02',
    );
    const two = path.join(p.root, '.worktrees', 'two');
    git(p.root, ['worktree', 'add', '-q', '-b', 'slice/P1-S-01-two', two]);
    assert.throws(
      () => findWorktree(p.root, 'P1/S-01'),
      (e) => e instanceof BuildError && e.code === 2 && /^two worktrees hold P1\/S-01: .+, .+; pass --worktree$/.test(e.message),
    );
    const picked = findWorktree(p.root, 'P1/S-01', { worktree: '.worktrees/two' });
    assert.equal(picked.branch, 'slice/P1-S-01-two');
    assert.throws(() => findWorktree(p.root, 'P1/S-01', { worktree: '.' }), (e) => e instanceof BuildError && e.code === 1);
  } finally {
    p.cleanup();
  }
});

test('a local branch holds its slice', async () => {
  const p = project({ slices: [{ n: 1, group: 'A' }, { n: 2, group: 'A' }] });
  try {
    git(p.root, ['branch', 'slice/P1-S-01-elsewhere']);
    assert.equal((await cli(p.root, ['build', 'next'])).stdout, 'P1/S-02\n');
    const r = await cli(p.root, ['build', 'start', 'P1/S-01']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /P1\/S-01 is already started in slice\/P1-S-01-elsewhere/);
  } finally {
    p.cleanup();
  }
});

test('the groups of one step run in parallel', async () => {
  const p = project({ order: 'A; B, C', slices: [{ n: 1, group: 'A' }, { n: 2, group: 'B' }, { n: 3, group: 'C' }] });
  try {
    setSliceState(p.root, 'P1/S-01', 'released');
    setSliceState(p.root, 'P1/S-02', 'building');
    assert.equal((await cli(p.root, ['build', 'next'])).stdout, 'P1/S-03\n');
    const r = await cli(p.root, ['build', 'start', 'P1/S-03']);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    p.cleanup();
  }
});

test('a slice waits on an earlier phase', async () => {
  const p = project({
    phases: [
      { phase: 1, slices: [{ n: 1, group: 'A' }] },
      { phase: 2, slices: [{ n: 1, group: 'A' }] },
    ],
  });
  try {
    setSliceState(p.root, 'P1/S-01', 'draft-pr');
    const r = await cli(p.root, ['build', 'next']);
    assert.equal(r.code, 1);
    assert.ok(r.stdout.split('\n').includes('P2/S-01 waits on P1/S-01 (draft-pr)'), r.stdout);
    const s = await cli(p.root, ['build', 'start', 'P2/S-01']);
    assert.equal(s.code, 1);
    assert.match(s.stderr, /P2\/S-01 waits on P1\/S-01 \(draft-pr\)/);
    setSliceState(p.root, 'P1/S-01', 'merged');
    assert.equal((await cli(p.root, ['build', 'next'])).stdout, 'P2/S-01\n');
  } finally {
    p.cleanup();
  }
});

test('a bad branch name and a stray directory are refused', async () => {
  const p = project({ slices: [{ n: 1, group: 'A' }, { n: 2, group: 'A' }] });
  try {
    for (const descr of ['a..b', 'x.lock', 'has space', 'trail.']) {
      const r = await cli(p.root, ['build', 'start', 'P1/S-01', '--descr', descr]);
      assert.equal(r.code, 2, descr);
      assert.match(r.stderr, new RegExp(`branch name slice/P1-S-01-${descr.replace(/\./g, '\\.')} is not valid; pass --descr`));
    }
    const dir = path.join(p.root, '.worktrees', 'P1-S-02');
    fs.mkdirSync(dir, { recursive: true });
    const r = await cli(p.root, ['build', 'start', 'P1/S-02']);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`${dir} exists and holds no worktree of P1/S-02; remove it`), r.stderr);
  } finally {
    p.cleanup();
  }
});

test('uncommitted slice states or plan files are refused', async () => {
  const p = project({ slices: [{ n: 1, group: 'A' }, { n: 2, group: 'A' }] });
  const DIRTY = 'slicekit: uncommitted changes to slice states or plan files; commit or stash them first\n';
  try {
    write(p.root, '.slicekit/state/P1-S-01.json', `${JSON.stringify({ slice: 'P1/S-01', state: 'merged', history: [] })}\n`);
    for (const args of [['build', 'next'], ['build', 'start', 'P1/S-02']]) {
      const r = await cli(p.root, args);
      assert.equal(r.code, 1, args.join(' '));
      assert.equal(r.stderr, DIRTY);
    }
    fs.rmSync(path.join(p.root, '.slicekit', 'state'), { recursive: true });
    fs.appendFileSync(path.join(p.root, 'docs', 'phases', 'P1-x', 'P1.md'), '\nedited\n');
    const r = await cli(p.root, ['build', 'start', 'P1/S-01']);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, DIRTY);
    assert.ok(!fs.existsSync(path.join(p.root, '.worktrees')));
    git(p.root, ['checkout', '--', 'docs']);
    // Other uncommitted work does not stop a start.
    write(p.root, 'notes.txt', 'mine');
    assert.equal((await cli(p.root, ['build', 'next'])).stdout, 'P1/S-01\n');
  } finally {
    p.cleanup();
  }
});

const PASSING = "import { test } from 'node:test';\ntest('works', () => {});\n";
const FAILING = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('works', () => assert.equal(1, 2));\n";

test('tests that pass before the build are refused', async () => {
  const p = await startedWithTest(PASSING);
  try {
    const r = await cli(p.root, ['build', 'red', 'P1/S-01', '--tests', 'test/a.test.js']);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /the evaluation set must fail before the build/);
    assert.equal(stateIn(p.wt).state, 'todo');
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), p.claim);
    assert.match(git(p.wt, ['status', '--porcelain']), /\?\? test\//);
  } finally {
    p.cleanup();
  }
});

test('absolute and backslash test paths are stored relative', async () => {
  const p = await startedWithTest("import { test } from 'node:test';\ntest('another', () => {});\n");
  try {
    const abs = path.join(p.wt, 'test', 'a.test.js').replace(/\//g, '\\');
    // A test file that does not hold the evaluation row's name is refused before the run.
    const missing = await cli(p.root, ['build', 'red', 'P1/S-01', '--tests', abs]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /evaluation test "a\.test\.js » works" is not in the test files/);

    write(p.root, 'outside.test.js', FAILING);
    const outside = await cli(p.root, ['build', 'red', 'P1/S-01', '--tests', path.join(p.root, 'outside.test.js')]);
    assert.equal(outside.code, 2);
    assert.match(outside.stderr, /outside\.test\.js is outside the worktree/);
    assert.equal(stateIn(p.wt).state, 'todo');

    write(p.wt, 'test/a.test.js', FAILING);
    const r = await cli(p.root, ['build', 'red', 'P1/S-01', '--tests', abs]);
    assert.equal(r.code, 0, r.stderr);
    const [sha, moves] = r.stdout.trim().split('\n');
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.equal(moves, 'tests-red → building');

    const state = stateIn(p.wt);
    assert.equal(state.state, 'building');
    assert.deepEqual(state.frozenTests, ['test/a.test.js']);
    assert.equal(state.redCommit, sha);
    assert.deepEqual(state.history.map((h) => h.to), ['tests-red', 'building']);

    // The red commit holds the test file alone, on top of the claim; the bookkeeping follows it.
    assert.equal(git(p.wt, ['rev-parse', `${sha}^`]), p.claim);
    assert.equal(git(p.wt, ['diff', '--name-only', p.claim, sha]), 'test/a.test.js');
    const body = git(p.wt, ['log', '-1', '--format=%B', sha]);
    assert.match(body, /^test\(P1\/S-01\): evaluation set\n/);
    assert.match(body, /\nran: node --test → exit 1\n/);
    assert.equal(parseTrailers(body).Slice, 'P1/S-01');
    const after = git(p.wt, ['log', '--format=%s', `${sha}..HEAD`]).split('\n');
    assert.deepEqual(after, ['chore(slicekit): P1/S-01 building', 'chore(slicekit): P1/S-01 tests-red']);
    // Each bookkeeping commit carries the state file, and BUILD.md when its text changed, nothing else.
    for (const c of git(p.wt, ['rev-list', `${sha}..HEAD`]).split('\n')) {
      const touched = git(p.wt, ['diff-tree', '--no-commit-id', '--name-only', '-r', c]).split('\n');
      assert.ok(touched.includes('.slicekit/state/P1-S-01.json'), touched.join(', '));
      assert.ok(touched.every((f) => ['.slicekit/state/P1-S-01.json', 'BUILD.md'].includes(f)), touched.join(', '));
      assert.equal(parseTrailers(git(p.wt, ['log', '-1', '--format=%B', c])).Slice, 'P1/S-01');
    }
    assert.ok(git(p.wt, ['diff', '--name-only', sha, 'HEAD']).split('\n').includes('BUILD.md'));
    assert.equal(git(p.wt, ['status', '--porcelain']), '');

    const again = await cli(p.root, ['build', 'red', 'P1/S-01', '--tests', abs]);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /P1\/S-01 is building; red runs from todo/);
  } finally {
    p.cleanup();
  }
});

const NO_CHANGE = /test\/a\.test\.js have no change to commit; red needs the evaluation set as new or changed files/;

test('an evaluation test with no change since HEAD is refused unless HEAD is its red commit', async () => {
  // A failing test already on main: unchanged in the worktree, so the claim commit would become "red".
  const existing = await startedWithTest(undefined, { files: { 'test/a.test.js': FAILING } });
  try {
    const r = await red1(existing, 'test/a.test.js');
    assert.equal(r.code, 1);
    assert.match(r.stderr, NO_CHANGE);
    assert.equal(stateIn(existing.wt).state, 'todo');
  } finally {
    existing.cleanup();
  }
  // The tests committed by hand, then an unrelated commit on top: HEAD is not the red commit.
  const p = await startedWithTest(FAILING);
  try {
    commitIn(p.wt, 'test(P1/S-01): evaluation set');
    write(p.wt, 'src/t1.js', 'export const x = 1;\n');
    commitIn(p.wt, 'unrelated');
    const r = await red1(p, 'test/a.test.js');
    assert.equal(r.code, 1);
    assert.match(r.stderr, NO_CHANGE);
    assert.equal(stateIn(p.wt).state, 'todo');
    // HEAD holding exactly the listed tests under the evaluation-set subject is a re-run: accepted.
    git(p.wt, ['reset', '-q', '--hard', 'HEAD^']);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const again = await red1(p, 'test/a.test.js');
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout.split('\n')[0], head);
  } finally {
    p.cleanup();
  }
});

test('a test command that could not run is not red', async () => {
  for (const [command, extra] of [
    ['slicekit-no-such-command-for-red', {}],
    ['npm run tset', { 'package.json': `${JSON.stringify({ name: 'x', version: '1.0.0', scripts: { test: 'node --test' } })}\n` }],
  ]) {
    const p = await startedWithTest(FAILING, { test: command, files: extra });
    try {
      const r = await red1(p, 'test/a.test.js');
      assert.equal(r.code, 1, command);
      assert.match(r.stderr, new RegExp(`${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} could not run \\(exit \\d+\\): `), r.stderr);
      assert.equal(stateIn(p.wt).state, 'todo');
      assert.equal(git(p.wt, ['rev-parse', 'HEAD']), p.claim);
    } finally {
      p.cleanup();
    }
  }
});

test('runCommand reports a run that did not finish and summarises the totals', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-run-'));
  try {
    fs.writeFileSync(path.join(dir, 'out.js'), "console.log('# tests 3');\nconsole.log('# fail 1');\nconsole.log('# duration_ms 5');\nconsole.log('bye');\n");
    const r = runCommand(dir, 'node out.js');
    assert.equal(r.exit, 0);
    assert.equal(r.error, null);
    assert.equal(r.summary, '# fail 1');
    // A shell builtin, so no child outlives the killed shell.
    const big = runCommand(dir, 'echo output-longer-than-the-buffer-allows', { maxBuffer: 8 });
    assert.equal(typeof big.error, 'string');
    assert.match(big.error, /ENOBUFS/);
  } finally {
    // On win32 the shell's child can outlive the killed shell for a moment and hold the directory.
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('every listed file holds an evaluation test, and no kit file is one', async () => {
  const p = await startedWithTest(FAILING);
  try {
    write(p.wt, 'test/helper.js', 'export const h = 1;\n');
    const helper = await red1(p, 'test/a.test.js,test/helper.js');
    assert.equal(helper.code, 1);
    assert.match(helper.stderr, /test\/helper\.js holds no evaluation test/);
    for (const kit of ['.slicekit/config.json', 'docs/phases/P1-x/S-01-thing-1.md']) {
      const r = await red1(p, `test/a.test.js,${kit}`);
      assert.equal(r.code, 1, kit);
      assert.ok(r.stderr.includes(`${kit} is a kit file, not a test`), r.stderr);
    }
    assert.equal(stateIn(p.wt).state, 'todo');
  } finally {
    p.cleanup();
  }
});

test('the evaluation name must be a string in the test file', async () => {
  const p = await startedWithTest("import { test } from 'node:test';\n// works\ntest('other', () => { throw new Error('x'); });\n");
  try {
    const r = await red1(p, 'test/a.test.js');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /evaluation test "a\.test\.js » works" is not in the test files/);
  } finally {
    p.cleanup();
  }
});

test('a re-run after a refused bookkeeping commit finishes the move to building', async () => {
  const p = await startedWithTest(FAILING);
  const hooks = git(p.wt, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const hook = path.join(hooks, 'hooks', 'commit-msg');
  try {
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, '#!/bin/sh\nif grep -q "^chore(slicekit)" "$1"; then echo no bookkeeping >&2; exit 1; fi\nexit 0\n', { mode: 0o755 });
    const first = await red1(p, 'test/a.test.js');
    assert.equal(first.code, 1);
    assert.equal(stateIn(p.wt).state, 'tests-red');
    fs.rmSync(hook);
    const again = await red1(p, 'test/a.test.js');
    assert.equal(again.code, 0, again.stderr);
    const state = stateIn(p.wt);
    assert.equal(state.state, 'building');
    assert.equal(again.stdout.split('\n')[0], state.redCommit);
    assert.deepEqual(state.history.map((h) => h.to), ['tests-red', 'building']);
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
    assert.deepEqual(git(p.wt, ['log', '--format=%s', `${state.redCommit}..HEAD`]).split('\n'), [
      'chore(slicekit): P1/S-01 building',
      'chore(slicekit): P1/S-01 tests-red',
    ]);
  } finally {
    p.cleanup();
  }
});

const SLICE_FILE = 'docs/phases/P1-x/S-01-thing-1.md';

test('a change to a frozen test is refused at commit', async () => {
  const p = await building();
  try {
    write(p.wt, 'src/t1.js', 'export const x = () => 2;\n');
    fs.appendFileSync(path.join(p.wt, 'test', 'a.test.js'), "test('extra', () => {});\n");
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const refused = await commitWorkCli(p, '--message', 'feat(P1/S-01): x');
    assert.equal(refused.code, 1);
    assert.ok(
      refused.stderr.includes(`frozen test test/a.test.js changed since ${p.redSha.slice(0, 7)}; amend the slice file to change the evaluation set`),
      refused.stderr,
    );
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);

    // amend needs the human's edit to the slice file first.
    const early = await cli(p.root, ['build', 'amend', 'P1/S-01', '--test', 'test/a.test.js', '--reason', 'r']);
    assert.equal(early.code, 1);
    assert.match(early.stderr, /amend the slice file first; it has no change/);
    const notFrozen = await cli(p.root, ['build', 'amend', 'P1/S-01', '--test', 'src/t1.js', '--reason', 'r']);
    assert.equal(notFrozen.code, 1);

    fs.appendFileSync(path.join(p.wt, ...SLICE_FILE.split('/')), '\nThe extra test checks nothing yet.\n');
    const amended = await cli(p.root, ['build', 'amend', 'P1/S-01', '--test', 'test/a.test.js', '--reason', 'r']);
    assert.equal(amended.code, 0, amended.stderr);
    assert.equal(amended.stdout, 'unfroze test/a.test.js\n');
    assert.deepEqual(stateIn(p.wt).unfrozen, ['test/a.test.js']);
    assert.deepEqual(git(p.wt, ['log', '-2', '--format=%s']).split('\n'), [
      'chore(slicekit): P1/S-01 unfreeze test/a.test.js',
      'docs(P1/S-01): amend evaluation set',
    ]);
    assert.match(git(p.wt, ['log', '-1', '--format=%B', 'HEAD^']), /\n\nr\n\nSlice: P1\/S-01$/);

    const done = await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green');
    assert.equal(done.code, 0, done.stderr);
    assert.match(done.stdout, /^[0-9a-f]{7} exit 0\n$/);
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
    const body = git(p.wt, ['log', '-1', '--format=%B']);
    assert.match(body, /^feat\(P1\/S-01\): x\n\nran: node --test → exit 0\n\nSlice: P1\/S-01$/);
    assert.deepEqual(git(p.wt, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n').sort(), ['src/t1.js', 'test/a.test.js']);
    assert.equal((await commitWorkCli(p, '--message', 'again')).stdout, 'nothing to commit\n');
  } finally {
    p.cleanup();
  }
});

test('build commit refuses a red run under --require-green, a run that could not run, and kit files', async () => {
  const p = await building();
  try {
    write(p.wt, 'src/t1.js', 'export const x = () => 3;\n');
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const red = await commitWorkCli(p, '--message', 'wip', '--require-green');
    assert.equal(red.code, 1);
    assert.match(red.stderr, /tests fail \(exit 1\): /);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);

    // Without --require-green a red run is committed, with its exit in the message.
    const wip = await commitWorkCli(p, '--message', 'wip');
    assert.equal(wip.code, 0, wip.stderr);
    assert.match(wip.stdout, /^[0-9a-f]{7} exit 1\n$/);

    // A frozen test committed by hand is still a change since the red commit.
    fs.appendFileSync(path.join(p.wt, 'test', 'a.test.js'), '// later\n');
    git(p.wt, ['add', 'test/a.test.js']);
    git(p.wt, ['commit', '-q', '-m', 'by hand']);
    const byHand = await commitWorkCli(p, '--message', 'x');
    assert.equal(byHand.code, 1);
    assert.match(byHand.stderr, /frozen test test\/a\.test\.js changed since/);
    git(p.wt, ['reset', '-q', '--hard', 'HEAD^']);

    for (const kit of ['BUILD.md', '.slicekit/state/P1-S-01.json', SLICE_FILE]) {
      fs.appendFileSync(path.join(p.wt, ...kit.split('/')), kit.endsWith('.json') ? ' ' : '\nx\n');
      const r = await commitWorkCli(p, '--message', 'x');
      assert.equal(r.code, 1, kit);
      assert.ok(r.stderr.includes(`${kit} is a kit file; build commit does not commit it`), r.stderr);
      git(p.wt, ['checkout', '--', kit]);
    }

    // The config the command reads is the main checkout's; the worktree's copy stays as committed.
    const cfgFile = path.join(p.root, '.slicekit', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    cfg.commands.test = 'slicekit-no-such-command-for-commit';
    fs.writeFileSync(cfgFile, `${JSON.stringify(cfg, null, 2)}\n`);
    write(p.wt, 'src/t1.js', 'export const x = () => 2;\n');
    const notRun = await commitWorkCli(p, '--message', 'x');
    assert.equal(notRun.code, 1);
    assert.match(notRun.stderr, /slicekit-no-such-command-for-commit could not run \(exit \d+\): /);
  } finally {
    p.cleanup();
  }
});

test('every commit on the slice branch carries the Slice trailer', async () => {
  const p = await building();
  try {
    write(p.wt, 'src/t1.js', 'export const x = () => 3;\n');
    assert.equal((await commitWorkCli(p, '--message', 'feat(P1/S-01): first try')).code, 0);
    fs.appendFileSync(path.join(p.wt, 'test', 'a.test.js'), "test('extra', () => {});\n");
    fs.appendFileSync(path.join(p.wt, ...SLICE_FILE.split('/')), '\nAmended.\n');
    assert.equal((await cli(p.root, ['build', 'amend', 'P1/S-01', '--test', 'test/a.test.js', '--reason', 'why'])).code, 0);
    write(p.wt, 'src/t1.js', 'export const x = () => 2;\n');
    assert.equal((await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green')).code, 0);

    const base = git(p.wt, ['merge-base', 'HEAD', 'main']);
    const commits = commitsOnBranch(p.wt, base);
    assert.ok(commits.length >= 8, String(commits.length));
    for (const c of commits) assert.equal(c.trailers.Slice, 'P1/S-01', `${c.subject}\n${c.body}`);
  } finally {
    p.cleanup();
  }
});

const amendCli = (p, t, reason = 'r') => cli(p.root, ['build', 'amend', 'P1/S-01', '--test', t, '--reason', reason]);
const WEAK = "import { test } from 'node:test';\ntest('works', () => {});\n";
const editSlice = (p, text = '\nAmended.\n') => fs.appendFileSync(path.join(p.wt, ...SLICE_FILE.split('/')), text);

test('a frozen test hidden from git or changed on disk is refused at commit', async () => {
  const p = await building();
  try {
    write(p.wt, 'src/t1.js', 'export const x = () => 99;\n');
    for (const flag of ['--skip-worktree', '--assume-unchanged']) {
      git(p.wt, ['update-index', flag, 'test/a.test.js']);
      fs.writeFileSync(path.join(p.wt, 'test', 'a.test.js'), WEAK);
      const r = await commitWorkCli(p, '--message', 'x', '--require-green');
      assert.equal(r.code, 1, flag);
      assert.match(r.stderr, /frozen test test\/a\.test\.js /, flag);
      git(p.wt, ['update-index', flag.replace('--', '--no-'), 'test/a.test.js']);
      git(p.wt, ['checkout', '--', 'test/a.test.js']);
    }
    // Deleted, or renamed away: a missing frozen test is a change.
    fs.renameSync(path.join(p.wt, 'test', 'a.test.js'), path.join(p.wt, 'test', 'b.test.js'));
    const renamed = await commitWorkCli(p, '--message', 'x');
    assert.equal(renamed.code, 1);
    assert.match(renamed.stderr, /frozen test test\/a\.test\.js changed since/);
    assert.equal(git(p.wt, ['log', '-1', '--format=%s']), 'chore(slicekit): P1/S-01 building');
  } finally {
    p.cleanup();
  }
});

test('a hand commit cannot unfreeze a test or change the evaluation set', async () => {
  const p = await building();
  try {
    const sf = path.join(p.wt, '.slicekit', 'state', 'P1-S-01.json');
    const st = JSON.parse(fs.readFileSync(sf, 'utf8'));
    fs.writeFileSync(sf, `${JSON.stringify({ ...st, unfrozen: ['test/a.test.js'] }, null, 2)}\n`);
    commitIn(p.wt, 'by hand state');
    const forged = git(p.wt, ['rev-parse', '--short=7', 'HEAD']);
    fs.writeFileSync(path.join(p.wt, 'test', 'a.test.js'), WEAK);
    write(p.wt, 'src/t1.js', GREEN);
    const r = await commitWorkCli(p, '--message', 'weakened');
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`.slicekit/state/P1-S-01.json was changed in ${forged} outside the kit; only build commands write it`), r.stderr);

    git(p.wt, ['reset', '-q', '--hard', 'HEAD^']);
    editSlice(p, '\nhand\n');
    commitIn(p.wt, 'by hand slice');
    const sliceSha = git(p.wt, ['rev-parse', '--short=7', 'HEAD']);
    write(p.wt, 'src/t1.js', GREEN);
    const s = await commitWorkCli(p, '--message', 'y');
    assert.equal(s.code, 1);
    assert.ok(s.stderr.includes(`${SLICE_FILE} was changed in ${sliceSha} outside the kit; only build commands write it`), s.stderr);
  } finally {
    p.cleanup();
  }
});

test('build commit refuses the hooks and the Claude settings', async () => {
  const p = await building();
  try {
    write(p.wt, 'src/t1.js', GREEN);
    for (const kit of ['.githooks/pre-commit', '.claude/settings.json']) {
      write(p.wt, kit, 'x\n');
      const r = await commitWorkCli(p, '--message', 'x');
      assert.equal(r.code, 1, kit);
      assert.ok(r.stderr.includes(`${kit} is a kit file; build commit does not commit it`), r.stderr);
      fs.rmSync(path.join(p.wt, ...kit.split('/')));
    }
  } finally {
    p.cleanup();
  }
});

test('amend takes any spelling of the test and records the amendment', async () => {
  const p = await building();
  try {
    editSlice(p);
    const r = await amendCli(p, path.join(p.wt, 'test', 'a.test.js').replace(/\//g, '\\'), 'the row was wrong');
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'unfroze test/a.test.js\n');
    const last = stateIn(p.wt).history.at(-1);
    assert.deepEqual(last.evidence, {
      unfreeze: 'test/a.test.js',
      amendCommit: git(p.wt, ['rev-parse', 'HEAD^']),
      reason: 'the row was wrong',
    });
  } finally {
    p.cleanup();
  }
});

test('an amend that stopped part way finishes on a re-run', async () => {
  // The state lock is busy while unfreeze runs: the slice file is committed, nothing is unfrozen.
  const p = await building();
  try {
    editSlice(p);
    const lock = path.join(p.wt, '.slicekit', 'state', 'P1-S-01.json.lock');
    fs.writeFileSync(lock, String(process.pid));
    const busy = await amendCli(p, 'test/a.test.js');
    assert.equal(busy.code, 1);
    assert.equal(git(p.wt, ['log', '-1', '--format=%s']), 'docs(P1/S-01): amend evaluation set');
    assert.deepEqual(stateIn(p.wt).unfrozen, []);
    fs.rmSync(lock);
    const again = await amendCli(p, 'test/a.test.js');
    assert.equal(again.code, 0, again.stderr);
    assert.deepEqual(stateIn(p.wt).unfrozen, ['test/a.test.js']);
    assert.deepEqual(git(p.wt, ['log', '-2', '--format=%s']).split('\n'), [
      'chore(slicekit): P1/S-01 unfreeze test/a.test.js',
      'docs(P1/S-01): amend evaluation set',
    ]);
  } finally {
    p.cleanup();
  }
  // The bookkeeping commit is refused by a hook: the state says unfrozen, but nothing records it.
  const q = await building();
  const hook = path.join(git(q.wt, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'hooks', 'commit-msg');
  try {
    editSlice(q);
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, '#!/bin/sh\nif grep -q "^chore(slicekit)" "$1"; then exit 1; fi\nexit 0\n', { mode: 0o755 });
    const refused = await amendCli(q, 'test/a.test.js');
    assert.equal(refused.code, 1);
    assert.deepEqual(stateIn(q.wt).unfrozen, ['test/a.test.js']);
    fs.rmSync(hook);
    const again = await amendCli(q, 'test/a.test.js');
    assert.equal(again.code, 0, again.stderr);
    assert.equal(git(q.wt, ['status', '--porcelain']), '');
    assert.equal(git(q.wt, ['log', '-1', '--format=%s']), 'chore(slicekit): P1/S-01 unfreeze test/a.test.js');
    // Now it is done: a third run is refused.
    const third = await amendCli(q, 'test/a.test.js');
    assert.equal(third.code, 1);
    assert.match(third.stderr, /test\/a\.test\.js is already unfrozen/);
  } finally {
    q.cleanup();
  }
});

const SLICE_BRANCH = 'refs/heads/slice/P1-S-01-thing-1';

test('the draft pull request body carries every section', async () => {
  const p = await green();
  try {
    const r = await p.pr();
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `#1 https://example.test/pull/1\nverdict ${vpath(p.root, 'P1-S-01-r1.md')}\n`);
    const made = JSON.parse(fs.readFileSync(path.join(p.host, 'pr-1.json'), 'utf8'));
    assert.equal(made.isDraft, true);
    assert.equal(made.title, '[P1/S-01] Thing 1');
    assert.equal(made.headRefName, 'slice/P1-S-01-thing-1');
    assert.equal(made.baseRefName, 'main');
    assert.deepEqual(prBodyProblems(made.title, made.body, loadConfig(p.root)), []);
    assert.match(made.body, /^## \[P1\/S-01\] Thing 1\n\*\*Done when:\*\* 1\. It works\.\n/);
    assert.match(made.body, /\n\*\*Proof:\*\* `node --test` → \S*\s?pass 1 · \S*\s?fail 0 · CI: pending\n/);
    assert.match(made.body, /\n\*\*Decisions:\*\* x returns 2\n/);
    assert.match(
      made.body,
      /\n\*\*Runbook:\*\* no operational change: the slice touches no configuration, infrastructure, migration, alert, queue or integration\n/,
    );
    assert.match(made.body, /\n\*\*Infra \/ migration:\*\* none\n\*\*Try it:\*\* 1\. Run the tests\. 2\. Call x\(\)\. 3\. See 2\.\n/);
    assert.match(
      made.body,
      /\n\*\*Reviewer blocked:\*\* nothing\n\*\*Should-haves declined:\*\* none\n\*\*Skipped \/ not checked:\*\* Windows paths were not tried\.\n$/,
    );

    const st = stateIn(p.wt);
    assert.equal(st.state, 'draft-pr');
    assert.equal(st.pr.number, 1);
    assert.equal(st.pr.url, 'https://example.test/pull/1');
    const last = st.history.at(-1);
    assert.equal(last.evidence.testExit, 0);
    assert.equal(last.evidence.checkExit, 0);
    // The recorded head is the one pushed before the bookkeeping commit, which reached origin too.
    assert.equal(st.pr.headSha, git(p.wt, ['rev-parse', 'HEAD^']));
    assert.equal(git(p.wt, ['log', '-1', '--format=%s']), 'chore(slicekit): P1/S-01 draft-pr');
    assert.equal(git(p.remote, ['rev-parse', SLICE_BRANCH]), git(p.wt, ['rev-parse', 'HEAD']));
    assert.equal(git(p.wt, ['status', '--porcelain']), '');

    // At draft-pr a re-run records nothing and updates the body, keeping what review wrote there.
    const live = made.body
      .replace('**Reviewer blocked:** nothing', '**Reviewer blocked:** B-1 fixed by the guard')
      .replace('**Should-haves declined:** none', '**Should-haves declined:** https://example.test/issues/4');
    fs.writeFileSync(path.join(p.host, 'pr-1.json'), `${JSON.stringify({ ...made, body: live }, null, 2)}\n`);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const again = await p.pr();
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, `#1 https://example.test/pull/1\nverdict ${vpath(p.root, 'P1-S-01-r1.md')}\n`);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
    assert.equal(stateIn(p.wt).history.length, st.history.length);
    const after = JSON.parse(fs.readFileSync(path.join(p.host, 'pr-1.json'), 'utf8')).body;
    assert.match(after, /\n\*\*Reviewer blocked:\*\* B-1 fixed by the guard\n\*\*Should-haves declined:\*\* https:\/\/example\.test\/issues\/4\n/);
    assert.deepEqual(prCalls(p.host).map((c) => c.op), ['openPullRequest', 'updatePullRequestBody']);
  } finally {
    p.cleanup();
  }
});

test('a re-run after a failed open opens the pull request once', async () => {
  const p = await green();
  try {
    fs.writeFileSync(path.join(p.host, 'pr-create-error.txt'), 'GraphQL: something went wrong\n');
    const failed = await p.pr();
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /gh pr create failed/);
    // The push happened; the state did not move.
    assert.equal(git(p.remote, ['rev-parse', SLICE_BRANCH]), git(p.wt, ['rev-parse', 'HEAD']));
    assert.equal(stateIn(p.wt).state, 'building');

    fs.rmSync(path.join(p.host, 'pr-create-error.txt'));
    const again = await p.pr();
    assert.equal(again.code, 0, again.stderr);
    assert.equal(prCalls(p.host).filter((c) => c.op === 'openPullRequest').length, 1);
    const st = stateIn(p.wt);
    assert.equal(st.state, 'draft-pr');
    assert.equal(st.history.filter((h) => h.to === 'draft-pr').length, 1);
  } finally {
    p.cleanup();
  }
});

test('build pr refuses before any push: notes, a dirty worktree, a failing command, the runbook, check', async () => {
  const p = await green();
  try {
    const pushed = () => git(p.remote, ['rev-parse', SLICE_BRANCH]);
    const before = pushed();
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const untouched = (at = head) => {
      assert.equal(pushed(), before);
      assert.equal(git(p.wt, ['rev-parse', 'HEAD']), at);
      assert.equal(stateIn(p.wt).state, 'building');
      assert.deepEqual(prCalls(p.host), []);
    };

    fs.writeFileSync(p.notes, JSON.stringify({ tryIt: ['one', 'two'], skipped: 'x' }));
    const twoSteps = await p.pr();
    assert.equal(twoSteps.code, 2);
    assert.match(twoSteps.stderr, /notes need tryIt \(three steps\) and skipped/);
    // A field of the wrong type is named, with the type it needs.
    assert.match(twoSteps.stderr, /notes\.tryIt must be a list of exactly three non-empty strings/);
    fs.writeFileSync(p.notes, JSON.stringify({ tryIt: ['a', 'b', 'c'], skipped: ['Skipped: x', 'Not checked: y'] }));
    const listed = await p.pr();
    assert.equal(listed.code, 2);
    assert.match(listed.stderr, /notes\.skipped must be one non-empty string/);
    fs.writeFileSync(p.notes, JSON.stringify({ tryIt: ['a', 'b', 'c'] }));
    assert.equal((await p.pr()).code, 2);
    untouched();
    fs.writeFileSync(p.notes, JSON.stringify({ tryIt: ['a', 'b', 'c'], skipped: 'nothing else was tried' }));

    // An uncommitted change is not what the commands would vouch for.
    write(p.wt, 'src/t1.js', 'export const x = () => 5;\n');
    const dirty = await p.pr();
    assert.equal(dirty.code, 1);
    assert.match(dirty.stderr, /uncommitted changes/);
    untouched();
    git(p.wt, ['checkout', '--', 'src/t1.js']);

    // A failing lint command, and a build command that cannot run.
    const cfgFile = path.join(p.root, '.slicekit', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    const withCommands = (extra) => fs.writeFileSync(cfgFile, `${JSON.stringify({ ...cfg, commands: { ...cfg.commands, ...extra } }, null, 2)}\n`);
    withCommands({ lint: 'node -e "console.log(2 + 1 + \' problems\'); process.exit(3)"' });
    const lint = await p.pr();
    assert.equal(lint.code, 1);
    assert.match(lint.stderr, /lint failed \(exit 3\): 3 problems/);
    untouched();
    withCommands({ build: 'slicekit-no-such-build-command' });
    const notRun = await p.pr();
    assert.equal(notRun.code, 1);
    assert.match(notRun.stderr, /slicekit-no-such-build-command could not run/);
    untouched();
    fs.writeFileSync(cfgFile, `${JSON.stringify(cfg, null, 2)}\n`);

    // A runbook slice must change the runbook or say why it need not.
    const sliceFile = path.join(p.wt, ...SLICE_FILE.split('/'));
    fs.writeFileSync(sliceFile, fs.readFileSync(sliceFile, 'utf8').replace('runbook: no', 'runbook: yes'));
    commitIn(p.wt, 'runbook flag');
    const flagged = git(p.wt, ['rev-parse', 'HEAD']);
    const runbook = await p.pr();
    assert.equal(runbook.code, 1);
    assert.ok(
      runbook.stderr.includes('the slice touches operations; change the runbook or give notes.runbook "no operational change: <reason>"'),
      runbook.stderr,
    );
    untouched(flagged);
    git(p.wt, ['reset', '-q', '--hard', head]);

    // A check finding.
    write(p.wt, 'docs/phases/P1-x/S-02-broken.md', '---\nslice: P1/S-01\n---\n');
    commitIn(p.wt, 'broken plan');
    const broken = git(p.wt, ['rev-parse', 'HEAD']);
    const checked = await p.pr();
    assert.equal(checked.code, 1);
    assert.match(checked.stderr, /slicekit check failed/);
    untouched(broken);
  } finally {
    p.cleanup();
  }
});

test('build pr after a verdict refuses a head with nothing new since review', async () => {
  const p = await green();
  try {
    assert.equal((await p.pr()).code, 0);
    write(p.wt, '.slicekit/reviews/P1-S-01-r1.md', '# Verdict\n\nNo blockers.\n');
    commitIn(p.wt, 'chore(slicekit): P1/S-01 verdict round 1\n\nSlice: P1/S-01');
    recordState(p.wt, loadConfig(p.root), 'P1/S-01', 'in-review', {
      verdict: { round: 1, blockers: 0, path: '.slicekit/reviews/P1-S-01-r1.md' },
    });
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const pushed = git(p.remote, ['rev-parse', SLICE_BRANCH]);
    const before = stateIn(p.wt);
    const again = await p.pr();
    assert.equal(again.code, 1);
    assert.match(again.stderr, /nothing new since review/);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
    assert.equal(git(p.remote, ['rev-parse', SLICE_BRANCH]), pushed);
    assert.deepEqual(stateIn(p.wt), before);
    assert.equal(before.state, 'in-review');
  } finally {
    p.cleanup();
  }
});

test('build pr finishes a draft-pr recording whose bookkeeping commit was undone, staged or not', async () => {
  for (const staged of [false, true]) {
    const p = await green();
    try {
      assert.equal((await p.pr()).code, 0);
      const recorded = stateIn(p.wt).pr.headSha;
      git(p.wt, ['reset', '-q', ...(staged ? ['--soft'] : []), 'HEAD^']);
      git(p.wt, ['push', '-q', '--force', 'origin', `HEAD:${SLICE_BRANCH}`]);
      assert.notEqual(git(p.wt, ['status', '--porcelain']), '');
      const again = await p.pr();
      assert.equal(again.code, 0, `${staged}: ${again.stderr}`);
      assert.equal(git(p.wt, ['status', '--porcelain']), '');
      assert.equal(git(p.remote, ['rev-parse', SLICE_BRANCH]), git(p.wt, ['rev-parse', 'HEAD']));
      assert.equal(git(p.wt, ['rev-parse', 'HEAD^']), recorded);
      assert.equal(stateIn(p.wt).history.filter((h) => h.to === 'draft-pr').length, 1);
    } finally {
      p.cleanup();
    }
  }
});

test('build pr refuses a worktree behind its branch on origin', async () => {
  const p = await green();
  const other = cloneOf(p.remote);
  try {
    git(other.root, ['switch', '-q', 'slice/P1-S-01-thing-1']);
    git(other.root, ['commit', '-q', '--allow-empty', '-m', 'elsewhere\n\nSlice: P1/S-01']);
    git(other.root, ['push', '-q', 'origin', 'slice/P1-S-01-thing-1']);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const r = await p.pr();
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'slicekit: slice/P1-S-01-thing-1 is 1 commit behind origin; run slicekit build sync P1/S-01\n');
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
    assert.equal(stateIn(p.wt).state, 'building');
    assert.deepEqual(prCalls(p.host), []);
  } finally {
    other.cleanup();
    p.cleanup();
  }
});

// ---- Task 5: the procedure, the developer brief, examples/backend ----

const KIT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXAMPLE = path.join(KIT_ROOT, 'examples', 'backend');
// The hook command the README tells a reader to pass: this checkout's bin, through node.
const KIT_CLI = `node "${binPath.replace(/\\/g, '/')}"`;
const exampleFile = (rel) => fs.readFileSync(path.join(EXAMPLE, ...rel.split('/')), 'utf8');

test('init on a copy of examples/backend prints no hook warning', () => {
  assert.equal(Object.hasOwn(JSON.parse(exampleFile('.slicekit/config.json')), 'cli'), false);
  const repo = makeRepo();
  try {
    fs.cpSync(EXAMPLE, repo.root, { recursive: true });
    const init = runCli(['init', '--shape', 'backend', '--cli', KIT_CLI], { cwd: repo.root, shim: false });
    assert.equal(init.code, 0, init.stderr);
    assert.equal(init.stderr, '');
    assert.equal(loadConfig(repo.root).cli, KIT_CLI);
  } finally {
    repo.cleanup();
  }
});

// The README's steps, then the procedure's steps 1 to 5 in the forms the procedure gives them, with
// this test standing in for the developer and the human.
test('examples/backend goes from todo to draft-pr', async () => {
  const repo = makeRepo();
  const origin = makeRemote(repo.root);
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-host-'));
  // The session's scratch directory, outside the repository, where the procedure puts the notes.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-scratch-'));
  try {
    const { root } = repo;
    fs.cpSync(EXAMPLE, root, { recursive: true });
    const init = runCli(['init', '--shape', 'backend', '--cli', KIT_CLI], { cwd: root, shim: false });
    assert.equal(init.code, 0, init.stderr);
    // init adds the kit's layout around the example's files and keeps them as they were.
    for (const rel of ['docs/spec/01-greeting.md', 'docs/spec/gaps.md', 'docs/spec/stack.md', 'docs/decisions.md', 'docs/runbook.md', 'docs/intake/2026-10-26-greeting.md', 'docs/phases/P1-greeting/P1.md', 'docs/phases/P1-greeting/S-01-greet.md']) {
      assert.equal(fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8'), exampleFile(rel), rel);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.slicekit', 'config.json'), 'utf8')), {
      ...JSON.parse(exampleFile('.slicekit/config.json')),
      cli: KIT_CLI,
    });
    assert.ok(fs.existsSync(path.join(root, 'docs', 'runbook.md')));
    const status = runCli(['status', '--write'], { cwd: root, shim: false });
    assert.equal(status.code, 0, status.stderr);
    commitAll(root, 'the example, with the kit installed');
    git(root, ['push', '-q', 'origin', 'main']);
    // main is green before any slice starts.
    const onMain = runCli(['check'], { cwd: root, shim: false });
    assert.equal(onMain.code, 0, onMain.stdout + onMain.stderr);
    // The example walked the real pipeline: intake, clarify, spec, gap scan, stack and plan are done.
    const stage = await cli(root, ['stage', 'require', 'plan']);
    assert.equal(stage.code, 0, stage.stderr);
    assert.equal(stage.stdout, 'ready: plan\n');

    // Step 1.
    const next = await cli(root, ['build', 'next']);
    assert.equal(next.code, 0, next.stderr);
    assert.equal(next.stdout, 'P1/S-01\n');
    const started = await cli(root, ['build', 'start', 'P1/S-01']);
    assert.equal(started.code, 0, started.stderr);
    const wt = started.stdout.split('\n')[0];
    const at = ['--worktree', wt];

    // Step 2: the developer's whole prompt names the worktree.
    const brief = await cli(root, ['instructions', 'developer', 'P1/S-01', ...at]);
    assert.equal(brief.code, 0, brief.stderr);
    assert.match(brief.stdout, /^## Where$/m);
    assert.ok(brief.stdout.includes(path.resolve(wt).split(path.sep).join('/')), brief.stdout);
    const testFile = (pattern) =>
      `// REQ-1.1\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from '../src/greet.js';\ntest('refuses an empty name', () => assert.throws(() => greet(''), /${pattern}/));\n`;
    write(wt, 'test/greet.test.js', "// REQ-1.1\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from '../src/greet.js';\ntest('greets a name', () => assert.equal(greet('Ada'), 'Hello, Ada!'));\n");
    write(wt, 'test/greet-empty.test.js', testFile('name required'));

    // Step 3: the developer's `tests:` paths, joined by commas.
    const red = await cli(root, ['build', 'red', 'P1/S-01', '--tests', 'test/greet.test.js,test/greet-empty.test.js', ...at]);
    assert.equal(red.code, 0, red.stderr);
    assert.equal(red.stdout.split('\n')[1], 'tests-red → building');
    // A session that died here starts again with build start, which resumes at the worktree's state.
    const resumed = await cli(root, ['build', 'start', 'P1/S-01']);
    assert.equal(resumed.code, 0, resumed.stderr);
    assert.equal(resumed.stdout, `resumed ${wt} at building\n`);

    // Step 4: the code, then an amendment the human approved: the negative test expects the wrong
    // message. The row stays the same, so the amendment is a note under it in the worktree's slice file.
    write(wt, 'src/greet.js', "export function greet(name) {\n  if (!name) throw new Error('a name is required');\n  return `Hello, ${name}!`;\n}\n");
    // The checkout may have CRLF line ends.
    const row = /(\| `greet-empty\.test\.js » refuses an empty name` \| negative \| REQ-1\.1 \|)(\r?\n)/;
    const sliceFile = path.join(wt, 'docs', 'phases', 'P1-greeting', 'S-01-greet.md');
    const before = fs.readFileSync(sliceFile, 'utf8');
    assert.match(before, row);
    fs.writeFileSync(sliceFile, before.replace(row, '$1$2$2Amended: `test/greet-empty.test.js` expects the message REQ-1.1 states, "a name is required".$2'));
    const amended = await cli(root, ['build', 'amend', 'P1/S-01', '--test', 'test/greet-empty.test.js', '--reason', 'the test expected the wrong message', ...at]);
    assert.equal(amended.code, 0, amended.stderr);
    write(wt, 'test/greet-empty.test.js', testFile('a name is required'));
    const work = await cli(root, ['build', 'commit', 'P1/S-01', '--message', 'feat(P1/S-01): greet a name', ...at]);
    assert.equal(work.code, 0, work.stderr);
    assert.match(work.stdout, /^[0-9a-f]{7} exit 0\n$/);

    // Step 5: everything is committed, so the green run has nothing to commit, which is success.
    const done = await cli(root, ['build', 'commit', 'P1/S-01', '--message', 'feat(P1/S-01): green', '--require-green', ...at]);
    assert.equal(done.code, 0, done.stderr);
    assert.equal(done.stdout, 'nothing to commit\n');
    const notes = path.join(scratch, 'slicekit-notes-P1-S-01.json');
    fs.writeFileSync(
      notes,
      JSON.stringify({ tryIt: ['Run npm test.', "Call greet('Ada').", 'See Hello, Ada!.'], skipped: 'Names with spaces were not tried.' }),
    );
    const pr = await cli(root, ['build', 'pr', 'P1/S-01', '--notes', notes, ...at], { ...process.env, SLICEKIT_GITHOST_FIXTURE: host });
    assert.equal(pr.code, 0, pr.stderr);
    assert.equal(pr.stdout, `#1 https://example.test/pull/1\nverdict ${vpath(root, 'P1-S-01-r1.md')}\n`);

    assert.equal(stateIn(wt).state, 'draft-pr');
    const made = fs.readdirSync(host).filter((f) => /^pr-\d+\.json$/.test(f));
    assert.deepEqual(made, ['pr-1.json']);
    const body = JSON.parse(fs.readFileSync(path.join(host, 'pr-1.json'), 'utf8'));
    assert.equal(body.isDraft, true);
    assert.equal(body.title, '[P1/S-01] Greet a name');

    const checked = runCli(['check'], { cwd: wt, shim: false });
    assert.equal(checked.code, 0, checked.stdout + checked.stderr);
    assert.match(checked.stdout, /\b0 findings\b/);
  } finally {
    fs.rmSync(host, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    origin.cleanup();
    repo.cleanup();
  }
});

test('the procedure and the developer brief pass the brief lint', () => {
  const procedure = fs.readFileSync(path.join(TEMPLATES, 'commands', 'build.md'), 'utf8').replace(/\r\n/g, '\n');
  const brief = fs.readFileSync(path.join(TEMPLATES, 'agents', 'developer.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.deepEqual(briefProblems(procedure, { kind: 'command' }), []);
  assert.deepEqual(briefProblems(brief, { kind: 'agent' }), []);
  for (const sub of ['next', 'start', 'red', 'commit', 'amend', 'pr']) assert.ok(procedure.includes(`{{cli}} build ${sub}`), sub);
  assert.ok(procedure.includes('{{cli}} instructions developer'), procedure);
  assert.ok(procedure.includes('tests: <a>, <b>'), procedure);
  for (const h of ['## Tests first', '## Then code']) assert.match(brief, new RegExp(`^${h}$`, 'm'), h);
  assert.ok(brief.includes('ran: <command> → exit <code>'), brief);
  assert.ok(brief.includes('amend:'), brief);
  // The amendment is made to the worktree's copy of the slice file, even when the row stays the same.
  assert.ok(procedure.includes('<path>/<docsRoot>/phases/'), procedure);
  // The stage gate first; a resumed slice goes on at its state; another clone's slice stops the run.
  assert.ok(procedure.includes('{{cli}} stage require plan'), procedure);
  for (const s of ['resumed <path> at <state>', '`todo`', '`tests-red`', '`building`', '`draft-pr`', 'another clone']) assert.ok(procedure.includes(s), s);
  // The wording the other procedures use: {{args}} once in the opening, <docsRoot>, the no-git sentence.
  assert.equal(procedure.match(/\{\{args\}\}/g)?.length, 1, '{{args}}');
  assert.ok(procedure.includes('run no git or gh command yourself'), procedure);
  assert.ok(procedure.includes('`<docsRoot>` below is the `docsRoot` in `.slicekit/config.json`'), procedure);
  // The default branch's pull refusal goes to the human, since the procedure runs no git; a slice
  // branch behind origin is synced by the command it names.
  assert.match(procedure, /default branch is behind origin\s+\(`pull first`\)[\s\S]{0,120}human/);
  assert.ok(procedure.includes('ends `run slicekit build sync <id>`'), procedure);
  assert.doesNotMatch(procedure, /is not in the worktree; pull first/);
  // `nothing to commit` is success; the notes file's shape and place are stated.
  assert.ok(procedure.includes('`nothing to commit`'), procedure);
  assert.ok(procedure.includes('a list of exactly three strings'), procedure);
  assert.ok(procedure.includes('one string'), procedure);
  assert.ok(procedure.includes('slicekit-notes-<id>.json'), procedure);
  assert.ok(procedure.includes('your scratchpad or temp directory'), procedure);
  assert.doesNotMatch(procedure, /\.git\//);
  assert.doesNotMatch(procedure, /npx/);
  // The brief says each thing once.
  assert.equal(brief.match(/\bdocument\b/gi)?.length, 1, 'document');
  assert.equal(brief.match(/outside the slice's expected/gi)?.length, 1, 'outside');
  // A helper lives inside the evaluation test file, so it is frozen with it (D-10).
  assert.doesNotMatch(brief, /helper a test imports/);
  assert.match(brief, /helper[^.]*inside the evaluation test file/i);
});

// S-25 review M-7: the verdict path build pr prints can be written at once, without a mkdir first.
test('build pr creates the directory of the verdict path it prints', async () => {
  const p = await green();
  try {
    fs.rmSync(path.join(p.root, '.slicekit', 'reviews'), { recursive: true, force: true });
    const r = await p.pr();
    assert.equal(r.code, 0, r.stderr);
    const printed = r.stdout.split('\n').find((l) => l.startsWith('verdict ')).slice('verdict '.length);
    assert.equal(fs.statSync(path.dirname(printed)).isDirectory(), true);
  } finally {
    p.cleanup();
  }
});
