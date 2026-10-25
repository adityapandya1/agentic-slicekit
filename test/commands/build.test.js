import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../../src/config.js';
import { main } from '../../src/cli/index.js';
import { git } from '../../src/git.js';
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

// One phase, P1, with a phase file carrying `order` (or no Order line) and one slice per entry.
function writePhase(root, docsRoot, { order, slices }) {
  const dir = docsRoot === '.' ? 'phases/P1-x' : `${docsRoot}/phases/P1-x`;
  write(root, `${dir}/P1.md`, `# Phase 1 — X\n\n${order ? `**Order:** ${order}\n` : ''}`);
  for (const { n, group } of slices) {
    write(
      root,
      `${dir}/S-${pad(n)}-thing-${n}.md`,
      `---
slice: P1/S-${pad(n)}
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

function setSliceState(root, id, state) {
  write(root, `.slicekit/state/${id.replace('/', '-')}.json`, `${JSON.stringify({ slice: id, state, history: [] }, null, 2)}\n`);
}

// A repository on main with a config and one phase committed; with `remote`, a bare origin holding main.
function project({ order, slices, remote = false, docsRoot = 'docs' }) {
  const cfg = defaultConfig({ name: 'demo', shape: 'backend', docsRoot });
  const repo = makeRepo({ files: { '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n` } });
  writePhase(repo.root, docsRoot, { order, slices });
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
