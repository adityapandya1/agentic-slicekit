// P8/S-60 (REQ-3.3, D-102), finding H-2 of round 1: for a state file written before P8/S-60, which lists
// frozen tests as file paths, the pre-edit guard reads which tests of the file are frozen from the slice
// file at the red commit, not from the working tree, which the guard does not protect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { handle } from '../../src/hooks/pre-edit.js';
import { defaultConfig } from '../../src/config.js';
import { makeRepo, commit } from '../helpers/tmp-repo.js';

const SLICE = 'P1/S-06';
const BRANCH = 'slice/P1-S-06-hooks';
const BILLING = 'test/billing.test.js';
const SLICE_FILE = 'docs/phases/P1-x/S-06-hooks.md';
const FROZEN = 'frozen for P1/S-06; amend the slice file to change the evaluation set';
const cfg = { ...defaultConfig({ name: 'demo', shape: 'backend' }) };

const BILLING_TEXT = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  '',
  "test('rejects an unknown currency', () => {",
  "  assert.throws(() => bill('XYZ'));",
  '});',
  '',
  "test('formats a total', () => {",
  "  assert.equal(format(1), '1.00');",
  '});',
  '',
].join('\n');

const sliceText = (row) => `---
slice: ${SLICE}
name: Hooks
repo: .
group: A
runbook: no
requirements: [REQ-3.3]
decisions: []
---

## Done when

1. It works.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| \`${row}\` | negative | REQ-3.3 |

## Expected changes

\`src/billing.js\`, tests.
`;

// A slice branch whose red commit holds BILLING and a slice file naming `rejects an unknown currency`;
// the state file lists the frozen test in the path form, as one written before P8/S-60.
function oldFormRepo() {
  const repo = makeRepo({
    branch: BRANCH,
    files: { [BILLING]: BILLING_TEXT, [SLICE_FILE]: sliceText('billing.test.js » rejects an unknown currency'), 'docs/runbook.md': '# r' },
  });
  execFileSync('git', ['add', '-A'], { cwd: repo.root, stdio: 'pipe' });
  commit(repo.root, 'test: red', { allowEmpty: false });
  const redCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.root }).toString().trim();
  const state = path.join(repo.root, '.slicekit', 'state', 'P1-S-06.json');
  fs.mkdirSync(path.dirname(state), { recursive: true });
  fs.writeFileSync(state, JSON.stringify({ slice: SLICE, state: 'building', redCommit, frozenTests: [BILLING], unfrozen: [] }));
  return repo;
}

const editOf = (root, oldString, newString) =>
  handle({ session_id: 's', tool_name: 'Edit', tool_input: { file_path: BILLING, old_string: oldString, new_string: newString }, cwd: root }, { root, cfg, env: {} });

// REQ-3.3
test('a path entry is read with the evaluation set at the red commit, not the working tree', () => {
  const { root, cleanup } = oldFormRepo();
  try {
    // The working tree's slice file is rewritten to name the other test of the file.
    fs.writeFileSync(path.join(root, ...SLICE_FILE.split('/')), sliceText('billing.test.js » formats a total'));
    // The test the row named at red stays frozen.
    const denied = editOf(root, "assert.throws(() => bill('XYZ'));", 'assert.ok(true);');
    assert.equal(denied.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(denied));
    assert.equal(denied.hookSpecificOutput?.permissionDecisionReason, FROZEN);
    // The test the working tree's row now names was not frozen at red: its edit is allowed.
    assert.deepEqual(editOf(root, "assert.equal(format(1), '1.00');", "assert.equal(format(2), '2.00');"), {});
  } finally {
    cleanup();
  }
});

// Finding H-3 of round 3: the new-document exception reads Expected changes from the slice file as
// committed at HEAD, so an uncommitted edit of the slice file cannot widen it; a committed one, as
// `build amend` makes, does.
const NEW_DOC = "no slice starts a document; a document changes only when this slice's code made it wrong";
const writeOf = (root, file) =>
  handle({ session_id: 's', tool_name: 'Write', tool_input: { file_path: file, content: '# new' }, cwd: root }, { root, cfg, env: {} });

// REQ-3.3
test('a new document named only by an uncommitted edit of Expected changes is denied', () => {
  const { root, cleanup } = oldFormRepo();
  try {
    const doc = 'docs/guide/new-page.md';
    const sliceAbs = path.join(root, ...SLICE_FILE.split('/'));
    const widened = sliceText('billing.test.js » rejects an unknown currency')
      .replace('`src/billing.js`, tests.', `\`src/billing.js\`, \`${doc}\`, tests.`);
    assert.notEqual(widened, sliceText('billing.test.js » rejects an unknown currency'));
    fs.writeFileSync(sliceAbs, widened);
    const denied = writeOf(root, doc);
    assert.equal(denied.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(denied));
    assert.equal(denied.hookSpecificOutput?.permissionDecisionReason, NEW_DOC);
    // Committed, as `build amend` commits the slice file: the document is now allowed.
    execFileSync('git', ['add', SLICE_FILE], { cwd: root, stdio: 'pipe' });
    commit(root, 'chore(slicekit): amend', { allowEmpty: false });
    assert.deepEqual(writeOf(root, doc), {});
    assert.equal(writeOf(root, 'docs/guide/other-page.md').hookSpecificOutput?.permissionDecisionReason, NEW_DOC);
  } finally {
    cleanup();
  }
});
