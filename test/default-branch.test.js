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
