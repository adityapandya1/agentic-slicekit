// REQ-5.5, D-95 (P5/S-50): a sync that sets a version re-renders each folder under `examples/` that
// holds rendered files, as `update --yes` would in that folder; its pull request carries those files,
// and `check --ci` on a sync pull request accepts an example file only where it equals a fresh render
// at that version. Driven through the commands the CI sync job runs: `status --sync --write`, then
// `sync open`, and `check --ci` on the sync pull request. Every host answer comes from a fixture
// directory (SLICEKIT_GITHOST_FIXTURE); nothing reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { init } from '../src/init.js';
import { CONFIG_PATH, loadConfig } from '../src/config.js';
import { kitVersion } from '../src/render/index.js';
import { applyUpdate, planUpdate } from '../src/render/update.js';
import { readSlice, writeSlice } from '../src/state/index.js';
import { makeRemote, makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';
import { writeSliceFixture } from './helpers/slice-fixture.js';

// ---- helpers of this evaluation set ----

// The version the fixture's examples are committed at: older than any version a sync sets here.
const OLD = '0.0.1';
const EXAMPLE = 'examples/demo';
const PLAIN = 'examples/plain';
const SETTINGS = `${EXAMPLE}/.claude/settings.json`;

// Where the fixture's package.json starts, and how many slices its phase 1 holds, so that the
// version the sync sets is the running kit's version. A fixture repository is not the kit's own
// checkout, where the render is stamped with the running kit's version; with the two equal, "the
// version the sync sets" reads the same in both. With the patch above 0 one slice of two merges
// (the patch goes up); with the patch at 0 the one slice of the phase merges (the minor goes up).
// A kit at <major>.0.0 has no such start: the fixture then starts at the kit's version, and the
// version the sync sets is the next patch.
function startFor(kit) {
  const [major, minor, patch] = kit.split('.').map(Number);
  if (patch > 0) return { from: `${major}.${minor}.${patch - 1}`, p1: 2, to: kit };
  if (minor > 0) return { from: `${major}.${minor - 1}.0`, p1: 1, to: kit };
  return { from: kit, p1: 2, to: `${major}.0.1` };
}
const START = startFor(kitVersion());
const TARGET = START.to;

const PACKAGE = `{\n  "name": "demo",\n  "version": "${START.from}",\n  "private": true,\n  "scripts": { "test": "node --test" }\n}\n`;
const CHANGELOG = `# Changelog\n\nEach version of demo, newest first.\n\n## ${START.from}\n\n- The first version.\n`;

// git in `cwd`; a commit on main carries the documented exception, nothing else does.
function gitIn(cwd, args, { allowProtected = false } = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'ALLOW_PROTECTED_COMMIT') delete env[k];
  if (allowProtected) env.ALLOW_PROTECTED_COMMIT = '1';
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// The CLI's environment: this process's, without any CI pull request or commit exception, with the host fixture.
function cliEnv(fixture, extra = {}) {
  const env = { ...process.env };
  const drop = ['ALLOW_PROTECTED_COMMIT', 'GITHUB_EVENT_PATH', 'GITHUB_EVENT_NAME', 'GITHUB_HEAD_REF', 'GITHUB_BASE_REF', 'GITHUB_REF', 'SLICEKIT_PR_TITLE', 'SLICEKIT_PR_BODY', 'SLICEKIT_GITHOST_FIXTURE'];
  for (const k of Object.keys(env)) if (drop.includes(k.toUpperCase())) delete env[k];
  return { ...env, SLICEKIT_GITHOST_FIXTURE: fixture, ...extra };
}

const writeJson = (dir, name, value) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
const abs = (root, rel) => path.join(root, ...rel.split('/'));
const read = (root, rel) => fs.readFileSync(abs(root, rel), 'utf8');
const versionOf = (root) => JSON.parse(read(root, 'package.json')).version;

// Every file under `dir`, as POSIX paths from it, sorted.
function filesUnder(dir) {
  const out = [];
  const walk = (at, prefix) => {
    for (const e of fs.readdirSync(at, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(at, e.name), `${prefix}${e.name}/`);
      else out.push(`${prefix}${e.name}`);
    }
  };
  walk(dir, '');
  return out.sort();
}

// The versions an example holds reference copies of: the directories under its .slicekit/rendered.
const renderedVersions = (root, example) => fs.readdirSync(abs(root, `${example}/.slicekit/rendered`)).sort();
// The rendered files of an example whose `update` plan at `version` is not `same`.
function drift(root, example, version) {
  const dir = abs(root, example);
  return planUpdate(dir, loadConfig(dir), { version })
    .filter((item) => item.status !== 'same')
    .map((item) => item.dest);
}

// An initialised kit with release.auto on, package.json at START.from, a CHANGELOG.md and the slices
// of phase 1, of which P1/S-01 is recorded `ready` with pull request 14, merged on the host fixture.
// Under examples/ it holds two folders: examples/demo, an initialised kit of its own whose rendered
// files and reference copies are at OLD, and examples/plain, which holds no rendered file. All of it
// is committed on main as the merge of pull request 14. -> {root, fixture, cfg, merge}
function withExamples(fn) {
  const repo = makeRepo();
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-exfix-'));
  try {
    const root = repo.root;
    init(root, { name: 'demo', shape: 'backend' });
    const ids = [];
    for (let n = 1; n <= START.p1; n++) ids.push(writeSliceFixture(root, { phase: 1, n }));
    fs.writeFileSync(path.join(root, 'docs', 'phases', 'P1-x', 'P1.md'), '# Phase 1 — Spine\n');
    fs.writeFileSync(path.join(root, 'package.json'), PACKAGE);
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG);
    const file = path.join(root, CONFIG_PATH);
    const conf = JSON.parse(fs.readFileSync(file, 'utf8'));
    conf.release = { auto: true };
    fs.writeFileSync(file, `${JSON.stringify(conf, null, 2)}\n`);

    // examples/demo: initialised, then rendered at OLD as `update --yes` of a kit at OLD left it.
    const demo = abs(root, EXAMPLE);
    fs.mkdirSync(demo, { recursive: true });
    fs.writeFileSync(path.join(demo, 'package.json'), '{\n  "name": "counter",\n  "version": "1.0.0",\n  "private": true\n}\n');
    init(demo, { name: 'counter', shape: 'backend' });
    const demoCfg = loadConfig(demo);
    applyUpdate(demo, demoCfg, planUpdate(demo, demoCfg, { version: OLD }), { version: OLD });
    assert.deepEqual(renderedVersions(root, EXAMPLE), [OLD], 'the fixture example is not rendered at the old version');
    assert.deepEqual(drift(root, EXAMPLE, OLD), [], 'the fixture example differs from a render at the old version');
    assert.notDeepEqual(drift(root, EXAMPLE, TARGET), [], 'the fixture example already equals a render at the new version');

    // examples/plain: a project before init, as examples/backend is in the kit's repository.
    fs.mkdirSync(abs(root, PLAIN), { recursive: true });
    fs.writeFileSync(abs(root, `${PLAIN}/README.md`), '# plain\n\nAn example before init.\n');
    fs.writeFileSync(abs(root, `${PLAIN}/package.json`), '{\n  "name": "plain",\n  "version": "1.0.0",\n  "private": true\n}\n');

    writeJson(fixture, 'pr-14.json', {
      number: 14,
      url: 'https://github.com/acme/demo/pull/14',
      state: 'MERGED',
      mergedAt: '2026-10-20T09:30:00Z',
      headRefOid: 'abc14def5678',
      title: '[P1/S-01] Fixture 1',
      body: 'Slice: P1/S-01',
      labels: [],
    });
    gitIn(root, ['add', '-A']);
    gitIn(root, ['commit', '-q', '-m', 'kit'], { allowProtected: true });
    const cfg = loadConfig(root);
    writeSlice(root, cfg, { ...readSlice(root, cfg, ids[0]), state: 'ready', pr: { number: 14, headSha: 'abc14def5678' } });
    gitIn(root, ['add', '-A']);
    gitIn(root, ['commit', '-q', '-m', 'Merge pull request #14 from acme/slice/p1-s-01', '-m', '[P1/S-01] Fixture 1'], { allowProtected: true });
    return fn({ root, fixture, cfg, merge: gitIn(root, ['rev-parse', 'HEAD']) });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    repo.cleanup();
  }
}

// The sync job's first step, on the default branch's merge commit.
function syncWrite(root, fixture) {
  const r = runCli(['status', '--sync', '--write'], { cwd: root, env: cliEnv(fixture) });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  return r;
}

// ---- the evaluation set ----

test('a sync that sets a version re-renders each example at it', { timeout: 300_000 }, () => {
  withExamples(({ root, fixture }) => {
    const remote = makeRemote(root);
    try {
      gitIn(root, ['push', '-q', 'origin', 'main']);
      const mainTip = gitIn(root, ['rev-parse', 'HEAD']);
      const plainBefore = filesUnder(abs(root, PLAIN));

      syncWrite(root, fixture);
      assert.equal(versionOf(root), TARGET);

      // examples/demo: every rendered file equals a render at the version set, and its reference
      // copies are that version's alone, as `update --yes` leaves them.
      assert.deepEqual(renderedVersions(root, EXAMPLE), [TARGET]);
      assert.deepEqual(drift(root, EXAMPLE, TARGET), [], `${EXAMPLE} holds rendered files that differ from a render at ${TARGET}`);
      assert.equal(JSON.parse(read(root, SETTINGS))._slicekit.version, TARGET);
      // Its own package.json is the example's, not a file the sync versions.
      assert.equal(JSON.parse(read(root, `${EXAMPLE}/package.json`)).version, '1.0.0');
      // examples/plain holds no rendered file, and gets none.
      assert.deepEqual(filesUnder(abs(root, PLAIN)), plainBefore);

      // The sync job's second step carries the example's files on the sync branch, not on main.
      const short = gitIn(root, ['rev-parse', '--short', 'HEAD']);
      const opened = runCli(['sync', 'open'], { cwd: root, env: cliEnv(fixture) });
      assert.equal(opened.code, 0, opened.stderr + opened.stdout);
      const branch = `sync/${short}`;
      assert.equal(gitIn(remote.remote, ['rev-parse', 'refs/heads/main']), mainTip);
      const changed = gitIn(remote.remote, ['diff', '--name-only', '--no-renames', 'refs/heads/main', `refs/heads/${branch}`]).split('\n').filter(Boolean);
      for (const f of ['package.json', 'CHANGELOG.md', SETTINGS, `${EXAMPLE}/.slicekit/rendered/${TARGET}/.claude/settings.json`, `${EXAMPLE}/.slicekit/rendered/${OLD}/.claude/settings.json`]) {
        assert.ok(changed.includes(f), `${f} not on ${branch}: ${changed.join(', ')}`);
      }
      assert.deepEqual(changed.filter((f) => f.startsWith(`${PLAIN}/`)), []);
      // What the branch holds for the example is what the sync wrote: a render at the version set.
      const onBranch = (rel) => gitIn(remote.remote, ['show', `refs/heads/${branch}:${rel}`]);
      assert.equal(JSON.parse(onBranch(SETTINGS))._slicekit.version, TARGET);
      const held = gitIn(remote.remote, ['ls-tree', '-r', '--name-only', `refs/heads/${branch}`, '--', `${EXAMPLE}/.slicekit/rendered`]).split('\n').filter(Boolean);
      assert.ok(held.length > 0 && held.every((f) => f.startsWith(`${EXAMPLE}/.slicekit/rendered/${TARGET}/`)), held.join(', '));
    } finally {
      remote.cleanup();
    }
  });
});

test('a sync pull request whose example file differs from a fresh render fails, naming the file', { timeout: 600_000 }, () => {
  withExamples(({ root, fixture, merge }) => {
    const short = merge.slice(0, 7);
    const branch = `sync/${short}`;
    const reference = `${EXAMPLE}/.slicekit/rendered/${TARGET}/.claude/settings.json`;

    // The sync branch as the sync job makes it, then `tamper` applied to it, judged by check --ci.
    // -> the findings on a file under examples/.
    const judge = (tamper) => {
      gitIn(root, ['checkout', '-q', '-B', branch, merge]);
      syncWrite(root, fixture);
      tamper();
      gitIn(root, ['add', '-A']);
      gitIn(root, ['commit', '-q', '-m', `chore(slicekit): sync state after ${short}`]);
      const head = gitIn(root, ['rev-parse', 'HEAD']);
      const event = path.join(fixture, 'event.json');
      writeJson(fixture, 'event.json', {
        pull_request: {
          number: 21,
          title: `[sync] state after ${short}`,
          body: `**Done when:** the slice state after ${short} is on main\n**Proof:** status --sync --write\n**Decisions:** none\n`,
          head: { ref: branch, sha: head },
          base: { ref: 'main' },
          user: { login: 'github-actions[bot]' },
          labels: [],
        },
      });
      const r = runCli(['check', '--ci', '--json'], {
        cwd: root,
        env: cliEnv(fixture, { GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: branch, GITHUB_BASE_REF: 'main' }),
      });
      const out = JSON.parse(r.stdout);
      assert.ok(Array.isArray(out.findings), r.stdout + r.stderr);
      gitIn(root, ['checkout', '-q', 'main']);
      return out.findings.filter((f) => typeof f.file === 'string' && f.file.startsWith('examples/'));
    };
    const files = (findings) => findings.map((f) => f.file).sort();

    // As the sync job rendered it: the branch carries the example at the version set, with no finding on it.
    const clean = judge(() => {
      assert.equal(versionOf(root), TARGET);
      assert.deepEqual(renderedVersions(root, EXAMPLE), [TARGET]);
      assert.equal(JSON.parse(read(root, SETTINGS))._slicekit.version, TARGET);
    });
    assert.deepEqual(clean, [], JSON.stringify(clean));

    // A rendered file of the example stamped with another version than the one the sync sets.
    const wrongVersion = judge(() => {
      const settings = JSON.parse(read(root, SETTINGS));
      settings._slicekit.version = '9.9.9';
      fs.writeFileSync(abs(root, SETTINGS), `${JSON.stringify(settings, null, 2)}\n`);
    });
    assert.deepEqual(files(wrongVersion), [SETTINGS], JSON.stringify(wrongVersion));
    assert.equal(wrongVersion[0].rule, 'sync-release', JSON.stringify(wrongVersion));

    // A rendered file of the example left as the merge holds it, at the old version.
    const stale = judge(() => fs.writeFileSync(abs(root, SETTINGS), `${gitIn(root, ['show', `${merge}:${SETTINGS}`])}\n`));
    assert.deepEqual(files(stale), [SETTINGS], JSON.stringify(stale));

    // A reference copy of the example that is not the one a fresh render writes.
    const copy = judge(() => fs.writeFileSync(abs(root, reference), `${read(root, reference)}\n`));
    assert.deepEqual(files(copy), [reference], JSON.stringify(copy));
  });
});
