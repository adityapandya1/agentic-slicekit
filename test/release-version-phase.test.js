// REQ-5.5, D-96 (P6/S-51, issue #174): a phase gets its minor version once, the first time every
// slice of it is merged or released. The changelog is the record: a phase whose line a CHANGELOG.md
// section on the default branch holds has had its minor version, so a slice added to that phase
// later is a patch version whose section names that slice alone. `check --ci` on a sync pull request
// computes the same. Driven through the commands the CI sync job runs, `status --sync --write`, and
// `check --ci` on the sync pull request. Every host answer comes from a fixture directory
// (SLICEKIT_GITHOST_FIXTURE); nothing reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { init } from '../src/init.js';
import { CONFIG_PATH, loadConfig } from '../src/config.js';
import { readSlice, writeSlice } from '../src/state/index.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';
import { writeSliceFixture } from './helpers/slice-fixture.js';

// ---- helpers of this evaluation set ----

const PACKAGE = '{\n  "name": "demo",\n  "version": "0.1.3",\n  "private": true,\n  "scripts": { "test": "node --test" }\n}\n';
const INTRO = '# Changelog\n\nEach version of demo, newest first.\n\n';
const CHANGELOG = `${INTRO}## 0.1.0\n\n- The first version.\n`;

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

// A merged pull request in the git host fixture.
const mergedPr = (number, slice, name) => ({
  number,
  url: `https://github.com/acme/demo/pull/${number}`,
  state: 'MERGED',
  mergedAt: '2026-10-20T09:30:00Z',
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
// The non-empty lines under a section's heading.
const body = (section) => section.split('\n').slice(1).map((l) => l.trimEnd()).filter((l) => l !== '');
// package.json as it was, with only its version field changed.
const withVersion = (before, v) => before.replace(/"version": "[^"]*"/, `"version": "${v}"`);

// The history of issue #174, on main, with release.auto on and package.json at 0.1.3:
//   1. phase 1 has two slices; P1/S-01 merged earlier, and the merge of P1/S-02 completes the phase.
//      Its sync sets the phase's minor version, 0.2.0, and that sync pull request merges.
//   2. a plan pull request adds P1/S-03 to the phase and merges.
//   3. P1/S-03 merges (#18), which leaves every slice of phase 1 merged a second time.
// `fn` gets the repository standing on that last merge, before its sync ran.
function withSliceAddedToACompletedPhase(fn) {
  const repo = makeRepo();
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-relfix-'));
  try {
    const root = repo.root;
    init(root, { name: 'demo', shape: 'backend' });
    const s1 = writeSliceFixture(root, { phase: 1, n: 1 });
    const s2 = writeSliceFixture(root, { phase: 1, n: 2 });
    fs.writeFileSync(path.join(root, 'docs', 'phases', 'P1-x', 'P1.md'), '# Phase 1 — Spine\n');
    fs.writeFileSync(path.join(root, 'package.json'), PACKAGE);
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG);
    const file = path.join(root, CONFIG_PATH);
    const conf = JSON.parse(fs.readFileSync(file, 'utf8'));
    conf.release = { auto: true };
    fs.writeFileSync(file, `${JSON.stringify(conf, null, 2)}\n`);
    writeJson(fixture, 'pr-14.json', mergedPr(14, 'P1/S-02', 'Fixture 2'));
    writeJson(fixture, 'pr-18.json', mergedPr(18, 'P1/S-03', 'Fixture 3'));
    gitIn(root, ['add', '-A']);
    gitIn(root, ['commit', '-q', '-m', 'kit'], { allowProtected: true });
    const cfg = loadConfig(root);

    // 1. The phase completes: its minor version and its phase section, as before D-96.
    parkAt(root, cfg, s1, 'merged', { number: 13, headSha: 'abc13def5678' }, { mergedAt: '2026-10-19T09:00:00Z' });
    parkAt(root, cfg, s2, 'ready', { number: 14, headSha: 'abc14def5678' });
    mergeCommit(root, 'Merge pull request #14 from acme/slice/p1-s-02', '[P1/S-02] Fixture 2');
    syncWrite(root, fixture);
    assert.equal(versionOf(root), '0.2.0');
    const first = newest(read(root, 'CHANGELOG.md'));
    assert.match(first, /^Phase 1\b/m, first);
    for (const want of ['P1/S-01', 'P1/S-02']) assert.ok(first.includes(want), `${want} in\n${first}`);
    mergeCommit(root, 'Merge pull request #15 from acme/sync/abc1234', '[sync] state after abc1234');

    // 2. The plan adds a slice to the phase that has its minor version.
    const s3 = writeSliceFixture(root, { phase: 1, n: 3 });
    mergeCommit(root, 'Merge pull request #17 from acme/plan/p1-s-03', '[plan] Add P1/S-03');
    syncWrite(root, fixture);
    assert.equal(versionOf(root), '0.2.0', 'a plan merge sets no version');
    mergeCommit(root, 'Merge pull request #19 from acme/sync/abc5678', '[sync] state after abc5678');

    // 3. That slice merges.
    parkAt(root, cfg, s3, 'ready', { number: 18, headSha: 'abc18def5678' });
    const merge = mergeCommit(root, 'Merge pull request #18 from acme/slice/p1-s-03', '[P1/S-03] Fixture 3');
    return fn({ root, fixture, cfg, ids: [s1, s2, s3], merge });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    repo.cleanup();
  }
}

// ---- the evaluation set ----

test('a slice added to a phase that has its minor version gets a patch version naming that slice alone', () => {
  withSliceAddedToACompletedPhase(({ root, fixture, cfg, ids }) => {
    const pkgBefore = read(root, 'package.json');
    const logBefore = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(logBefore), ['0.2.0', '0.1.0']);

    syncWrite(root, fixture);
    // Every slice of the phase is merged again, and the phase's line is in the 0.2.0 section.
    assert.deepEqual(ids.map((id) => readSlice(root, cfg, id).state), ['merged', 'merged', 'merged']);
    // The patch number up by one, never a second minor version; no other byte of package.json changed.
    assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.2.1'));
    const log = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(log), ['0.2.1', '0.2.0', '0.1.0']);
    assert.ok(log.startsWith(`${INTRO}## 0.2.1`), log);
    assert.ok(log.endsWith(logBefore.slice(logBefore.indexOf('## 0.2.0'))), log);
    // The section names the newly merged slice alone: no phase line, no other slice of the phase.
    const section = newest(log);
    assert.deepEqual(body(section), ['- P1/S-03 Fixture 3 (#18)'], section);
    assert.doesNotMatch(section, /^Phase /m);
    for (const not of ['P1/S-01', 'P1/S-02']) assert.ok(!section.includes(not), `${not} in\n${section}`);
  });
});

test('a sync pull request that sets a second minor version for a phase is a finding', () => {
  withSliceAddedToACompletedPhase(({ root, fixture, merge }) => {
    const short = merge.slice(0, 7);
    const branch = `sync/${short}`;
    const pkgAtMerge = read(root, 'package.json');
    const logAtMerge = read(root, 'CHANGELOG.md');

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
      const on = (file) => out.findings.filter((f) => f.rule === 'sync-release' && f.file === file);
      gitIn(root, ['checkout', '-q', 'main']);
      return { pkg: on('package.json'), log: on('CHANGELOG.md') };
    };

    // The second minor version for phase 1, with the phase section naming every slice again: what a
    // sync wrote for this merge before D-96 (issue #174).
    const secondMinor = judge(() => {
      const phaseSection = '## 0.3.0\n\nPhase 1: Spine.\n\n- P1/S-01 Fixture 1 (#13)\n- P1/S-02 Fixture 2 (#14)\n- P1/S-03 Fixture 3 (#18)\n\n';
      fs.writeFileSync(path.join(root, 'package.json'), withVersion(pkgAtMerge, '0.3.0'));
      fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `${INTRO}${phaseSection}${logAtMerge.slice(logAtMerge.indexOf('## 0.2.0'))}`);
    });
    // One finding per file.
    assert.equal(secondMinor.pkg.length, 1, JSON.stringify(secondMinor.pkg));
    assert.equal(secondMinor.log.length, 1, JSON.stringify(secondMinor.log));
    for (const f of [...secondMinor.pkg, ...secondMinor.log]) assert.ok(f.message.includes(short), f.message);

    // The patch version the sync job computes, naming P1/S-03 alone: no finding on either file.
    const clean = judge(() => {
      assert.equal(versionOf(root), '0.2.1');
      assert.deepEqual(versions(read(root, 'CHANGELOG.md')), ['0.2.1', '0.2.0', '0.1.0']);
    });
    assert.deepEqual(clean.pkg, [], JSON.stringify(clean.pkg));
    assert.deepEqual(clean.log, [], JSON.stringify(clean.log));
  });
});

// ---- P8/S-63 (REQ-5.6, D-96, issue #183) ----

// The phase line of the 0.2.0 section, rewritten by hand: wrapped over two lines, with and without
// its final full stop. Each still records that phase 1 had its minor version.
test("a phase line wrapped over two lines counts as the phase's minor version", () => {
  for (const wrapped of ['Phase 1: Spine, the first phase of\nthe demo.', 'Phase 1: Spine, the first phase of\nthe demo']) {
    withSliceAddedToACompletedPhase(({ root, fixture }) => {
      const before = read(root, 'CHANGELOG.md');
      const line = before.split('\n').find((l) => /^Phase 1\b/.test(l));
      assert.ok(line, before);
      // The hand edit lands in the merge of P1/S-03, before its sync runs.
      fs.writeFileSync(path.join(root, 'CHANGELOG.md'), before.replace(line, wrapped));
      gitIn(root, ['add', '-A']);
      gitIn(root, ['commit', '-q', '--amend', '--no-edit'], { allowProtected: true });
      const pkgBefore = read(root, 'package.json');
      const logBefore = read(root, 'CHANGELOG.md');
      assert.ok(logBefore.includes(wrapped), logBefore);

      syncWrite(root, fixture);
      // A patch version, never a second minor version.
      assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.2.1'), JSON.stringify(wrapped));
      const log = read(root, 'CHANGELOG.md');
      assert.deepEqual(versions(log), ['0.2.1', '0.2.0', '0.1.0']);
      const section = newest(log);
      assert.deepEqual(body(section), ['- P1/S-03 Fixture 3 (#18)'], section);
      // The wrapped line is left as it was written.
      assert.ok(log.endsWith(logBefore.slice(logBefore.indexOf('## 0.2.0'))), log);
    });
  }
});

// The phase line written by hand without a name and followed directly by the section's first slice
// line, with no blank line between them: the list line ends the phase line's paragraph (verdict
// P8/S-63 r1 H-1).
test('a phase line followed directly by a list line counts as the phase\'s minor version', () => {
  withSliceAddedToACompletedPhase(({ root, fixture }) => {
    const before = read(root, 'CHANGELOG.md');
    const line = before.split('\n').find((l) => /^Phase 1\b/.test(l));
    assert.ok(line && before.includes(`${line}\n\n- `), before);
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), before.replace(`${line}\n\n`, 'Phase 1.\n'));
    gitIn(root, ['add', '-A']);
    gitIn(root, ['commit', '-q', '--amend', '--no-edit'], { allowProtected: true });
    const pkgBefore = read(root, 'package.json');
    const logBefore = read(root, 'CHANGELOG.md');
    assert.ok(logBefore.includes('Phase 1.\n- P1/S-01'), logBefore);

    syncWrite(root, fixture);
    assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.2.1'));
    const log = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(log), ['0.2.1', '0.2.0', '0.1.0']);
    assert.deepEqual(body(newest(log)), ['- P1/S-03 Fixture 3 (#18)'], newest(log));
  });
});
