// REQ-1.1: the default branch init writes into a new config (P3/S-36, issue #78, review r1 H-2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDefaultBranch, git } from '../src/git.js';
import { makeRepo } from './helpers/tmp-repo.js';

test("origin's HEAD that names a branch no longer present is passed over", () => {
  const repo = makeRepo({ commits: 1, branch: 'master' });
  try {
    git(repo.root, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/gone']);
    assert.equal(detectDefaultBranch(repo.root), 'master');
    git(repo.root, ['update-ref', 'refs/remotes/origin/gone', 'HEAD']);
    assert.equal(detectDefaultBranch(repo.root), 'gone');
  } finally {
    repo.cleanup();
  }
});

test("an empty repository's master is the default; any other branch HEAD is on is not", () => {
  const empty = makeRepo({ branch: 'master' });
  const feature = makeRepo({ commits: 1, branch: 'feature/x' });
  try {
    assert.equal(detectDefaultBranch(empty.root), 'master');
    assert.equal(detectDefaultBranch(feature.root), 'main');
  } finally {
    empty.cleanup();
    feature.cleanup();
  }
});

// Review r4 H-8: Git for Windows sets init.defaultBranch=master for the whole machine, so a
// repository on main that still has a master branch keeps main.
test('a local main comes before a machine-wide init.defaultBranch', () => {
  const repo = makeRepo({ commits: 1, branch: 'main' });
  try {
    git(repo.root, ['branch', 'master']);
    git(repo.root, ['config', 'init.defaultBranch', 'master']);
    assert.equal(detectDefaultBranch(repo.root), 'main');
    const empty = makeRepo({ branch: 'trunk' });
    try {
      git(empty.root, ['config', 'init.defaultBranch', 'trunk']);
      assert.equal(detectDefaultBranch(empty.root), 'trunk', "an empty repository's HEAD was named by the setting");
    } finally {
      empty.cleanup();
    }
  } finally {
    repo.cleanup();
  }
});

// Review r4 H-7: a name git allows but the config refuses is passed over, so init still writes a config.
test('a name accept refuses is passed over', () => {
  const repo = makeRepo({ commits: 1, branch: 'master' });
  try {
    git(repo.root, ['update-ref', 'refs/remotes/origin/dev+1', 'HEAD']);
    git(repo.root, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/dev+1']);
    assert.equal(detectDefaultBranch(repo.root), 'dev+1');
    assert.equal(detectDefaultBranch(repo.root, { accept: (b) => !b.includes('+') }), 'master');
  } finally {
    repo.cleanup();
  }
});
