// REQ-1.6, D-100 (P8/S-58): init registers a merge driver for BUILD.md, so a local merge of the
// default branch into a slice branch, both of which moved a state file and rewrote BUILD.md, ends with
// no conflict and a BUILD.md that equals what `status --write` renders from the merged state files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../src/init.js';
import { loadConfig } from '../src/config.js';
import { readSlice, setState } from '../src/state/index.js';
import { renderBuild } from '../src/state/build.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { writeSliceFixtures } from './helpers/slice-fixture.js';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The kit's own CLI by its absolute path, so the driver git runs in the fixture finds it.
const CLI = `node ${path.join(kitRoot, 'bin', 'slicekit.js').split(path.sep).join('/')}`;

// ALLOW_PROTECTED_COMMIT: init installs the kit's hooks, which refuse a commit on main.
const ENV = { ...process.env, ALLOW_PROTECTED_COMMIT: '1' };
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV }).trim();

const pr = (n, id) => ({ number: n, url: `http://x/${n}`, headSha: 'abc1234', title: `[${id}] x` });

// BUILD.md rendered from the state files on disk, as `status --write` writes it.
function rewriteBuild(root, cfg) {
  const file = path.join(root, 'BUILD.md');
  fs.writeFileSync(file, renderBuild(root, cfg, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''));
}

function commitAll(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

test('a local merge regenerates BUILD.md through the merge driver with no conflict', () => {
  const repo = makeRepo();
  try {
    const root = repo.root;
    init(root, { name: 'demo', shape: 'backend', cli: CLI });
    const ids = writeSliceFixtures(root, 3);
    const cfg = loadConfig(root);
    rewriteBuild(root, cfg);
    commitAll(root, 'plan');

    // The slice branch moves P1/S-01 and rewrites BUILD.md.
    git(root, 'checkout', '-q', '-b', 'slice/P1-S-01-a');
    setState(root, cfg, ids[0], 'draft-pr', { backfill: true, testExit: 0, checkExit: 0, pr: pr(14, ids[0]) });
    rewriteBuild(root, cfg);
    commitAll(root, `chore(slicekit): ${ids[0]} pr\n\nSlice: ${ids[0]}`);

    // The default branch moves P1/S-02, the next row of the same table, and rewrites BUILD.md.
    git(root, 'checkout', '-q', 'main');
    setState(root, cfg, ids[1], 'draft-pr', { backfill: true, testExit: 0, checkExit: 0, pr: pr(15, ids[1]) });
    rewriteBuild(root, cfg);
    commitAll(root, 'chore(slicekit): sync state');

    git(root, 'checkout', '-q', 'slice/P1-S-01-a');
    const merged = spawnSync('git', ['merge', '--no-ff', '--no-edit', 'main'], { cwd: root, encoding: 'utf8', env: ENV });
    assert.equal(merged.status, 0, `${merged.stdout}${merged.stderr}`);
    assert.equal(git(root, 'ls-files', '--unmerged'), '', 'a path is left unmerged');
    assert.equal(git(root, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3, 'the merge commit was made');
    assert.equal(git(root, 'status', '--porcelain'), '', 'the merge left a change behind');

    // Both moves are in the merged state files, and BUILD.md is their rendering.
    assert.equal(readSlice(root, cfg, ids[0]).state, 'draft-pr');
    assert.equal(readSlice(root, cfg, ids[1]).state, 'draft-pr');
    const text = fs.readFileSync(path.join(root, 'BUILD.md'), 'utf8');
    assert.equal(text, renderBuild(root, cfg, text));
    assert.match(text, /#14/);
    assert.match(text, /#15/);
    assert.equal(git(root, 'show', 'HEAD:BUILD.md'), text.trim());
  } finally {
    repo.cleanup();
  }
});
