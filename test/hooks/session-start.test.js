// REQ-3.1: SessionStart prints divergence from the default branch and the active slice, fails open,
// and after compaction re-injects the slice's handoff and brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { handle } from '../../src/hooks/session-start.js';
import { runHook } from '../../src/hooks/io.js';
import { CONFIG_PATH, defaultConfig } from '../../src/config.js';
import { makeRepo, commit } from '../helpers/tmp-repo.js';

const SLICE = 'P1/S-06';
const BRANCH = 'slice/P1-S-06-hooks';
const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const BOGUS = path.join(os.tmpdir(), 'slicekit-no-such-origin-4f1c', 'nothing.git');

function writeState(root, state) {
  const file = path.join(root, '.slicekit', 'state', 'P1-S-06.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ slice: SLICE, state: 'building', ...state }));
}

function writeConfig(root) {
  const file = path.join(root, CONFIG_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg));
}

const text = (r) => r.hookSpecificOutput?.additionalContext;
const lines = (r) => text(r).split('\n');
async function start(root, source = 'startup') {
  const r = await handle({ session_id: 's', source, cwd: root }, { root, cfg, env: process.env });
  assert.equal(r.hookSpecificOutput?.hookEventName, 'SessionStart');
  return r;
}

// A repo on main with one commit, pushed to a local bare origin; then `branch` checked out.
function withOrigin({ branch = BRANCH } = {}) {
  const repo = makeRepo({ commits: 1 });
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-origin-'));
  git(bare, ['init', '--bare', '-b', 'main']);
  git(repo.root, ['remote', 'add', 'origin', bare]);
  git(repo.root, ['push', '--quiet', 'origin', 'main']);
  if (branch !== 'main') git(repo.root, ['checkout', '--quiet', '-b', branch]);
  const cleanup = () => {
    repo.cleanup();
    try {
      fs.rmSync(bare, { recursive: true, force: true });
    } catch {
      // the OS temp cleaner takes it
    }
  };
  return { root: repo.root, bare, cleanup };
}

// ---- evaluation set ----

// REQ-3.1
test('prints divergence and slice; exits 0 offline', async () => {
  const repo = makeRepo({ commits: 1, branch: BRANCH });
  try {
    git(repo.root, ['remote', 'add', 'origin', BOGUS]);
    writeState(repo.root, {});
    writeConfig(repo.root);
    const r = await runHook('session-start', { stdin: JSON.stringify({ session_id: 's', source: 'startup', cwd: repo.root }), root: repo.root });
    assert.equal(r.code, 0);
    const out = JSON.parse(r.stdout);
    const [first, second, ...rest] = lines(out);
    assert.match(first, /^slicekit: could not fetch origin \(.+\)$/);
    assert.ok(first.length <= 'slicekit: could not fetch origin ()'.length + 120);
    assert.equal(second, `active slice: ${SLICE} (building)`);
    assert.deepEqual(rest, []);
  } finally {
    repo.cleanup();
  }
});

// REQ-3.1
test('compact re-injects the brief', async () => {
  const o = withOrigin();
  try {
    writeState(o.root, { handoff: 'stage: building\nnext: make test 3 pass' });
    const r = await start(o.root, 'compact');
    assert.deepEqual(lines(r), [
      `slicekit: ${BRANCH} is 0 ahead / 0 behind origin/main`,
      `active slice: ${SLICE} (building)`,
      'stage: building',
      'next: make test 3 pass',
      `Brief: run slicekit instructions developer ${SLICE}`,
    ]);
  } finally {
    o.cleanup();
  }
});

// ---- further cases ----

test('ahead and behind against a local bare origin', async () => {
  const o = withOrigin();
  try {
    commit(o.root, 'mine 1');
    commit(o.root, 'mine 2');
    // origin moves on by one commit the local branch does not have
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-clone-'));
    try {
      git(other, ['clone', '--quiet', o.bare, '.']);
      git(other, ['config', 'user.name', 'T']);
      git(other, ['config', 'user.email', 't@example.com']);
      git(other, ['config', 'commit.gpgsign', 'false']);
      commit(other, 'theirs');
      git(other, ['push', '--quiet', 'origin', 'main']);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
    const r = await start(o.root);
    assert.deepEqual(lines(r), [`slicekit: ${BRANCH} is 2 ahead / 1 behind origin/main`, 'no active slice']);
  } finally {
    o.cleanup();
  }
});

test('no origin remote: says so without the network', async () => {
  const repo = makeRepo({ commits: 1 });
  try {
    const r = await start(repo.root);
    assert.deepEqual(lines(r), ['slicekit: could not fetch origin (no origin remote)', 'no active slice']);
  } finally {
    repo.cleanup();
  }
});

test('not a git repository', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-norepo-'));
  try {
    const r = await start(dir);
    assert.deepEqual(lines(r), ['slicekit: not a git repository', 'no active slice']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no commits yet', async () => {
  const repo = makeRepo({ branch: BRANCH });
  try {
    writeState(repo.root, { state: 'todo' });
    const r = await start(repo.root);
    assert.deepEqual(lines(r), [`slicekit: ${BRANCH} has no commits yet`, `active slice: ${SLICE} (todo)`]);
  } finally {
    repo.cleanup();
  }
});

test('handoff as an object prints key: value lines', async () => {
  const o = withOrigin();
  try {
    writeState(o.root, { handoff: { stage: 'building', findings: ['B-1'], next: 'fix B-1' } });
    const r = await start(o.root, 'compact');
    assert.deepEqual(lines(r).slice(2), [
      'stage: building',
      'findings: ["B-1"]',
      'next: fix B-1',
      `Brief: run slicekit instructions developer ${SLICE}`,
    ]);
  } finally {
    o.cleanup();
  }
});

test('compact without a handoff prints only the brief pointer', async () => {
  const o = withOrigin();
  try {
    writeState(o.root, {});
    const r = await start(o.root, 'compact');
    assert.deepEqual(lines(r).slice(2), [`Brief: run slicekit instructions developer ${SLICE}`]);
  } finally {
    o.cleanup();
  }
});

test('other sources and an unknown source print only the two lines', async () => {
  const o = withOrigin();
  try {
    writeState(o.root, { handoff: 'next: x' });
    for (const source of ['startup', 'resume', 'clear', 'weird', undefined]) {
      const r = await handle({ session_id: 's', source, cwd: o.root }, { root: o.root, cfg, env: process.env });
      assert.equal(lines(r).length, 2, `source ${source}`);
    }
  } finally {
    o.cleanup();
  }
});

test('a failed fetch with an earlier origin ref prints the reason and the counts as of the last fetch', async () => {
  const o = withOrigin();
  try {
    commit(o.root, 'mine');
    git(o.root, ['remote', 'set-url', 'origin', BOGUS]);
    const [first] = lines(await start(o.root));
    assert.match(first, new RegExp(`^slicekit: could not fetch origin \\(.+\\); ${BRANCH} is 1 ahead / 0 behind origin/main \\(as of the last fetch\\)$`));
  } finally {
    o.cleanup();
  }
});

test('an option-shaped defaultBranch is refused before git sees it', async () => {
  const o = withOrigin();
  try {
    const bad = { ...cfg, defaultBranch: '--upload-pack=x' };
    const r = await handle({ session_id: 's', source: 'startup', cwd: o.root }, { root: o.root, cfg: bad, env: process.env });
    assert.match(lines(r)[0], /^slicekit: could not fetch origin \(.*refusing ref.*\)$/);
  } finally {
    o.cleanup();
  }
});

test('a fetch past its timeout is killed and reported', async () => {
  const o = withOrigin();
  try {
    git(o.root, ['update-ref', '-d', 'refs/remotes/origin/main']);
    const r = await handle({ session_id: 's', source: 'startup', cwd: o.root }, { root: o.root, cfg, env: process.env, fetchTimeoutMs: 1 });
    assert.equal(lines(r)[0], 'slicekit: could not fetch origin (timed out after 1 ms)');
  } finally {
    o.cleanup();
  }
});
