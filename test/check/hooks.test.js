import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/check/context.js';
import { git } from '../../src/git.js';
import hooks from '../../src/check/rules/hooks.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const win = process.platform === 'win32';
const run = (root) => hooks.run(buildContext(root, loadConfig(root)));

function withInit(fn, opts) {
  const repo = makeRepo(opts);
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    return fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

test('the rule is blocking and not a ratchet', () => {
  assert.equal(hooks.id, 'hooks');
  assert.equal(hooks.blocking, true);
  assert.equal(hooks.ratchet, false);
});

// REQ-3.9: git hooks do not survive a clone, so an unset hooks path fails check.
test('hooksPath unset is a finding', () => {
  withInit((root) => {
    git(root, ['config', '--unset', 'core.hooksPath']);
    assert.deepEqual(run(root), [
      { file: '.githooks', line: 0, message: 'core.hooksPath is not set; run slicekit init' },
    ]);
  });
});

test('a hooks path other than .githooks is a finding', () => {
  withInit((root) => {
    git(root, ['config', 'core.hooksPath', '.husky']);
    assert.deepEqual(run(root), [
      { file: '.githooks', line: 0, message: 'core.hooksPath is .husky, not .githooks; set it to .githooks or run slicekit init' },
    ]);
  });
});

test('installed hooks are not a finding', () => {
  withInit((root) => assert.deepEqual(run(root), []));
});

test('a missing hook is a named finding', () => {
  withInit((root) => {
    fs.rmSync(path.join(root, '.githooks', 'pre-commit'));
    assert.deepEqual(run(root), [
      { file: '.githooks/pre-commit', line: 1, message: '.githooks/pre-commit is missing; run slicekit init' },
    ]);
  });
});

// On POSIX the mode bit is read; on win32 there is none, so the index mode of a tracked hook is.
test('a hook that is not executable is a named finding', () => {
  withInit((root) => {
    const file = path.join(root, '.githooks', 'prepare-commit-msg');
    if (win) git(root, ['add', '.githooks/prepare-commit-msg']);
    else fs.chmodSync(file, 0o644);
    if (win) git(root, ['update-index', '--chmod=-x', '.githooks/prepare-commit-msg']);
    assert.deepEqual(run(root), [
      { file: '.githooks/prepare-commit-msg', line: 1, message: '.githooks/prepare-commit-msg is not executable; run git update-index --chmod=+x .githooks/prepare-commit-msg' },
    ]);
    if (win) git(root, ['update-index', '--chmod=+x', '.githooks/prepare-commit-msg']);
    else fs.chmodSync(file, 0o755);
    assert.deepEqual(run(root), []);
  });
});

test('pre-merge-commit is the third hook the rule expects', () => {
  withInit((root) => {
    fs.rmSync(path.join(root, '.githooks', 'pre-merge-commit'));
    assert.deepEqual(run(root).map((f) => f.message), ['.githooks/pre-merge-commit is missing; run slicekit init']);
  });
});

// M2: one normaliser, shared with init: a spelling that resolves to <root>/.githooks is installed.
test('every spelling of the .githooks path counts as installed', () => {
  withInit((root) => {
    const spellings = ['./.githooks', '.githooks/', path.join(root, '.githooks'), path.join(root, '.githooks').split(path.sep).join('/')];
    if (win) spellings.push('.GitHooks');
    for (const value of spellings) {
      git(root, ['config', 'core.hooksPath', value]);
      assert.deepEqual(run(root), [], value);
    }
    git(root, ['config', 'core.hooksPath', 'sub/.githooks']);
    assert.equal(run(root).length, 1);
  });
});

// A link that resolves to .githooks is installed: both sides are compared by their real paths.
test('a junction or symlink to .githooks counts as installed', (t) => {
  withInit((root) => {
    try {
      fs.symlinkSync(path.join(root, '.githooks'), path.join(root, 'hooks-link'), win ? 'junction' : 'dir');
    } catch (e) {
      t.skip(`cannot create a link here: ${e.code ?? e.message}`);
      return;
    }
    git(root, ['config', 'core.hooksPath', 'hooks-link']);
    assert.deepEqual(run(root), []);
  });
});

test('not a repository is not a finding', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-plain-'));
  try {
    init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    assert.deepEqual(run(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
