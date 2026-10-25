import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/check/context.js';
import { git } from '../../src/git.js';
import trailer from '../../src/check/rules/trailer.js';
import { commit, makeRepo } from '../helpers/tmp-repo.js';

const BRANCH = 'slice/P1-S-03-x';
const run = (root) => trailer.run(buildContext(root, loadConfig(root)));
const sha7 = (root, rev = 'HEAD') => git(root, ['rev-parse', '--short=7', rev]);

// An initialised repo whose git hooks are switched off, so each commit carries only what its
// message says. `setup` runs before init: it makes the history the rule judges.
function withRepo(fn, { commits = 1, branch = 'main', setup = () => {} } = {}) {
  const repo = makeRepo({ commits, branch });
  try {
    setup(repo.root);
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    git(repo.root, ['config', '--unset', 'core.hooksPath']);
    // init stages the hooks it creates in a repo with commits; unstage them so the index is clean.
    if (commits > 0) git(repo.root, ['reset', '-q']);
    return fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

const onSlice = (root) => git(root, ['checkout', '-q', '-b', BRANCH]);

test('the rule is blocking and not a ratchet', () => {
  assert.equal(trailer.id, 'trailer');
  assert.equal(trailer.blocking, true);
  assert.equal(trailer.ratchet, false);
});

// REQ-1.9: every commit on a slice branch carries `Slice: P<n>/S-<nn>`.
test('commit without trailer on a slice branch is a finding', () => {
  withRepo((root) => {
    onSlice(root);
    commit(root, 'with\n\nSlice: P1/S-03');
    commit(root, 'without');
    assert.deepEqual(run(root), [
      { file: BRANCH, line: 0, message: `commit ${sha7(root)} has no Slice trailer` },
    ]);
  });
});

// REQ-1.9: a slice branch with no commits has nothing to judge.
test('no commits is not a finding', () => {
  withRepo((root) => assert.deepEqual(run(root), []), { commits: 0, branch: BRANCH });
});

test('a trailer naming another slice is a finding', () => {
  withRepo((root) => {
    onSlice(root);
    commit(root, 'wrong\n\nSlice: P1/S-04');
    assert.deepEqual(run(root).map((f) => f.message), [`commit ${sha7(root)} names P1/S-04, branch is P1/S-03`]);
  });
});

test('a branch that is not a slice branch is not judged', () => {
  withRepo((root) => {
    git(root, ['checkout', '-q', '-b', 'feature/x']);
    commit(root, 'without');
    assert.deepEqual(run(root), []);
  });
});

test('commits already on the default branch are not judged', () => {
  withRepo((root) => {
    onSlice(root);
    commit(root, 'mine\n\nSlice: P1/S-03');
    assert.deepEqual(run(root), []);
  }, { commits: 3 });
});

test('a merge commit is exempt', () => {
  withRepo((root) => {
    onSlice(root);
    commit(root, 'mine\n\nSlice: P1/S-03');
    git(root, ['checkout', '-q', 'main']);
    commit(root, 'main moves on');
    git(root, ['checkout', '-q', BRANCH]);
    git(root, ['merge', '--no-ff', '-q', '-m', 'merge main', 'main']);
    assert.deepEqual(run(root), []);
  });
});

test('the base is origin/<defaultBranch> when it exists', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-bare-'));
  try {
    withRepo((root) => {
      onSlice(root);
      commit(root, 'pushed, no trailer');
      git(root, ['push', '-q', 'origin', `HEAD:refs/heads/main`]);
      git(root, ['fetch', '-q', 'origin']);
      commit(root, 'local\n\nSlice: P1/S-03');
      assert.deepEqual(run(root), []);
    }, {
      setup: (root) => {
        git(bare, ['init', '-q', '--bare', '-b', 'main']);
        git(root, ['remote', 'add', 'origin', bare]);
        git(root, ['push', '-q', 'origin', 'main']);
      },
    });
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('with no default branch every commit is judged', () => {
  withRepo((root) => {
    commit(root, 'second, no trailer');
    const found = run(root);
    assert.equal(found.length, 2);
  }, { commits: 1, branch: BRANCH });
});

// git, not a hand parser, decides what a trailer is: these messages all carry `Slice: P1/S-03`.
test('cherry-pick -x keeps the trailer git reads', () => {
  withRepo((root) => {
    git(root, ['checkout', '-q', '-b', 'feature/x']);
    fs.writeFileSync(path.join(root, 'f.txt'), 'f');
    git(root, ['add', 'f.txt']);
    commit(root, 'picked\n\nSlice: P1/S-03');
    git(root, ['checkout', '-q', 'main']);
    onSlice(root);
    git(root, ['cherry-pick', '-x', 'feature/x']);
    assert.match(git(root, ['log', '-1', '--format=%B']), /\(cherry picked from commit [0-9a-f]+\)$/);
    assert.deepEqual(run(root), []);
  });
});

test('a trailer block with a line of prose and a git trailer is read as git reads it', () => {
  withRepo((root) => {
    onSlice(root);
    commit(root, 'subject\n\nThis fixes it.\nSigned-off-by: Z <z@example.com>\nSlice: P1/S-03');
    assert.deepEqual(run(root), []);
  });
});

test('a folded trailer does not hide the Slice trailer', () => {
  withRepo((root) => {
    onSlice(root);
    commit(root, 'subject\n\nSlice: P1/S-03\nCo-Authored-By: A\n  <a@example.com>');
    assert.deepEqual(run(root), []);
  });
});

test('a lowercase slice key counts, as git matches keys', () => {
  withRepo((root) => {
    onSlice(root);
    commit(root, 'subject\n\nslice: P1/S-03');
    assert.deepEqual(run(root), []);
  });
});

// The base excludes every default-branch ref that exists: a stale origin does not drag local
// main's commits into the slice's range.
test('local main ahead of a stale origin/main is not judged', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-bare-'));
  try {
    withRepo((root) => {
      commit(root, 'main ahead 1');
      commit(root, 'main ahead 2');
      onSlice(root);
      commit(root, 'mine\n\nSlice: P1/S-03');
      assert.deepEqual(run(root), []);
    }, {
      setup: (root) => {
        git(bare, ['init', '-q', '--bare', '-b', 'main']);
        git(root, ['remote', 'add', 'origin', bare]);
        git(root, ['push', '-q', 'origin', 'main']);
        git(root, ['fetch', '-q', 'origin']);
      },
    });
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

// First-parent only: a stacked slice merged into this branch keeps its own trailers.
test('a stacked slice merged into the branch is not judged', () => {
  withRepo((root) => {
    onSlice(root);
    commit(root, 'mine\n\nSlice: P1/S-03');
    git(root, ['checkout', '-q', '-b', 'slice/P1-S-04-y']);
    commit(root, 'stacked\n\nSlice: P1/S-04');
    git(root, ['checkout', '-q', BRANCH]);
    git(root, ['merge', '--no-ff', '-q', '-m', 'merge S-04', 'slice/P1-S-04-y']);
    assert.deepEqual(run(root), []);
  });
});
