import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../src/init.js';
import { loadConfig } from '../src/config.js';
import { kitPaths } from '../src/paths.js';
import { readSlice, writeSlice } from '../src/state/index.js';
import { syncFromHost } from '../src/state/sync.js';
import { getHost } from '../src/adapters/githost/index.js';
import { reduceRuns } from '../src/adapters/githost/github.js';
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
    const before = fs.readFileSync(path.join(kitPaths(root, cfg).state, fs.readdirSync(kitPaths(root, cfg).state)[0]), 'utf8');
    const { changes } = syncFromHost(root, cfg, getHost(cfg, fixtureEnv));
    assert.deepEqual(changes, []);
    assert.equal(readSlice(root, cfg, ids[1]).state, 'ready');
    const after = fs.readFileSync(path.join(kitPaths(root, cfg).state, fs.readdirSync(kitPaths(root, cfg).state)[0]), 'utf8');
    assert.equal(after, before);
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
    assert.match(warnings[0], new RegExp(`${ids[0]}.*no pull request number`));
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
