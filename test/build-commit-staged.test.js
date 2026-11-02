// REQ-2.6: build commit with paths staged runs the tests on the staged content and commits it alone,
// leaving a tracked path changed but not staged in the worktree (P4/S-45 r3 B-1, issue #69).
// REQ-1.8: a slice-file-only build amend that wrote its record and stopped before committing it is
// finished by a second run (P4/S-45 r3 H-5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { git } from '../src/git.js';
import { appendHistory } from '../src/state/index.js';
import { building, cli, commitWorkCli, green, stateIn, write } from './helpers/build-flow.js';

const indexDirs = () => new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('slicekit-index-')));
const newIndexDirs = (before) => [...indexDirs()].filter((n) => !before.has(n));

const committedFiles = (wt, rev) =>
  git(wt, ['diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', rev])
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => l.replace('\t', ' '));

// Task 1 is src/t1.js; Task 2 is an edit to src/t2.js, tracked, that the tests would fail on.
const T1_RED = "import { y } from './t2.js';\nexport const x = () => y * 0;\n";
// Passes with Task 2's src/t2.js, fails with the committed one.
const T1_TASK2 = "import { y } from './t2.js';\nexport const x = () => y - 1;\n";
const T1_GREEN = "import { y } from './t2.js';\nexport const x = () => y;\n";
const T2 = 'export const y = 2;\n';
const T2_TASK2 = 'export const y = 3;\n';

async function withTask2Pending() {
  const p = await building();
  write(p.wt, 'src/t1.js', T1_RED);
  write(p.wt, 'src/t2.js', T2);
  const first = await commitWorkCli(p, '--message', 'feat(P1/S-01): start');
  assert.equal(first.code, 0, first.stderr);
  assert.equal(git(p.wt, ['status', '--porcelain']), '');
  write(p.wt, 'src/t2.js', T2_TASK2);
  return p;
}

test('build commit with a tracked unstaged change commits the staged path and runs the tests on it', async () => {
  const p = await withTask2Pending();
  try {
    write(p.wt, 'src/t1.js', T1_GREEN);
    git(p.wt, ['add', '--', 'src/t1.js']);
    const before = indexDirs();
    // --require-green: the worktree's src/t2.js makes the test fail, the staged tree makes it pass.
    const r = await commitWorkCli(p, '--message', 'feat(P1/S-01): task 1', '--require-green');
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /exit 0/);
    assert.deepEqual(committedFiles(p.wt, 'HEAD'), ['M src/t1.js']);
    assert.match(git(p.wt, ['log', '-1', '--format=%B', 'HEAD']), /→ exit 0/);
    // The tracked unstaged edit is still in the worktree, unstaged, and not in the commit.
    assert.equal(fs.readFileSync(path.join(p.wt, 'src', 't2.js'), 'utf8'), T2_TASK2);
    // git() trims its output, so the leading space of " M" is gone.
    assert.equal(git(p.wt, ['status', '--porcelain']), 'M src/t2.js');
    assert.equal(git(p.wt, ['show', 'HEAD:src/t2.js']), T2.trim());
    assert.deepEqual(newIndexDirs(before), []);
  } finally {
    p.cleanup();
  }
});

test('build commit runs the tests on the staged content when it fails, and removes its directory', async () => {
  const p = await withTask2Pending();
  try {
    // Staged: src/t1.js, which fails against the committed src/t2.js; the worktree, with Task 2's
    // unstaged src/t2.js, passes.
    write(p.wt, 'src/t1.js', T1_TASK2);
    git(p.wt, ['add', '--', 'src/t1.js']);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const before = indexDirs();
    const r = await commitWorkCli(p, '--message', 'feat(P1/S-01): task 2', '--require-green');
    assert.notEqual(r.code, 0, r.stdout);
    assert.match(r.stderr, /tests fail/);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
    assert.equal(git(p.wt, ['status', '--porcelain']), 'M  src/t1.js\n M src/t2.js');
    assert.deepEqual(newIndexDirs(before), []);
  } finally {
    p.cleanup();
  }
});

const SLICE_FILE = 'docs/phases/P1-x/S-01-thing-1.md';
const REVIEWS = '.slicekit/reviews';
const AMEND_SUBJECT = 'docs(P1/S-01): amend evaluation set';

const verdictText = (head) =>
  [
    'Verdict: BLOCK',
    `Head: ${head}`,
    '',
    '| ID | File:line | What is wrong | Why it matters | How verified |',
    '|---|---|---|---|---|',
    '| B-1 | test/a.test.js:4 | the test asserts the wrong value | it matters | read only |',
    '',
    '## Checklists run',
    '',
    '- correctness',
    '',
    '## Not checked',
    '',
    '- performance',
    '',
  ].join('\n');

test('build amend with no test named finishes a run that wrote its record but did not commit it', async () => {
  const p = await green();
  try {
    const pr = await p.pr();
    assert.equal(pr.code, 0, pr.stderr);
    const rel = `${REVIEWS}/P1-S-01-r1.md`;
    write(p.root, rel, verdictText(git(p.wt, ['rev-parse', 'HEAD'])));
    const v = await cli(p.root, ['build', 'verdict', 'P1/S-01', rel], p.env);
    assert.equal(v.code, 0, v.stderr);
    const sliceAbs = path.join(p.wt, ...SLICE_FILE.split('/'));
    fs.appendFileSync(sliceAbs, '\nAmended in review.\n');
    const unfroze = await cli(p.root, ['build', 'amend', 'P1/S-01', '--test', 'test/a.test.js', '--reason', 'B-1 sits in the frozen test']);
    assert.equal(unfroze.code, 0, unfroze.stderr);

    // The first run: the slice file committed and the record written, then it stopped.
    fs.appendFileSync(sliceAbs, '\nA second amendment.\n');
    git(p.wt, ['add', '--', SLICE_FILE]);
    git(p.wt, ['commit', '-q', '-m', `${AMEND_SUBJECT}\n\nthe Done when list was wrong\n\nSlice: P1/S-01`]);
    const sha = git(p.wt, ['rev-parse', 'HEAD']);
    appendHistory(p.wt, loadConfig(p.root), 'P1/S-01', { amendCommit: sha, reason: 'the Done when list was wrong' });
    const pending = stateIn(p.wt);
    assert.notEqual(git(p.wt, ['status', '--porcelain']), '');

    const r = await cli(p.root, ['build', 'amend', 'P1/S-01', '--reason', 'the Done when list was wrong']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stderr.includes('has no change'), r.stderr);
    // The pending record is committed as it was, once, in the bookkeeping commit.
    assert.deepEqual(stateIn(p.wt), pending);
    assert.equal(stateIn(p.wt).history.filter((h) => h.evidence?.amendCommit === sha).length, 1);
    assert.equal(git(p.wt, ['log', '-1', '--format=%s', 'HEAD']), 'chore(slicekit): P1/S-01 amend');
    assert.equal(git(p.wt, ['rev-parse', 'HEAD^']), sha);
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
  } finally {
    p.cleanup();
  }
});
