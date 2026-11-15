// REQ-2.1: the branch command cuts and switches slice branches, and pushBranch never pushes to a protected or default branch.
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
const pushOpts = { protectedBranches: cfg.protectedBranches, defaultBranch: cfg.defaultBranch };

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
    commit(other, `from elsewhere on ${branch}`);
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

      // An untracked file is carried to the new branch, as git carries it.
      fs.writeFileSync(path.join(root, 'stray.txt'), 'x');
      const carried = await cli(root, ['branch', 'gaps', 'carry']);
      assert.equal(carried.code, 0, carried.stderr);
      assert.equal(currentBranch(root), 'gaps/carry');
      assert.equal(fs.readFileSync(path.join(root, 'stray.txt'), 'utf8'), 'x');

      // A change to a tracked file is refused.
      fs.appendFileSync(path.join(root, '.slicekit', 'config.json'), '\n');
      const dirty = await cli(root, ['branch', 'plan', 'next']);
      assert.equal(dirty.code, 1);
      assert.match(dirty.stderr, /commit or stash your changes first/);
      assert.equal(currentBranch(root), 'gaps/carry');
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
    assert.match(r.stderr, /^slicekit: could not fetch origin \((?:fatal|error): .+\); branching from local main$/m);
    assert.equal(sha(root, 'HEAD'), sha(root, 'main'));
  });
});

test('pushBranch sets an upstream, then pushes HEAD to the upstream branch by name', async () => {
  await withRepo(
    async (root, remote) => {
      switchBranch(root, 'spec/demo', { create: true, from: 'main' });
      commit(root, 'spec');
      assert.deepEqual(pushBranch(root, pushOpts), { branch: 'spec/demo', remoteRef: 'refs/heads/spec/demo' });
      assert.equal(git(remote, ['rev-parse', 'refs/heads/spec/demo']), sha(root, 'HEAD'));
      // A local branch whose upstream has another name: a plain push would refuse.
      switchBranch(root, 'work', { create: true, from: 'HEAD' });
      git(root, ['branch', '--set-upstream-to=origin/spec/demo']);
      commit(root, 'more');
      assert.deepEqual(pushBranch(root, pushOpts), { branch: 'work', remoteRef: 'refs/heads/spec/demo' });
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
      assert.throws(() => pushBranch(root, pushOpts), /protected/);
      // A work branch that tracks main is refused too.
      switchBranch(root, 'spec/x', { create: true, from: 'HEAD' });
      git(root, ['branch', '--set-upstream-to=origin/main']);
      assert.throws(() => pushBranch(root, pushOpts), /protected/);
      git(root, ['switch', '-q', '--detach', 'HEAD']);
      assert.throws(() => pushBranch(root, pushOpts), GitError);
      assert.equal(git(remote, ['rev-parse', 'refs/heads/main']), before);
    },
    { remote: true },
  );
});

test('a tag named like the branch does not hide main from pushBranch or currentBranch', async () => {
  await withRepo(
    async (root, remote) => {
      const before = git(remote, ['rev-parse', 'refs/heads/main']);
      git(root, ['tag', 'main']);
      commit(root, 'local');
      assert.equal(currentBranch(root), 'main');
      assert.throws(() => pushBranch(root, pushOpts), /protected/);
      assert.equal(git(remote, ['rev-parse', 'refs/heads/main']), before);
    },
    { remote: true },
  );
});

test('a push mapping in the config cannot redirect pushBranch onto main', async () => {
  await withRepo(
    async (root, remote) => {
      const before = git(remote, ['rev-parse', 'refs/heads/main']);
      git(root, ['config', 'remote.origin.push', 'refs/heads/work:refs/heads/main']);
      switchBranch(root, 'work', { create: true, from: 'main' });
      commit(root, 'work');
      assert.deepEqual(pushBranch(root, pushOpts), { branch: 'work', remoteRef: 'refs/heads/work' });
      assert.equal(git(remote, ['rev-parse', 'refs/heads/main']), before);
      assert.equal(git(remote, ['rev-parse', 'refs/heads/work']), sha(root, 'HEAD'));
      assert.equal(git(root, ['rev-parse', '--abbrev-ref', '@{u}']), 'origin/work');
      // With the upstream set, the second push goes by explicit refspec too.
      commit(root, 'work 2');
      assert.deepEqual(pushBranch(root, pushOpts), { branch: 'work', remoteRef: 'refs/heads/work' });
      assert.equal(git(remote, ['rev-parse', 'refs/heads/main']), before);
      assert.equal(git(remote, ['rev-parse', 'refs/heads/work']), sha(root, 'HEAD'));
    },
    { remote: true },
  );
});

test('pushBranch refuses the default branch even when it is not listed as protected', async () => {
  await withRepo(
    async (root, remote) => {
      switchBranch(root, 'trunk', { create: true, from: 'main' });
      commit(root, 'on trunk');
      assert.throws(() => pushBranch(root, { protectedBranches: ['main'], defaultBranch: 'trunk' }), /trunk/);
      assert.throws(() => git(remote, ['rev-parse', '--verify', 'refs/heads/trunk']), GitError);
    },
    { remote: true },
  );
});

test('pushBranch needs the protected branches and the default branch from the config', async () => {
  await withRepo(
    async (root, remote) => {
      switchBranch(root, 'spec/demo', { create: true, from: 'main' });
      const message = 'pushBranch needs {protectedBranches, defaultBranch} from the config';
      for (const opts of [undefined, {}, { protectedBranches: ['main'] }, { defaultBranch: 'main' }, { protectedBranches: 'main', defaultBranch: 'main' }, { protectedBranches: ['main'], defaultBranch: '' }]) {
        assert.throws(() => pushBranch(root, opts), (e) => e instanceof TypeError && e.message === message, JSON.stringify(opts));
      }
      assert.throws(() => git(remote, ['rev-parse', '--verify', 'refs/heads/spec/demo']), GitError);
    },
    { remote: true },
  );
});

test('branch without origin, or after a failed fetch, cuts from the default branch, not a tag of that name', async () => {
  await withRepo(async (root) => {
    git(root, ['tag', 'main']);
    commit(root, 'after the tag');
    assert.equal((await cli(root, ['branch', 'plan', 'p4'])).code, 0);
    assert.equal(sha(root, 'HEAD'), sha(root, 'refs/heads/main'));
    assert.notEqual(sha(root, 'HEAD'), sha(root, 'refs/tags/main'));
    git(root, ['switch', '-q', 'main']);
    git(root, ['remote', 'add', 'origin', path.join(os.tmpdir(), 'slicekit-no-such-remote')]);
    const r = await cli(root, ['branch', 'plan', 'p5']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(sha(root, 'HEAD'), sha(root, 'refs/heads/main'));
  });
});

test('behindUpstream is 0 once the upstream branch is deleted on the remote', async () => {
  await withRepo(
    async (root, remote) => {
      switchBranch(root, 'spec/demo', { create: true, from: 'main' });
      pushBranch(root, pushOpts);
      pushFromElsewhere(remote, 'spec/demo');
      assert.equal(behindUpstream(root), 1);
      git(remote, ['update-ref', '-d', 'refs/heads/spec/demo']);
      assert.equal(behindUpstream(root), 0);
    },
    { remote: true },
  );
});

test('branch takes a work branch that exists only on origin and tracks it', async () => {
  await withRepo(
    async (root, remote) => {
      pushFromElsewhere(remote, 'main');
      // Another clone made spec/demo on origin; this clone has no local branch of that name.
      git(root, ['push', '-q', 'origin', 'HEAD:refs/heads/spec/demo']);
      pushFromElsewhere(remote, 'spec/demo');
      git(root, ['fetch', '-q', 'origin']);
      const r = await cli(root, ['branch', 'spec', 'demo']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(sha(root, 'HEAD'), sha(root, 'refs/remotes/origin/spec/demo'));
      assert.notEqual(sha(root, 'HEAD'), sha(root, 'refs/remotes/origin/main'));
      assert.equal(git(root, ['rev-parse', '--abbrev-ref', '@{u}']), 'origin/spec/demo');
    },
    { remote: true },
  );
});

test('branch fetches the work branch itself, so one only on origin is found without a prior fetch', async () => {
  await withRepo(
    async (root, remote) => {
      // Another clone made plan/p2 on origin after this clone last fetched.
      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-clone-'));
      try {
        git(other, ['clone', '-q', remote, '.']);
        git(other, ['config', 'user.name', 'Other']);
        git(other, ['config', 'user.email', 'other@example.com']);
        git(other, ['config', 'commit.gpgsign', 'false']);
        git(other, ['switch', '-q', '-c', 'plan/p2']);
        commit(other, 'plan from elsewhere');
        git(other, ['push', '-q', 'origin', 'plan/p2']);
      } finally {
        fs.rmSync(other, { recursive: true, force: true });
      }
      const r = await cli(root, ['branch', 'plan', 'p2']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stderr, '');
      assert.equal(git(root, ['log', '-1', '--format=%s']), 'plan from elsewhere');
      assert.equal(git(root, ['rev-parse', '--abbrev-ref', '@{u}']), 'origin/plan/p2');
      // A work branch origin does not have is not an error: it is cut from the default branch.
      git(root, ['switch', '-q', 'main']);
      const fresh = await cli(root, ['branch', 'gaps', 'new']);
      assert.equal(fresh.code, 0, fresh.stderr);
      assert.equal(fresh.stderr, '');
      assert.equal(sha(root, 'HEAD'), sha(root, 'refs/remotes/origin/main'));
    },
    { remote: true },
  );
});

test('behindUpstream counts commits on the upstream not in HEAD', async () => {
  await withRepo(
    async (root, remote) => {
      switchBranch(root, 'spec/demo', { create: true, from: 'main' });
      assert.equal(behindUpstream(root), 0);
      pushBranch(root, pushOpts);
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

// P5/S-21, REQ-2.9, D-54: the release record's work branch is cut as the plan's is.
test('branch release cuts release/<slug> from the default branch as origin has it', async () => {
  await withRepo(
    async (root) => {
      commit(root, 'local only');
      const r = await cli(root, ['branch', 'release', 'p1']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, 'release/p1\n');
      assert.equal(currentBranch(root), 'release/p1');
      assert.equal(sha(root, 'HEAD'), sha(root, 'refs/remotes/origin/main'));
      // Run again on the branch, it answers with the branch and moves nothing.
      const again = await cli(root, ['branch', 'release', 'p1']);
      assert.equal(again.code, 0, again.stderr);
      assert.equal(again.stdout, 'release/p1\n');
      // A slug that is not lowercase is a usage error, and so is a kind the command does not cut.
      assert.equal((await cli(root, ['branch', 'release', 'P1'])).code, 2);
      const unknown = await cli(root, ['branch', 'deploy', 'p1']);
      assert.equal(unknown.code, 2);
      assert.match(unknown.stderr, /usage: slicekit branch <spec\|gaps\|plan\|release> <slug>/);
    },
    { remote: true },
  );
});

// P5/S-21 review round 3 (H-6): `release` runs only at the default branch's tip, so `branch release`
// does not leave the session on a release branch that stands elsewhere.
test('branch release moves a stale release branch to the tip, and refuses one that holds its own commits', async () => {
  await withRepo(
    async (root, remote) => {
      // A release branch cut earlier, with no commit of its own; the default branch then moved.
      assert.equal((await cli(root, ['branch', 'release', 'p1'])).code, 0);
      const old = sha(root, 'HEAD');
      pushFromElsewhere(remote, 'main');
      // Run on the stale branch itself, it moves it and says so.
      const moved = await cli(root, ['branch', 'release', 'p1']);
      assert.equal(moved.code, 0, moved.stderr);
      assert.equal(moved.stdout, 'release/p1\n');
      assert.match(moved.stderr, /^slicekit: release\/p1 was behind main; moved to the tip of main$/m);
      assert.equal(currentBranch(root), 'release/p1');
      assert.notEqual(sha(root, 'HEAD'), old);
      assert.equal(sha(root, 'HEAD'), sha(root, 'refs/remotes/origin/main'));
      // Run from another branch, the same.
      git(root, ['switch', '-q', 'main']);
      pushFromElsewhere(remote, 'main');
      const fromMain = await cli(root, ['branch', 'release', 'p1']);
      assert.equal(fromMain.code, 0, fromMain.stderr);
      assert.match(fromMain.stderr, /release\/p1 was behind main; moved to the tip of main/);
      assert.equal(currentBranch(root), 'release/p1');
      assert.equal(sha(root, 'HEAD'), sha(root, 'refs/remotes/origin/main'));

      // A release branch with a commit the default branch lacks (a release pull request closed
      // unmerged) is not moved and not taken up: the line names the next slug.
      commit(root, 'docs(release): P1');
      const own = sha(root, 'HEAD');
      for (const start of ['release/p1', 'main']) {
        git(root, ['switch', '-q', start]);
        const r = await cli(root, ['branch', 'release', 'p1']);
        assert.equal(r.code, 1, `${start}: ${r.stdout}`);
        assert.equal(r.stdout, '');
        assert.match(r.stderr, /^slicekit: release\/p1 holds commits main lacks, so no release runs on it; run slicekit branch release p1-2$/m);
        assert.equal(currentBranch(root), start);
        assert.equal(sha(root, 'refs/heads/release/p1'), own);
      }
      const next = await cli(root, ['branch', 'release', 'p1-2']);
      assert.equal(next.code, 0, next.stderr);
      assert.equal(next.stdout, 'release/p1-2\n');
      assert.equal(sha(root, 'HEAD'), sha(root, 'refs/remotes/origin/main'));

      // The other kinds keep a branch that exists where it stands.
      git(root, ['switch', '-q', 'main']);
      assert.equal((await cli(root, ['branch', 'plan', 'p9'])).code, 0);
      const planAt = sha(root, 'HEAD');
      git(root, ['switch', '-q', 'main']);
      pushFromElsewhere(remote, 'main');
      const plan = await cli(root, ['branch', 'plan', 'p9']);
      assert.deepEqual([plan.code, plan.stdout, plan.stderr], [0, 'plan/p9\n', '']);
      assert.equal(sha(root, 'HEAD'), planAt);
    },
    { remote: true },
  );
});

// P5/S-50 review round 1 (H-4), issue #152, REQ-2.9: a numbered slug given directly, `<slug>-<n>`,
// asks the git host about the whole family: the base slug's branch and every numbered one. An open
// release pull request on any of them refuses, naming it, and no branch is cut.
test('branch release with a numbered slug asks the host about the base branch and every numbered one', async () => {
  await withRepo(
    async (root) => {
      const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-branch-host-'));
      const env = { ...process.env, SLICEKIT_GITHOST_FIXTURE: fixture };
      const run = async (args) => {
        let stdout = '';
        let stderr = '';
        const code = await main(args, { cwd: root, env, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } });
        return { code, stdout, stderr };
      };
      const url = (n) => `https://github.com/acme/demo/pull/${n}`;
      const put = (number, head, state) =>
        fs.writeFileSync(
          path.join(fixture, `pr-${number}.json`),
          `${JSON.stringify({ number, url: url(number), state, mergedAt: null, headRefOid: sha(root, `refs/heads/${head}`), headRefName: head, baseRefName: 'main', isDraft: false, title: '[release] P1', body: '', labels: [] }, null, 2)}\n`,
        );
      try {
        // release/p1 and release/p1-2 each hold a commit main lacks, and both are on origin.
        for (const name of ['release/p1', 'release/p1-2']) {
          git(root, ['switch', '-q', '-c', name, 'main']);
          commit(root, `docs(release): P1 on ${name}`);
          git(root, ['push', '-q', 'origin', name]);
        }
        git(root, ['switch', '-q', 'main']);
        const refused = async (branch, number) => {
          const r = await run(['branch', 'release', 'p1-3']);
          assert.equal(r.code, 1, r.stdout + r.stderr);
          assert.equal(r.stdout, '');
          const lines = r.stderr.split('\n').filter((l) => l !== '');
          assert.equal(lines.length, 1, r.stderr);
          assert.equal(lines[0], `slicekit: ${branch} is the branch of open pull request #${number} (${url(number)}); the phase's release is already open`);
          assert.equal(currentBranch(root), 'main');
          assert.throws(() => sha(root, 'refs/heads/release/p1-3'), GitError);
        };

        // The phase's release is open on the numbered branch release/p1-2.
        put(3, 'release/p1', 'CLOSED');
        put(4, 'release/p1-2', 'OPEN');
        await refused('release/p1-2', 4);

        // The phase's release is open on the base slug's branch.
        put(3, 'release/p1', 'OPEN');
        put(4, 'release/p1-2', 'CLOSED');
        await refused('release/p1', 3);

        // Neither is open: the numbered slug is cut from the default branch.
        put(3, 'release/p1', 'CLOSED');
        const cut = await run(['branch', 'release', 'p1-3']);
        assert.deepEqual([cut.code, cut.stdout], [0, 'release/p1-3\n'], cut.stderr);
        assert.equal(sha(root, 'HEAD'), sha(root, 'refs/remotes/origin/main'));
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
      }
    },
    { remote: true },
  );
});

// P6/S-51 (issue #170, REQ-2.9): a numbered slug whose branch holds its own commits belongs to the
// family of its base slug, so the next slug is the family's next free number, `<slug>-<n+1>` or the
// first one after it that no local or origin branch has, and never `<slug>-<n>-2`.
test('branch release given a numbered slug names the next free number of its family', async () => {
  await withRepo(
    async (root) => {
      const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-branch-host-'));
      const env = { ...process.env, SLICEKIT_GITHOST_FIXTURE: fixture };
      const run = async (args) => {
        let stdout = '';
        let stderr = '';
        const code = await main(args, { cwd: root, env, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } });
        return { code, stdout, stderr };
      };
      const closed = (number, head) =>
        fs.writeFileSync(
          path.join(fixture, `pr-${number}.json`),
          `${JSON.stringify({ number, url: `https://github.com/acme/demo/pull/${number}`, state: 'CLOSED', mergedAt: null, headRefOid: sha(root, `refs/heads/${head}`), headRefName: head, baseRefName: 'main', isDraft: false, title: '[release] P1', body: '', labels: [] }, null, 2)}\n`,
        );
      try {
        // release/p1 and release/p1-2 each hold a commit main lacks, both are on origin, and the
        // release pull request of each was closed unmerged: no branch of the family has one open.
        for (const name of ['release/p1', 'release/p1-2']) {
          git(root, ['switch', '-q', '-c', name, 'main']);
          commit(root, `docs(release): P1 on ${name}`);
          git(root, ['push', '-q', 'origin', name]);
        }
        closed(3, 'release/p1');
        closed(4, 'release/p1-2');
        const own = sha(root, 'refs/heads/release/p1-2');
        // Refused from the default branch and from the branch itself, with one line naming `next`.
        const refused = async (next) => {
          for (const start of ['main', 'release/p1-2']) {
            git(root, ['switch', '-q', start]);
            const r = await run(['branch', 'release', 'p1-2']);
            assert.equal(r.code, 1, `${start}: ${r.stdout}${r.stderr}`);
            assert.equal(r.stdout, '');
            const lines = r.stderr.split('\n').filter((l) => l !== '');
            assert.equal(lines.length, 1, r.stderr);
            assert.ok(lines[0].startsWith('slicekit: release/p1-2 holds commits main lacks'), lines[0]);
            assert.ok(lines[0].endsWith(`; run slicekit branch release ${next}`), `${start}: ${lines[0]}`);
            assert.ok(!r.stderr.includes('p1-2-2'), r.stderr);
            assert.equal(currentBranch(root), start);
            assert.equal(sha(root, 'refs/heads/release/p1-2'), own);
            assert.throws(() => sha(root, 'refs/heads/release/p1-2-2'), GitError);
          }
        };

        // The family holds release/p1 and release/p1-2: the next free number is 3.
        await refused('p1-3');

        // release/p1-3 exists on origin only, pushed from elsewhere: the next free number is 4.
        git(root, ['push', '-q', 'origin', 'refs/remotes/origin/main:refs/heads/release/p1-3']);
        git(root, ['update-ref', '-d', 'refs/remotes/origin/release/p1-3']);
        assert.throws(() => sha(root, 'refs/heads/release/p1-3'), GitError);
        await refused('p1-4');

        // release/p1-4 exists here only: the next free number is 5.
        git(root, ['branch', '-q', '--no-track', 'release/p1-4', 'refs/remotes/origin/main']);
        await refused('p1-5');

        // The slug the line names is cut from the default branch.
        git(root, ['switch', '-q', 'main']);
        const cut = await run(['branch', 'release', 'p1-5']);
        assert.deepEqual([cut.code, cut.stdout], [0, 'release/p1-5\n'], cut.stderr);
        assert.equal(sha(root, 'HEAD'), sha(root, 'refs/remotes/origin/main'));
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
      }
    },
    { remote: true },
  );
});
