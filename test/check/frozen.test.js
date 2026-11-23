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

// ---- P6/S-51 (REQ-3.15, D-10, issues #100 and #101) ----

// One commit on the slice branch that removes the slice's state file.
const removeState = (root) => {
  git(root, ['rm', '-q', '--', STATE]);
  commit(root, `chore: drop the state file\n\nSlice: ${SLICE}`, { allowEmpty: false });
};

// Issue #100: a tip with no state file is judged by the versions of the file in its history.
test('a tip that removed the state file after red is a finding and its frozen tests are still judged', () => {
  const FROZEN = `frozen test changed after red: ${TEST}`;
  // The removal alone: one finding, naming the state file.
  withSlice((root) => {
    red(root);
    removeState(root);
    const found = run(root);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0].file, STATE);
    assert.ok(found[0].message.includes(STATE), found[0].message);
    assert.notEqual(found[0].message, FROZEN);
  });
  // The frozen test changed after red, then the state file removed: the removal and the test.
  withSlice((root) => {
    red(root);
    changeTest(root);
    removeState(root);
    const found = run(root);
    assert.equal(found.length, 2, JSON.stringify(found));
    const removal = found.filter((f) => f.file === STATE);
    assert.equal(removal.length, 1, JSON.stringify(found));
    assert.ok(removal[0].message.includes(STATE), removal[0].message);
    assert.deepEqual(found.filter((f) => f.file === TEST).map((f) => f.message), [FROZEN]);
  });
  // A state file that never recorded a red commit, removed: nothing to judge.
  withSlice((root) => {
    commitFiles(root, { [STATE]: stateJson('todo', null) }, `chore(slicekit): ${SLICE} started`);
    commitFiles(root, { [TEST]: 'one\n' }, 'test: draft');
    removeState(root);
    commitFiles(root, { [TEST]: 'two\n' }, 'test: draft again');
    assert.deepEqual(messages(root), []);
  });
});

// Issue #101: freezeTests set to false in the config turns the rule off (D-10).
test('with freezeTests false a changed frozen test is no finding', () => {
  withSlice((root) => {
    red(root);
    changeTest(root);
    assert.deepEqual(messages(root), [`frozen test changed after red: ${TEST}`]);
    const file = path.join(root, '.slicekit', 'config.json');
    const conf = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.notEqual(conf.freezeTests, false);
    fs.writeFileSync(file, `${JSON.stringify({ ...conf, freezeTests: false }, null, 2)}\n`);
    assert.equal(loadConfig(root).freezeTests, false);
    assert.deepEqual(messages(root), []);
  });
});

// ---- P8/S-60 (REQ-3.15, REQ-3.7, D-102): a test is frozen by its name ----

const TWO_TESTS = [
  "import { test } from 'node:test';",
  '',
  "test('bills', () => { throw new Error('red'); });",
  '',
  "test('formats', () => { throw new Error('red too'); });",
  '',
].join('\n');

// The red commit of TWO_TESTS, then the bookkeeping commit whose state file freezes `bills` by name.
function redByName(root) {
  const sha = commitFiles(root, { [TEST]: TWO_TESTS }, 'test: red');
  const state = { slice: SLICE, state: 'building', branch: BRANCH, redCommit: sha, frozenTests: [{ file: TEST, name: 'bills' }], unfrozen: [], history: [] };
  commitFiles(root, { [STATE]: `${JSON.stringify(state, null, 2)}\n` }, `chore(slicekit): ${SLICE} tests-red`);
  return sha;
}

// REQ-3.15
test('a changed frozen test is a finding naming the file and the test', () => {
  const FINDING = `frozen test changed after red: ${TEST} » bills`;
  withSlice((root) => {
    redByName(root);
    assert.deepEqual(messages(root), []);
    commitFiles(root, { [TEST]: TWO_TESTS.replace("throw new Error('red'); });", '});') }, 'feat: green by editing the test');
    assert.deepEqual(messages(root), [FINDING]);
  });
  // A frozen test that is gone is the same finding.
  withSlice((root) => {
    redByName(root);
    commitFiles(root, { [TEST]: TWO_TESTS.replace("test('bills', () => { throw new Error('red'); });\n", '') }, 'feat: drop the test');
    assert.deepEqual(messages(root), [FINDING]);
  });
});

// REQ-3.15
test('a change to another test of the same file is no finding', () => {
  withSlice((root) => {
    redByName(root);
    // Another test's body, a new import and a new test change; `bills` stays as it was at red.
    const changed = TWO_TESTS
      .replace("test('formats', () => { throw new Error('red too'); });", "test('formats', () => {});")
      .replace("import { test } from 'node:test';", "import { test } from 'node:test';\nimport assert from 'node:assert/strict';")
      .concat("test('rounds', () => assert.ok(true));\n");
    commitFiles(root, { [TEST]: changed }, 'feat: another test changes');
    assert.deepEqual(messages(root), []);
  });
});
