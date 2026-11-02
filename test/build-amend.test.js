// REQ-1.8, REQ-2.6: build amend runs from draft-pr, in-review and changes-requested, returns the slice to building, and is refused from ci-green or ready.
// REQ-1.8: build amend with no test named commits the slice file alone once every test it names is unfrozen, and still refuses while a frozen test is not named (P4/S-45, issue #72).
// P2/S-29 Done when 2: `build amend` runs from draft-pr, in-review and changes-requested as well as
// building, so a finding inside a frozen test can be fixed during review; the slice returns to building.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { git } from '../src/git.js';
import { recordState } from '../src/build/record.js';
import { cli, green, stateIn, write } from './helpers/build-flow.js';

const SLICE_FILE = 'docs/phases/P1-x/S-01-thing-1.md';
const REVIEWS = '.slicekit/reviews';

function verdictText(verdict, findings = [], head) {
  const rows = findings.map(([id, wrong]) => `| ${id} | test/a.test.js:4 | ${wrong} | it matters | read only |`);
  return [
    `Verdict: ${verdict}`,
    `Head: ${head}`,
    '',
    '| ID | File:line | What is wrong | Why it matters | How verified |',
    '|---|---|---|---|---|',
    ...rows,
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
}

// A slice reviewed once: green, build pr, then round 1's verdict recorded -> in-review.
async function reviewed(verdict, findings) {
  const p = await green();
  const r = await p.pr();
  assert.equal(r.code, 0, r.stderr);
  const rel = `${REVIEWS}/P1-S-01-r1.md`;
  write(p.root, rel, verdictText(verdict, findings, git(p.wt, ['rev-parse', 'HEAD'])));
  const v = await cli(p.root, ['build', 'verdict', 'P1/S-01', rel], p.env);
  assert.equal(v.code, 0, v.stderr);
  assert.equal(stateIn(p.wt).state, 'in-review');
  return p;
}

const editSlice = (p) => fs.appendFileSync(path.join(p.wt, ...SLICE_FILE.split('/')), '\nAmended in review.\n');
const amendCli = (p) => cli(p.root, ['build', 'amend', 'P1/S-01', '--test', 'test/a.test.js', '--reason', 'B-1 sits in the frozen test']);

test('amend runs from in-review and returns the slice to building', async () => {
  const p = await reviewed('BLOCK', [['B-1', 'the test asserts the wrong value']]);
  try {
    editSlice(p);
    const r = await amendCli(p);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'unfroze test/a.test.js\n');
    const st = stateIn(p.wt);
    assert.equal(st.state, 'building');
    assert.deepEqual(st.unfrozen, ['test/a.test.js']);
    // The amendment is recorded as before: the slice file's own commit, then the unfreeze.
    const unfreeze = st.history.find((h) => h.evidence?.unfreeze === 'test/a.test.js');
    assert.ok(unfreeze, JSON.stringify(st.history));
    assert.equal(unfreeze.evidence.reason, 'B-1 sits in the frozen test');
    const amendSubject = git(p.wt, ['log', '-1', '--format=%s', unfreeze.evidence.amendCommit]);
    assert.equal(amendSubject, 'docs(P1/S-01): amend evaluation set');
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
  } finally {
    p.cleanup();
  }
});

test('amend from ci-green or ready is refused', async () => {
  const p = await reviewed('APPROVE');
  try {
    const cfg = loadConfig(p.root);
    const head = stateIn(p.wt).pr.headSha;
    recordState(p.wt, cfg, 'P1/S-01', 'ci-green', { ci: { status: 'success', sha: head } });
    editSlice(p);
    for (const state of ['ci-green', 'ready']) {
      if (state === 'ready') recordState(p.wt, { ...cfg, review: { ...cfg.review, independent: 'optional' } }, 'P1/S-01', 'ready', {});
      const before = stateIn(p.wt);
      assert.equal(before.state, state);
      const r = await amendCli(p);
      assert.notEqual(r.code, 0, `${state}: ${r.stdout}`);
      // The refusal names the states amend runs from, the review states among them.
      for (const from of ['building', 'draft-pr', 'in-review', 'changes-requested']) {
        assert.ok(r.stderr.includes(from), `${state}: the refusal does not name ${from}: ${r.stderr}`);
      }
      assert.ok(r.stderr.includes(`is ${state}`), r.stderr);
      assert.deepEqual(stateIn(p.wt), before);
    }
  } finally {
    p.cleanup();
  }
});

const AMEND_SUBJECT = 'docs(P1/S-01): amend evaluation set';
const commitFiles = (wt, sha) => git(wt, ['diff-tree', '--no-commit-id', '--name-only', '-r', sha]).split('\n').filter((l) => l !== '');

test('build amend changes only the slice file when its tests are already unfrozen', async () => {
  const p = await reviewed('BLOCK', [['B-1', 'the test asserts the wrong value']]);
  try {
    editSlice(p);
    const first = await amendCli(p);
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(stateIn(p.wt).unfrozen, ['test/a.test.js']);
    // Every test the slice file names is unfrozen now; a second amendment names none.
    fs.appendFileSync(path.join(p.wt, ...SLICE_FILE.split('/')), '\nA second amendment.\n');
    const before = stateIn(p.wt);
    const r = await cli(p.root, ['build', 'amend', 'P1/S-01', '--reason', 'the Done when list was wrong']);
    assert.equal(r.code, 0, r.stderr);
    const st = stateIn(p.wt);
    assert.deepEqual(st.unfrozen, ['test/a.test.js']);
    assert.equal(st.state, before.state);
    const added = st.history.slice(before.history.length);
    const entry = added.find((h) => h.evidence?.reason === 'the Done when list was wrong');
    assert.ok(entry, JSON.stringify(st.history));
    const sha = entry.evidence.amendCommit;
    assert.equal(git(p.wt, ['log', '-1', '--format=%s', sha]), AMEND_SUBJECT);
    assert.deepEqual(commitFiles(p.wt, sha), [SLICE_FILE]);
    assert.ok(git(p.wt, ['show', `${sha}:${SLICE_FILE}`]).includes('A second amendment.'));
    // The state file's record is committed too, and nothing is left behind.
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
  } finally {
    p.cleanup();
  }
});

test('build amend still refuses a frozen test it does not name', async () => {
  const p = await reviewed('BLOCK', [['B-1', 'the test asserts the wrong value']]);
  try {
    editSlice(p);
    const before = stateIn(p.wt);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const r = await cli(p.root, ['build', 'amend', 'P1/S-01', '--reason', 'B-1 sits in the frozen test']);
    assert.notEqual(r.code, 0, r.stdout);
    // The refusal names the frozen test the command left out.
    assert.ok(r.stderr.includes('test/a.test.js'), r.stderr);
    assert.deepEqual(stateIn(p.wt), before);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
    assert.notEqual(git(p.wt, ['status', '--porcelain', '--', SLICE_FILE]), '');
  } finally {
    p.cleanup();
  }
});
