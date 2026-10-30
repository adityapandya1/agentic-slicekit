// REQ-3.11, D-49, D-35: `slicekit ci bookkeeping` without --base finds its base on the git host (the
// path the gate takes): the newest pull request commit whose slicekit run ran every team command job
// to success, containing the base branch's current tip. Anything else is `code`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { init } from '../src/init.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { CI_PULL_REQUEST, runCli } from './helpers/run-cli.js';
import { writeSliceFixtures } from './helpers/slice-fixture.js';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function write(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function commitAll(root, message) {
  git(root, 'add', '-A');
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '--no-verify', '-q', '--allow-empty', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

let runId = 100;
// One run of `workflow` on `sha` in the fixture host, with its jobs; `jobs` maps a job name to its conclusion.
function addRun(host, sha, { workflow = 'slicekit', event = 'pull_request', status = 'completed', jobs = {}, createdAt = '2026-10-30T10:00:00Z' } = {}) {
  const file = path.join(host, `ci-${sha}.json`);
  const runs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const id = ++runId;
  runs.push({ databaseId: id, status, conclusion: status === 'completed' ? 'success' : '', createdAt, workflowName: workflow, event, url: `https://example.test/runs/${id}` });
  fs.writeFileSync(file, JSON.stringify(runs));
  const list = Object.entries(jobs).map(([name, conclusion]) => ({ name, status: 'completed', conclusion }));
  fs.writeFileSync(path.join(host, `jobs-${id}.json`), JSON.stringify({ jobs: [{ name: 'gate', status: 'completed', conclusion: 'success' }, ...list] }));
}
const PASSED = { 'cmd-test (ubuntu-latest, 1/1)': 'success', 'cmd-test (windows-latest, 1/3)': 'success' };
const SKIPPED = { 'cmd-test (ubuntu-latest, 1/1)': 'skipped', 'cmd-test (windows-latest, 1/3)': 'skipped' };

// main, then a slice branch: A (code), B (state file), C (verdict and BUILD.md), the head.
function withPullRequest(fn) {
  const repo = makeRepo();
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-host-'));
  try {
    const root = repo.root;
    init(root, { name: 'demo', shape: 'backend' });
    writeSliceFixtures(root, 1);
    write(root, 'src/x.js', 'export const x = 1;\n');
    commitAll(root, 'main');
    git(root, 'checkout', '-q', '-b', 'slice/P1-S-01-a');
    write(root, 'src/x.js', 'export const x = 2;\n');
    const A = commitAll(root, 'feat(P1/S-01): code');
    write(root, '.slicekit/state/P1-S-01.json', '{"state":"draft-pr"}\n');
    const B = commitAll(root, 'chore(slicekit): P1/S-01 draft-pr');
    write(root, '.slicekit/reviews/P1-S-01-r1.md', 'Verdict: APPROVE\n');
    write(root, 'BUILD.md', '# Build\n');
    const C = commitAll(root, 'chore(slicekit): P1/S-01 verdict r1');
    const env = { ...process.env, SLICEKIT_GITHOST_FIXTURE: host };
    for (const k of Object.keys(env)) if (CI_PULL_REQUEST.includes(k.toUpperCase())) delete env[k];
    const judge = (head = C) => {
      const r = runCli(['ci', 'bookkeeping', '--head', head, '--base-branch', 'main'], { cwd: root, env });
      assert.equal(r.code, 0, r.stderr);
      return r.stdout.trim();
    };
    return fn({ root, host, A, B, C, judge });
  } finally {
    repo.cleanup();
    fs.rmSync(host, { recursive: true, force: true });
  }
}

test('the walk takes the newest commit whose slicekit command jobs passed', () => {
  withPullRequest(({ host, A, B, C, judge }) => {
    // No run anywhere: nothing to stand on.
    assert.match(judge(), /^code \(/);
    addRun(host, A, { jobs: PASSED });
    assert.equal(judge(), `bookkeeping ${A.slice(0, 7)}..${C.slice(0, 7)}`);
    addRun(host, B, { jobs: PASSED });
    assert.match(judge(), new RegExp(`^bookkeeping ${B.slice(0, 7)}\\.\\.`));
  });
});

test('a commit green only in another workflow, or only by a bookkeeping skip, is never the base', () => {
  withPullRequest(({ host, A, B, judge }) => {
    addRun(host, A, { workflow: 'docs', event: 'push', jobs: PASSED });
    addRun(host, A, { workflow: 'slicekit', event: 'push', jobs: PASSED });
    assert.match(judge(), /^code \(/);
    // B's run skipped the command jobs (a bookkeeping run): the walk goes on past it, and finds nothing.
    addRun(host, B, { jobs: SKIPPED });
    assert.match(judge(), /^code \(/);
    // The newest slicekit run of A is the answer: an older green one replaced by a skipped one does not count.
    addRun(host, A, { jobs: PASSED, createdAt: '2026-10-30T09:00:00Z' });
    addRun(host, A, { jobs: SKIPPED, createdAt: '2026-10-30T11:00:00Z' });
    assert.match(judge(), /^code \(/);
  });
});

test('past a bookkeeping-skipped run the walk reaches the tested commit; a failed run ends it', () => {
  withPullRequest(({ host, A, B, judge }) => {
    addRun(host, A, { jobs: PASSED });
    addRun(host, B, { jobs: SKIPPED });
    assert.match(judge(), new RegExp(`^bookkeeping ${A.slice(0, 7)}\\.\\.`));
    addRun(host, B, { jobs: { 'cmd-test (ubuntu-latest, 1/1)': 'failure' }, createdAt: '2026-10-30T12:00:00Z' });
    assert.match(judge(), /^code \(the team command jobs failed/);
  });
});

test('a host error gives code', () => {
  withPullRequest(({ host, A, judge }) => {
    addRun(host, A, { jobs: PASSED });
    fs.writeFileSync(path.join(host, `ci-${A}.json`), '{not json');
    assert.match(judge(), /^code \(git host/);
  });
});

test('a base branch that moved since the green run gives code', () => {
  withPullRequest(({ root, host, A, judge }) => {
    addRun(host, A, { jobs: PASSED });
    git(root, 'checkout', '-q', 'main');
    write(root, 'src/z.js', 'export const z = 1;\n');
    commitAll(root, 'main moves');
    git(root, 'checkout', '-q', 'slice/P1-S-01-a');
    assert.match(judge(), /^code \(main moved since/);
  });
});

test('the walk looks at the newest 20 commits of the pull request and no further', () => {
  withPullRequest(({ root, host, A, C, judge }) => {
    addRun(host, A, { jobs: PASSED });
    // A is the third commit from C. With 17 more on top, A is the 20th from the head: found.
    let head = C;
    for (let i = 0; i < 17; i++) {
      write(root, '.slicekit/state/P1-S-01.json', `{"n":${i}}\n`);
      head = commitAll(root, `chore(slicekit): P1/S-01 n${i}`);
    }
    assert.match(judge(head), new RegExp(`^bookkeeping ${A.slice(0, 7)}\\.\\.`));
    write(root, '.slicekit/state/P1-S-01.json', '{"n":"last"}\n');
    head = commitAll(root, 'chore(slicekit): P1/S-01 last');
    assert.match(judge(head), /^code \(no commit of the last 20/);
  });
});
