import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig, loadConfig } from '../../src/config.js';
import { main } from '../../src/cli/index.js';
import { git, parseTrailers } from '../../src/git.js';
import { BuildError, findWorktree, startSlice } from '../../src/build/worktree.js';
import { runCli } from '../helpers/run-cli.js';
import { commit, makeRemote, makeRepo } from '../helpers/tmp-repo.js';

async function cli(root, args) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

const pad = (n) => String(n).padStart(2, '0');

function write(root, rel, text) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// Phase P<phase> with a phase file carrying `order` (or no Order line) and one slice per entry.
function writePhase(root, docsRoot, { phase = 1, order, slices }) {
  const dir = docsRoot === '.' ? `phases/P${phase}-x` : `${docsRoot}/phases/P${phase}-x`;
  write(root, `${dir}/P${phase}.md`, `# Phase ${phase} — X\n\n${order ? `**Order:** ${order}\n` : ''}`);
  for (const { n, group } of slices) {
    write(
      root,
      `${dir}/S-${pad(n)}-thing-${n}.md`,
      `---
slice: P${phase}/S-${pad(n)}
name: Thing ${n}
repo: .
group: ${group}
runbook: no
requirements: [REQ-1.1]
decisions: []
---

## Done when

1. It works.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| \`t${n}.test.js » works\` | happy | REQ-1.1 |

## Expected changes

\`src/t${n}.js\`.
`,
    );
  }
}

// Writes and commits a state file: build next and build start refuse uncommitted state changes.
function setSliceState(root, id, state) {
  write(root, `.slicekit/state/${id.replace('/', '-')}.json`, `${JSON.stringify({ slice: id, state, history: [] }, null, 2)}\n`);
  git(root, ['add', '--', '.slicekit/state']);
  commit(root, `state ${id} ${state}`);
}

// A repository on main with a config and one phase committed; with `remote`, a bare origin holding main.
function project({ order, slices, phases, remote = false, docsRoot = 'docs' }) {
  const cfg = defaultConfig({ name: 'demo', shape: 'backend', docsRoot });
  const repo = makeRepo({ files: { '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n` } });
  for (const ph of phases ?? [{ order, slices }]) writePhase(repo.root, docsRoot, ph);
  git(repo.root, ['add', '-A']);
  commit(repo.root, 'plan');
  const origin = remote ? makeRemote(repo.root) : null;
  if (origin) git(repo.root, ['push', '-q', 'origin', 'main']);
  return {
    root: repo.root,
    remote: origin?.remote,
    cleanup() {
      origin?.cleanup();
      repo.cleanup();
    },
  };
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

    const again = await cli(p.root, ['build', 'start', 'P1/S-02']);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /P1\/S-02 is already started in /);
  } finally {
    p.cleanup();
  }
});

// ALLOW_PROTECTED_COMMIT: init installs the kit's hooks, which refuse a commit on main.
function commitAll(root, message) {
  git(root, ['add', '-A']);
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ALLOW_PROTECTED_COMMIT: '1' },
  });
}

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
