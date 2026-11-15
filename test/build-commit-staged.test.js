// REQ-2.6: build commit with paths staged runs the tests on the staged content and commits it alone,
// leaving a tracked path changed but not staged in the worktree (P4/S-45 r3 B-1, issue #69).
// REQ-1.8: a slice-file-only build amend that wrote its record and stopped before committing it is
// finished by a second run (P4/S-45 r3 H-5).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { git } from '../src/git.js';
import { appendHistory } from '../src/state/index.js';
import { IMPORTING, building, cli, commitWorkCli, green, red1, startedWithTest, stateIn, write } from './helpers/build-flow.js';

// This file's process gets a temp folder of its own, so the leftover checks below list the run
// folders of this file's staged commits alone, never those of a test file running at the same
// moment. os.tmpdir() reads these variables at each call, and every child process inherits them.
const PRIVATE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-staged-tmp-'));
for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = PRIVATE_TMP;
after(() => fs.rmSync(PRIVATE_TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

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

// ---- P6/S-51 (REQ-2.6, D-43, issue #107): the staged run reads untracked files and runs git ----

// A test command as a team's local one is (D-43): it reads the test files to run from `.slice-tests`,
// a file git ignores, in its working directory, and asks git where it is. It writes what it saw to
// `probe`, then runs the listed tests and exits as they do.
const listRunner = (probe) => `import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const listed = fs.readFileSync('.slice-tests', 'utf8').split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const seen = {
  listed,
  toplevel: git('rev-parse', '--show-toplevel').trim(),
  unstaged: git('diff', '--name-only').trim(),
  t2: fs.existsSync('src/t2.js') ? fs.readFileSync('src/t2.js', 'utf8') : null,
};
fs.writeFileSync(${JSON.stringify(probe)}, JSON.stringify(seen));
const run = spawnSync(process.execPath, ['--test', ...listed], { stdio: 'inherit' });
process.exit(run.status ?? 1);
`;

test('with paths staged the test command reads an ignored file and runs git', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-staged-probe-'));
  const probe = path.join(scratch, 'seen.json');
  const seen = () => JSON.parse(fs.readFileSync(probe, 'utf8'));
  const LIST = '# the tests of this slice\ntest/a.test.js\n';
  const p = await startedWithTest(IMPORTING, {
    test: 'node tools/run-listed.mjs',
    files: { 'tools/run-listed.mjs': listRunner(probe), '.gitignore': '.slice-tests\n' },
  });
  try {
    write(p.wt, '.slice-tests', LIST);
    assert.equal(git(p.wt, ['status', '--porcelain', '--', '.slice-tests']), '', 'git ignores .slice-tests');
    const red = await red1(p, 'test/a.test.js');
    assert.equal(red.code, 0, red.stderr);
    // Task 1 committed with nothing staged, so the run is in the worktree; then Task 2's edit to
    // src/t2.js, tracked and not staged, on which the test fails.
    write(p.wt, 'src/t1.js', T1_RED);
    write(p.wt, 'src/t2.js', T2);
    const first = await commitWorkCli(p, '--message', 'feat(P1/S-01): start');
    assert.equal(first.code, 0, first.stderr);
    write(p.wt, 'src/t2.js', T2_TASK2);
    write(p.wt, 'src/t1.js', T1_GREEN);
    git(p.wt, ['add', '--', 'src/t1.js']);
    fs.rmSync(probe, { force: true });
    const before = indexDirs();

    const r = await commitWorkCli(p, '--message', 'feat(P1/S-01): task 1', '--require-green');
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /exit 0/);
    // The command read the ignored file at the same relative path, and git answered it with exit 0.
    assert.ok(fs.existsSync(probe), 'the test command stopped before it wrote what it saw');
    assert.deepEqual(seen().listed, ['test/a.test.js']);
    assert.notEqual(seen().toplevel, '');
    // It still saw every tracked file as staged, and no unstaged change: the committed src/t2.js.
    assert.equal(seen().t2, T2);
    assert.equal(seen().unstaged, '');
    // The staged path alone is committed; the unstaged edit and the ignored file stay in the worktree.
    assert.deepEqual(committedFiles(p.wt, 'HEAD'), ['M src/t1.js']);
    assert.match(git(p.wt, ['log', '-1', '--format=%B', 'HEAD']), /→ exit 0/);
    assert.equal(fs.readFileSync(path.join(p.wt, 'src', 't2.js'), 'utf8'), T2_TASK2);
    assert.equal(git(p.wt, ['status', '--porcelain']), 'M src/t2.js');
    assert.equal(fs.readFileSync(path.join(p.wt, '.slice-tests'), 'utf8'), LIST);
    // The run's directory is removed, and removing it did not walk into the worktree.
    assert.deepEqual(newIndexDirs(before), []);
  } finally {
    p.cleanup();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
