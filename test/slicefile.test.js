import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSliceFile,
  findSliceFiles,
  parsePhaseFile,
  parseOrder,
  SliceFileError,
} from '../src/slicefile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'slices', 'S-07-sample.md');
const sample = fs.readFileSync(fixture, 'utf8');

test('parses front matter and the evaluation table', () => {
  const s = parseSliceFile(sample, fixture);
  assert.equal(s.id, 'P1/S-07');
  assert.equal(s.name, 'Sample slice for the parser');
  assert.equal(s.repo, '.');
  assert.equal(s.group, 'B');
  assert.equal(s.runbook, false);
  assert.deepEqual(s.requirements, ['REQ-9.1', 'REQ-9.2']);
  assert.deepEqual(s.decisions, ['D-90']);
  assert.equal(s.path, fixture);
  assert.equal(s.doneWhen.length, 2);
  assert.match(s.doneWhen[0], /^The sample command prints/);
  assert.equal(s.evaluation.length, 3);
  assert.deepEqual(s.evaluation.map((e) => e.kind), ['happy', 'negative', 'e2e']);
  assert.deepEqual(s.evaluation[1].covers, ['REQ-9.1', 'REQ-9.2']);
  assert.equal(s.evaluation[0].test, '`sample.test.js » prints ok`');
  assert.deepEqual(s.expectedChanges, ['src/sample.js', 'src/cli/', 'test/sample.test.js']);
});

test('runbook yes is true and a bad value throws', () => {
  assert.equal(parseSliceFile(sample.replace('runbook: no', 'runbook: yes'), 'x.md').runbook, true);
  assert.throws(
    () => parseSliceFile(sample.replace('runbook: no', 'runbook: maybe'), 'x.md'),
    (e) => e instanceof SliceFileError && e.field === 'runbook',
  );
});

test('bad evaluation kind throws naming the row', () => {
  assert.throws(
    () => parseSliceFile(sample.replace('| e2e |', '| smoke |'), 'x.md'),
    (e) => e instanceof SliceFileError && /end to end run/.test(e.message),
  );
});

test('missing slice field throws naming it', () => {
  const text = sample.replace(/^slice: .*\n/m, '');
  assert.throws(
    () => parseSliceFile(text, 'docs/phases/P1/S-07.md'),
    (e) =>
      e instanceof SliceFileError &&
      e.field === 'slice' &&
      e.path === 'docs/phases/P1/S-07.md' &&
      /slice/.test(e.message) &&
      /S-07\.md/.test(e.message),
  );
});

test('missing Done when section throws naming it', () => {
  const text = sample.replace('## Done when', '## Finished');
  assert.throws(
    () => parseSliceFile(text, 'x.md'),
    (e) => e instanceof SliceFileError && /Done when/.test(e.message),
  );
});

test('evaluation set with no table throws naming the section and path', () => {
  const text = sample.replace(/\| Test \|[\s\S]*?e2e \|[^\n]*\n/, 'None yet.\n');
  assert.throws(
    () => parseSliceFile(text, 'docs/x.md'),
    (e) => e instanceof SliceFileError && e.field === 'Evaluation set' && e.path === 'docs/x.md',
  );
});

test('evaluation set table with the wrong header throws', () => {
  const text = sample.replace('| Test | Kind | Covers |', '| Name | Type | Reqs |');
  assert.throws(
    () => parseSliceFile(text, 'docs/x.md'),
    (e) => e instanceof SliceFileError && e.field === 'Evaluation set' && e.path === 'docs/x.md',
  );
});

test('evaluation set table with no rows throws', () => {
  const text = sample.replace(/\| `sample[^\n]*\n/g, '');
  assert.throws(
    () => parseSliceFile(text, 'docs/x.md'),
    (e) => e instanceof SliceFileError && e.field === 'Evaluation set',
  );
});

test('expected changes also parse from a list', () => {
  const text = sample.replace(
    '`src/sample.js`, `src/cli/`, `test/sample.test.js`.',
    '- `a.js`\n- `b/`',
  );
  assert.deepEqual(parseSliceFile(text, 'x.md').expectedChanges, ['a.js', 'b/']);
});

test('expected changes carry the file line of each path and of their heading', () => {
  const s = parseSliceFile(sample, fixture);
  assert.equal(s.expectedChangesLine, 24);
  assert.deepEqual(s.expectedChangeLines, [26, 26, 26]);
  const listed = parseSliceFile(sample.replace('`src/sample.js`, `src/cli/`, `test/sample.test.js`.', '- `a.js`\n- `b/`'), 'x.md');
  assert.deepEqual(listed.expectedChangeLines, [26, 27]);
  const none = parseSliceFile(sample.replace(/## Expected changes[\s\S]*$/, ''), 'x.md');
  assert.equal(none.expectedChangesLine, null);
  assert.deepEqual(none.expectedChanges, []);
  assert.deepEqual(none.expectedChangeLines, []);
});

test('findSliceFiles orders by phase then slice', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicefile-'));
  try {
    const mk = (dir, file) => {
      fs.mkdirSync(path.join(root, 'docs', 'phases', dir), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'phases', dir, file), 'x');
    };
    mk('P10-late', 'S-01-a.md');
    mk('P2-mid', 'S-10-b.md');
    mk('P2-mid', 'S-02-c.md');
    mk('P1-spine', 'S-03-d.md');
    mk('P1-spine', 'P1.md');
    const found = findSliceFiles(root, { docsRoot: 'docs' });
    assert.deepEqual(
      found.map((f) => `${f.phaseId}/${path.basename(f.path)}`),
      ['P1/S-03-d.md', 'P2/S-02-c.md', 'P2/S-10-b.md', 'P10/S-01-a.md'],
    );
    assert.equal(found[0].phaseDir, path.join(root, 'docs', 'phases', 'P1-spine'));
    assert.equal(found[0].path, path.join(root, 'docs', 'phases', 'P1-spine', 'S-03-d.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findSliceFiles normalises a zero-padded phase directory to its phase id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicefile-'));
  try {
    fs.mkdirSync(path.join(root, 'docs', 'phases', 'P01-x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'phases', 'P01-x', 'S-01-a.md'), 'x');
    assert.deepEqual(findSliceFiles(root, { docsRoot: 'docs' }).map((f) => f.phaseId), ['P1']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a slice whose address names another phase than its directory is a SliceFileError', () => {
  const inDir = (dir) => path.join('docs', 'phases', dir, 'S-07-sample.md');
  assert.equal(parseSliceFile(sample, inDir('P1-spine')).id, 'P1/S-07');
  assert.equal(parseSliceFile(sample, inDir('P01-spine')).id, 'P1/S-07');
  assert.throws(
    () => parseSliceFile(sample, inDir('P2-loop')),
    (e) => e instanceof SliceFileError && e.field === 'slice' && /P1\/S-07 is in the directory of phase P2/.test(e.message),
  );
});

test('findSliceFiles returns nothing when there is no phases directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicefile-'));
  try {
    assert.deepEqual(findSliceFiles(root, { docsRoot: 'docs' }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('parsePhaseFile reads id and name from the first heading', () => {
  assert.deepEqual(parsePhaseFile('# Phase 1 — Spine: implementation plan\n\nbody'), {
    id: 'P1',
    name: 'Spine',
  });
  assert.deepEqual(parsePhaseFile('intro\n# Phase 12 - Late stuff\n# Phase 2 — Other'), {
    id: 'P12',
    name: 'Late stuff',
  });
  assert.deepEqual(parsePhaseFile('# Phase 3: Gate'), { id: 'P3', name: 'Gate' });
  assert.equal(parsePhaseFile('# Nothing here'), null);
});

test('parses every real slice file in docs/phases/P1-spine', () => {
  const dir = path.join(here, '..', 'docs', 'phases', 'P1-spine');
  const files = fs.readdirSync(dir).filter((f) => /^S-\d{2}-.*\.md$/.test(f));
  assert.ok(files.length >= 8);
  for (const f of files) {
    const p = path.join(dir, f);
    const s = parseSliceFile(fs.readFileSync(p, 'utf8'), p);
    assert.match(s.id, /^P1\/S-0\d$/, f);
    assert.ok(s.evaluation.length >= 1, f);
    assert.ok(s.doneWhen.length >= 1, f);
  }
});

test('parseOrder reads steps and parallel groups', () => {
  assert.deepEqual(parseOrder('# Phase 2 — Loop\n\n**Order:** A; B, C; D\n'), [['A'], ['B', 'C'], ['D']]);
  assert.equal(parseOrder('# Phase 2 — Loop\n\nNo order here.\n'), null);
  // A line inside a fence is an example, not the order; the first line outside one counts.
  const fenced = '```\n**Order:** X; Y\n```\n\n**Order:**  A ,B ;C\n\n**Order:** Z\n';
  assert.deepEqual(parseOrder(fenced), [['A', 'B'], ['C']]);
});
