// REQ-1.1: the default branch init writes into a new config (P3/S-36, issue #78, review r1 H-2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDefaultBranch, git } from '../src/git.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';

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

// P4/S-46 (issue #87): with no origin, no init.defaultBranch and HEAD on neither main nor master,
// init cannot tell the default branch; it asks for one rather than guess. git's system and global
// config are shut out, so a machine-wide init.defaultBranch (Git for Windows sets one) does not count.
function isolatedEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-gitcfg-'));
  const global = path.join(dir, 'gitconfig');
  fs.writeFileSync(global, '');
  return { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: global }, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const configFile = (root) => path.join(root, '.slicekit', 'config.json');

test('init on a feature branch with no origin refuses and asks for --default-branch', () => {
  const iso = isolatedEnv();
  const feature = makeRepo({ commits: 1, branch: 'feature/x' });
  const detached = makeRepo({ commits: 1, branch: 'feature/y' });
  try {
    const r = runCli(['init', '--shape', 'backend'], { cwd: feature.root, env: iso.env });
    assert.notEqual(r.code, 0, r.stdout);
    assert.match(r.stderr, /--default-branch <name>/);
    assert.ok(!fs.existsSync(configFile(feature.root)), 'no config was written');

    git(detached.root, ['switch', '-q', '--detach', 'HEAD']);
    const d = runCli(['init', '--shape', 'backend'], { cwd: detached.root, env: iso.env });
    assert.notEqual(d.code, 0, d.stdout);
    assert.match(d.stderr, /--default-branch <name>/);
    assert.ok(!fs.existsSync(configFile(detached.root)), 'no config was written');
  } finally {
    feature.cleanup();
    detached.cleanup();
    iso.cleanup();
  }
});

test('init --default-branch trunk protects trunk', () => {
  const iso = isolatedEnv();
  const repo = makeRepo({ commits: 1, branch: 'feature/x' });
  try {
    const r = runCli(['init', '--shape', 'backend', '--default-branch', 'trunk'], { cwd: repo.root, env: iso.env });
    assert.equal(r.code, 0, r.stderr);
    const cfg = JSON.parse(fs.readFileSync(configFile(repo.root), 'utf8'));
    assert.equal(cfg.defaultBranch, 'trunk');
    assert.deepEqual(cfg.protectedBranches, ['trunk']);
  } finally {
    repo.cleanup();
    iso.cleanup();
  }
});
