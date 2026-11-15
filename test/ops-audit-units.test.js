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
import { init as initKit } from '../src/init.js';
import { cli } from './helpers/build-flow.js';
import { commitFixed } from './helpers/graph-fixture.js';
import { makeRepo } from './helpers/tmp-repo.js';
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

// P5/S-23 review H-1: an action is held to its mark in every form the section can hold one.
test('opsReportProblems: an action written as a plain line or a table row is held to its mark', () => {
  const index = indexOf(['src/a.js'], [
    { id: 'slice:P1/S-01', kind: 'slice', label: 'x' },
    { id: 'pull-request:1', kind: 'pull-request', label: 'x' },
    { id: 'pull-request:api#4', kind: 'pull-request', label: 'x' },
  ]);
  const END = 'the action does not end with who may take it: (anyone), (on-call) or (owner: <name>)';
  const CELL = 'the action names in no cell who may take it: (anyone), (on-call) or (owner: <name>)';
  withDir({ 'docs/runbook.md': 'one\ntwo\n' }, (root) => {
    const check = (text) => opsReportProblems(root, index, 'r.md', text);
    // The only action is a plain line.
    assert.deepEqual(check(OPS('Restart the billing service now')), [`r.md:11 ${END}`]);
    // A table: the header and the divider are no action; a row with no mark in any cell is refused.
    assert.deepEqual(check(OPS('| Action | Who |\n|---|---|\n| Read the log | (anyone) |\n| Restart it | |\n| Page them | on-call |')), [
      `r.md:14 ${CELL}`,
      `r.md:15 ${CELL}`,
    ]);
    // A paragraph is one action, named at its first line; so is each paragraph after a list.
    assert.deepEqual(check(OPS('- Read the log (anyone)\n\nRestart it now\nand page them (on-call)\n\nThen wait\nfor the owner.')), [`r.md:16 ${END}`]);
    // A line right under a list item continues it, indented or not.
    assert.deepEqual(check(OPS('- Restart it\n(on-call)\n- Read the log (anyone)\nthen restart it')), [`r.md:13 ${END}`]);
    // A sub-heading and a fenced block are no action; every form, marked, passes.
    assert.deepEqual(check(OPS('### Now\n\nRead the log (anyone)\n\n```\ntail -f app.log\n```\n\n| Action | Who |\n|---|---|\n| Restart it | (owner: Dana) |\n\n1. Page them (on-call)')), []);
  });
});

// P5/S-23 review H-5: the closing lines end the Proposed actions section, and a section that proposes
// no action is the one line `None.`.
test('opsReportProblems: the closing lines end the actions, and a section of no action is the line None.', () => {
  const index = indexOf(['src/a.js'], [
    { id: 'slice:P1/S-01', kind: 'slice', label: 'x' },
    { id: 'pull-request:1', kind: 'pull-request', label: 'x' },
    { id: 'pull-request:api#4', kind: 'pull-request', label: 'x' },
  ]);
  const END = 'the action does not end with who may take it: (anyone), (on-call) or (owner: <name>)';
  withDir({ 'docs/runbook.md': 'one\ntwo\n' }, (root) => {
    const check = (text) => opsReportProblems(root, index, 'r.md', text);
    // A closing line that wraps onto a second line.
    assert.deepEqual(check(OPS('- Read the log (anyone)\n\nSkipped: nothing\nNot checked: the CI history, since no tool\nreads it.')), []);
    // A closing line followed by a list.
    assert.deepEqual(check(OPS('- Read the log (anyone)\n\nSkipped: nothing\nNot checked:\n- the CI history\n- the log')), []);
    // The first of the two, wrapped and followed by a list, with a paragraph after the second.
    assert.deepEqual(check(OPS('- Read the log (anyone)\nSkipped: the release record, which\nnames no service\n- and the dashboard\n\nNot checked: nothing\n\nRestart it now')), []);
    // An unmarked action above the closing lines is still refused.
    assert.deepEqual(check(OPS('- Read the log (anyone)\n- Restart it\n\nSkipped: nothing\nNot checked:\n- the CI history')), [`r.md:12 ${END}`]);
    // A closing label inside a fenced block ends nothing: the action under the block is still read.
    assert.deepEqual(check(OPS('```\nSkipped: 2 files\n```\n\n- Restart it')), [`r.md:15 ${END}`]);
    // No action: the one line `None.`, alone in the section.
    assert.deepEqual(check(OPS('None.')), []);
    assert.deepEqual(check(OPS('None.\n\nSkipped: nothing\nNot checked:\n- the CI history')), []);
    assert.deepEqual(check(OPS('None.\n- Restart it')), [`r.md:11 ${END}`, `r.md:12 ${END}`]);
    assert.deepEqual(check(OPS('- None.')), [`r.md:11 ${END}`]);
    assert.deepEqual(check(OPS('Nothing to do')), [`r.md:11 ${END}`]);
    // A section holding the closing lines alone is empty.
    assert.deepEqual(check(OPS('').replace('\n\n\n', '\n\n')), ['r.md:9 the "## Proposed actions" section is empty']);
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
      '| runbook#health | docs/runbook.md:1 | no test starts the service | | unverifiable | |',
    ])), []);
    assert.deepEqual(check(AUDIT(['| REQ-1.1 | docs/spec/01-x.md:3 | it does not | `node --test` | drifted | AAAAAAA |'])), []);
    // Each row alone, so that no claim has two rows.
    for (const [row, problem] of [
      ['| REQ-9.9 | docs/spec/01-x.md:3 | x | src/a.js:1 | holds | |', 'REQ-9.9 is not a claim of this audit'],
      ['| REQ-1.1 | docs/spec/01-x.md:4 | x | src/a.js:1 | holds | |', 'REQ-1.1 is written at docs/spec/01-x.md:3, not docs/spec/01-x.md:4'],
      ['| REQ-1.1 | docs/spec/01-x.md:3 | x | src/a.js:2 | holds | |', 'src/a.js:2 is not a line of a file in the repository'],
      ['| REQ-1.1 | docs/spec/01-x.md:3 | x | somewhere in the code | holds | |', 'Found at of REQ-1.1 is neither a <file>:<line> nor a command in backticks'],
      ['| REQ-1.1 | docs/spec/01-x.md:3 | x | src/a.js:1 | drifted | |', 'drifted REQ-1.1 names no commit; name one that touched its files after it was written'],
      ['| REQ-1.1 | docs/spec/01-x.md:3 | x | src/a.js:1 | drifted | aaaaaa |', 'drifted REQ-1.1 names aaaaaa, which is not a commit that touched its files after it was written'],
      ['| runbook#health | docs/runbook.md:1 | x | src/a.js:1 | drifted | aaaaaaa |', 'drifted runbook#health names aaaaaaa, which is not a commit that touched its files after it was written'],
      ['| runbook#health | docs/runbook.md:1 | | | unverifiable | |', 'unverifiable runbook#health does not say why in Evidence'],
      ['| runbook#health | docs/runbook.md:1 | x | src/a.js:1 | Holds | |', 'the status of runbook#health is "Holds", not holds, drifted or unverifiable'],
      ['| runbook#health | docs/runbook.md:1 | x |', 'the row holds 3 cells, not 6'],
    ]) {
      assert.deepEqual(check(AUDIT([row])), [`r.md:5 ${problem}`]);
    }
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

// P5/S-23 review H-2: a claim has one row, and with `everyClaim` every claim of the area has one.
// `audit check` reads the area's claims as `audit context` does: from the spec and the runbook, by
// the area it is given.
test('auditReportProblems refuses a claim with two rows and, asked for every claim, a claim with none', async () => {
  const HOLDS = '| REQ-1.1 | docs/spec/01-x.md:3 | it does | src/a.js:1 | holds | |';
  withDir({ 'src/a.js': 'one\n' }, (root) => {
    const check = (rows, opts) => auditReportProblems(root, 'r.md', AUDIT(rows), CLAIMS, opts);
    // Two rows for one claim, with different statuses.
    assert.deepEqual(check([HOLDS, '| REQ-1.1 | docs/spec/01-x.md:3 | no test reads it | | unverifiable | |']), ['r.md:6 REQ-1.1 has a second row; its first is on line 5']);
    // One row for an area of two claims: a row is asked for each claim only with everyClaim.
    assert.deepEqual(check([HOLDS]), []);
    assert.deepEqual(check([HOLDS], { everyClaim: true }), ['r.md:3 no row for runbook#health']);
    assert.deepEqual(check([HOLDS, '| runbook#health | docs/runbook.md:1 | no test starts it | | unverifiable | |'], { everyClaim: true }), []);
    // A row that is refused still counts as its claim's row.
    assert.deepEqual(check([HOLDS, '| runbook#health | docs/runbook.md:1 | x | src/a.js:1 | Holds | |'], { everyClaim: true }), [
      'r.md:6 the status of runbook#health is "Holds", not holds, drifted or unverifiable',
    ]);
  });

  // The command: `audit check <report> runbook --every-claim` on a runbook of two sections.
  const repo = makeRepo();
  try {
    const { root } = repo;
    initKit(root, { name: 'demo', shape: 'backend', commands: { test: 'node --test' }, cli: 'node bin/slicekit.js' });
    commitFixed(root, 'plan', { 'docs/runbook.md': '# Runbook: demo\n\n## Health\n\nIt answers ok.\n\n## Rollback\n\nRevert it.\n' });
    assert.equal((await cli(root, ['graph'])).code, 0);
    const report = '.slicekit/reports/audit-1.md';
    fs.mkdirSync(path.join(root, '.slicekit', 'reports'), { recursive: true });
    fs.writeFileSync(path.join(root, report), AUDIT(['| runbook#health | docs/runbook.md:3 | no test starts it | | unverifiable | |']));
    const rows = await cli(root, ['audit', 'check', report, 'runbook']);
    assert.equal(rows.code, 0, `${rows.stdout}\n${rows.stderr}`);
    const every = await cli(root, ['audit', 'check', report, 'runbook', '--every-claim']);
    assert.equal(every.code, 1, `${every.stdout}\n${every.stderr}`);
    assert.equal(every.stdout, `${report}:3 no row for runbook#rollback\n`);
  } finally {
    repo.cleanup();
  }
});

// P5/S-23 review H-6: in First checks a `<path>:<line>` token is a citation by the file it names, not
// by a slash: a file of the repository or of the graph, or a path that ends in a file extension.
test('opsReportProblems: a citation is a token that names a file, with a slash or without', () => {
  const index = indexOf(['src/a.js', 'docs/gone.md', 'Procfile'], [
    { id: 'slice:P1/S-01', kind: 'slice', label: 'x' },
    { id: 'pull-request:1', kind: 'pull-request', label: 'x' },
    { id: 'pull-request:api#4', kind: 'pull-request', label: 'x' },
  ]);
  const NOT = 'is not a line of a file in the repository';
  withDir({ 'docs/runbook.md': 'one\ntwo\n', 'README.md': 'one\n', LICENSE: 'one\n', 'src/a.js': 'one\n' }, (root) => {
    const check = (checks) => opsReportProblems(root, index, 'r.md', OPS('- Read the log (anyone)', checks));
    // A missing file is refused with no slash in its path, and so is a line past a file's end.
    assert.deepEqual(check('- Read nosuch.md:3, then README.md:2 and LICENSE:4.'), [
      `r.md:7 nosuch.md:3 ${NOT}`,
      `r.md:7 README.md:2 ${NOT}`,
      `r.md:7 LICENSE:4 ${NOT}`,
    ]);
    // A file of the graph that is not on disk is a citation, with an extension or without.
    assert.deepEqual(check('- docs/gone.md:1 and Procfile:1'), [`r.md:7 docs/gone.md:1 ${NOT}`, `r.md:7 Procfile:1 ${NOT}`]);
    // An image and tag, a host path and port, a host and port and a time name no file and end in no
    // file extension: none is a citation, with a slash or without.
    assert.deepEqual(check('- Pull registry/app:2 and call svc.internal/health:8080, then localhost:3000 at 10:30.'), []);
    // Files that exist, cited with a slash and without, pass.
    assert.deepEqual(check('- README.md:1, LICENSE:1, src/a.js:1 and `docs/runbook.md:2`'), []);
  });
});

// P5/S-23 review H-7: `audit context` prints at most ten candidate commits per claim, newest first,
// then one line counting the rest; `--all` prints each one; `audit check` still judges a drifted row
// against every candidate.
test('audit context prints ten candidates per claim and counts the rest; audit check reads them all', async () => {
  const repo = makeRepo();
  try {
    const { root } = repo;
    initKit(root, { name: 'demo', shape: 'backend', commands: { test: 'node --test' }, cli: 'node bin/slicekit.js' });
    commitFixed(root, 'plan', { 'docs/runbook.md': '# Runbook: demo\n\n## Health\n\nIt answers ok (`src/a.js`).\n', 'src/a.js': '0\n' });
    const shas = [];
    for (let i = 1; i <= 12; i++) shas.push(commitFixed(root, `fix: change ${i}`, { 'src/a.js': `${i}\n` }));
    assert.equal((await cli(root, ['graph'])).code, 0);
    const candidatesOf = (out) => out.split('\n').filter((l) => /^\s+candidate /.test(l)).map((l) => l.trim().split(' ')[1]);
    const sha7 = (s) => s.slice(0, 7);

    const ctx = await cli(root, ['audit', 'context', 'runbook']);
    assert.equal(ctx.code, 0, `${ctx.stdout}\n${ctx.stderr}`);
    assert.deepEqual(candidatesOf(ctx.stdout), shas.slice(2).reverse().map(sha7), ctx.stdout);
    const lines = ctx.stdout.split('\n');
    const more = lines.findIndex((l) => l.startsWith('  2 more candidates, each older: '));
    assert.ok(more > 0 && /^\s+candidate /.test(lines[more - 1]), ctx.stdout);

    const all = await cli(root, ['audit', 'context', 'runbook', '--all']);
    assert.equal(all.code, 0, `${all.stdout}\n${all.stderr}`);
    assert.deepEqual(candidatesOf(all.stdout), [...shas].reverse().map(sha7), all.stdout);
    assert.doesNotMatch(all.stdout, /more candidates/);

    // The oldest candidate is not printed without --all; a drifted row naming it still passes.
    const report = lines[0];
    fs.writeFileSync(path.join(root, report), AUDIT([`| runbook#health | docs/runbook.md:3 | it answers 1 | src/a.js:1 | drifted | ${sha7(shas[0])} |`]));
    const checked = await cli(root, ['audit', 'check', report, 'runbook']);
    assert.equal(checked.code, 0, `${checked.stdout}\n${checked.stderr}`);
  } finally {
    repo.cleanup();
  }
});

// P5/S-50 (issue #157, REQ-2.14): the line `audit context` prints for the candidates it does not show
// names a command that prints them and reserves no report file: `audit context <area> --all` with
// `--no-report`, written with the kit's command prefix. That form prints the context alone.
test('audit context with --all and --no-report prints every candidate and reserves no report', async () => {
  const repo = makeRepo();
  try {
    const { root } = repo;
    initKit(root, { name: 'demo', shape: 'backend', commands: { test: 'node --test' }, cli: 'node bin/slicekit.js' });
    commitFixed(root, 'plan', { 'docs/runbook.md': '# Runbook: demo\n\n## Health\n\nIt answers ok (`src/a.js`).\n', 'src/a.js': '0\n' });
    const shas = [];
    for (let i = 1; i <= 12; i++) shas.push(commitFixed(root, `fix: change ${i}`, { 'src/a.js': `${i}\n` }));
    assert.equal((await cli(root, ['graph'])).code, 0);
    const candidatesOf = (out) => out.split('\n').filter((l) => /^\s+candidate /.test(l)).map((l) => l.trim().split(' ')[1]);
    const sha7 = (s) => s.slice(0, 7);
    const reports = path.join(root, '.slicekit', 'reports');
    const reserved = () => (fs.existsSync(reports) ? fs.readdirSync(reports).sort() : []);

    // Without --all: the line that counts the older candidates names the form that reserves no report.
    const ctx = await cli(root, ['audit', 'context', 'runbook']);
    assert.equal(ctx.code, 0, `${ctx.stdout}\n${ctx.stderr}`);
    const hint = ctx.stdout.split('\n').filter((l) => /more candidates?\b/.test(l));
    assert.equal(hint.length, 1, ctx.stdout);
    assert.ok(hint[0].startsWith('  2 more candidates'), hint[0]);
    assert.ok(hint[0].includes('node bin/slicekit.js audit context runbook --all --no-report'), hint[0]);
    const before = reserved();
    assert.equal(before.length, 1, `audit context reserves one report: ${before.join(', ')}`);
    assert.equal(ctx.stdout.split('\n')[0], `.slicekit/reports/${before[0]}`);

    // The form the line names: every candidate, the context alone, and no report reserved.
    const all = await cli(root, ['audit', 'context', 'runbook', '--all', '--no-report']);
    assert.equal(all.code, 0, `${all.stdout}\n${all.stderr}`);
    assert.deepEqual(candidatesOf(all.stdout), [...shas].reverse().map(sha7), all.stdout);
    assert.doesNotMatch(all.stdout, /more candidates?\b/);
    const lines = all.stdout.split('\n');
    assert.equal(lines[0], 'runbook#health docs/runbook.md:3 Health');
    assert.ok(!lines.some((l) => l.includes('.slicekit/reports')), all.stdout);
    assert.deepEqual(reserved(), before, 'audit context --all --no-report reserved a report');
    assert.equal(all.stderr, '');
  } finally {
    repo.cleanup();
  }
});
