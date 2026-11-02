// REQ-3.15, D-10: on a slice branch a test of the evaluation set stays as it was at the red commit
// recorded in the slice's state file, unless the slice file was amended after that commit. The state
// file, the red commit and the tests are read from git objects of HEAD, never the working tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/check/context.js';
import { git } from '../../src/git.js';
import frozen from '../../src/check/rules/frozen.js';
import { commit, makeRepo } from '../helpers/tmp-repo.js';
import { writeSliceFixture } from '../helpers/slice-fixture.js';

const SLICE = 'P1/S-01';
const BRANCH = 'slice/P1-S-01-a';
const TEST = 'test/billing.test.js';
const STATE = '.slicekit/state/P1-S-01.json';
const SLICE_FILE = 'docs/phases/P1-x/S-01-a.md';

const run = (root) => frozen.run(buildContext(root, loadConfig(root)));
const messages = (root) => run(root).map((f) => f.message);

const write = (root, rel, text) => {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

const commitFiles = (root, files, message) => {
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  git(root, ['add', '--', ...Object.keys(files)]);
  commit(root, `${message}\n\nSlice: ${SLICE}`, { allowEmpty: false });
  return git(root, ['rev-parse', 'HEAD']);
};

const stateJson = (state, redCommit) =>
  `${JSON.stringify({ slice: SLICE, state, branch: BRANCH, redCommit, frozenTests: redCommit ? [TEST] : [], unfrozen: [], history: [] }, null, 2)}\n`;

// An initialised repo with the slice file committed on main and the git hooks switched off, so each
// commit carries only what the test writes; then the slice branch is checked out.
function withSlice(fn) {
  const repo = makeRepo({ commits: 1 });
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    git(repo.root, ['config', '--unset', 'core.hooksPath']);
    git(repo.root, ['reset', '-q']);
    writeSliceFixture(repo.root);
    git(repo.root, ['add', '-A']);
    commit(repo.root, 'setup', { allowEmpty: false });
    git(repo.root, ['checkout', '-q', '-b', BRANCH]);
    return fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

// The red commit of the frozen test, then the bookkeeping commit that records it in the state file.
function red(root) {
  const sha = commitFiles(root, { [TEST]: "test('bills', () => { throw new Error('red'); });\n" }, 'test: red');
  commitFiles(root, { [STATE]: stateJson('building', sha) }, `chore(slicekit): ${SLICE} tests-red`);
  return sha;
}

const changeTest = (root) => commitFiles(root, { [TEST]: "test('bills', () => {});\n" }, 'feat: green by editing the test');

test('a frozen test changed after red fails the rule, naming the file', () => {
  withSlice((root) => {
    red(root);
    assert.deepEqual(messages(root), []);
    changeTest(root);
    assert.deepEqual(messages(root), [`frozen test changed after red: ${TEST}`]);
  });
});

test('a state file hidden with assume-unchanged is judged by its committed content', () => {
  withSlice((root) => {
    red(root);
    changeTest(root);
    // The working tree says the slice never reached tests-red, and the test is back at its red
    // content; both are hidden from git, so only the committed objects tell the truth.
    write(root, STATE, stateJson('todo', null));
    git(root, ['update-index', '--assume-unchanged', '--', STATE]);
    write(root, TEST, "test('bills', () => { throw new Error('red'); });\n");
    git(root, ['update-index', '--skip-worktree', '--', TEST]);
    assert.equal(git(root, ['status', '--porcelain']), '', 'git sees no change in the working tree');
    assert.deepEqual(messages(root), [`frozen test changed after red: ${TEST}`]);
  });
});

test('a change after an amend of the slice file passes', () => {
  withSlice((root) => {
    red(root);
    const text = fs.readFileSync(path.join(root, ...SLICE_FILE.split('/')), 'utf8');
    commitFiles(root, { [SLICE_FILE]: `${text}\nThe evaluation set now expects billing to pass.\n` }, `docs(${SLICE}): amend evaluation set`);
    changeTest(root);
    assert.deepEqual(messages(root), []);
  });
});

test('a branch with no red commit reports nothing', () => {
  withSlice((root) => {
    // A slice branch with no state file.
    commitFiles(root, { [TEST]: 'one\n' }, 'test: draft');
    assert.deepEqual(messages(root), []);
    // A slice branch whose state file has no red commit (before tests-red).
    commitFiles(root, { [STATE]: stateJson('todo', null) }, `chore(slicekit): ${SLICE} started`);
    commitFiles(root, { [TEST]: 'two\n' }, 'test: draft again');
    assert.deepEqual(messages(root), []);
    // The same history as a failing slice branch, judged on a branch that is not a slice branch and
    // on the default branch.
    red(root);
    changeTest(root);
    assert.deepEqual(messages(root), [`frozen test changed after red: ${TEST}`]);
    git(root, ['branch', '-q', '-m', 'feature/x']);
    assert.deepEqual(messages(root), []);
    git(root, ['branch', '-q', '-D', 'main']);
    git(root, ['branch', '-q', '-m', 'main']);
    assert.deepEqual(messages(root), []);
  });
});
