import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeRepo, commit } from './helpers/tmp-repo.js';
import { git, GitError, isRepo, hasCommits, currentBranch, headSha, changedFiles, commitsOnBranch, parseTrailers } from '../src/git.js';

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
    commit(root, message, { allowEmpty: false });
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

function gitTrailers(root, message) {
  const out = execFileSync('git', ['interpret-trailers', '--parse'], { cwd: root, input: message, encoding: 'utf8' });
  const trailers = {};
  for (const line of out.trim().split('\n').filter((l) => l !== '')) {
    const i = line.indexOf(':');
    trailers[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return trailers;
}

test('git » parseTrailers agrees with git interpret-trailers --parse', () => {
  const { root, cleanup } = makeRepo();
  try {
    const joined = 'feat: x\n\nbody\n\nSlice: P1/S-01\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n';
    assert.equal(Object.keys(gitTrailers(root, joined)).length, 2);
    assert.deepEqual(parseTrailers(joined), gitTrailers(root, joined));
    const split = 'feat: x\n\nSlice: P1/S-01\n\nCo-Authored-By: A <a@x.io>\n';
    assert.deepEqual(parseTrailers(split), gitTrailers(root, split));
  } finally {
    cleanup();
  }
});

test('git » currentBranch is null on a detached HEAD', () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    git(root, ['checkout', '--detach']);
    assert.equal(currentBranch(root), null);
  } finally {
    cleanup();
  }
});

test('git » option-shaped refs are refused before git runs', () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    for (const bad of ['--output=x', '-x', 'a b', 'main..HEAD', '']) {
      assert.throws(() => changedFiles(root, bad), GitError, bad);
      assert.throws(() => commitsOnBranch(root, bad), GitError, bad);
    }
    assert.equal(fs.existsSync(path.join(root, 'x')), false);
    assert.deepEqual(changedFiles(root, 'main'), []);
    assert.deepEqual(commitsOnBranch(root, 'main'), []);
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
