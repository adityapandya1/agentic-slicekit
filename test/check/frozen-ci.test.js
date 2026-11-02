// REQ-3.15 under `slicekit check --ci`: actions/checkout leaves a detached merge commit of the pull
// request into the base. The rule judges the branch GITHUB_HEAD_REF at the pull request's head, read
// from the event's head sha, or the merge commit's second parent when the event has none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

const stateJson = (redCommit) =>
  `${JSON.stringify({ slice: SLICE, state: 'building', branch: BRANCH, redCommit, frozenTests: [TEST], unfrozen: [], history: [] }, null, 2)}\n`;

// A slice branch past red, then the detached merge commit of it into main that CI checks out; `fn`
// gets the root, the pull request's head sha and a directory for the event file.
function onMergeCommit(changeTest, fn) {
  const repo = makeRepo({ commits: 1 });
  const events = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-event-'));
  try {
    const { root } = repo;
    init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    git(root, ['config', '--unset', 'core.hooksPath']);
    git(root, ['reset', '-q']);
    writeSliceFixture(root);
    git(root, ['add', '-A']);
    commit(root, 'setup', { allowEmpty: false });
    git(root, ['checkout', '-q', '-b', BRANCH]);
    const red = commitFiles(root, { [TEST]: "test('bills', () => { throw new Error('red'); });\n" }, 'test: red');
    let head = commitFiles(root, { [STATE]: stateJson(red) }, `chore(slicekit): ${SLICE} tests-red`);
    if (changeTest) head = commitFiles(root, { [TEST]: "test('bills', () => {});\n" }, 'feat: green by editing the test');
    git(root, ['checkout', '-q', '--detach', 'main']);
    git(root, ['merge', '-q', '--no-ff', '-m', 'Merge pull request', head]);
    return fn(root, head, events);
  } finally {
    repo.cleanup();
    fs.rmSync(events, { recursive: true, force: true });
  }
}

const runCi = (root, env) => frozen.run(buildContext(root, loadConfig(root), { ci: true, env })).map((f) => f.message);

const eventFile = (dir, pr) => {
  const file = path.join(dir, 'event.json');
  fs.writeFileSync(file, JSON.stringify({ pull_request: { title: `[${SLICE}] a`, body: '', number: 1, ...pr } }));
  return file;
};

test('under --ci a frozen test changed after red fails the rule at the pull request head', () => {
  onMergeCommit(true, (root, head, events) => {
    assert.notEqual(git(root, ['rev-parse', 'HEAD']), head, 'HEAD is the merge commit, not the head');
    const env = { GITHUB_HEAD_REF: BRANCH, GITHUB_EVENT_PATH: eventFile(events, { head: { sha: head } }) };
    assert.deepEqual(runCi(root, env), [`frozen test changed after red: ${TEST}`]);
  });
});

test('under --ci with no head sha in the event the merge commit second parent is judged', () => {
  onMergeCommit(true, (root, _head, events) => {
    const env = { GITHUB_HEAD_REF: BRANCH, GITHUB_EVENT_PATH: eventFile(events, {}) };
    assert.deepEqual(runCi(root, env), [`frozen test changed after red: ${TEST}`]);
  });
});

test('under --ci a pull request whose frozen test is unchanged passes', () => {
  onMergeCommit(false, (root, head, events) => {
    const env = { GITHUB_HEAD_REF: BRANCH, GITHUB_EVENT_PATH: eventFile(events, { head: { sha: head } }) };
    assert.deepEqual(runCi(root, env), []);
  });
});
