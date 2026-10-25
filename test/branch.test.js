import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../src/config.js';
import { main } from '../src/cli/index.js';
import {
  GitError,
  behindUpstream,
  commitPaths,
  currentBranch,
  git,
  gitUser,
  hasRemote,
  isClean,
  pushBranch,
  switchBranch,
} from '../src/git.js';
import { commit, makeRemote, makeRepo } from './helpers/tmp-repo.js';

const cfg = defaultConfig({ name: 'demo', shape: 'backend' });

async function cli(root, args) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

// A repository with a committed config on main; with `remote`, a bare origin holding main.
async function withRepo(fn, { remote = false } = {}) {
  const repo = makeRepo({ files: { '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n` } });
  git(repo.root, ['add', '-A']);
  commit(repo.root, 'config');
  const origin = remote ? makeRemote(repo.root) : null;
  if (origin) git(repo.root, ['push', '-q', 'origin', 'main']);
  try {
    return await fn(repo.root, origin?.remote);
  } finally {
    origin?.cleanup();
    repo.cleanup();
  }
}

const sha = (root, ref) => git(root, ['rev-parse', ref]);

// A second clone that adds one commit to `branch` on the remote.
function pushFromElsewhere(remote, branch) {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-clone-'));
  try {
    git(other, ['clone', '-q', remote, '.']);
    git(other, ['config', 'user.name', 'Other']);
    git(other, ['config', 'user.email', 'other@example.com']);
    git(other, ['config', 'commit.gpgsign', 'false']);
    git(other, ['switch', '-q', branch]);
    commit(other, 'from elsewhere');
    git(other, ['push', '-q', 'origin', branch]);
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
}

test('branch starts from the default branch and refuses a dirty tree', async () => {
  await withRepo(
    async (root) => {
      // Local main is one commit ahead of origin/main; the branch is cut from origin/main.
      commit(root, 'local only');
      const r = await cli(root, ['branch', 'spec', 'demo']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, 'spec/demo\n');
      assert.equal(currentBranch(root), 'spec/demo');
      assert.equal(sha(root, 'HEAD'), sha(root, 'origin/main'));
      assert.notEqual(sha(root, 'HEAD'), sha(root, 'main'));
      // No upstream is set, so a later push cannot land on main.
      assert.throws(() => git(root, ['rev-parse', '--abbrev-ref', '@{u}']), GitError);

      fs.writeFileSync(path.join(root, 'stray.txt'), 'x');
      const dirty = await cli(root, ['branch', 'plan', 'next']);
      assert.equal(dirty.code, 1);
      assert.match(dirty.stderr, /commit or stash your changes first/);
      assert.equal(currentBranch(root), 'spec/demo');
      assert.throws(() => git(root, ['rev-parse', '--verify', 'refs/heads/plan/next']), GitError);
    },
    { remote: true },
  );
});

test('branch refuses a bad slug or kind with exit 2', async () => {
  await withRepo(async (root) => {
    for (const args of [['spec', 'Demo'], ['spec', '-x'], ['spec', 'a/b'], ['spec', 'a'.repeat(61)], ['slice', 'demo'], ['spec']]) {
      const r = await cli(root, ['branch', ...args]);
      assert.equal(r.code, 2, args.join(' '));
    }
    assert.equal(currentBranch(root), 'main');
  });
});

test('branch prints the branch it is already on, and switches to one that exists', async () => {
  await withRepo(async (root) => {
    assert.equal((await cli(root, ['branch', 'gaps', 'first'])).code, 0);
    commit(root, 'on gaps');
    const again = await cli(root, ['branch', 'gaps', 'first']);
    assert.deepEqual([again.code, again.stdout], [0, 'gaps/first\n']);
    git(root, ['switch', '-q', 'main']);
    const back = await cli(root, ['branch', 'gaps', 'first']);
    assert.deepEqual([back.code, back.stdout], [0, 'gaps/first\n']);
    assert.equal(git(root, ['log', '-1', '--format=%s']), 'on gaps');
  });
});

test('branch without origin cuts from the local default; a failed fetch warns', async () => {
  await withRepo(async (root) => {
    commit(root, 'local');
    assert.equal((await cli(root, ['branch', 'plan', 'p2'])).code, 0);
    assert.equal(sha(root, 'HEAD'), sha(root, 'main'));
    git(root, ['switch', '-q', 'main']);
    git(root, ['remote', 'add', 'origin', path.join(os.tmpdir(), 'slicekit-no-such-remote')]);
    const r = await cli(root, ['branch', 'plan', 'p3']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /^slicekit: could not fetch origin \(.+\); branching from local main$/m);
    assert.equal(sha(root, 'HEAD'), sha(root, 'main'));
  });
});

test('pushBranch sets an upstream, then pushes HEAD to the upstream branch by name', async () => {
  await withRepo(
    async (root, remote) => {
      switchBranch(root, 'spec/demo', { create: true, from: 'main' });
      commit(root, 'spec');
      assert.deepEqual(pushBranch(root), { branch: 'spec/demo', remoteRef: 'refs/heads/spec/demo' });
      assert.equal(git(remote, ['rev-parse', 'refs/heads/spec/demo']), sha(root, 'HEAD'));
      // A local branch whose upstream has another name: a plain push would refuse.
      switchBranch(root, 'work', { create: true, from: 'HEAD' });
      git(root, ['branch', '--set-upstream-to=origin/spec/demo']);
      commit(root, 'more');
      assert.deepEqual(pushBranch(root), { branch: 'work', remoteRef: 'refs/heads/spec/demo' });
      assert.equal(git(remote, ['rev-parse', 'refs/heads/spec/demo']), sha(root, 'HEAD'));
    },
    { remote: true },
  );
});

test('pushBranch never pushes to a protected branch or from a detached head', async () => {
  await withRepo(
    async (root, remote) => {
      const before = git(remote, ['rev-parse', 'refs/heads/main']);
      commit(root, 'local');
      assert.throws(() => pushBranch(root, { protectedBranches: ['main'] }), /protected/);
      // A work branch that tracks main is refused too.
      switchBranch(root, 'spec/x', { create: true, from: 'HEAD' });
      git(root, ['branch', '--set-upstream-to=origin/main']);
      assert.throws(() => pushBranch(root), /protected/);
      git(root, ['switch', '-q', '--detach', 'HEAD']);
      assert.throws(() => pushBranch(root), GitError);
      assert.equal(git(remote, ['rev-parse', 'refs/heads/main']), before);
    },
    { remote: true },
  );
});

test('behindUpstream counts commits on the upstream not in HEAD', async () => {
  await withRepo(
    async (root, remote) => {
      switchBranch(root, 'spec/demo', { create: true, from: 'main' });
      assert.equal(behindUpstream(root), 0);
      pushBranch(root);
      assert.equal(behindUpstream(root), 0);
      pushFromElsewhere(remote, 'spec/demo');
      assert.equal(behindUpstream(root), 1);
    },
    { remote: true },
  );
});

test('the small helpers: gitUser, isClean, hasRemote, commitPaths', async () => {
  await withRepo(async (root) => {
    assert.equal(gitUser(root), 'Slicekit Test');
    assert.equal(isClean(root), true);
    assert.equal(hasRemote(root), false);
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    fs.writeFileSync(path.join(root, 'b.txt'), 'b');
    assert.equal(isClean(root), false);
    const made = commitPaths(root, ['a.txt'], 'add a');
    assert.equal(made, sha(root, 'HEAD'));
    assert.equal(git(root, ['show', '--name-only', '--format=', 'HEAD']), 'a.txt');
    assert.equal(git(root, ['status', '--porcelain']), '?? b.txt');
    assert.equal(commitPaths(root, ['a.txt'], 'again'), null);
    assert.throws(() => commitPaths(root, [], 'none'), GitError);
    git(root, ['remote', 'add', 'origin', root]);
    assert.equal(hasRemote(root), true);
    assert.equal(hasRemote(root, 'upstream'), false);
    assert.throws(() => switchBranch(root, '-x'), GitError);
  });
});
