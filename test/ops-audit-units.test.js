// P5/S-23, REQ-2.13, REQ-2.14, D-57, D-58: the rules of `slicekit ops` and `slicekit audit` that the
// command tests do not reach, on a hand-written graph: how a symptom's words name files, and each
// problem the two report checks name. test/commands/ops.test.js and test/commands/audit.test.js hold
// the commands themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditReportProblems } from '../src/audit.js';
import { indexGraph } from '../src/graph/load.js';
import { GraphError } from '../src/graph/schema.js';
import { BROAD, opsReportProblems, symptomFiles } from '../src/ops.js';

const fileNode = (p) => ({ id: `file:${p}`, kind: 'file', label: p });
const indexOf = (files, more = []) => indexGraph({ schemaVersion: 1, nodes: [...files.map(fileNode), ...more], edges: [] });

function withDir(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-units-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('symptomFiles: a word names a file by one whole path segment, case ignored', () => {
  const index = indexOf(['src/Billing/charge.js', 'src/billing-api/refund_job.js', 'src/rebilling/x.js', 'docs/billing.md', 'src/ab.js']);
  const r = symptomFiles(index, 'Billing: the REFUND job, ab? billing again');
  assert.deepEqual(r.files, ['docs/billing.md', 'src/Billing/charge.js', 'src/billing-api/refund_job.js']);
  assert.deepEqual(r.words, [
    { word: 'billing', files: ['docs/billing.md', 'src/Billing/charge.js', 'src/billing-api/refund_job.js'] },
    { word: 'refund', files: ['src/billing-api/refund_job.js'] },
    { word: 'job', files: ['src/billing-api/refund_job.js'] },
  ]);
  // `the` and `again` name no file; `ab` is under three characters and is no word; each word once.
  assert.deepEqual(r.unmatched, ['the', 'again']);
  assert.deepEqual(r.broad, []);
  assert.deepEqual(symptomFiles(index, ''), { files: [], words: [], broad: [], unmatched: [] });
});

test('symptomFiles: a word is too broad above fifty files, not at fifty', () => {
  assert.equal(BROAD, 50);
  const many = (n) => Array.from({ length: n }, (_, i) => `src/queue/q${i}.js`);
  const at = symptomFiles(indexOf(many(50)), 'queue');
  assert.equal(at.files.length, 50);
  assert.deepEqual(at.broad, []);
  const over = symptomFiles(indexOf([...many(51), 'src/other.js']), 'queue other');
  assert.deepEqual(over.broad, [{ word: 'queue', count: 51 }]);
  assert.deepEqual(over.files, ['src/other.js']);
  assert.deepEqual(over.unmatched, []);
  // A path names what the word was too broad for.
  assert.equal(symptomFiles(indexOf(many(51)), 'queue', ['src/queue/']).files.length, 51);
});

test('symptomFiles: a --path names a file or every file under a directory, else it is refused', () => {
  const index = indexOf(['src/a/one.js', 'src/a/two.js', 'src/ab.js']);
  assert.deepEqual(symptomFiles(index, 'nothing here', ['./src/a/']).files, ['src/a/one.js', 'src/a/two.js']);
  assert.deepEqual(symptomFiles(index, '', ['src\\ab.js', 'src/a/one.js']).files, ['src/a/one.js', 'src/ab.js']);
  assert.throws(() => symptomFiles(index, 'one', ['src/nosuch']), (e) => e instanceof GraphError && e.code === 2 && e.message === 'src/nosuch is not in the graph');
});

const OPS = (actions, checks = '- docs/runbook.md:2 Read the log.') => `## Likely slices and pull requests

- P1/S-01, #1, api#4: src/a.js

## First checks

${checks}

## Proposed actions

${actions}

Skipped: nothing
Not checked: nothing
`;

test('opsReportProblems: who may take an action, wrapped items, and what counts as a citation', () => {
  const index = indexOf(['src/a.js'], [
    { id: 'slice:P1/S-01', kind: 'slice', label: 'x' },
    { id: 'pull-request:1', kind: 'pull-request', label: 'x' },
    { id: 'pull-request:api#4', kind: 'pull-request', label: 'x' },
  ]);
  withDir({ 'docs/runbook.md': 'one\ntwo\n', 'README.md': 'one\n' }, (root) => {
    const check = (text) => opsReportProblems(root, index, 'r.md', text);
    assert.deepEqual(check(OPS('- Read the log (anyone)\n- Page them (on-call).\n1. Ask about the limits\n   of the card (owner: Dana Smith)\n* Roll back (owner: payments team)')), []);
    // An owner with no name, a mark that is not at the end, and a mark no rule names.
    assert.deepEqual(check(OPS('- Ask (owner: )\n- (anyone) Read the log\n- Restart it (admin)')), [
      'r.md:11 the action does not end with who may take it: (anyone), (on-call) or (owner: <name>)',
      'r.md:12 the action does not end with who may take it: (anyone), (on-call) or (owner: <name>)',
      'r.md:13 the action does not end with who may take it: (anyone), (on-call) or (owner: <name>)',
    ]);
    // A host and port is no citation; a file that exists is held to its line count.
    assert.deepEqual(check(OPS('- Read the log (anyone)', '- Call host.example:8080 at 10:30, then read README.md:1 and `docs/runbook.md:2`.')), []);
    assert.deepEqual(check(OPS('- Read the log (anyone)', '- README.md:2 and docs/nosuch.md:1')), [
      'r.md:7 README.md:2 is not a line of a file in the repository',
      'r.md:7 docs/nosuch.md:1 is not a line of a file in the repository',
    ]);
    // An empty section, a missing one and the closing lines.
    assert.deepEqual(check('## Likely slices and pull requests\n\n## First checks\n\n- none\n'), [
      'r.md:1 the "## Likely slices and pull requests" section is empty',
      'r.md:1 no "## Proposed actions" section',
      'r.md:5 no "Skipped:" line',
      'r.md:5 no "Not checked:" line',
    ]);
    assert.equal(check('').length, 5, 'a reserved report nobody wrote');
  });
});

const CLAIMS = [
  { id: 'REQ-1.1', where: 'docs/spec/01-x.md:3', title: 'A', files: ['src/a.js'], since: null, candidates: [{ sha: 'a'.repeat(40), date: 'd', subject: 's' }] },
  { id: 'runbook#health', where: 'docs/runbook.md:1', title: 'Health', files: [], since: null, candidates: [] },
];
const AUDIT = (rows, header = '| Claim | Where | Evidence | Found at | Status | Commit |') => `## Claims

${header}
|---|---|---|---|---|---|
${rows.join('\n')}

Skipped: nothing
Not checked: nothing
`;

test('auditReportProblems names each row that is not in order', () => {
  withDir({ 'src/a.js': 'one\n' }, (root) => {
    const check = (text) => auditReportProblems(root, 'r.md', text, CLAIMS);
    assert.deepEqual(check(AUDIT([
      '| `REQ-1.1` | `docs/spec/01-x.md:3` | it does | `src/a.js:1` | `holds` | |',
      '| REQ-1.1 | docs/spec/01-x.md:3 | it does not | `node --test` | drifted | AAAAAAA |',
      '| runbook#health | docs/runbook.md:1 | no test starts the service | | unverifiable | |',
    ])), []);
    assert.deepEqual(check(AUDIT([
      '| REQ-9.9 | docs/spec/01-x.md:3 | x | src/a.js:1 | holds | |',
      '| REQ-1.1 | docs/spec/01-x.md:4 | x | src/a.js:1 | holds | |',
      '| REQ-1.1 | docs/spec/01-x.md:3 | x | src/a.js:2 | holds | |',
      '| REQ-1.1 | docs/spec/01-x.md:3 | x | somewhere in the code | holds | |',
      '| REQ-1.1 | docs/spec/01-x.md:3 | x | src/a.js:1 | drifted | |',
      '| REQ-1.1 | docs/spec/01-x.md:3 | x | src/a.js:1 | drifted | aaaaaa |',
      '| runbook#health | docs/runbook.md:1 | x | src/a.js:1 | drifted | aaaaaaa |',
      '| runbook#health | docs/runbook.md:1 | | | unverifiable | |',
      '| runbook#health | docs/runbook.md:1 | x | src/a.js:1 | Holds | |',
      '| runbook#health | docs/runbook.md:1 | x |',
    ])), [
      'r.md:5 REQ-9.9 is not a claim of this audit',
      'r.md:6 REQ-1.1 is written at docs/spec/01-x.md:3, not docs/spec/01-x.md:4',
      'r.md:7 src/a.js:2 is not a line of a file in the repository',
      'r.md:8 Found at of REQ-1.1 is neither a <file>:<line> nor a command in backticks',
      'r.md:9 drifted REQ-1.1 names no commit; name one that touched its files after it was written',
      'r.md:10 drifted REQ-1.1 names aaaaaa, which is not a commit that touched its files after it was written',
      'r.md:11 drifted runbook#health names aaaaaaa, which is not a commit that touched its files after it was written',
      'r.md:12 unverifiable runbook#health does not say why in Evidence',
      'r.md:13 the status of runbook#health is "Holds", not holds, drifted or unverifiable',
      'r.md:14 the row holds 3 cells, not 6',
    ]);
    // The table: missing, with other columns, or with no row; and the closing lines.
    assert.deepEqual(check('# Audit\n\nSkipped: nothing\nNot checked: nothing\n'), ['r.md:1 no "## Claims" section']);
    assert.deepEqual(check('## Claims\n\nNone.\n\nSkipped: nothing\nNot checked: nothing\n'), ['r.md:1 the "## Claims" section holds no table']);
    assert.deepEqual(check(AUDIT([], '| Claim | Where | Evidence | Found | Status | Commit |')), ["r.md:3 the Claims table's columns are not Claim, Where, Evidence, Found at, Status, Commit"]);
    assert.deepEqual(check(AUDIT([])), ['r.md:3 the Claims table holds no row']);
    assert.deepEqual(check('## Claims\n\n| Claim | Where | Evidence | Found at | Status | Commit |\n|---|---|---|---|---|---|\n| runbook#health | docs/runbook.md:1 | x | | unverifiable | |\n'), [
      'r.md:5 no "Skipped:" line',
      'r.md:5 no "Not checked:" line',
    ]);
  });
});
