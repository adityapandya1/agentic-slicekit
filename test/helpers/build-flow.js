// The S-14 build flow for command tests: a project with the kit installed, a bare origin, the
// fixture git host, and a slice P1/S-01 taken through build start, red, commit and pr.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../../src/config.js';
import { init as initKit } from '../../src/init.js';
import { main } from '../../src/cli/index.js';
import { git } from '../../src/git.js';
import { runCli } from './run-cli.js';
import { commit, makeRemote, makeRepo } from './tmp-repo.js';

// The absolute session-root path of a verdict file, as `build pr` and `build verdict` print it.
export const vpath = (root, name) => path.resolve(root, '.slicekit', 'reviews', name).split(path.sep).join('/');

export async function cli(root, args, env) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; }, ...(env ? { env } : {}) };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

export const pad = (n) => String(n).padStart(2, '0');

export function write(root, rel, text) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// Phase P<phase> with a phase file carrying `order` (or no Order line) and one slice per entry.
export function writePhase(root, docsRoot, { phase = 1, order, slices }) {
  const dir = docsRoot === '.' ? `phases/P${phase}-x` : `${docsRoot}/phases/P${phase}-x`;
  write(root, `${dir}/P${phase}.md`, `# Phase ${phase} — X\n\n${order ? `**Order:** ${order}\n` : ''}`);
  for (const { n, group, evalFile } of slices) {
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
| \`${evalFile ?? `t${n}.test.js`} » works\` | happy | REQ-1.1 |
| \`${evalFile ?? `t${n}.test.js`} » works\` | negative | REQ-1.1 |

## Expected changes

\`src/t${n}.js\`.
`,
    );
  }
}

// The spec and decisions that make the slice files' REQ-1.1 a known, cited requirement.
export const SPEC = `# 01 — X

## REQ-1.1 It works

The kit SHALL work.

Scenario: GIVEN a repo WHEN it runs THEN it works.

Cites: D-01.

Enforced by: the tests.
`;
export const DECISIONS = `# Decisions

## Settled

| # | Type | Question | Answer | Who, when |
|---|---|---|---|---|
| D-01 | Decision | Name? | demo | team, 2026-10-24 |
`;

// A repository on main with a config and one phase committed; with `remote`, a bare origin holding
// main. With `init`, the kit is installed (hooks, templates, a spec for REQ-1.1) and `slicekit check`
// passes on it.
export function project({ order, slices, phases, remote = false, docsRoot = 'docs', commands = {}, files = {}, init = false }) {
  const cfg = defaultConfig({ name: 'demo', shape: 'backend', docsRoot, commands });
  const repo = makeRepo({ files: init ? files : { '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n`, ...files } });
  if (init) {
    initKit(repo.root, { name: 'demo', shape: 'backend', docsRoot, commands, cli: 'node bin/slicekit.js' });
    write(repo.root, `${docsRoot}/spec/01-x.md`, SPEC);
    write(repo.root, `${docsRoot}/decisions.md`, DECISIONS);
  }
  for (const ph of phases ?? [{ order, slices }]) writePhase(repo.root, docsRoot, ph);
  if (init) {
    const status = runCli(['status', '--write'], { cwd: repo.root });
    assert.equal(status.code, 0, status.stderr);
    commitAll(repo.root, 'plan');
  } else {
    git(repo.root, ['add', '-A']);
    commit(repo.root, 'plan');
  }
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

// ALLOW_PROTECTED_COMMIT: init installs the kit's hooks, which refuse a commit on main.
export function commitAll(root, message) {
  git(root, ['add', '-A']);
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ALLOW_PROTECTED_COMMIT: '1' },
  });
}

// A started slice P1/S-01 whose evaluation row is `a.test.js » works`, with `node --test` as the
// test command; `body` is the test file the developer wrote at test/a.test.js in the worktree.
export async function startedWithTest(body, { test = 'node --test', files, remote = false, init = false } = {}) {
  const p = project({ slices: [{ n: 1, group: 'A', evalFile: 'a.test.js' }], commands: { test }, files, remote, init });
  const started = await cli(p.root, ['build', 'start', 'P1/S-01']);
  assert.equal(started.code, 0, started.stderr);
  const wt = started.stdout.split('\n')[0];
  if (body !== undefined) write(wt, 'test/a.test.js', body);
  return { ...p, wt, claim: git(wt, ['rev-parse', 'HEAD']) };
}

export const stateIn = (wt) => {
  const file = path.join(wt, '.slicekit', 'state', 'P1-S-01.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { state: 'todo' };
};

export const red1 = (p, tests) => cli(p.root, ['build', 'red', 'P1/S-01', '--tests', tests]);

export const commitIn = (wt, message) => {
  git(wt, ['add', '-A']);
  git(wt, ['commit', '-q', '-m', message]);
};

// A started slice past red: test/a.test.js imports src/t1.js, which does not exist yet, so it fails
// until the developer writes it.
// It names REQ-1.1, the slice's requirement, as every test file on a slice branch must (REQ-4.3).
export const IMPORTING = "// REQ-1.1\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { x } from '../src/t1.js';\ntest('works', () => assert.equal(x(), 2));\n";
export async function building(opts) {
  const p = await startedWithTest(IMPORTING, opts);
  const r = await red1(p, 'test/a.test.js');
  assert.equal(r.code, 0, r.stderr);
  return { ...p, redSha: r.stdout.split('\n')[0] };
}
export const commitWorkCli = (p, ...args) => cli(p.root, ['build', 'commit', 'P1/S-01', ...args]);

export const GREEN = 'export const x = () => 2;\n';

// The fixture git host and a notes file for `build pr`, in a fresh directory.
export function fixtureHost() {
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-host-'));
  const notes = path.join(host, 'notes.json');
  fs.writeFileSync(
    notes,
    JSON.stringify({ tryIt: ['Run the tests.', 'Call x().', 'See 2.'], skipped: 'Windows paths were not tried.', decisions: ['x returns 2'] }),
  );
  const env = { ...process.env, SLICEKIT_GITHOST_FIXTURE: host };
  return { host, notes, env, cleanup: () => fs.rmSync(host, { recursive: true, force: true }) };
}

// A green slice P1/S-01 with a bare origin and the fixture git host; `notes` is the notes file.
export async function green() {
  const p = await building({ remote: true, init: true });
  write(p.wt, 'src/t1.js', GREEN);
  const done = await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green');
  assert.equal(done.code, 0, done.stderr);
  const h = fixtureHost();
  const cleanup = p.cleanup;
  return {
    ...p,
    host: h.host,
    notes: h.notes,
    env: h.env,
    pr: (...args) => cli(p.root, ['build', 'pr', 'P1/S-01', '--notes', h.notes, ...args], h.env),
    cleanup() {
      h.cleanup();
      cleanup();
    },
  };
}

// Slice P1/S-<nn> of project `p` (made with `init` and `node --test`) taken through build start, red
// on test/t<n>.test.js and a green build commit that also writes `files` ({ rel: text }). -> the
// slice's id, worktree, branch and claim commit.
export async function greenSlice(p, n, files = {}) {
  const id = `P1/S-${pad(n)}`;
  const started = await cli(p.root, ['build', 'start', id]);
  assert.equal(started.code, 0, started.stderr);
  const [wt, branch] = started.stdout.split('\n');
  const claim = git(wt, ['rev-parse', 'HEAD']);
  write(wt, `test/t${n}.test.js`, IMPORTING.replace('../src/t1.js', `../src/t${n}.js`));
  const r = await cli(p.root, ['build', 'red', id, '--tests', `test/t${n}.test.js`]);
  assert.equal(r.code, 0, r.stderr);
  write(wt, `src/t${n}.js`, GREEN);
  for (const [rel, text] of Object.entries(files)) write(wt, rel, text);
  const done = await cli(p.root, ['build', 'commit', id, '--message', `feat(${id}): x`, '--require-green']);
  assert.equal(done.code, 0, done.stderr);
  return { id, wt, branch, claim };
}
export const prCalls = (host) => {
  const file = path.join(host, 'pr-calls.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};

// The review worktree `review start` makes (S-16 Task 2), built by hand: `<root>/.worktrees/review-P1-S-01`
// on `slice/P1-S-01-review` at origin's slice branch, tracking it, so a push lands on the slice branch.
export function reviewWorktree(p, branch = 'slice/P1-S-01-thing-1') {
  const dir = path.join(p.root, '.worktrees', 'review-P1-S-01');
  git(p.root, ['fetch', '-q', 'origin']);
  git(p.root, ['worktree', 'add', '-q', '--track', '-b', 'slice/P1-S-01-review', dir, `origin/${branch}`]);
  return dir;
}

// The review worktree removed and the build worktree brought up to what it pushed, so the build
// session's steps find one worktree holding the slice again.
export function leaveReview(p, dir, branch = 'slice/P1-S-01-thing-1') {
  git(p.root, ['worktree', 'remove', '--force', dir]);
  git(p.root, ['branch', '-q', '-D', 'slice/P1-S-01-review']);
  git(p.wt, ['fetch', '-q', 'origin']);
  git(p.wt, ['merge', '-q', '--ff-only', `origin/${branch}`]);
}
