// REQ-2.11 The verdict file: the reviewer's verdict is parsed and its shape problems named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseVerdict, verdictProblems } from '../src/verdict.js';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/verdicts/${name}`, import.meta.url)), 'utf8');

const TAIL = '\n## Checklists run\n\n- correctness\n\n## Not checked\n\n- security\n';
const TABLE = '| ID | File:line | What is wrong | Why it matters | How verified |\n|---|---|---|---|---|\n';
const doc = (verdict, rows = [], tail = TAIL) => `${verdict}\n\n${rows.length ? TABLE + rows.join('\n') + '\n' : ''}${tail}`;
const problems = (text) => verdictProblems(parseVerdict(text, 'r1.md'));

test('verdict » parses good (REQ-2.11)', () => {
  const v = parseVerdict(fixture('good.md'), '.slicekit/reviews/P1-S-07-r1.md');
  assert.equal(v.verdict, 'BLOCK');
  assert.equal(v.independent, true);
  assert.equal(v.path, '.slicekit/reviews/P1-S-07-r1.md');
  assert.deepEqual(v.findings, [
    { id: 'B-1', kind: 'blocker', file: 'src/verdict.js', line: 12, wrong: 'the parser drops CRLF rows', why: 'a Windows reviewer is refused', verified: '`node --test` printed "fail 1"' },
    { id: 'H-1', kind: 'should-have', file: 'src/verdict.js', line: null, wrong: 'a long function', why: 'hard to read', verified: 'read only' },
    { id: 'H-2', kind: 'should-have', file: null, line: null, wrong: 'no fixture for an empty table', why: 'coverage gap', verified: 'read only' },
  ]);
  assert.deepEqual(v.checklists, ['correctness', 'tests']);
  assert.deepEqual(v.notChecked, ['performance']);
  assert.deepEqual(verdictProblems(v), []);
});

test('verdict » names missing how-verified (REQ-2.11)', () => {
  assert.deepEqual(problems(fixture('missing-verified.md')), [
    'finding B-2 has no "how verified"',
    'finding H-1 has no "how verified"',
  ]);
});

test('verdict » CRLF input parses the same (REQ-2.11)', () => {
  const lf = fixture('good.md').replace(/\r\n/g, '\n');
  assert.deepEqual(parseVerdict(lf.replace(/\n/g, '\r\n'), 'x'), parseVerdict(lf, 'x'));
});

test('verdict » rows without outer pipes and with extra spaces parse (REQ-2.11)', () => {
  const text = 'Verdict: CHANGES\n\nID|File:line|What is wrong|Why it matters|How verified\n--|--|--|--|--\n  H-3  |   lib/x.js:7   |  w  |  y  |  read only  \n' + TAIL;
  const v = parseVerdict(text, 'r1.md');
  assert.deepEqual(v.findings, [{ id: 'H-3', kind: 'should-have', file: 'lib/x.js', line: 7, wrong: 'w', why: 'y', verified: 'read only' }]);
  assert.deepEqual(verdictProblems(v), []);
});

test('verdict » no verdict line (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Summary: fine')), ['no verdict line']);
  assert.deepEqual(problems(doc('Verdict: approve')), ['no verdict line']);
  assert.deepEqual(problems(doc('Verdict: MAYBE')), ['no verdict line']);
  assert.deepEqual(problems(`# Review\n\n${doc('Verdict: APPROVE')}`), ['no verdict line']);
  assert.deepEqual(problems(''), ['no verdict line', 'no checklists listed', 'no "Not checked" section']);
});

test('verdict » the verdict line may follow blank lines (REQ-2.11)', () => {
  assert.equal(parseVerdict(`\n\n  \n${doc('Verdict: APPROVE')}`, 'r').verdict, 'APPROVE');
  assert.equal(parseVerdict('Summary', 'r').verdict, null);
});

test('verdict » an unknown id form is a problem (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: CHANGES', ['| X-1 | a.js:1 | w | y | read only |', '| b-1 | a.js:1 | w | y | read only |'])), [
    'finding X-1 has an unknown id form',
    'finding b-1 has an unknown id form',
  ]);
  const v = parseVerdict(doc('Verdict: CHANGES', ['| X-1 | a.js:1 | w | y | read only |']), 'r');
  assert.equal(v.findings[0].kind, null);
});

test('verdict » a duplicate id is a problem (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: BLOCK', ['| B-1 | a.js:1 | w | y | read only |', '| B-1 | b.js:2 | w | y | read only |'])), [
    'finding B-1 is listed twice',
  ]);
});

test('verdict » BLOCK with no blocker is a problem (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: BLOCK', ['| H-1 | a.js:1 | w | y | read only |'])), ['verdict BLOCK with no open blocker']);
  assert.deepEqual(problems(doc('Verdict: BLOCK')), ['verdict BLOCK with no open blocker']);
});

test('verdict » APPROVE with a blocker is a problem (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: APPROVE', ['| B-1 | a.js:1 | w | y | read only |'])), ['verdict APPROVE with open blocker B-1']);
  assert.deepEqual(
    problems(doc('Verdict: APPROVE', ['| B-1 | a.js:1 | w | y | read only |', '| B-2 | a.js:1 | w | y | read only |'])),
    ['verdict APPROVE with open blocker B-1, B-2'],
  );
});

test('verdict » no checklists listed (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: APPROVE', [], '\n## Not checked\n\n- security\n')), ['no checklists listed']);
  assert.deepEqual(problems(doc('Verdict: APPROVE', [], '\n## Checklists run\n\n## Not checked\n\n- security\n')), ['no checklists listed']);
});

test('verdict » no "Not checked" section (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: APPROVE', [], '\n## Checklists run\n\n- correctness\n')), ['no "Not checked" section']);
  const v = parseVerdict(doc('Verdict: APPROVE', [], '\n## Checklists run\n\n- correctness\n\n## Not checked\n'), 'r');
  assert.deepEqual(v.notChecked, []);
  assert.deepEqual(verdictProblems(v), []);
});

test('verdict » independent only with an "Independent: yes" line (REQ-2.8)', () => {
  assert.equal(parseVerdict(doc('Verdict: APPROVE'), 'r').independent, false);
  assert.equal(parseVerdict(doc('Verdict: APPROVE') + '\nIndependent: no\n', 'r').independent, false);
  assert.equal(parseVerdict(doc('Verdict: APPROVE') + '\nIndependent: yes\n', 'r').independent, true);
});

test('verdict » problems come in a stable order (REQ-2.11)', () => {
  const text = 'Verdict: APPROVE\n\n' + TABLE + '| B-1 | a.js | w | y | |\n| Z | a.js | w | y | read only |\n| B-1 | a.js | w | y | read only |\n';
  assert.deepEqual(problems(text), [
    'finding B-1 has no "how verified"',
    'finding Z has an unknown id form',
    'finding B-1 is listed twice',
    'verdict APPROVE with open blocker B-1',
    'no checklists listed',
    'no "Not checked" section',
  ]);
});
