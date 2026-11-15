// REQ-5.5, D-90, D-92 (P5/S-49): the changelog is the record of which merged slices have a version.
// A sync sets one version for every merged slice that no CHANGELOG.md section on the default branch
// names and whose own merge did not set the version, whichever merge it runs on; a slice merged
// before the newest merge that set the version by hand, or before the commit that turned
// release.auto on, is never named. `status --sync --write` sets a version only when HEAD is the tip
// of the default branch. The merge orders are the ones the independent verdict of P5/S-48 ran
// (.slicekit/reviews/P5-S-48i-r3.md, H-4, H-5 and H-6). Driven through the command the CI sync job
// runs; every host answer comes from a fixture directory (SLICEKIT_GITHOST_FIXTURE); nothing
// reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { init } from '../src/init.js';
import { CONFIG_PATH, loadConfig } from '../src/config.js';
import { applyUpdate, planUpdate } from '../src/render/update.js';
import { readSlice, writeSlice } from '../src/state/index.js';
import { makeRepo } from './helpers/tmp-repo.js';
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

// `release` set in the kit's config as given.
function setRelease(root, release) {
  const file = path.join(root, CONFIG_PATH);
  const conf = JSON.parse(fs.readFileSync(file, 'utf8'));
  conf.release = release;
  fs.writeFileSync(file, `${JSON.stringify(conf, null, 2)}\n`);
}

// An initialised kit with three slices in phase 1, package.json at 0.1.0 and a CHANGELOG.md,
// `release` set in config as given (undefined: absent), committed on main as "kit". The host fixture
// holds pull requests 14 (P1/S-01) and 16 (P1/S-02), both merged.
function withRelease(fn, { release } = {}) {
  const repo = makeRepo();
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-relord-'));
  try {
    const root = repo.root;
    // A checkout writes each file's bytes as committed, so a file compares equal after a branch switch.
    gitIn(root, ['config', 'core.autocrlf', 'false']);
    init(root, { name: 'demo', shape: 'backend' });
    const ids = [];
    for (let n = 1; n <= 3; n++) ids.push(writeSliceFixture(root, { phase: 1, n }));
    fs.writeFileSync(path.join(root, 'docs', 'phases', 'P1-x', 'P1.md'), '# Phase 1 — Spine\n');
    fs.writeFileSync(path.join(root, 'package.json'), PACKAGE);
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG);
    if (release !== undefined) setRelease(root, release);
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

// The merge of a slice's pull request on main: the slice is `ready` with that pull request, as its
// branch left it, and the host reports the pull request merged.
function mergeSlice(root, cfg, id, number, name) {
  parkAt(root, cfg, id, 'ready', { number, headSha: `abc${number}def5678` });
  return mergeCommit(root, `Merge pull request #${number} from acme/slice/${id.toLowerCase().replace('/', '-')}`, `[${id}] ${name}`);
}

// The sync job's first step, on the default branch's merge commit.
function syncWrite(root, fixture) {
  const r = runCli(['status', '--sync', '--write'], { cwd: root, env: cliEnv(fixture) });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  return r;
}

// The sync job on main's tip, as `sync open` leaves it: status --sync --write, then everything it
// wrote committed on `sync/<short sha>`, and main back as it was. Returns the branch and short sha.
function syncBranch(root, fixture) {
  syncWrite(root, fixture);
  const short = gitIn(root, ['rev-parse', '--short', 'HEAD']);
  const branch = `sync/${short}`;
  gitIn(root, ['checkout', '-q', '-b', branch]);
  gitIn(root, ['add', '-A']);
  gitIn(root, ['commit', '-q', '-m', `chore(slicekit): sync state after ${short}`]);
  gitIn(root, ['checkout', '-q', 'main']);
  return { branch, short };
}

// The merge of a sync pull request into main: a merge commit with GitHub's message.
function mergeSync(root, { branch, short }, number) {
  gitIn(root, ['merge', '-q', '--no-ff', '-m', `Merge pull request #${number} from acme/${branch}`, '-m', `[sync] state after ${short}`, branch], { allowProtected: true });
  return gitIn(root, ['rev-parse', 'HEAD']);
}

// The sync job on main's tip, its pull request merged at once: main then holds what the sync wrote.
function syncAndMerge(root, fixture, number) {
  return mergeSync(root, syncBranch(root, fixture), number);
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
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
// The paths `git status --porcelain` lists, untracked files one by one.
const changedPaths = (root) =>
  gitIn(root, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).trim());
// The states of the slices, in order.
const states = (root, cfg, ids) => ids.map((id) => readSlice(root, cfg, id).state);
const names = (section, wants) => {
  for (const want of wants) assert.ok(section.includes(want), `${want} not in\n${section}`);
};
const namesNone = (section, nots) => {
  for (const not of nots) assert.ok(!section.includes(not), `${not} in\n${section}`);
};

// ---- the evaluation set ----

test("a slice merged before a version-setting merge's sync is merged gets the next version alone", () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    // The merge of pull request 14 sets 0.3.0 with its section itself (H-4): a version set by hand.
    fs.writeFileSync(path.join(root, 'package.json'), withVersion(PACKAGE, '0.3.0'));
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `${INTRO}## 0.3.0\n\n- Phase 1.\n\n## 0.1.0\n\n- The first version.\n`);
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    // Pull request 16 merges before the sync pull request of that merge is merged: main still
    // records P1/S-01 at ready, so the sync on this merge records both slices.
    mergeSlice(root, cfg, ids[1], 16, 'Fixture 2');
    const pkgBefore = read(root, 'package.json');
    const logBefore = read(root, 'CHANGELOG.md');

    syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'merged', 'todo']);
    // The next version, once: the patch up by one from the version the first merge set.
    assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.3.1'));
    const log = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(log), ['0.3.1', '0.3.0', '0.1.0']);
    assert.ok(log.endsWith(logBefore.slice(logBefore.indexOf('## 0.3.0'))), log);
    // Its section names the later slice alone; the version-setting slice is not named again.
    const section = newest(log);
    names(section, ['P1/S-02', 'Fixture 2', '#16']);
    namesNone(section, ['P1/S-01', 'Fixture 1', '#14', 'P1/S-03']);

    // That sync pull request merged: the sync on its merge sets no second version for either slice.
    const short = gitIn(root, ['rev-parse', '--short', 'HEAD']);
    mergeCommit(root, `Merge pull request #21 from acme/sync/${short}`, `[sync] state after ${short}`);
    const pkg = read(root, 'package.json');
    syncWrite(root, fixture);
    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);
  }, { release: { auto: true } });
});

test('a sync pull request merged after a second slice merged sets a version for that slice', () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    // Pull request 14 merges; its sync job cuts a sync branch that sets 0.1.1 naming P1/S-01 (H-6).
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    const sync = syncBranch(root, fixture);
    assert.equal(JSON.parse(gitIn(root, ['show', `${sync.branch}:package.json`])).version, '0.1.1');
    assert.equal(read(root, 'package.json'), PACKAGE);
    // Pull request 16 merges on main, then the first sync pull request is merged before the second
    // slice's sync job closes it as superseded.
    mergeSlice(root, cfg, ids[1], 16, 'Fixture 2');
    mergeSync(root, sync, 21);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'ready', 'todo']);
    const pkgBefore = read(root, 'package.json');
    const logBefore = read(root, 'CHANGELOG.md');
    assert.equal(pkgBefore, withVersion(PACKAGE, '0.1.1'));
    assert.deepEqual(versions(logBefore), ['0.1.1', '0.1.0']);

    // The sync on the sync pull request's merge records P1/S-02 and sets the next version for it.
    syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'merged', 'todo']);
    assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.1.2'));
    const log = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(log), ['0.1.2', '0.1.1', '0.1.0']);
    assert.ok(log.startsWith(`${INTRO}## 0.1.2`), log);
    assert.ok(log.endsWith(logBefore.slice(logBefore.indexOf('## 0.1.1'))), log);
    const section = newest(log);
    names(section, ['P1/S-02', 'Fixture 2', '#16']);
    namesNone(section, ['P1/S-01', 'Fixture 1', '#14', 'P1/S-03']);
  }, { release: { auto: true } });
});

test('a slice the changelog names, or merged before the hand-set version, is not versioned again', () => {
  // A slice a changelog section on the default branch names: its sync sets no version and no section.
  withRelease(({ root, fixture, cfg, ids }) => {
    // The merge of pull request 14 adds the slice's own line to the newest section and leaves the version.
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `${CHANGELOG}- P1/S-01 Fixture 1 (#14)\n`);
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    const pkg = read(root, 'package.json');
    const log = read(root, 'CHANGELOG.md');
    syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'todo', 'todo']);
    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);
  }, { release: { auto: true } });

  // A slice merged before the newest merge that set the version by hand is never named or counted.
  withRelease(({ root, fixture, cfg, ids }) => {
    // Pull request 14 merges; its sync pull request is never merged, so main keeps P1/S-01 at ready.
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    // A release pull request sets 0.2.0 with its section by hand; the section does not name the slice.
    fs.writeFileSync(path.join(root, 'package.json'), withVersion(PACKAGE, '0.2.0'));
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `${INTRO}## 0.2.0\n\n- The second version.\n\n## 0.1.0\n\n- The first version.\n`);
    mergeCommit(root, 'Merge pull request #15 from acme/release/0.2.0', '[release] 0.2.0');
    // Pull request 16 merges after it: the sync records both slices and versions the later one only.
    mergeSlice(root, cfg, ids[1], 16, 'Fixture 2');
    const pkgBefore = read(root, 'package.json');

    syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'merged', 'todo']);
    assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.2.1'));
    const log = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(log), ['0.2.1', '0.2.0', '0.1.0']);
    const section = newest(log);
    names(section, ['P1/S-02', 'Fixture 2', '#16']);
    namesNone(section, ['P1/S-01', 'Fixture 1', '#14']);

    // No slice is left to version: the sync on the sync pull request's merge sets no version and adds no section.
    const short = gitIn(root, ['rev-parse', '--short', 'HEAD']);
    mergeCommit(root, `Merge pull request #21 from acme/sync/${short}`, `[sync] state after ${short}`);
    const pkg = read(root, 'package.json');
    syncWrite(root, fixture);
    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);
  }, { release: { auto: true } });

  // No version set by hand: a slice merged before the commit that turned release.auto on is never named or counted.
  withRelease(({ root, fixture, cfg, ids }) => {
    // Pull request 14 merges while the config has no release.auto; its sync pull request is never merged.
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    setRelease(root, { auto: true });
    mergeCommit(root, 'Merge pull request #15 from acme/plan/release-auto', '[plan] Turn release.auto on');
    mergeSlice(root, cfg, ids[1], 16, 'Fixture 2');
    const pkgBefore = read(root, 'package.json');

    syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'merged', 'todo']);
    assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.1.1'));
    const log = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(log), ['0.1.1', '0.1.0']);
    const section = newest(log);
    names(section, ['P1/S-02', 'Fixture 2', '#16']);
    namesNone(section, ['P1/S-01', 'Fixture 1', '#14']);
  }, { release: undefined });
});

test('a sync merge whose slice was already recorded merged is not taken for a hand-set version', () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    // Pull request 14 merges. A plan branch runs status --sync --write off the tip: it writes the
    // state and no version, commits that state, and is merged (review B-1 of round 1).
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    gitIn(root, ['checkout', '-q', '-b', 'plan/notes']);
    gitIn(root, ['commit', '-q', '--allow-empty', '-m', 'plan: notes']);
    const off = syncWrite(root, fixture);
    assert.ok(off.stderr.includes('version not set: HEAD is not the tip of main'), off.stderr);
    gitIn(root, ['add', '-A']);
    gitIn(root, ['commit', '-q', '-m', 'chore(slicekit): state']);
    gitIn(root, ['checkout', '-q', 'main']);
    gitIn(root, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #15 from acme/plan/notes', '-m', '[plan] Notes', 'plan/notes'], { allowProtected: true });
    assert.deepEqual(states(root, cfg, ids), ['merged', 'todo', 'todo']);
    assert.equal(read(root, 'package.json'), PACKAGE);

    // The sync on that merge sets 0.1.1 naming P1/S-01 on its branch; main already records the
    // slice merged, so the branch moves no slice state.
    const sync = syncBranch(root, fixture);
    assert.equal(JSON.parse(gitIn(root, ['show', `${sync.branch}:package.json`])).version, '0.1.1');
    // Pull request 16 merges on main, then the sync pull request is merged.
    mergeSlice(root, cfg, ids[1], 16, 'Fixture 2');
    mergeSync(root, sync, 21);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'ready', 'todo']);
    const pkgBefore = read(root, 'package.json');
    const logBefore = read(root, 'CHANGELOG.md');
    assert.equal(pkgBefore, withVersion(PACKAGE, '0.1.1'));
    assert.deepEqual(versions(logBefore), ['0.1.1', '0.1.0']);

    // The sync on the sync pull request's merge records P1/S-02 and sets the next version for it.
    syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'merged', 'todo']);
    assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.1.2'));
    const log = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(log), ['0.1.2', '0.1.1', '0.1.0']);
    assert.ok(log.endsWith(logBefore.slice(logBefore.indexOf('## 0.1.1'))), log);
    const section = newest(log);
    names(section, ['P1/S-02', 'Fixture 2', '#16']);
    namesNone(section, ['P1/S-01', 'Fixture 1', '#14', 'P1/S-03']);
  }, { release: { auto: true } });
});

test('a sync pull request squash-merged under an edited subject is not taken for a hand-set version', () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    // Pull request 14 merges; its sync job cuts a sync branch that sets 0.1.1 naming P1/S-01.
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    const sync = syncBranch(root, fixture);
    assert.equal(JSON.parse(gitIn(root, ['show', `${sync.branch}:package.json`])).version, '0.1.1');
    // Pull request 16 merges on main, then the sync pull request is squash-merged under a subject a
    // person typed at merge time (review B-2 of round 2): main gets one commit with one parent,
    // and no commit with the sync commit's subject or the sync title.
    mergeSlice(root, cfg, ids[1], 16, 'Fixture 2');
    gitIn(root, ['merge', '-q', '--squash', sync.branch]);
    gitIn(root, ['commit', '-q', '-m', 'Sync state (#21)'], { allowProtected: true });
    assert.equal(gitIn(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').length, 2);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'ready', 'todo']);
    const pkgBefore = read(root, 'package.json');
    const logBefore = read(root, 'CHANGELOG.md');
    assert.equal(pkgBefore, withVersion(PACKAGE, '0.1.1'));
    assert.deepEqual(versions(logBefore), ['0.1.1', '0.1.0']);

    // The sync on the squash commit records P1/S-02 and sets the next version for it.
    const r = syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'merged', 'todo']);
    assert.equal(read(root, 'package.json'), withVersion(pkgBefore, '0.1.2'), r.stdout);
    const log = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(log), ['0.1.2', '0.1.1', '0.1.0']);
    assert.ok(log.endsWith(logBefore.slice(logBefore.indexOf('## 0.1.1'))), log);
    const section = newest(log);
    names(section, ['P1/S-02', 'Fixture 2', '#16']);
    namesNone(section, ['P1/S-01', 'Fixture 1', '#14', 'P1/S-03']);
  }, { release: { auto: true } });
});

test("status --sync --write off the default branch's tip sets no version", () => {
  const LINE = 'version not set: HEAD is not the tip of main';
  // What the release step writes stays as it was: package.json, CHANGELOG.md and the rendered files.
  const untouched = (root, pkg, log) => {
    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);
    const changed = changedPaths(root);
    for (const f of changed) {
      assert.ok(f !== 'package.json' && f !== 'CHANGELOG.md' && !f.startsWith('.slicekit/rendered') && !f.startsWith('.claude/'), `${f} changed: ${changed.join(', ')}`);
    }
    return changed;
  };

  // On a slice branch with one commit (H-5): the state and BUILD.md are written, the version is not set.
  withRelease(({ root, fixture, cfg, ids }) => {
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    gitIn(root, ['checkout', '-q', '-b', 'slice/p1-s-03']);
    gitIn(root, ['commit', '-q', '--allow-empty', '-m', 'test(P1/S-03): the evaluation set']);
    const pkg = read(root, 'package.json');
    const log = read(root, 'CHANGELOG.md');
    const build = read(root, 'BUILD.md');

    const r = syncWrite(root, fixture);
    assert.ok(r.stderr.split(/\r?\n/).some((l) => l.includes(LINE)), r.stderr);
    assert.doesNotMatch(r.stdout, /^version /m);
    // The state and BUILD.md as before this slice: the merge is recorded.
    assert.equal(readSlice(root, cfg, ids[0]).state, 'merged');
    assert.match(r.stdout, /synced P1\/S-01 → merged \(PR #14\)/);
    assert.notEqual(read(root, 'BUILD.md'), build);
    const changed = untouched(root, pkg, log);
    assert.ok(changed.includes('BUILD.md'), changed.join(', '));

    // Under --json the document carries no version, and the line still goes to stderr.
    gitIn(root, ['checkout', '-q', '--', '.']);
    const j = runCli(['status', '--sync', '--write', '--json'], { cwd: root, env: cliEnv(fixture) });
    assert.equal(j.code, 0, j.stderr + j.stdout);
    const out = JSON.parse(j.stdout);
    assert.equal(out.version, undefined, j.stdout);
    assert.deepEqual(out.synced.map((c) => c.id), ['P1/S-01']);
    assert.ok(j.stderr.includes(LINE), j.stderr);
    untouched(root, pkg, log);
  }, { release: { auto: true } });

  // On a commit behind the default branch's tip, with no branch: the same.
  withRelease(({ root, fixture, cfg, ids }) => {
    const first = mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    mergeSlice(root, cfg, ids[1], 16, 'Fixture 2');
    gitIn(root, ['checkout', '-q', '--detach', first]);
    const pkg = read(root, 'package.json');
    const log = read(root, 'CHANGELOG.md');

    const r = syncWrite(root, fixture);
    assert.ok(r.stderr.includes(LINE), r.stderr);
    assert.equal(readSlice(root, cfg, ids[0]).state, 'merged');
    untouched(root, pkg, log);
  }, { release: { auto: true } });

  // With no release.auto there is no version to set: the line is not printed.
  withRelease(({ root, fixture, cfg, ids }) => {
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    gitIn(root, ['checkout', '-q', '-b', 'slice/p1-s-03']);
    const r = syncWrite(root, fixture);
    assert.ok(!r.stderr.includes('version not set'), r.stderr);
    assert.equal(read(root, 'package.json'), PACKAGE);
    assert.equal(read(root, 'CHANGELOG.md'), CHANGELOG);
  }, { release: undefined });
});

test('a rebase-merged slice that sets the version itself is not versioned again', () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    // Pull request 14 is rebase-merged (review B-3 of round 3): its commits land one by one on
    // main. The first records the slice as building, the second sets 0.3.0 with a section written
    // by hand, the last records the slice as ready with its pull request.
    writeSlice(root, cfg, { ...readSlice(root, cfg, ids[0]), state: 'building' });
    mergeCommit(root, 'chore(slicekit): P1/S-01 building');
    fs.writeFileSync(path.join(root, 'package.json'), withVersion(PACKAGE, '0.3.0'));
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `${INTRO}## 0.3.0\n\n- Phase 1.\n\n## 0.1.0\n\n- The first version.\n`);
    mergeCommit(root, 'feat(P1/S-01): the first release');
    parkAt(root, cfg, ids[0], 'ready', { number: 14, headSha: 'abc14def5678' });
    mergeCommit(root, 'chore(slicekit): P1/S-01 ready');
    const pkg = read(root, 'package.json');
    const log = read(root, 'CHANGELOG.md');

    // The sync on that tip records the merge and sets no second version for the slice.
    const r = syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'todo', 'todo']);
    assert.doesNotMatch(r.stdout, /^version /m);
    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);

    // Pull request 16 merges after it: the next version names that slice alone.
    gitIn(root, ['checkout', '-q', '--', '.']);
    mergeSlice(root, cfg, ids[1], 16, 'Fixture 2');
    syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'merged', 'todo']);
    assert.equal(read(root, 'package.json'), withVersion(pkg, '0.3.1'));
    const after = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(after), ['0.3.1', '0.3.0', '0.1.0']);
    const section = newest(after);
    names(section, ['P1/S-02', 'Fixture 2', '#16']);
    namesNone(section, ['P1/S-01', 'Fixture 1', '#14', 'P1/S-03']);
  }, { release: { auto: true } });
});

test('a hand-set version whose section mixes prose with a slice line is still a floor', () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    // Pull request 14 merges; its sync pull request is never merged, so main keeps P1/S-01 at ready.
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    // A release pull request sets 0.2.0 by hand (review B-4 of round 3): its section holds a line
    // of prose and one line in the generated slice line format, naming another slice.
    fs.writeFileSync(path.join(root, 'package.json'), withVersion(PACKAGE, '0.2.0'));
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `${INTRO}## 0.2.0\n\nThe second version, set by hand.\n\n- P1/S-03 Fixture 3 (#9)\n\n## 0.1.0\n\n- The first version.\n`);
    mergeCommit(root, 'Merge pull request #15 from acme/release/0.2.0', '[release] 0.2.0');
    const pkg = read(root, 'package.json');
    const log = read(root, 'CHANGELOG.md');

    // The sync on that tip records P1/S-01 merged and sets no version: it merged before the floor.
    const r = syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'todo', 'todo']);
    assert.doesNotMatch(r.stdout, /^version /m);
    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);

    // Pull request 16 merges after the hand-set version: the next version names that slice alone.
    gitIn(root, ['checkout', '-q', '--', '.']);
    mergeSlice(root, cfg, ids[1], 16, 'Fixture 2');
    syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'merged', 'todo']);
    assert.equal(read(root, 'package.json'), withVersion(pkg, '0.2.1'));
    const after = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(after), ['0.2.1', '0.2.0', '0.1.0']);
    const section = newest(after);
    names(section, ['P1/S-02', 'Fixture 2', '#16']);
    namesNone(section, ['P1/S-01', 'Fixture 1', '#14']);
  }, { release: { auto: true } });
});

test('a hand-set version whose section arrives in a later commit, or under a bracketed dated heading, is still a floor', () => {
  const PROSE = '- The second version, set by hand.\n\n## 0.1.0\n\n- The first version.\n';
  // The sync on the tip sets no version; pull request 16 merged after it gets `next`, alone.
  const floorHolds = ({ root, fixture, cfg, ids }, next, headings) => {
    const pkg = read(root, 'package.json');
    const log = read(root, 'CHANGELOG.md');
    const r = syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'todo', 'todo']);
    assert.doesNotMatch(r.stdout, /^version /m);
    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);

    gitIn(root, ['checkout', '-q', '--', '.']);
    mergeSlice(root, cfg, ids[1], 16, 'Fixture 2');
    syncWrite(root, fixture);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'merged', 'todo']);
    assert.equal(read(root, 'package.json'), withVersion(pkg, next));
    const after = read(root, 'CHANGELOG.md');
    assert.deepEqual(versions(after), headings);
    assert.ok(after.endsWith(log.slice(log.indexOf('## '))), after);
    const section = newest(after);
    names(section, ['P1/S-02', 'Fixture 2', '#16']);
    namesNone(section, ['P1/S-01', 'Fixture 1', '#14', 'P1/S-03']);
  };

  // Pull request 14 is rebase-merged (review B-5 of round 4): the commit that sets 0.3.0 in
  // package.json lands before the commit that adds its section. The slice set the version itself.
  withRelease((kit) => {
    const { root, cfg, ids } = kit;
    writeSlice(root, cfg, { ...readSlice(root, cfg, ids[0]), state: 'building' });
    mergeCommit(root, 'chore(slicekit): P1/S-01 building');
    fs.writeFileSync(path.join(root, 'package.json'), withVersion(PACKAGE, '0.3.0'));
    mergeCommit(root, 'feat(P1/S-01): the first release');
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `${INTRO}## 0.3.0\n\n${PROSE}`);
    mergeCommit(root, 'docs(P1/S-01): the changelog of the first release');
    parkAt(root, cfg, ids[0], 'ready', { number: 14, headSha: 'abc14def5678' });
    mergeCommit(root, 'chore(slicekit): P1/S-01 ready');
    floorHolds(kit, '0.3.1', ['0.3.1', '0.3.0', '0.1.0']);
  }, { release: { auto: true } });

  // A release set by hand lands as two commits after pull request 14 merged: the version, then its section.
  withRelease((kit) => {
    const { root, cfg, ids } = kit;
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    fs.writeFileSync(path.join(root, 'package.json'), withVersion(PACKAGE, '0.2.0'));
    mergeCommit(root, 'chore(release): 0.2.0');
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `${INTRO}## 0.2.0\n\n${PROSE}`);
    mergeCommit(root, 'docs(release): the changelog of 0.2.0');
    floorHolds(kit, '0.2.1', ['0.2.1', '0.2.0', '0.1.0']);
  }, { release: { auto: true } });

  // A release set by hand in one merge, its heading the version in square brackets with a date.
  withRelease((kit) => {
    const { root, cfg, ids } = kit;
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    fs.writeFileSync(path.join(root, 'package.json'), withVersion(PACKAGE, '0.2.0'));
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `${INTRO}## [0.2.0] - 2026-10-20\n\n${PROSE}`);
    mergeCommit(root, 'Merge pull request #15 from acme/release/0.2.0', '[release] 0.2.0');
    floorHolds(kit, '0.2.1', ['0.2.1', '[0.2.0]', '0.1.0']);
  }, { release: { auto: true } });

  // The control: the section lands before the version. The version is set at the second commit.
  withRelease((kit) => {
    const { root, cfg, ids } = kit;
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `${INTRO}## 0.2.0\n\n${PROSE}`);
    mergeCommit(root, 'docs(release): the changelog of 0.2.0');
    fs.writeFileSync(path.join(root, 'package.json'), withVersion(PACKAGE, '0.2.0'));
    mergeCommit(root, 'chore(release): 0.2.0');
    floorHolds(kit, '0.2.1', ['0.2.1', '0.2.0', '0.1.0']);
  }, { release: { auto: true } });
});

test('a second status --sync --write on the same tip adds no second section', () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    // Pull request 14 merges; the sync on that tip sets 0.1.1 (review H-2 of round 4).
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');
    const first = syncWrite(root, fixture);
    assert.match(first.stdout, /^version 0\.1\.1: /m);
    const pkg = read(root, 'package.json');
    const log = read(root, 'CHANGELOG.md');
    assert.equal(pkg, withVersion(PACKAGE, '0.1.1'));
    assert.deepEqual(versions(log), ['0.1.1', '0.1.0']);
    const changed = changedPaths(root);

    // The same command again, with nothing committed between: it writes nothing and reports no version.
    const second = syncWrite(root, fixture);
    assert.doesNotMatch(second.stdout, /^version /m);
    assert.deepEqual(states(root, cfg, ids), ['merged', 'todo', 'todo']);
    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);
    assert.deepEqual(changedPaths(root), changed);

    const j = runCli(['status', '--sync', '--write', '--json'], { cwd: root, env: cliEnv(fixture) });
    assert.equal(j.code, 0, j.stderr + j.stdout);
    assert.equal(JSON.parse(j.stdout).version, undefined, j.stdout);
    assert.equal(read(root, 'CHANGELOG.md'), log);
  }, { release: { auto: true } });
});

// P5/S-50 review round 1 (H-1), D-95: an example whose config does not load is found before the
// release step writes a file. The refusal is one line naming the example folder and the config
// problem; package.json, CHANGELOG.md and every rendered file stay as they were.
test('a sync refuses an example whose config does not load, naming the folder, and writes no release file', () => {
  withRelease(({ root, fixture, cfg, ids }) => {
    const OLD = '0.0.1';
    // examples/alpha: an initialised kit rendered at an older version, which a sync would re-render.
    const alpha = path.join(root, 'examples', 'alpha');
    fs.mkdirSync(alpha, { recursive: true });
    init(alpha, { name: 'alpha', shape: 'backend' });
    const alphaCfg = loadConfig(alpha);
    applyUpdate(alpha, alphaCfg, planUpdate(alpha, alphaCfg, { version: OLD }), { version: OLD });
    // examples/broken: rendered files, and a config that is not valid JSON.
    const broken = path.join(root, 'examples', 'broken');
    fs.mkdirSync(broken, { recursive: true });
    init(broken, { name: 'broken', shape: 'backend' });
    fs.writeFileSync(path.join(broken, CONFIG_PATH), '{ "name": "broken",\n');
    mergeCommit(root, 'examples');
    mergeSlice(root, cfg, ids[0], 14, 'Fixture 1');

    const pkg = read(root, 'package.json');
    const log = read(root, 'CHANGELOG.md');
    const r = runCli(['status', '--sync', '--write'], { cwd: root, env: cliEnv(fixture) });
    assert.equal(r.code, 2, r.stderr + r.stdout);
    const lines = r.stderr.split('\n').filter((l) => l !== '');
    assert.equal(lines.length, 1, r.stderr);
    assert.ok(lines[0].startsWith('slicekit: '), r.stderr);
    assert.ok(lines[0].includes('examples/broken'), r.stderr);
    assert.ok(lines[0].includes('is not valid JSON'), r.stderr);
    assert.doesNotMatch(r.stdout, /^version /m);

    assert.equal(read(root, 'package.json'), pkg);
    assert.equal(read(root, 'CHANGELOG.md'), log);
    // The only files changed are the slice states the host sync wrote: no rendered file of the
    // repository or of either example.
    const list = (args) => gitIn(root, args).split('\n').filter(Boolean);
    const changed = [...list(['diff', '--name-only', 'HEAD']), ...list(['ls-files', '--others', '--exclude-standard'])];
    assert.deepEqual(changed.filter((f) => !f.startsWith('.slicekit/state/')), [], changed.join(', '));
    assert.deepEqual(fs.readdirSync(path.join(alpha, '.slicekit', 'rendered')), [OLD]);
  }, { release: { auto: true } });
});
