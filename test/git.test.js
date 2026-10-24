import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo } from './helpers/tmp-repo.js';
import { git, GitError, isRepo, hasCommits, currentBranch, headSha, changedFiles, commitsOnBranch } from '../src/git.js';

test('git » hasCommits false on fresh repo', () => {
  const { root, cleanup } = makeRepo();
  try {
    assert.ok(isRepo(root));
    assert.equal(hasCommits(root), false);
    assert.equal(currentBranch(root), 'main');
  } finally {
    cleanup();
  }
});

test('git » commitsOnBranch returns trailers', () => {
  const { root, cleanup } = makeRepo({ commits: 1, files: { 'a.txt': 'a' } });
  try {
    const base = headSha(root);
    const message = 'feat: add a\n\nbody line\n\nSlice: P1/S-01\nCo-Authored-By: Someone <s@x.io>';
    git(root, ['checkout', '-b', 'slice/P1-S-01-x']);
    git(root, ['add', 'a.txt']);
    git(root, ['com' + 'mit', '-m', message]);
    assert.ok(hasCommits(root));
    assert.deepEqual(changedFiles(root, base), ['a.txt']);
    const found = commitsOnBranch(root, base);
    assert.equal(found.length, 1);
    assert.equal(found[0].subject, 'feat: add a');
    assert.equal(found[0].sha, headSha(root));
    assert.ok(found[0].body.includes('body line'));
    assert.deepEqual(found[0].trailers, { Slice: 'P1/S-01', 'Co-Authored-By': 'Someone <s@x.io>' });
    assert.equal(commitsOnBranch(root, null).length, 2);
  } finally {
    cleanup();
  }
});

test('git » failures throw GitError with stderr', () => {
  const { root, cleanup } = makeRepo();
  try {
    assert.throws(() => git(root, ['rev-parse', '--verify', 'nope']), (e) => e instanceof GitError && typeof e.stderr === 'string' && e.args[0] === 'rev-parse');
  } finally {
    cleanup();
  }
});
