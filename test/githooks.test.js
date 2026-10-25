import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../src/init.js';
import { git, parseTrailers } from '../src/git.js';
import { loadConfig } from '../src/config.js';
import { buildContext } from '../src/check/context.js';
import trailer from '../src/check/rules/trailer.js';
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
    // init stages the hooks it creates in a repo with commits; unstage them so the index is clean.
    if (commits > 0) git(repo.root, ['reset', '-q']);
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
  for (const name of ['prepare-commit-msg', 'pre-commit', 'pre-merge-commit']) {
    const text = fs.readFileSync(path.join(kitRoot, 'templates', 'githooks', name), 'utf8');
    assert.ok(text.startsWith('#!/bin/sh\n'), name);
    assert.ok(!text.includes('\r'), name);
  }
});

// sh has no import: the protected-branch check is copied into every hook, and the copies must agree.
test('every hook carries the same protected-branch check', () => {
  const read = (name) => fs.readFileSync(path.join(kitRoot, 'templates', 'githooks', name), 'utf8');
  assert.equal(read('pre-merge-commit'), read('pre-commit'));
  const block = (text) => {
    const m = /# >>> slicekit protected-branch check[\s\S]*# <<< slicekit protected-branch check\n/.exec(text);
    assert.ok(m, 'marked block present');
    return m[0];
  };
  assert.equal(block(read('prepare-commit-msg')), block(read('pre-commit')));
});

// Any git command, hooks and all; never throws.
function gitRun(root, args, env = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ALLOW_PROTECTED_COMMIT: '', ...env } });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// A real change staged, so a pick or a revert of it is never empty.
const change = (root, name) => {
  fs.writeFileSync(path.join(root, name), name);
  git(root, ['add', name]);
};

const INNER = ['git', 'com' + 'mit', '--allow-empty', '-m', 'inner'].join(' ');

// REQ-3.9: a clean `git merge` runs pre-merge-commit, not pre-commit.
test('pre-merge-commit refuses a merge on a protected branch', { skip: noSh }, () => {
  withHooks((root) => {
    git(root, ['checkout', '-q', '-b', 'feature/x']);
    assert.equal(commit(root, ['-m', 'on feature']).code, 0);
    git(root, ['checkout', '-q', 'main']);
    const refused = gitRun(root, ['merge', '--no-ff', '-m', 'merge feature', 'feature/x']);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /main is protected/);
    gitRun(root, ['merge', '--abort']);
    const allowed = gitRun(root, ['merge', '--no-ff', '-m', 'merge feature', 'feature/x'], { ALLOW_PROTECTED_COMMIT: '1' });
    assert.equal(allowed.code, 0, allowed.stderr);
    assert.equal(body(root), 'merge feature');
  }, { branch: 'main', commits: 1 });
});

// REQ-3.9: cherry-pick, revert and a commit inside a rebase never run pre-commit; prepare-commit-msg
// carries the same check, and during a rebase the branch is read from the rebase's head-name.
test('cherry-pick, revert and a rebase commit on a protected branch are refused', { skip: noSh }, () => {
  withHooks((root) => {
    git(root, ['checkout', '-q', '-b', 'feature/x']);
    change(root, 'f.txt');
    assert.equal(commit(root, ['-m', 'on feature']).code, 0);
    git(root, ['checkout', '-q', 'main']);
    const pick = gitRun(root, ['cherry-pick', 'feature/x']);
    assert.notEqual(pick.code, 0);
    assert.match(pick.stderr, /main is protected/);
    gitRun(root, ['cherry-pick', '--abort']);
    change(root, 'm.txt');
    assert.equal(commit(root, ['-m', 'on main'], { ALLOW_PROTECTED_COMMIT: '1' }).code, 0);
    const revert = gitRun(root, ['revert', '--no-edit', 'HEAD']);
    assert.notEqual(revert.code, 0);
    assert.match(revert.stderr, /main is protected/);
    gitRun(root, ['revert', '--abort']);
    // A refused single revert can leave its changes staged; start the rebase from a clean index.
    git(root, ['reset', '-q', '--hard']);
    const before = git(root, ['rev-parse', 'HEAD']);
    const rebase = gitRun(root, ['rebase', '--exec', INNER, 'HEAD~1']);
    assert.notEqual(rebase.code, 0);
    assert.match(rebase.stderr, /main is protected/);
    gitRun(root, ['rebase', '--abort']);
    assert.equal(git(root, ['rev-parse', 'HEAD']), before);
  }, { branch: 'main', commits: 2 });
});

test('cherry-pick, revert and a rebase commit on a slice branch are allowed', { skip: noSh }, () => {
  withHooks((root) => {
    git(root, ['checkout', '-q', '-b', 'feature/x']);
    change(root, 'f.txt');
    assert.equal(commit(root, ['-m', 'on feature']).code, 0);
    git(root, ['checkout', '-q', '-b', 'slice/P1-S-06-x', 'main']);
    const pick = gitRun(root, ['cherry-pick', 'feature/x']);
    assert.equal(pick.code, 0, pick.stderr);
    assert.equal(body(root), 'on feature\n\nSlice: P1/S-06');
    const revert = gitRun(root, ['revert', '--no-edit', 'HEAD']);
    assert.equal(revert.code, 0, revert.stderr);
    assert.equal(count(body(root), 'Slice: P1/S-06'), 1);
    // M1: a commit made during a rebase on a slice branch gets the trailer too.
    const rebase = gitRun(root, ['rebase', '--exec', INNER, 'HEAD~1']);
    assert.equal(rebase.code, 0, rebase.stderr);
    assert.equal(git(root, ['symbolic-ref', '--short', 'HEAD']), 'slice/P1-S-06-x');
    assert.equal(body(root), 'inner\n\nSlice: P1/S-06');
  }, { branch: 'main', commits: 2 });
});

// A `---` line in a body is text: the trailer goes at the end, where git reads trailers.
test('a body with a --- line still ends in the trailer the rule reads', { skip: noSh }, () => {
  withHooks((root) => {
    assert.equal(commit(root, ['-m', 'subject\n\n---\nnot a patch']).code, 0);
    assert.equal(body(root), 'subject\n\n---\nnot a patch\n\nSlice: P1/S-06');
    assert.deepEqual(trailer.run(buildContext(root, loadConfig(root))), []);
  });
});

// REQ-1.9: a squash merge concluded by `git commit` is an ordinary commit on the slice branch, so it
// is stamped like one (git gives the hook the source `squash` when the message is SQUASH_MSG).
test('a squash merge committed on a slice branch carries the trailer', { skip: noSh }, () => {
  withHooks((root) => {
    git(root, ['checkout', '-q', '-b', 'feature/x']);
    change(root, 'f.txt');
    assert.equal(commit(root, ['-m', 'on feature']).code, 0);
    git(root, ['checkout', '-q', '-b', 'slice/P1-S-06-x', 'main']);
    gitRun(root, ['merge', '--squash', 'feature/x']);
    const r = commit(root, ['--no-edit']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(count(body(root), 'Slice: P1/S-06'), 1);
    assert.deepEqual(trailer.run(buildContext(root, loadConfig(root))), []);
  }, { branch: 'main', commits: 1 });
});

const setProtected = (root, list) => {
  const file = path.join(root, '.slicekit', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.protectedBranches = list;
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
};

// A protectedBranches entry is a branch name, never a file glob: `*` is not expanded against the
// files in the repository root.
test('a glob character in protectedBranches is not matched against files', { skip: noSh }, () => {
  withHooks((root) => {
    setProtected(root, ['*', 'main']);
    fs.writeFileSync(path.join(root, 'feature'), 'a file named like the branch');
    const onMain = commit(root, ['-m', 'on main']);
    assert.notEqual(onMain.code, 0);
    assert.match(onMain.stderr, /main is protected/);
    git(root, ['checkout', '-q', '-b', 'feature']);
    const onFeature = commit(root, ['-m', 'on feature']);
    assert.equal(onFeature.code, 0, onFeature.stderr);
  }, { branch: 'main', commits: 1 });
});

test('a refused cherry-pick says how to give up', { skip: noSh }, () => {
  withHooks((root) => {
    git(root, ['checkout', '-q', '-b', 'feature/x']);
    change(root, 'f.txt');
    assert.equal(commit(root, ['-m', 'on feature']).code, 0);
    git(root, ['checkout', '-q', 'main']);
    const pick = gitRun(root, ['cherry-pick', 'feature/x']);
    assert.notEqual(pick.code, 0);
    const line = pick.stderr.split('\n').find((l) => l.startsWith('slicekit: '));
    assert.equal(line, 'slicekit: main is protected; commit on a slice branch, or set ALLOW_PROTECTED_COMMIT=1; to give up, run git cherry-pick --abort');
  }, { branch: 'main', commits: 1 });
});
