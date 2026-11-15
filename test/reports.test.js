// P5/S-23, REQ-2.13, REQ-2.14, D-57, D-58: the report helpers `slicekit ops` and `slicekit audit`
// share: the next free report path, reserved so two runs never get one, and the reading of a
// report's sections and tables. Every directory here lives in os.tmpdir().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { kitPaths } from '../src/paths.js';
import { footerProblems, lineExists, nextReport, reportSections, reportTable, sectionTable } from '../src/reports.js';

const run = promisify(execFile);
const CFG = { docsRoot: 'docs' };
const REPORTS = fileURLToPath(new URL('../src/reports.js', import.meta.url));

function withDir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-reports-'));
  const done = () => fs.rmSync(root, { recursive: true, force: true });
  let result;
  try {
    result = fn(root);
  } catch (e) {
    done();
    throw e;
  }
  return result instanceof Promise ? result.finally(done) : (done(), result);
}

test('nextReport gives ops-1.md, then ops-2.md, each reserved as an empty file', () => {
  withDir((root) => {
    assert.equal(kitPaths(root, CFG).reports, path.join(root, '.slicekit', 'reports'));
    assert.equal(nextReport(root, CFG, 'ops'), '.slicekit/reports/ops-1.md');
    assert.equal(fs.readFileSync(path.join(root, '.slicekit', 'reports', 'ops-1.md'), 'utf8'), '');
    assert.equal(nextReport(root, CFG, 'ops'), '.slicekit/reports/ops-2.md');
    // Each kind counts on its own, and the next number is one above the highest there.
    assert.equal(nextReport(root, CFG, 'audit'), '.slicekit/reports/audit-1.md');
    fs.writeFileSync(path.join(root, '.slicekit', 'reports', 'ops-7.md'), 'x');
    fs.writeFileSync(path.join(root, '.slicekit', 'reports', 'ops-notes.md'), 'x');
    assert.equal(nextReport(root, CFG, 'ops'), '.slicekit/reports/ops-8.md');
    assert.deepEqual(fs.readdirSync(path.join(root, '.slicekit', 'reports')).sort(), ['audit-1.md', 'ops-1.md', 'ops-2.md', 'ops-7.md', 'ops-8.md', 'ops-notes.md']);
    // A report already written is never handed out again or emptied.
    assert.equal(fs.readFileSync(path.join(root, '.slicekit', 'reports', 'ops-7.md'), 'utf8'), 'x');
  });
});

test('two reservations at once get distinct paths', async () => {
  await withDir(async (root) => {
    const script = path.join(root, 'reserve.mjs');
    fs.writeFileSync(
      script,
      `import { nextReport } from ${JSON.stringify(pathToFileURL(REPORTS).href)};\nprocess.stdout.write(nextReport(process.argv[2], { docsRoot: 'docs' }, 'ops'));\n`,
    );
    const runs = await Promise.all(Array.from({ length: 10 }, () => run(process.execPath, [script, root])));
    const got = runs.map((r) => r.stdout);
    assert.equal(new Set(got).size, 10, got.join(' '));
    for (const rel of got) assert.match(rel, /^\.slicekit\/reports\/ops-\d+\.md$/);
    assert.ok(fs.existsSync(path.join(root, '.slicekit', 'reports', 'ops-1.md')), 'ops-1.md exists');
    assert.equal(fs.readdirSync(path.join(root, '.slicekit', 'reports')).length, 10);
  });
});

const REPORT = `# Title

## First

one

\`\`\`
## not a heading
| a | b |
\`\`\`

## Claims

Some words.

| Claim | Status |
|---|---|
| REQ-1.1 | holds |
| a \\| b | drifted |

| Other | Table |
|---|---|
| x | y |

# Appendix

after

## first

a second section of the same name

Skipped: nothing
Not checked: nothing
`;

test('reportSections reads the ## sections outside fenced blocks, with line numbers', () => {
  const sections = reportSections(REPORT);
  assert.deepEqual([...sections.keys()], ['first', 'claims']);
  const first = sections.get('first');
  assert.equal(first.line, 3);
  assert.deepEqual(first.lines.filter((l) => l.text !== '').map((l) => [l.line, l.text]), [
    [5, 'one'],
    [7, '```'],
    [8, '## not a heading'],
    [9, '| a | b |'],
    [10, '```'],
  ]);
  // A section ends at the next # or ## heading.
  assert.ok(!sections.get('claims').lines.some((l) => l.text === 'after'));
  assert.equal(reportSections('no heading here\n').size, 0);
  assert.equal(reportSections('## A\r\n\r\nx\r\n').get('a').lines.at(1).text, 'x');
});

test('reportTable gives the rows of the first table of a section, the header dropped', () => {
  assert.deepEqual(reportTable(REPORT, 'Claims'), [
    { cells: ['REQ-1.1', 'holds'], line: 18 },
    { cells: ['a | b', 'drifted'], line: 19 },
  ]);
  assert.deepEqual(sectionTable(REPORT, 'claims').header, { cells: ['Claim', 'Status'], line: 16 });
  assert.deepEqual(reportTable(REPORT, 'First'), []);
  assert.deepEqual(reportTable(REPORT, 'No such section'), []);
  assert.equal(sectionTable(REPORT, 'First'), null);
});

test('lineExists and footerProblems', () => {
  withDir((root) => {
    fs.writeFileSync(path.join(root, 'a.md'), 'one\ntwo\n');
    fs.writeFileSync(path.join(root, 'b.md'), 'one\ntwo');
    for (const f of ['a.md', 'b.md']) {
      assert.equal(lineExists(root, f, 1), true, f);
      assert.equal(lineExists(root, f, 2), true, f);
      assert.equal(lineExists(root, f, 3), false, f);
      assert.equal(lineExists(root, f, 0), false, f);
    }
    assert.equal(lineExists(root, 'nosuch.md', 1), false);
    assert.equal(lineExists(root, '.', 1), false);
    assert.equal(lineExists(root, '../a.md', 1), false, 'a path outside the root');
  });
  assert.deepEqual(footerProblems('r.md', REPORT), []);
  assert.deepEqual(footerProblems('r.md', '## A\n\nx\n- Skipped: nothing\n'), ['r.md:4 no "Skipped:" line', 'r.md:4 no "Not checked:" line']);
  assert.deepEqual(footerProblems('r.md', ''), ['r.md:1 no "Skipped:" line', 'r.md:1 no "Not checked:" line']);
});

// P5/S-23 review H-8: nextReport reserves the path as an empty file, and a session's Write tool
// refuses to overwrite a file it has not read; each procedure says to read the file first.
test('the ops and audit procedures say to read the reserved report file before writing to it', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'instructions', 'commands');
  for (const name of ['ops.md', 'audit.md']) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\s+/g, ' ');
    assert.match(text, /created[^.]*\bempty\b[^.]*\bread\b[^.]*\bbefore\b[^.]*\bwrit/i, `${name} does not say to read the reserved file before writing`);
  }
});
