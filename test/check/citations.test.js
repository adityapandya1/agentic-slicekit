import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../../src/init.js';
import { check } from '../../src/check/index.js';
import citations from '../../src/check/rules/citations.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const DECISIONS = `# Decisions

## Settled

| # | Type | Question | Answer | Who, when |
|---|---|---|---|---|
| D-01 | Decision | Name? | demo | team, 2026-10-24 |
| D-02 | Decision | License? | MIT | team, 2026-10-24 |
`;

const req = (id, { cites = 'Cites: D-01.', enforced = 'Enforced by: `slicekit check`.', shall = true, scenario = true, level = 3 } = {}) =>
  [
    `${'#'.repeat(level)} ${id} A requirement`,
    '',
    shall ? 'The kit SHALL do the thing.' : 'The kit does the thing.',
    '',
    scenario ? 'Scenario: GIVEN a repo WHEN check runs THEN it passes.' : '',
    '',
    cites ?? '',
    '',
    enforced ?? '',
    '',
  ].join('\n');

const slice = ({ requirements = '[REQ-1.1]', decisions = '[D-01]', rows = ['| `a.test.js » works` | happy | REQ-1.1 |'] } = {}) => `---
slice: P1/S-03
name: Fixture
repo: .
group: B
runbook: no
requirements: ${requirements}
decisions: ${decisions}
---

## Done when

1. It works.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
${rows.join('\n')}

## Expected changes

\`src/a.js\`.
`;

// An init'd repo with the given spec text, decisions and (optionally) one slice file.
function fixture({ spec = req('REQ-1.1'), decisions = DECISIONS, sliceText = null, extra = {} } = {}) {
  const repo = makeRepo({ commits: 1 });
  init(repo.root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js' });
  const write = (rel, text) => {
    const file = path.join(repo.root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write('docs/spec/01-x.md', `# 01 — X\n\n${spec}`);
  write('docs/decisions.md', decisions);
  write('docs/intake/2026-10-24-brief.md', '# Brief\n');
  if (sliceText) write('docs/phases/P1-x/S-03-fixture.md', sliceText);
  for (const [rel, text] of Object.entries(extra)) write(rel, text);
  return repo;
}

const messages = (repo) => check(repo.root, { rules: [citations] }).findings.map((f) => f.message);

test('REQ without Cites is a finding', () => {
  const repo = fixture({
    spec: req('REQ-1.1', { cites: null }) + req('REQ-1.2', { enforced: null, shall: false, scenario: false }),
  });
  try {
    const result = check(repo.root, { rules: [citations] });
    assert.deepEqual(result.findings.map((f) => f.message), [
      'REQ-1.1 has no Cites line',
      'REQ-1.2 has no SHALL',
      'REQ-1.2 has no Scenario',
      'REQ-1.2 has no Enforced by line',
    ]);
    assert.equal(result.findings[0].file, 'docs/spec/01-x.md');
    assert.equal(result.findings[0].line, 3);
    assert.equal(result.exitCode, 1);
  } finally {
    repo.cleanup();
  }
});

test('REQ citing an unknown decision is a finding', () => {
  const repo = fixture({
    spec:
      req('REQ-1.1', { cites: 'Cites: D-01, D-99.' }) +
      req('REQ-1.2', { cites: 'Cites: `intake/2026-10-24-gone.md`.' }) +
      req('REQ-1.3', { cites: 'Cites: nothing yet.' }),
  });
  try {
    assert.deepEqual(messages(repo), [
      'REQ-1.1 cites unknown D-99',
      'REQ-1.2 cites missing intake 2026-10-24-gone.md',
      'REQ-1.3 Cites line names no decision or intake file',
    ]);
  } finally {
    repo.cleanup();
  }
});

test('evaluation test without a REQ is a finding', () => {
  const repo = fixture({
    sliceText: slice({ rows: ['| `a.test.js » works` | happy | REQ-1.1 |', '| `a.test.js » bare` | negative |  |'] }),
  });
  try {
    assert.deepEqual(messages(repo), ['slice P1/S-03 test "a.test.js » bare" covers no requirement']);
  } finally {
    repo.cleanup();
  }
});

test('slice naming an unknown REQ is a finding', () => {
  const repo = fixture({
    sliceText: slice({
      requirements: '[REQ-1.1, REQ-9.9]',
      decisions: '[D-01, D-77]',
      rows: ['| `a.test.js » works` | happy | REQ-1.1, REQ-8.8 |'],
    }),
  });
  try {
    assert.deepEqual(messages(repo), [
      'slice P1/S-03 names unknown REQ-9.9',
      'slice P1/S-03 names unknown D-77',
      'slice P1/S-03 names unknown REQ-8.8',
    ]);
  } finally {
    repo.cleanup();
  }
});

test('duplicate ids are a finding', () => {
  const repo = fixture({
    spec: req('REQ-1.1') + req('REQ-1.2'),
    decisions: `${DECISIONS}| D-01 | Decision | Again? | yes | team, 2026-10-24 |\n`,
    extra: { 'docs/spec/02-y.md': `# 02 — Y\n\n${req('REQ-1.2', { level: 2 })}` },
  });
  try {
    assert.deepEqual(messages(repo).sort(), [
      'duplicate id D-01 (docs/decisions.md:7 and docs/decisions.md:9)',
      'duplicate id REQ-1.2 (docs/spec/01-x.md:12 and docs/spec/02-y.md:3)',
    ]);
  } finally {
    repo.cleanup();
  }
});

test('a well-cited spec and slice pass', () => {
  const repo = fixture({
    spec:
      req('REQ-1.1', { cites: 'Cites: D-01, D-02, `intake/2026-10-24-brief.md`.' }) +
      req('REQ-1.2', { cites: '- Cites: `../intake/2026-10-24-brief.md`', level: 2 }) +
      '```\n### REQ-1.9 inside a fence is not a requirement\n```\n',
    sliceText: slice({ requirements: '[REQ-1.1, REQ-1.2]', decisions: '[D-02]' }),
  });
  try {
    const result = check(repo.root, { rules: [citations] });
    assert.deepEqual(result.findings, []);
    assert.equal(result.exitCode, 0);
  } finally {
    repo.cleanup();
  }
});

test('a nested REQ heading closes the outer block', () => {
  const outer = '## REQ-1.1 Outer\n\nThe kit SHALL do the outer thing.\n\n';
  const repo = fixture({ spec: outer + req('REQ-1.2') });
  try {
    assert.deepEqual(messages(repo), [
      'REQ-1.1 has no Scenario',
      'REQ-1.1 has no Cites line',
      'REQ-1.1 has no Enforced by line',
    ]);
  } finally {
    repo.cleanup();
  }
});

test('a bare intake/ token is not an intake citation', () => {
  const repo = fixture({ spec: req('REQ-1.1', { cites: 'Cites: `intake/`.' }) });
  try {
    assert.deepEqual(messages(repo), ['REQ-1.1 Cites line names no decision or intake file']);
  } finally {
    repo.cleanup();
  }
});

test('a wrapped Cites line is read as one line', () => {
  const repo = fixture({
    spec: req('REQ-1.1', { cites: 'Cites: D-01,\n  D-99, `../intake/2026-10-24-brief.md`.' }),
  });
  try {
    const found = check(repo.root, { rules: [citations] }).findings;
    assert.deepEqual(found.map((f) => [f.line, f.message]), [[10, 'REQ-1.1 cites unknown D-99']]);
  } finally {
    repo.cleanup();
  }
});

test('a list-item key line is not a Cites continuation', () => {
  const nested = fixture({
    spec: req('REQ-1.1', { cites: '  - Cites: D-01,\n    D-02.\n  - Enforced by: advisory (D-99).', enforced: null }),
  });
  const empty = fixture({
    spec: req('REQ-1.1', { cites: '- Cites: none\n  - Enforced by: `../intake/x.md`', enforced: null }),
  });
  try {
    assert.deepEqual(messages(nested), []);
    assert.deepEqual(messages(empty), ['REQ-1.1 Cites line names no decision or intake file']);
  } finally {
    nested.cleanup();
    empty.cleanup();
  }
});

test("the kit's own spec passes the citations rule", () => {
  const result = check(kitRoot, { rules: [citations] });
  assert.deepEqual(result.lines, ['check: 0 findings, 0 over baseline, 0 blocking, 1 rules']);
});
