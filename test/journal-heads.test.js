// REQ-3.8, D-89: which journal files a heads line is owed for (headsFiles), the omitted-line finding
// of the journal rule on a sync pull request, and the actor a heads line records across a re-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as J from '../src/journal.js';
import journalRule from '../src/check/rules/journal.js';
import { buildContext } from '../src/check/context.js';
import { CONFIG_PATH, defaultConfig } from '../src/config.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';

const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const FIELDS = { actor: 'ada', slice: 'P1/S-07', stage: 'build', commits: ['abc1234'], verdicts: [], decisions: ['D-34'] };
const HEADS = '.slicekit/journal-heads.log';
const rel = (root, branch) => path.relative(root, J.journalFile(root, branch)).split(path.sep).join('/');
const lastHash = (root, branch) => J.parseLine(fs.readFileSync(J.journalFile(root, branch), 'utf8').trimEnd().split('\n').at(-1)).hash;
const files = (root, merge, opts) => J.headsFiles(root, cfg, merge, opts).map((f) => f.file);
const head = (root) => git(root, ['rev-parse', 'HEAD']);

// main with the config and the journal file for main committed.
function repo() {
  const r = makeRepo({ commits: 1 });
  const conf = path.join(r.root, CONFIG_PATH);
  fs.mkdirSync(path.dirname(conf), { recursive: true });
  fs.writeFileSync(conf, JSON.stringify(cfg));
  J.appendJournal(r.root, FIELDS, { branch: 'main' });
  git(r.root, ['add', '-A']);
  git(r.root, ['commit', '--quiet', '-m', 'config and journal']);
  return r;
}

// One commit on the current branch that appends to the journal file of `branch`.
function journalCommit(root, branch) {
  J.appendJournal(root, FIELDS, { branch });
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', `journal ${branch}`]);
  return head(root);
}

// A no-ff merge into main of a branch that changes the journal file of each of `branches`.
function mergeOf(root, name, branches) {
  git(root, ['checkout', '--quiet', '-b', name, 'main']);
  for (const b of branches) journalCommit(root, b);
  git(root, ['checkout', '--quiet', 'main']);
  git(root, ['merge', '--quiet', '--no-ff', '-m', `merge ${name}`, name]);
  return head(root);
}

// A push of two commits fast-forwarded onto main, each changing a different journal file.
function fastForward(root, name, [b1, b2]) {
  git(root, ['checkout', '--quiet', '-b', name, 'main']);
  journalCommit(root, b1);
  journalCommit(root, b2);
  git(root, ['checkout', '--quiet', 'main']);
  git(root, ['merge', '--quiet', '--ff-only', name]);
  return head(root);
}

const recordedFor = (root, merge) => J.headsLines(root, cfg, merge, { run: '1', workflow: 'kitflow', actor: 'octocat' }).map((l) => `${l}\n`).join('');

// REQ-3.8 (H-2): the first sync after adoption, for a push of several commits.
test('headsFiles gives the first sync of a multi-commit push a line for every journal file it holds', () => {
  const r = repo();
  try {
    const tip = fastForward(r.root, 'slice/ff', ['slice/x', 'slice/y']);
    const at = git(r.root, ['ls-tree', '-r', '--name-only', tip, '--', '.slicekit/journal/']).split('\n').sort();
    assert.equal(at.length, 3, at.join('\n'));
    assert.deepEqual(files(r.root, tip, { recorded: '' }), at);
    for (const b of ['slice/x', 'slice/y']) {
      const got = J.headsFiles(r.root, cfg, tip, { recorded: '' }).find((f) => f.file === rel(r.root, b));
      assert.equal(got?.hash, lastHash(r.root, b), b);
    }
  } finally {
    r.cleanup();
  }
});

// REQ-3.8 (H-2): the first sync of a merge commit compares against its first parent.
test('headsFiles gives the first sync of a merge commit a line only for the files the merge changed', () => {
  const r = repo();
  try {
    const merge = mergeOf(r.root, 'slice/a', ['slice/a']);
    assert.deepEqual(files(r.root, merge, { recorded: '' }), [rel(r.root, 'slice/a')]);
  } finally {
    r.cleanup();
  }
});

// REQ-3.8: once the log names a merge, a later multi-commit push is compared against that merge.
test('headsFiles over a multi-commit push after a recorded merge names every file the push changed', () => {
  const r = repo();
  try {
    const m1 = mergeOf(r.root, 'slice/a', ['slice/a']);
    const recorded = recordedFor(r.root, m1);
    assert.equal(recorded.split('\n').filter(Boolean).length, 1, recorded);
    const tip = fastForward(r.root, 'slice/ff', ['slice/x', 'slice/y']);
    assert.deepEqual(files(r.root, tip, { recorded }), [rel(r.root, 'slice/x'), rel(r.root, 'slice/y')].sort());
  } finally {
    r.cleanup();
  }
});

// REQ-3.8: a merge whose sync pull request was superseded gets its line from the next sync.
test('headsFiles after a superseded sync pull request names the files of both merges', () => {
  const r = repo();
  try {
    const m1 = mergeOf(r.root, 'slice/a', ['slice/a']);
    const recorded = recordedFor(r.root, m1);
    mergeOf(r.root, 'slice/b', ['slice/b']); // its sync pull request is closed unmerged
    const m3 = mergeOf(r.root, 'slice/c', ['slice/c']);
    assert.deepEqual(files(r.root, m3, { recorded }), [rel(r.root, 'slice/b'), rel(r.root, 'slice/c')].sort());
    // A file the log already records at its current hash is owed nothing.
    assert.ok(!files(r.root, m3, { recorded }).includes(rel(r.root, 'slice/a')));
  } finally {
    r.cleanup();
  }
});

// ---- the journal rule under --ci ----

function hostDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-host-'));
}
const writeJson = (dir, name, value) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);

function prEnv(root, dir, { branch, title }) {
  const event = path.join(dir, 'event.json');
  writeJson(dir, 'event.json', {
    pull_request: { number: 7, title, body: '', head: { ref: branch, sha: head(root) }, user: { login: 'octocat' }, labels: [] },
  });
  return { SLICEKIT_GITHOST_FIXTURE: dir, GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: branch, GITHUB_BASE_REF: 'main' };
}
const ruleCi = (root, env) => journalRule.run(buildContext(root, cfg, { ci: true, env }));

// REQ-3.8 (H-3, H-4): src/check/rules/journal.js omitted().
test('a sync pull request that adds no heads line for a merge that changed a journal file fails in CI', () => {
  const r = repo();
  const dir = hostDir();
  try {
    const merge = mergeOf(r.root, 'slice/a', ['slice/a']);
    const branch = `sync/${merge.slice(0, 7)}`;
    git(r.root, ['checkout', '--quiet', '-b', branch]);
    fs.writeFileSync(path.join(r.root, 'STATE.md'), 'state\n');
    git(r.root, ['add', '-A']);
    git(r.root, ['commit', '--quiet', '-m', 'state only']);
    const found = ruleCi(r.root, prEnv(r.root, dir, { branch, title: `[sync] state after ${merge.slice(0, 7)}` }));
    const lacks = found.filter((f) => f.file === HEADS && f.message.includes('lacks a line for'));
    assert.equal(lacks.length, 1, JSON.stringify(found));
    assert.ok(lacks[0].message.includes(rel(r.root, 'slice/a')), lacks[0].message);
    assert.ok(lacks[0].message.includes(`hash=${lastHash(r.root, 'slice/a')}`), lacks[0].message);
    assert.ok(lacks[0].message.includes(merge.slice(0, 7)), lacks[0].message);
  } finally {
    r.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// REQ-3.8 (Codex P2 on #128): a sync branch whose merge does not resolve fails closed.
test('a sync pull request whose branch names a merge the checkout cannot resolve fails in CI', () => {
  const r = repo();
  const dir = hostDir();
  try {
    mergeOf(r.root, 'slice/a', ['slice/a']);
    const branch = 'sync/deadbee';
    git(r.root, ['checkout', '--quiet', '-b', branch]);
    fs.writeFileSync(path.join(r.root, 'STATE.md'), 'state\n');
    git(r.root, ['add', '-A']);
    git(r.root, ['commit', '--quiet', '-m', 'state only']);
    const found = ruleCi(r.root, prEnv(r.root, dir, { branch, title: '[sync] state after deadbee' }));
    const bad = found.filter((f) => f.file === HEADS && f.message.includes('cannot resolve'));
    assert.equal(bad.length, 1, JSON.stringify(found));
    assert.ok(bad[0].message.includes(branch), bad[0].message);
  } finally {
    r.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the actor across a re-run (H-5) ----

function runEnv(merge, { actor, triggering }) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (['GITHUB_EVENT_PATH', 'GITHUB_HEAD_REF', 'GITHUB_BASE_REF', 'SLICEKIT_PR_TITLE', 'SLICEKIT_PR_BODY', 'SLICEKIT_GITHOST_FIXTURE'].includes(k.toUpperCase())) delete env[k];
  }
  return { ...env, GITHUB_RUN_ID: '987654321', GITHUB_WORKFLOW: 'kitflow', GITHUB_ACTOR: actor, GITHUB_TRIGGERING_ACTOR: triggering, GITHUB_SHA: merge };
}

// REQ-3.8, D-89
test('a heads line records the actor who started the run, and a re-run by someone else still matches in CI', () => {
  const r = repo();
  const dir = hostDir();
  try {
    const merge = mergeOf(r.root, 'slice/a', ['slice/a']);
    // The job's second attempt, re-run by bob; alice started the run.
    const out = runCli(['journal', 'heads', merge], { cwd: r.root, env: runEnv(merge, { actor: 'alice', triggering: 'bob' }) });
    assert.equal(out.code, 0, out.stderr + out.stdout);
    const text = fs.readFileSync(path.join(r.root, HEADS), 'utf8');
    assert.match(text, / actor=alice\n$/);
    const branch = `sync/${merge.slice(0, 7)}`;
    git(r.root, ['checkout', '--quiet', '-b', branch]);
    git(r.root, ['add', '-A']);
    git(r.root, ['commit', '--quiet', '-m', 'heads']);
    writeJson(dir, 'run-987654321.json', {
      id: 987654321,
      name: 'kitflow',
      head_sha: merge,
      conclusion: null,
      actor: { login: 'alice' },
      triggering_actor: { login: 'carol' }, // a third attempt, re-run by carol, while check runs
    });
    assert.deepEqual(ruleCi(r.root, prEnv(r.root, dir, { branch, title: `[sync] state after ${merge.slice(0, 7)}` })), []);
  } finally {
    r.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
