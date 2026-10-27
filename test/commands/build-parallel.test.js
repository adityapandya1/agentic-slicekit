// S-16 Task 4: `build parallel P<n>` starts every runnable slice of a phase's next Order step, each in
// its own worktree; `build pr` refuses, before pushing, a branch that changes a path another slice of
// the same step has already pushed: the plan said they do not overlap (D-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { git } from '../../src/git.js';
import { cli, commitIn, fixtureHost, greenSlice, project, write } from '../helpers/build-flow.js';

const remoteHead = (p, branch) => git(p.root, ['ls-remote', 'origin', `refs/heads/${branch}`]).split(/\s+/)[0];

// Two group-A slices of one phase with no Order line, a bare origin and the fixture host.
function twoInA() {
  const p = project({ slices: [{ n: 1, group: 'A' }, { n: 2, group: 'A' }], commands: { test: 'node --test' }, remote: true, init: true });
  const h = fixtureHost();
  const cleanup = p.cleanup;
  return {
    ...p,
    ...h,
    pr: (id) => cli(p.root, ['build', 'pr', id, '--notes', h.notes], h.env),
    cleanup() {
      h.cleanup();
      cleanup();
    },
  };
}

const PASSING = (v) => `import { test } from 'node:test';\ntest('x ${v}', () => {});\n`;

test('a second run changing the same path stops as a plan defect', async () => {
  const p = twoInA();
  try {
    await greenSlice(p, 1, { 'src/billing.js': 'export const bill = 1;\n' });
    const two = await greenSlice(p, 2, { 'src/billing.js': 'export const bill = 2;\n' });
    const first = await p.pr('P1/S-01');
    assert.equal(first.code, 0, first.stderr);
    const second = await p.pr('P1/S-02');
    assert.equal(second.code, 1, second.stdout);
    assert.equal(second.stderr, 'slicekit: plan defect: P1/S-02 and P1/S-01 both change src/billing.js; the plan said they do not overlap\n');
    assert.equal(remoteHead(p, two.branch), two.claim);
  } finally {
    p.cleanup();
  }
});

test('a shared root or a bookkeeping file is not an overlap', async () => {
  const p = twoInA();
  try {
    // BUILD.md and the state files are the kit's: each recorded state rewrites both.
    const one = await greenSlice(p, 1, { 'test/x.test.js': PASSING(1) });
    const two = await greenSlice(p, 2, { 'test/x.test.js': PASSING(2) });
    for (const s of [one, two]) {
      const changed = git(s.wt, ['diff', '--name-only', 'origin/main', 'HEAD']).split('\n');
      for (const f of ['BUILD.md', 'test/x.test.js']) assert.ok(changed.includes(f), `${s.id} changes ${f}`);
      assert.ok(changed.some((f) => f.startsWith('.slicekit/state/')), `${s.id} changes its state file`);
    }
    const first = await p.pr('P1/S-01');
    assert.equal(first.code, 0, first.stderr);
    const second = await p.pr('P1/S-02');
    assert.equal(second.code, 0, second.stderr);
    assert.notEqual(remoteHead(p, two.branch), two.claim);
  } finally {
    p.cleanup();
  }
});

test('parallel starts one worktree per runnable slice of the step', async () => {
  const p = project({ order: 'A; B', slices: [{ n: 1, group: 'A' }, { n: 2, group: 'A' }, { n: 3, group: 'B' }], remote: true });
  try {
    const r = await cli(p.root, ['build', 'parallel', 'P1']);
    assert.equal(r.code, 0, r.stderr);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 2, r.stdout);
    const ids = lines.map((l) => l.split(' ')[0]);
    assert.deepEqual(ids, ['P1/S-01', 'P1/S-02']);
    for (const l of lines) {
      const [id, wt, branch] = l.split(' ');
      assert.ok(fs.existsSync(wt), `${id}: ${wt}`);
      assert.equal(git(wt, ['branch', '--show-current']), branch);
      assert.equal(remoteHead(p, branch), git(wt, ['rev-parse', 'HEAD']));
    }
    assert.ok(!fs.existsSync(`${p.root}/.worktrees/P1-S-03`));
    assert.equal(git(p.root, ['ls-remote', '--heads', 'origin', 'slice/P1-S-03-*']), '');
  } finally {
    p.cleanup();
  }
});

test('parallel with nothing ready says what each slice waits on', async () => {
  const p = project({ order: 'A; B', slices: [{ n: 1, group: 'A' }, { n: 2, group: 'B' }], remote: true });
  try {
    assert.equal((await cli(p.root, ['build', 'parallel', 'P1'])).code, 0);
    const r = await cli(p.root, ['build', 'parallel', 'P1']);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'slicekit: no slice of P1 is ready to build\nP1/S-02 waits on P1/S-01 (todo)\n');
  } finally {
    p.cleanup();
  }
});

test('parallel refuses a phase that is not P<n> and a phase with no slices', async () => {
  const p = project({ slices: [{ n: 1, group: 'A' }] });
  try {
    assert.equal((await cli(p.root, ['build', 'parallel'])).code, 2);
    assert.equal((await cli(p.root, ['build', 'parallel', 'S-01'])).code, 2);
    const r = await cli(p.root, ['build', 'parallel', 'P9']);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, 'slicekit: unknown phase P9\n');
  } finally {
    p.cleanup();
  }
});

test('parallel keeps the slices it started when another start fails, and exits 1', async () => {
  const p = project({ slices: [{ n: 1, group: 'A' }, { n: 2, group: 'A' }], remote: true });
  try {
    fs.mkdirSync(`${p.root}/.worktrees/P1-S-02`, { recursive: true });
    const r = await cli(p.root, ['build', 'parallel', 'P1']);
    assert.equal(r.code, 1);
    const [line, ...more] = r.stdout.trim().split('\n');
    assert.deepEqual(more, []);
    const [id, wt, branch] = line.split(' ');
    assert.equal(id, 'P1/S-01');
    assert.ok(fs.existsSync(wt));
    assert.equal(remoteHead(p, branch), git(wt, ['rev-parse', 'HEAD']));
    assert.match(r.stderr, /^slicekit: P1\/S-02 not started: .*P1-S-02 exists and holds no worktree of P1\/S-02; remove it\n$/);
  } finally {
    p.cleanup();
  }
});

test("another slice's review branch is not one of its branches", async () => {
  const p = twoInA();
  try {
    const started = await cli(p.root, ['build', 'start', 'P1/S-01']);
    assert.equal(started.code, 0, started.stderr);
    const wt1 = started.stdout.split('\n')[0];
    write(wt1, 'src/billing.js', 'export const bill = 1;\n');
    commitIn(wt1, 'review work');
    git(wt1, ['push', '-q', 'origin', 'HEAD:refs/heads/slice/P1-S-01-review']);
    await greenSlice(p, 2, { 'src/billing.js': 'export const bill = 2;\n' });
    const r = await p.pr('P1/S-02');
    assert.equal(r.code, 0, r.stderr);
  } finally {
    p.cleanup();
  }
});
