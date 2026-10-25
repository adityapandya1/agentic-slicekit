import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../src/init.js';
import { git, parseTrailers } from '../src/git.js';
import { which } from '../src/which.js';
import { makeRepo } from './helpers/tmp-repo.js';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Git runs hooks through sh; Git for Windows ships one. Without it these tests cannot run a hook.
const noSh = which('sh', process.env) === null ? 'sh not found on PATH; git hooks cannot run' : false;

// A repo with the slicekit hooks installed by init, on `branch`, with `commits` commits made before
// init (so they carry no trailer and pass no hook).
function withHooks(fn, { branch = 'slice/P1-S-06-x', commits = 0 } = {}) {
  const repo = makeRepo({ branch, commits });
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    return fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

// A real `git commit`, hooks and all; never throws, so a refusal can be asserted.
function commit(root, args, env = {}) {
  const r = spawnSync('git', ['commit', '--allow-empty', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ALLOW_PROTECTED_COMMIT: '', ...env },
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const body = (root, rev = 'HEAD') => git(root, ['log', '-1', '--format=%B', rev]);
const count = (text, needle) => text.split('\n').filter((l) => l === needle).length;

// REQ-1.9: on a slice branch every commit carries `Slice: P<n>/S-<nn>`, added once.
test('prepare-commit-msg adds the trailer once', { skip: noSh }, () => {
  withHooks((root) => {
    assert.equal(commit(root, ['-m', 'first']).code, 0);
    assert.equal(body(root), 'first\n\nSlice: P1/S-06');
    const second = commit(root, ['-m', 'second\n\nSlice: P1/S-06\nCo-Authored-By: A <a@example.com>']);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(count(body(root), 'Slice: P1/S-06'), 1);
    assert.equal(count(body(root, 'HEAD~1'), 'Slice: P1/S-06'), 1);
  });
});

test('the trailer joins an existing trailer block as its first line', { skip: noSh }, () => {
  withHooks((root) => {
    assert.equal(commit(root, ['-m', 'subject\n\nA body line.\n\nCo-Authored-By: A <a@example.com>']).code, 0);
    assert.equal(body(root), 'subject\n\nA body line.\n\nSlice: P1/S-06\nCo-Authored-By: A <a@example.com>');
    assert.deepEqual(parseTrailers(body(root)), { Slice: 'P1/S-06', 'Co-Authored-By': 'A <a@example.com>' });
  });
});

test('comment lines are not a trailer block', { skip: noSh }, () => {
  withHooks((root) => {
    const file = path.join(root, '.git', 'MSG');
    fs.writeFileSync(file, 'subject\n\nCo-Authored-By: A <a@example.com>\n# Please enter the commit message\n# Key: value\n');
    assert.equal(commit(root, ['--cleanup=strip', '-F', file]).code, 0);
    assert.equal(body(root), 'subject\n\nSlice: P1/S-06\nCo-Authored-By: A <a@example.com>');
  });
});

test('an amend keeps one trailer', { skip: noSh }, () => {
  withHooks((root) => {
    assert.equal(commit(root, ['-m', 'first']).code, 0);
    assert.equal(commit(root, ['--amend', '--no-edit']).code, 0);
    assert.equal(commit(root, ['--amend', '-m', 'reworded']).code, 0);
    assert.equal(body(root), 'reworded\n\nSlice: P1/S-06');
  });
});

test('a branch that is not a slice branch gets no trailer', { skip: noSh }, () => {
  withHooks((root) => {
    assert.equal(commit(root, ['-m', 'plain']).code, 0);
    assert.equal(body(root), 'plain');
  }, { branch: 'feature/x' });
});

test('a merge commit gets no trailer', { skip: noSh }, () => {
  withHooks((root) => {
    git(root, ['checkout', '-q', '-b', 'slice/P1-S-06-x']);
    assert.equal(commit(root, ['-m', 'on the slice']).code, 0);
    git(root, ['checkout', '-q', 'feature/x']);
    assert.equal(commit(root, ['-m', 'on feature']).code, 0);
    git(root, ['checkout', '-q', 'slice/P1-S-06-x']);
    execFileSync('git', ['merge', '--no-ff', '-q', '-m', 'merge feature', 'feature/x'], { cwd: root, stdio: 'pipe' });
    assert.equal(body(root), 'merge feature');
  }, { branch: 'feature/x', commits: 1 });
});

// REQ-3.9: the pre-commit hook refuses a commit on a protected branch, the initial one included.
test('pre-commit refuses a commit on a protected branch', { skip: noSh }, () => {
  withHooks((root) => {
    const r = commit(root, ['-m', 'on main']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /main is protected.*ALLOW_PROTECTED_COMMIT=1/);
    assert.equal(commit(root, ['-m', 'on main'], { ALLOW_PROTECTED_COMMIT: '1' }).code, 0);
    assert.equal(body(root), 'on main');
  }, { branch: 'main' });
});

test('pre-commit reads protectedBranches from the config', { skip: noSh }, () => {
  withHooks((root) => {
    const file = path.join(root, '.slicekit', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    cfg.protectedBranches = ['main', 'develop'];
    fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
    const r = commit(root, ['-m', 'on develop']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /develop is protected/);
  }, { branch: 'develop' });
});

test('pre-commit refuses a merge on a protected branch', { skip: noSh }, () => {
  withHooks((root) => {
    git(root, ['checkout', '-q', '-b', 'feature/x']);
    assert.equal(commit(root, ['-m', 'on feature']).code, 0);
    git(root, ['checkout', '-q', 'main']);
    // A merge that stops (conflict or --no-commit) is concluded by `git commit`, which runs pre-commit.
    execFileSync('git', ['merge', '--no-ff', '--no-commit', 'feature/x'], { cwd: root, stdio: 'pipe' });
    const r = commit(root, ['-m', 'merge feature']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /main is protected/);
  }, { branch: 'main', commits: 1 });
});

test('pre-commit allows a detached HEAD', { skip: noSh }, () => {
  withHooks((root) => {
    git(root, ['checkout', '-q', '--detach']);
    assert.equal(commit(root, ['-m', 'detached']).code, 0);
  }, { branch: 'main', commits: 1 });
});

test('the hook templates are POSIX sh with LF endings', () => {
  for (const name of ['prepare-commit-msg', 'pre-commit']) {
    const text = fs.readFileSync(path.join(kitRoot, 'templates', 'githooks', name), 'utf8');
    assert.ok(text.startsWith('#!/bin/sh\n'), name);
    assert.ok(!text.includes('\r'), name);
  }
});
