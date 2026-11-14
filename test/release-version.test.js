// REQ-5.5, D-90 (P5/S-48): with `release.auto` on, the sync pull request after a slice merge sets the
// next version in package.json and writes its CHANGELOG.md section; check --ci on a sync pull request
// recomputes both for the merge its branch names. Driven through the commands the CI sync job runs:
// `status --sync --write`, then `sync open`, and `check --ci` on the sync pull request. Every host
// answer comes from a fixture directory (SLICEKIT_GITHOST_FIXTURE); nothing reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { init } from '../src/init.js';
import { CONFIG_PATH, loadConfig } from '../src/config.js';
import { readSlice, writeSlice } from '../src/state/index.js';
import { makeRemote, makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';
import { writeSliceFixture } from './helpers/slice-fixture.js';

// ---- helpers of this evaluation set ----

const PACKAGE = '{\n  "name": "demo",\n  "version": "0.1.0",\n  "private": true,\n  "scripts": { "test": "node --test" }\n}\n';
const CHANGELOG = '# Changelog\n\nEach version of demo, newest first.\n\n## 0.1.0\n\n- The first version.\n';
const INTRO = '# Changelog\n\nEach version of demo, newest first.\n\n';

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

const MERGED_AT = '2026-10-20T09:30:00Z';
// A merged pull request in the git host fixture.
const mergedPr = (number, slice, name) => ({
  number,
  url: `https://github.com/acme/demo/pull/${number}`,
  state: 'MERGED',
  mergedAt: MERGED_AT,
  headRefOid: `abc${number}def5678`,
  title: `[${slice}] ${name}`,
  body: `Slice: ${slice}`,
  labels: [],
});
const writeJson = (dir, name, value) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);

// A slice's recorded state, as the review loop or an earlier sync left it.
function parkAt(root, cfg, id, state, pr, extra = {}) {
  writeSlice(root, cfg, { ...readSlice(root, cfg, id), state, pr, ...extra });
}

// An initialised kit with `p1` slices in phase 1 (and `p2` in phase 2), package.json at 0.1.0 and a
// CHANGELOG.md, `release` set in config as given (undefined: absent), committed on main as "kit".
// The host fixture holds pull requests 14 (P1/S-01) and 16 (P1/S-02), both merged.
function withRelease(fn, { p1 = 3, p2 = 0, release } = {}) {
  const repo = makeRepo();
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-relfix-'));
  try {
    const root = repo.root;
    init(root, { name: 'demo', shape: 'backend' });
    const ids = [];
    for (let n = 1; n <= p1; n++) ids.push(writeSliceFixture(root, { phase: 1, n }));
    for (let n = 1; n <= p2; n++) ids.push(writeSliceFixture(root, { phase: 2, n }));
    fs.writeFileSync(path.join(root, 'docs', 'phases', 'P1-x', 'P1.md'), '# Phase 1 — Spine\n');
    if (p2 > 0) fs.writeFileSync(path.join(root, 'docs', 'phases', 'P2-x', 'P2.md'), '# Phase 2 — Reach\n');
    fs.writeFileSync(path.join(root, 'package.json'), PACKAGE);
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG);
    if (release !== undefined) {
      const file = path.join(root, CONFIG_PATH);
      const conf = JSON.parse(fs.readFileSync(file, 'utf8'));
      conf.release = release;
      fs.writeFileSync(file, `${JSON.stringify(conf, null, 2)}\n`);
    }
    writeJson(fixture, 'pr-14.json', mergedPr(14, 'P1/S-01', 'Fixture 1'));
    writeJson(fixture, 'pr-16.json', mergedPr(16, 'P1/S-02', 'Fixture 2'));
    gitIn(root, ['add', '-A']);
    gitIn(root, ['commit', '-q', '-m', 'kit'], { allowProtected: true });
    return fn({ root, fixture, cfg: loadConfig(root), ids });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    repo.cleanup();
  }
}

// Commits everything on main as the merge of a pull request: a GitHub merge commit's message.
function mergeCommit(root, subject, body = '') {
  gitIn(root, ['add', '-A']);
  gitIn(root, ['commit', '-q', '--allow-empty', '-m', subject, ...(body ? ['-m', body] : [])], { allowProtected: true });
  return gitIn(root, ['rev-parse', 'HEAD']);
}

// The sync job's first step, on the default branch's merge commit.
function syncWrite(root, fixture) {
  const r = runCli(['status', '--sync', '--write'], { cwd: root, env: cliEnv(fixture) });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  return r;
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const versionOf = (root) => JSON.parse(read(root, 'package.json')).version;
// The versions CHANGELOG.md's `## ` headings name, newest first.
const versions = (text) => text.split('\n').filter((l) => /^## /.test(l)).map((l) => l.replace(/^## /, '').split(/\s/)[0]);
// The newest section: from the first `## ` heading up to the next one.
function newest(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## /.test(l));
  assert.ok(start >= 0, text);
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}
// package.json as it was, with only its version field changed.
const withVersion = (before, v) => before.replace(/"version": "[^"]*"/, `"version": "${v}"`);

// ---- the evaluation set ----

test('a slice merge sets the next patch version and a changelog section', () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    parkAt(root, cfg, ids[0], 'ready', { number: 14, headSha: 'abc14def5678' });
    mergeCommit(root, 'Merge pull request #14 from acme/slice/p1-s-01', '[P1/S-01] Fixture 1');
    const remote = makeRemote(root);
    try {
      gitIn(root, ['push', '-q', 'origin', 'main']);
      const mainTip = gitIn(root, ['rev-parse', 'HEAD']);
      const pkgBefore = read(root, 'package.json');
      const logBefore = read(root, 'CHANGELOG.md');

      syncWrite(root, fixture);
      assert.equal(readSlice(root, cfg, ids[0]).state, 'merged');
      // package.json: the patch number up by one, and no other byte changed.
      assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.1.1'));
      // CHANGELOG.md: one new section on top, under the file's intro, naming the slice, its name and pull request.
      const log = read(root, 'CHANGELOG.md');
      assert.deepEqual(versions(log), ['0.1.1', '0.1.0']);
      assert.ok(log.startsWith(`${INTRO}## 0.1.1`), log);
      assert.ok(log.endsWith(logBefore.slice(logBefore.indexOf('## 0.1.0'))), log);
      const section = newest(log);
      for (const want of ['P1/S-01', 'Fixture 1', '#14']) assert.ok(section.includes(want), `${want} in\n${section}`);
      for (const not of ['P1/S-02', 'P1/S-03']) assert.ok(!section.includes(not), `${not} in\n${section}`);

      // The sync job's second step carries the version and the section on the sync branch, not on main.
      const short = gitIn(root, ['rev-parse', '--short', 'HEAD']);
      const opened = runCli(['sync', 'open'], { cwd: root, env: cliEnv(fixture) });
      assert.equal(opened.code, 0, opened.stderr + opened.stdout);
      const branch = `sync/${short}`;
      assert.equal(gitIn(remote.remote, ['rev-parse', 'refs/heads/main']), mainTip);
      const changed = gitIn(remote.remote, ['diff', '--name-only', 'refs/heads/main', `refs/heads/${branch}`]).split('\n').filter(Boolean);
      for (const f of ['package.json', 'CHANGELOG.md']) assert.ok(changed.includes(f), `${f} not on ${branch}: ${changed.join(', ')}`);
      assert.equal(JSON.parse(gitIn(remote.remote, ['show', `refs/heads/${branch}:package.json`])).version, '0.1.1');
      assert.deepEqual(versions(gitIn(remote.remote, ['show', `refs/heads/${branch}:CHANGELOG.md`])), ['0.1.1', '0.1.0']);
    } finally {
      remote.cleanup();
    }
  }, { release: { auto: true } });
});

test('the merge that completes a phase sets the next minor version', () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    // P1/S-01 merged earlier (its sync recorded it); P1/S-02 is the last slice of phase 1; phase 2 is open.
    const [s1, s2, p2s1] = ids;
    fs.writeFileSync(path.join(root, 'package.json'), withVersion(PACKAGE, '0.1.3'));
    parkAt(root, cfg, s1, 'merged', { number: 13, headSha: 'abc13def5678' }, { mergedAt: '2026-10-19T09:00:00Z' });
    parkAt(root, cfg, s2, 'ready', { number: 14, headSha: 'abc14def5678' });
    mergeCommit(root, 'Merge pull request #14 from acme/slice/p1-s-02', '[P1/S-02] Fixture 2');
    const pkgBefore = read(root, 'package.json');

    syncWrite(root, fixture);
    assert.equal(readSlice(root, cfg, s2).state, 'merged');
    assert.equal(readSlice(root, cfg, p2s1).state, 'todo');
    // The minor number up by one and the patch at 0.
    assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.2.0'));
    const log = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(log), ['0.2.0', '0.1.0']);
    const section = newest(log);
    // The phase, and each of its slices with its name; the merged one with its pull request.
    assert.match(section, /Phase 1|P1(?!\/)/);
    for (const want of ['P1/S-01', 'Fixture 1', 'P1/S-02', 'Fixture 2', '#14']) assert.ok(section.includes(want), `${want} in\n${section}`);
    assert.ok(!section.includes('P2/S-01'), section);
  }, { p1: 2, p2: 1, release: { auto: true } });
});

test('a sync that records two slice merges sets one version naming both', () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    // The sync pull request after #14 was superseded unmerged, so main still records P1/S-01 at ready
    // when #16 merges: this sync records both merges.
    parkAt(root, cfg, ids[0], 'ready', { number: 14, headSha: 'abc14def5678' });
    parkAt(root, cfg, ids[1], 'ready', { number: 16, headSha: 'abc16def5678' });
    mergeCommit(root, 'Merge pull request #16 from acme/slice/p1-s-02', '[P1/S-02] Fixture 2');
    const pkgBefore = read(root, 'package.json');

    syncWrite(root, fixture);
    assert.deepEqual([readSlice(root, cfg, ids[0]).state, readSlice(root, cfg, ids[1]).state], ['merged', 'merged']);
    // One version, the patch up by one, and one section naming both slices.
    assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.1.1'));
    const log = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(log), ['0.1.1', '0.1.0']);
    const section = newest(log);
    for (const want of ['P1/S-01', 'Fixture 1', '#14', 'P1/S-02', 'Fixture 2', '#16']) assert.ok(section.includes(want), `${want} in\n${section}`);
    assert.ok(!section.includes('P1/S-03'), section);
  }, { release: { auto: true } });
});

test('a merge that sets the version itself, a plan merge, or a config without release.auto sets no version', () => {
  // A config without release.auto, or with it false: the slice syncs, package.json and CHANGELOG.md stay.
  for (const release of [undefined, { auto: false }]) {
    withRelease(({ root, fixture, cfg, ids }) => {
      parkAt(root, cfg, ids[0], 'ready', { number: 14, headSha: 'abc14def5678' });
      mergeCommit(root, 'Merge pull request #14 from acme/slice/p1-s-01', '[P1/S-01] Fixture 1');
      syncWrite(root, fixture);
      assert.equal(readSlice(root, cfg, ids[0]).state, 'merged', JSON.stringify(release));
      assert.equal(read(root, 'package.json'), PACKAGE, JSON.stringify(release));
      assert.equal(read(root, 'CHANGELOG.md'), CHANGELOG, JSON.stringify(release));
    }, { release });
  }

  // release.auto is a boolean; anything else is a config error naming it.
  withRelease(({ root, fixture }) => {
    const r = runCli(['status', '--sync', '--write'], { cwd: root, env: cliEnv(fixture) });
    assert.equal(r.code, 2, r.stdout);
    assert.match(r.stderr, /release\.auto/);
  }, { release: { auto: 'yes' } });

  withRelease(({ root, fixture, cfg, ids }) => {
    // The release slice's own merge sets package.json's version and its section itself: the sync sets none.
    fs.writeFileSync(path.join(root, 'package.json'), withVersion(PACKAGE, '0.3.0'));
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `${INTRO}## 0.3.0\n\n- Phase 1.\n\n## 0.1.0\n\n- The first version.\n`);
    parkAt(root, cfg, ids[0], 'ready', { number: 14, headSha: 'abc14def5678' });
    mergeCommit(root, 'Merge pull request #14 from acme/slice/p1-s-01', '[P1/S-01] Fixture 1');
    const pkg = read(root, 'package.json');
    const log = read(root, 'CHANGELOG.md');
    syncWrite(root, fixture);
    assert.equal(readSlice(root, cfg, ids[0]).state, 'merged');
    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);

    // The [sync] pull request's merge records no slice merge and sets no version.
    mergeCommit(root, 'Merge pull request #21 from acme/sync/abc1234', '[sync] state after abc1234');
    syncWrite(root, fixture);
    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);

    // A [plan] merge adds a slice and records no slice merge: no version.
    writeSliceFixture(root, { phase: 1, n: 4 });
    mergeCommit(root, 'Merge pull request #22 from acme/plan/p1-s-04', '[plan] Add P1/S-04');
    syncWrite(root, fixture);
    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);

    // The next slice merge counts from the version on the default branch: 0.3.0, so 0.3.1.
    parkAt(root, cfg, ids[1], 'ready', { number: 16, headSha: 'abc16def5678' });
    mergeCommit(root, 'Merge pull request #16 from acme/slice/p1-s-02', '[P1/S-02] Fixture 2');
    syncWrite(root, fixture);
    assert.equal(read(root, 'package.json'), withVersion(pkg, '0.3.1'));
    const after = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(after), ['0.3.1', '0.3.0', '0.1.0']);
    const section = newest(after);
    assert.ok(section.includes('P1/S-02') && section.includes('#16'), section);
    assert.ok(!section.includes('P1/S-01'), section);
  }, { release: { auto: true } });
});

test('a sync pull request whose version or changelog differs from what CI computes fails', () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    parkAt(root, cfg, ids[0], 'ready', { number: 14, headSha: 'abc14def5678' });
    const merge = mergeCommit(root, 'Merge pull request #14 from acme/slice/p1-s-01', '[P1/S-01] Fixture 1');
    const short = merge.slice(0, 7);
    const branch = `sync/${short}`;

    // The sync branch as the sync job makes it, then `tamper` applied to it, judged by check --ci.
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
      const on = (file) => out.findings.filter((f) => f.file === file);
      gitIn(root, ['checkout', '-q', 'main']);
      return { pkg: on('package.json'), log: on('CHANGELOG.md') };
    };

    // As the sync job computed it: no finding on either file.
    const clean = judge(() => {
      assert.equal(versionOf(root), '0.1.1');
      assert.deepEqual(versions(read(root, 'CHANGELOG.md')), ['0.1.1', '0.1.0']);
    });
    assert.deepEqual(clean.pkg, [], JSON.stringify(clean.pkg));
    assert.deepEqual(clean.log, [], JSON.stringify(clean.log));

    // Another version than CI computes for the merge.
    const wrongVersion = judge(() => fs.writeFileSync(path.join(root, 'package.json'), withVersion(read(root, 'package.json'), '0.1.2')));
    assert.equal(wrongVersion.pkg.length, 1, JSON.stringify(wrongVersion.pkg));
    // A change to package.json beyond its version field.
    const otherField = judge(() => fs.writeFileSync(path.join(root, 'package.json'), read(root, 'package.json').replace('"private": true', '"private": false')));
    assert.equal(otherField.pkg.length, 1, JSON.stringify(otherField.pkg));
    // A new section that differs from the one CI computes.
    const wrongSection = judge(() => fs.writeFileSync(path.join(root, 'CHANGELOG.md'), read(root, 'CHANGELOG.md').replace('Fixture 1', 'Fixture 9')));
    assert.equal(wrongSection.log.length, 1, JSON.stringify(wrongSection.log));
    // An edit below the new section.
    const olderEdited = judge(() => fs.writeFileSync(path.join(root, 'CHANGELOG.md'), read(root, 'CHANGELOG.md').replace('- The first version.', '- The first version, edited.')));
    assert.equal(olderEdited.log.length, 1, JSON.stringify(olderEdited.log));
  }, { release: { auto: true } });
});
