import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../src/init.js';
import { loadConfig } from '../src/config.js';
import { kitPaths } from '../src/paths.js';
import { stateFileName } from '../src/ids.js';
import { readSlice, writeSlice } from '../src/state/index.js';
import { syncFromHost } from '../src/state/sync.js';
import { getHost } from '../src/adapters/githost/index.js';
import { reduceRuns } from '../src/adapters/githost/gh-json.js';
import { ghExitError, githubHost } from '../src/adapters/githost/github.js';
import { GitHostError, GitHostNotFound } from '../src/adapters/githost/errors.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';
import { writeSliceFixtures } from './helpers/slice-fixture.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'githost');
const fixtureEnv = { SLICEKIT_GITHOST_FIXTURE: FIXTURE };

function withKit(fn, { slices = 2 } = {}) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const ids = writeSliceFixtures(repo.root, slices);
    fs.writeFileSync(path.join(repo.root, 'docs', 'phases', 'P1-x', 'P1.md'), '# Phase 1 — Spine\n');
    return fn(repo.root, loadConfig(repo.root), ids);
  } finally {
    repo.cleanup();
  }
}

// A slice parked at ready with a recorded pull request, as the review loop leaves it.
function park(root, cfg, id, pr) {
  writeSlice(root, cfg, { ...readSlice(root, cfg, id), state: 'ready', pr });
}

const pr14 = { number: 14, url: 'https://github.com/acme/demo/pull/14', headSha: 'abc1234def5678' };
const pr15 = { number: 15, url: 'https://github.com/acme/demo/pull/15', headSha: 'bbb2222ccc3333' };

test('merged PR from the fixture host moves ready to merged', () => {
  withKit((root, cfg, ids) => {
    park(root, cfg, ids[0], pr14);
    const { changes, warnings } = syncFromHost(root, cfg, getHost(cfg, fixtureEnv));
    assert.deepEqual(changes, [{ id: ids[0], from: 'ready', to: 'merged', pr: 14 }]);
    assert.deepEqual(warnings, []);
    const s = readSlice(root, cfg, ids[0]);
    assert.equal(s.state, 'merged');
    assert.equal(s.history.at(-1).evidence.mergedAt, '2026-10-20T09:30:00Z');
    assert.equal(s.pr.number, 14);
    assert.equal(s.pr.headSha, 'abc1234def5678');
  });
});

test('an unmerged PR leaves ready alone', () => {
  withKit((root, cfg, ids) => {
    park(root, cfg, ids[1], pr15);
    const file = path.join(kitPaths(root, cfg).state, stateFileName(ids[1]));
    const before = fs.readFileSync(file, 'utf8');
    const { changes } = syncFromHost(root, cfg, getHost(cfg, fixtureEnv));
    assert.deepEqual(changes, []);
    assert.equal(readSlice(root, cfg, ids[1]).state, 'ready');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
});

test('sync never touches a slice that is not ready', () => {
  withKit((root, cfg, ids) => {
    writeSlice(root, cfg, { ...readSlice(root, cfg, ids[0]), state: 'ci-green', pr: pr14 });
    const asked = [];
    const host = { getPullRequest: (n) => (asked.push(n), { number: n, mergedAt: '2026-10-20T09:30:00Z' }) };
    assert.deepEqual(syncFromHost(root, cfg, host).changes, []);
    assert.deepEqual(asked, []);
    assert.equal(readSlice(root, cfg, ids[0]).state, 'ci-green');
  });
});

test('sync skips a ready slice without a pr number with a warning', () => {
  withKit((root, cfg, ids) => {
    park(root, cfg, ids[0], null);
    park(root, cfg, ids[1], pr14);
    const { changes, warnings } = syncFromHost(root, cfg, getHost(cfg, fixtureEnv));
    assert.deepEqual(changes.map((c) => c.id), [ids[1]]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], new RegExp(`${ids[0]}.*has no valid pull request number`));
    assert.equal(readSlice(root, cfg, ids[0]).state, 'ready');
  });
});

test('getPullRequest maps gh fields', () => {
  const host = getHost({ gitHost: { kind: 'github' } }, fixtureEnv);
  assert.deepEqual(host.getPullRequest(14), {
    number: 14,
    url: 'https://github.com/acme/demo/pull/14',
    state: 'MERGED',
    mergedAt: '2026-10-20T09:30:00Z',
    headSha: 'abc1234def5678',
    title: '[P1/S-01] Fixture 1',
    body: 'Slice: P1/S-01',
    labels: ['slice', 'P1'],
  });
  assert.equal(host.getPullRequest(15).mergedAt, null);
  assert.throws(() => host.getPullRequest(99), { message: 'pull request 99 not found' });
});

test('listMergedSince filters by date', () => {
  const host = getHost({ gitHost: { kind: 'github' } }, fixtureEnv);
  assert.deepEqual(host.listMergedSince('2026-10-20T09:30:00Z'), [
    { number: 16, mergedAt: '2026-10-22T12:00:00Z', headSha: 'ddd4444', title: '[P1/S-04] newest' },
    { number: 14, mergedAt: '2026-10-20T09:30:00Z', headSha: 'abc1234def5678', title: '[P1/S-01] Fixture 1' },
  ]);
  assert.deepEqual(host.listMergedSince('2026-10-21').map((p) => p.number), [16]);
  assert.equal(host.listMergedSince('2026-09-01').length, 3);
  assert.throws(() => host.listMergedSince('not a date'), /date/);
});

test('ciStatus reduces runs', () => {
  const host = getHost({ gitHost: { kind: 'github' } }, fixtureEnv);
  const runs = 'https://github.com/acme/demo/actions/runs';
  const table = [
    ['aaaaaaa', { status: 'success', url: `${runs}/2` }],
    ['bbbbbbb', { status: 'pending', url: `${runs}/4` }],
    ['ccccccc', { status: 'failure', url: `${runs}/5` }],
    ['ddddddd', { status: 'unknown', url: null }],
    ['eeeeeee', { status: 'unknown', url: null }],
  ];
  for (const [sha, want] of table) assert.deepEqual(host.ciStatus(sha), want, sha);
  assert.deepEqual(reduceRuns([]), { status: 'unknown', url: null });
  assert.throws(() => host.ciStatus('--help'), /sha/);
});

test('getHost refuses an unsupported host kind', () => {
  assert.throws(() => getHost({ gitHost: { kind: 'gitlab' } }, {}), { message: 'unsupported git host: gitlab' });
});

function emptyPathEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-nopath-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k)));
  return { env: { ...env, PATH: dir }, dir };
}

test('gh missing yields a clear error', () => {
  const { env, dir } = emptyPathEnv();
  try {
    const host = getHost({ gitHost: { kind: 'github' } }, env);
    assert.throws(() => host.getPullRequest(1), {
      message: 'gh not found; install GitHub CLI or set SLICEKIT_GITHOST_FIXTURE',
    });
    assert.throws(() => host.getPullRequest(0), /positive integer/);
    withKit((root, cfg, ids) => {
      park(root, cfg, ids[0], pr14);
      const r = runCli(['status', '--sync'], { cwd: root, env });
      assert.equal(r.code, 2);
      assert.equal(r.stderr, 'slicekit: gh not found; install GitHub CLI or set SLICEKIT_GITHOST_FIXTURE\n');
    }, { slices: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('status --sync --write regenerates after syncing', () => {
  withKit((root, cfg, ids) => {
    park(root, cfg, ids[0], pr14);
    const env = { ...process.env, ...fixtureEnv };
    const r = runCli(['status', '--sync', '--write'], { cwd: root, env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `synced ${ids[0]} → merged (PR #14)\nBUILD.md updated\n`);
    const build = fs.readFileSync(kitPaths(root, cfg).build, 'utf8');
    assert.match(build, /^\| S-01 \|.*\| Done \|$/m);
    const again = runCli(['status', '--sync'], { cwd: root, env });
    assert.equal(again.code, 0, again.stderr);
    assert.ok(!again.stdout.includes('synced'), again.stdout);
  }, { slices: 1 });
});

test('a not-found pull request is warned and skipped; the rest of the sync runs', () => {
  withKit((root, cfg, ids) => {
    park(root, cfg, ids[0], pr14);
    park(root, cfg, ids[1], pr15);
    park(root, cfg, ids[2], { number: 0 });
    park(root, cfg, ids[3], { number: 16, headSha: 'ddd4444' });
    const file = path.join(kitPaths(root, cfg).state, stateFileName(ids[3]));
    const before = fs.readFileSync(file, 'utf8');
    const r = runCli(['status', '--sync'], { cwd: root, env: { ...process.env, ...fixtureEnv } });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.startsWith(`synced ${ids[0]} → merged (PR #14)\n`), r.stdout);
    assert.equal(readSlice(root, cfg, ids[0]).state, 'merged');
    assert.equal(readSlice(root, cfg, ids[1]).state, 'ready');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    const warnings = r.stderr.trimEnd().split('\n');
    assert.equal(warnings.length, 2, r.stderr);
    assert.match(warnings[0], new RegExp(`^slicekit: ${ids[2]} is ready but has no valid pull request number`));
    assert.equal(warnings[1], `slicekit: ${ids[3]}: pull request 16 could not be fetched: pull request 16 not found; skipped`);
  }, { slices: 4 });
});

test('a host failure after a change still reports the change, then the error', () => {
  withKit((root, cfg, ids) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-ghfix-'));
    try {
      fs.copyFileSync(path.join(FIXTURE, 'pr-14.json'), path.join(dir, 'pr-14.json'));
      fs.writeFileSync(path.join(dir, 'pr-17.json'), '{ not json');
      park(root, cfg, ids[0], pr14);
      park(root, cfg, ids[1], { number: 17 });
      park(root, cfg, ids[2], null);
      const r = runCli(['status', '--sync'], { cwd: root, env: { ...process.env, SLICEKIT_GITHOST_FIXTURE: dir } });
      assert.equal(r.code, 2);
      assert.equal(r.stdout, `synced ${ids[0]} → merged (PR #14)\n`);
      const err = r.stderr.trimEnd().split('\n');
      assert.match(err.at(-1), /^slicekit: git host fixture .*pr-17\.json/);
      assert.equal(readSlice(root, cfg, ids[0]).state, 'merged');
      assert.equal(readSlice(root, cfg, ids[1]).state, 'ready');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, { slices: 3 });
});

test('host failures are typed: not-found is GitHostNotFound, the rest GitHostError', () => {
  const host = getHost({ gitHost: { kind: 'github' } }, fixtureEnv);
  assert.throws(() => host.getPullRequest(99), (e) => e instanceof GitHostNotFound);
  const nf = ghExitError(['pr', 'view', '16', '--json', 'x'], 'GraphQL: Could not resolve to a PullRequest with the number of 16. (repository.pullRequest)');
  assert.ok(nf instanceof GitHostNotFound);
  assert.equal(nf.message, 'pull request 16 not found');
  const auth = ghExitError(['pr', 'view', '16', '--json', 'x'], 'gh auth login required');
  assert.ok(auth instanceof GitHostError && !(auth instanceof GitHostNotFound));
  assert.equal(auth.stderr, 'gh auth login required');
  const { env, dir } = emptyPathEnv();
  try {
    assert.throws(() => getHost({ gitHost: { kind: 'github' } }, env).ciStatus('abcdef0'), (e) => e instanceof GitHostError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('status --sync lets a non-host error through', async () => {
  const { statusCommand } = await import('../src/cli/status.js');
  await withKit(async (root) => {
    const io = { cwd: root, env: { SLICEKIT_GITHOST_FIXTURE: FIXTURE }, stdout: () => {}, stderr: () => {} };
    const statePath = path.join(root, '.slicekit', 'state');
    fs.mkdirSync(statePath, { recursive: true });
    fs.writeFileSync(path.join(statePath, 'P1-S-01.json'), '{ broken');
    await assert.rejects(statusCommand.run(['--sync'], io), { message: /P1-S-01\.json: not valid JSON$/ });
  }, { slices: 1 });
});

test('status --sync --json prints one JSON document on success', () => {
  withKit((root, cfg, ids) => {
    park(root, cfg, ids[0], pr14);
    park(root, cfg, ids[1], null);
    const r = runCli(['status', '--sync', '--json'], { cwd: root, env: { ...process.env, ...fixtureEnv } });
    assert.equal(r.code, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(data).sort(), ['slices', 'stage', 'synced', 'warnings']);
    assert.deepEqual(data.synced, [{ id: ids[0], from: 'ready', to: 'merged', pr: 14 }]);
    assert.equal(data.warnings.length, 1);
    assert.match(data.warnings[0], /has no valid pull request number/);
    assert.equal(data.slices[0].state, 'merged');
    const both = JSON.parse(runCli(['status', '--sync', '--write', '--json'], { cwd: root, env: { ...process.env, ...fixtureEnv } }).stdout);
    assert.equal(both.build, 'updated');
    assert.deepEqual(both.synced, []);
  });
});

test('status --sync --json prints one JSON document and exits 2 on a host failure', () => {
  withKit((root, cfg, ids) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-ghfix-'));
    try {
      fs.copyFileSync(path.join(FIXTURE, 'pr-14.json'), path.join(dir, 'pr-14.json'));
      fs.writeFileSync(path.join(dir, 'pr-17.json'), '{ not json');
      park(root, cfg, ids[0], pr14);
      park(root, cfg, ids[1], { number: 17 });
      park(root, cfg, ids[2], null);
      const r = runCli(['status', '--sync', '--json'], { cwd: root, env: { ...process.env, SLICEKIT_GITHOST_FIXTURE: dir } });
      assert.equal(r.code, 2);
      const data = JSON.parse(r.stdout);
      assert.deepEqual(Object.keys(data).sort(), ['error', 'synced', 'warnings']);
      assert.match(data.error, /^git host fixture .*pr-17\.json/);
      assert.deepEqual(data.synced, [{ id: ids[0], from: 'ready', to: 'merged', pr: 14 }]);
      assert.deepEqual(data.warnings, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, { slices: 3 });
});

test('the GitHub host runs gh in the project root and searches by merge date', () => {
  const calls = [];
  const list = [
    { number: 30, mergedAt: '2026-10-20T08:00:00Z', headRefOid: 'aaaaaaa', title: 'before the instant' },
    { number: 31, mergedAt: '2026-10-20T10:00:00Z', headRefOid: 'bbbbbbb', title: 'after the instant' },
  ];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return args[1] === 'list' ? JSON.stringify(list) : '[]';
  };
  const host = githubHost({ X: '1' }, '/the/project', exec);
  assert.deepEqual(host.listMergedSince('2026-10-20T09:30:00Z').map((p) => p.number), [31]);
  assert.equal(calls[0].cmd, 'gh');
  assert.equal(calls[0].opts.cwd, '/the/project');
  assert.deepEqual(calls[0].opts.env, { X: '1' });
  const args = calls[0].args;
  assert.equal(args[args.indexOf('--search') + 1], 'merged:>=2026-10-20');
  assert.equal(args[args.indexOf('--limit') + 1], '200');
  host.listMergedSince('2026-10-20T01:00:00+05:30');
  assert.equal(calls[1].args[calls[1].args.indexOf('--search') + 1], 'merged:>=2026-10-19');
  host.ciStatus('abcdef0');
  assert.equal(calls[2].opts.cwd, '/the/project');
});
