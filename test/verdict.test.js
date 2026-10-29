// REQ-2.11 The verdict file: the reviewer's verdict is parsed and its shape problems named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseVerdict, verdictProblems } from '../src/verdict.js';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/verdicts/${name}`, import.meta.url)), 'utf8');

const TAIL = '\n## Checklists run\n\n- correctness\n\n## Not checked\n\n- security\n';
const TABLE = '| ID | File:line | What is wrong | Why it matters | How verified |\n|---|---|---|---|---|\n';
// Every verdict names the head it reviewed (D-43).
const HEAD = 'Head: abc1234abc1234abc1234abc1234abc1234abc12';
const doc = (verdict, rows = [], tail = TAIL) => `${verdict}\n${HEAD}\n\n${rows.length ? TABLE + rows.join('\n') + '\n' : ''}${tail}`;
const problems = (text) => verdictProblems(parseVerdict(text, 'r1.md'));

test('verdict » parses good (REQ-2.11)', () => {
  const v = parseVerdict(fixture('good.md'), '.slicekit/reviews/P1-S-07-r1.md');
  assert.equal(v.verdict, 'BLOCK');
  assert.equal(v.independent, true);
  assert.equal(v.path, '.slicekit/reviews/P1-S-07-r1.md');
  assert.deepEqual(v.findings, [
    { id: 'B-1', kind: 'blocker', file: 'src/verdict.js', line: 12, lineEnd: null, wrong: 'the parser drops CRLF rows', why: 'a Windows reviewer is refused', verified: '`node --test` printed "fail 1"' },
    { id: 'H-1', kind: 'should-have', file: 'src/verdict.js', line: null, lineEnd: null, wrong: 'a long function', why: 'hard to read', verified: 'read only' },
    { id: 'H-2', kind: 'should-have', file: null, line: null, lineEnd: null, wrong: 'no fixture for an empty table', why: 'coverage gap', verified: 'read only' },
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
  const text = 'Verdict: CHANGES\nHead: abc1234abc1234abc1234abc1234abc1234abc12\n\nID|File:line|What is wrong|Why it matters|How verified\n--|--|--|--|--\n  H-3  |   lib/x.js:7   |  w  |  y  |  read only  \n' + TAIL;
  const v = parseVerdict(text, 'r1.md');
  assert.deepEqual(v.findings, [{ id: 'H-3', kind: 'should-have', file: 'lib/x.js', line: 7, lineEnd: null, wrong: 'w', why: 'y', verified: 'read only' }]);
  assert.deepEqual(verdictProblems(v), []);
});

test('verdict » no verdict line (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Summary: fine')), ['no verdict line']);
  assert.deepEqual(problems(doc('Verdict: approve')), ['no verdict line']);
  assert.deepEqual(problems(doc('Verdict: MAYBE')), ['no verdict line']);
  assert.deepEqual(problems(`# Review\n\n${doc('Verdict: APPROVE')}`), ['no verdict line']);
  assert.deepEqual(problems(''), ['no verdict line', 'no "Head:" line naming the head reviewed', 'no checklists listed', 'no "Not checked" section']);
});

test('verdict » the verdict line may follow blank lines (REQ-2.11)', () => {
  assert.equal(parseVerdict(`\n\n  \n${doc('Verdict: APPROVE')}`, 'r').verdict, 'APPROVE');
  assert.equal(parseVerdict('Summary', 'r').verdict, null);
});

test('verdict » an unknown id form is a problem (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: CHANGES', ['| X-1 | a.js:1 | w | y | read only |', '| b-1 | a.js:1 | w | y | read only |'])), [
    'finding X-1 has an unknown id form',
    'finding b-1 has an unknown id form',
    'verdict CHANGES with no should-have',
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
  const text = 'Verdict: APPROVE\nHead: abc1234abc1234abc1234abc1234abc1234abc12\n\n' + TABLE + '| B-1 | a.js | w | y | |\n| Z | a.js | w | y | read only |\n| B-1 | a.js | w | y | read only |\n';
  assert.deepEqual(problems(text), [
    'finding B-1 has no "how verified"',
    'finding Z has an unknown id form',
    'finding B-1 is listed twice',
    'verdict APPROVE with open blocker B-1',
    'no checklists listed',
    'no "Not checked" section',
  ]);
});

// Fix round 1: the review's probe cases.
const BS = String.fromCharCode(92);
const ROW = (id, rest = '| a | x | y | ran |') => `| ${id} ${rest}`;

test('verdict » CHANGES with a blocker is a problem (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: CHANGES', [ROW('B-1'), ROW('H-1')])), ['verdict CHANGES with open blocker B-1; use BLOCK']);
  assert.deepEqual(problems(doc('Verdict: CHANGES', [ROW('B-1'), ROW('B-2'), ROW('H-1')])), ['verdict CHANGES with open blocker B-1, B-2; use BLOCK']);
});

test('verdict » CHANGES with no should-have is a problem (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: CHANGES')), ['verdict CHANGES with no should-have']);
});

test('verdict » escaped and code-span pipes stay inside the cell (REQ-2.11)', () => {
  const esc = parseVerdict(doc('Verdict: BLOCK', ['| B-1 | a | uses a' + BS + '|b | y | |']), 'r');
  assert.equal(esc.findings[0].wrong, 'uses a|b');
  assert.deepEqual(verdictProblems(esc), ['finding B-1 has no "how verified"']);
  const code = parseVerdict(doc('Verdict: BLOCK', ['| B-1 | a | `a|b` | y | |']), 'r');
  assert.equal(code.findings[0].wrong, '`a|b`');
  assert.deepEqual(verdictProblems(code), ['finding B-1 has no "how verified"']);
  const inVerified = parseVerdict(doc('Verdict: BLOCK', ['| B-1 | a | x | y | `grep a' + BS + '|b` printed 2 |']), 'r');
  assert.equal(inVerified.findings[0].verified, '`grep a|b` printed 2');
  assert.deepEqual(verdictProblems(inVerified), []);
});

test('verdict » a row with more cells than the header is a problem (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: BLOCK', ['| B-1 | a | x | y | ran | extra |'])), ['finding B-1 has 6 cells, the header has 5']);
});

test('verdict » every findings table is read, in document order (REQ-2.11)', () => {
  const two = `Verdict: APPROVE\n${HEAD}\n\n${TABLE}${ROW('H-1')}\n\n${TABLE}| B-1 | a | x | y | |\n${TAIL}`;
  const v = parseVerdict(two, 'r');
  assert.deepEqual(v.findings.map((f) => f.id), ['H-1', 'B-1']);
  assert.deepEqual(verdictProblems(v), ['finding B-1 has no "how verified"', 'verdict APPROVE with open blocker B-1']);
  const otherFirst = `Verdict: BLOCK\n\n| Check | Result |\n|---|---|\n| a | b |\n\n${TABLE}${ROW('B-1')}\n${TAIL}`;
  assert.deepEqual(parseVerdict(otherFirst, 'r').findings.map((f) => f.id), ['B-1']);
});

test('verdict » more than one verdict line is a problem (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: CHANGES\nVerdict: BLOCK', [ROW('B-1')])), [
    'more than one verdict line',
    'verdict CHANGES with open blocker B-1; use BLOCK',
    'verdict CHANGES with no should-have',
  ]);
  assert.deepEqual(problems(doc('Verdict: BLOCK', [ROW('B-1')]) + '\n```\nVerdict: APPROVE\n```\n'), []);
});

test('verdict » an id with a leading zero or zero is an unknown id form (REQ-2.11)', () => {
  assert.deepEqual(problems(doc('Verdict: BLOCK', [ROW('B-01'), ROW('B-1')])), ['finding B-01 has an unknown id form']);
  assert.deepEqual(problems(doc('Verdict: CHANGES', [ROW('H-0')])), ['finding H-0 has an unknown id form', 'verdict CHANGES with no should-have']);
  for (const id of ['b-1', 'B-1a', '**B-1**']) {
    assert.deepEqual(problems(doc('Verdict: CHANGES', [ROW(id), ROW('H-1')])), [`finding ${id} has an unknown id form`]);
  }
});

test('verdict » a missing or empty "What is wrong" or "Why it matters" is a problem (REQ-2.11)', () => {
  const noCols = `Verdict: BLOCK\n${HEAD}\n\n| ID | File:line | How verified |\n|---|---|---|\n| B-1 | a | ran |\n${TAIL}`;
  assert.deepEqual(problems(noCols), ['findings table has no "What is wrong" column', 'findings table has no "Why it matters" column']);
  assert.deepEqual(problems(doc('Verdict: BLOCK', ['| B-1 |  |  |  | ran |'])), ['finding B-1 has no "What is wrong"', 'finding B-1 has no "Why it matters"']);
  assert.deepEqual(problems(doc('Verdict: BLOCK', ['| B-1 | a | x |'])), ['finding B-1 has no "Why it matters"', 'finding B-1 has no "how verified"']);
});

test('verdict » a fence line ends the findings table (REQ-2.11)', () => {
  const v = parseVerdict(`Verdict: APPROVE\n${HEAD}\n\n${TABLE}${ROW('H-1')}\n\`\`\`\nfoo\n\`\`\`\n| B-1 | a | x | y | |\n${TAIL}`, 'r');
  assert.deepEqual(v.findings.map((f) => f.id), ['H-1']);
  assert.deepEqual(verdictProblems(v), []);
  const fencedFirst = `Verdict: BLOCK\n\n\`\`\`\n${TABLE}| H-9 | a | x | y | |\n\`\`\`\n\n${TABLE}${ROW('B-1')}\n${TAIL}`;
  assert.deepEqual(parseVerdict(fencedFirst, 'r').findings.map((f) => f.id), ['B-1']);
});

test('verdict » non-string input never throws (REQ-2.11)', () => {
  for (const bad of [undefined, null, 42, {}]) assert.deepEqual(verdictProblems(parseVerdict(bad, 'r')), ['no verdict line']);
  const v = parseVerdict(Buffer.from(doc('Verdict: CHANGES', [ROW('H-1')])), 'r');
  assert.equal(v.verdict, 'CHANGES');
  assert.deepEqual(verdictProblems(v), []);
});

test('verdict » n/a, none and tbd are not a "how verified" (REQ-2.11)', () => {
  for (const s of ['n/a', 'None', ' TBD ', '   ']) {
    assert.deepEqual(problems(doc('Verdict: BLOCK', [`| B-1 | a | x | y | ${s} |`])), ['finding B-1 has no "how verified"']);
  }
});

test('verdict » a line range and a Windows path read (REQ-2.11)', () => {
  const [r] = parseVerdict(doc('Verdict: BLOCK', ['| B-1 | a.js:12-14 | x | y | ran |']), 'r').findings;
  assert.deepEqual([r.file, r.line, r.lineEnd], ['a.js', 12, 14]);
  const [w] = parseVerdict(doc('Verdict: BLOCK', [`| B-1 | C:${BS}x${BS}a.js:12 | x | y | ran |`]), 'r').findings;
  assert.deepEqual([w.file, w.line, w.lineEnd], [`C:${BS}x${BS}a.js`, 12, null]);
});

test('verdict » a deeper "Not checked" heading is the Not checked section (REQ-2.11)', () => {
  const v = parseVerdict(doc('Verdict: BLOCK', [ROW('B-1')], '\n## Checklists run\n\n- c\n\n### Not checked\n\n- p\n'), 'r');
  assert.deepEqual([v.checklists, v.notChecked, verdictProblems(v)], [['c'], ['p'], []]);
  const colon = parseVerdict(doc('Verdict: BLOCK', [ROW('B-1')], '\n## Checklists run\n\n- c\n\n## Not checked:\n\n- p\n'), 'r');
  assert.deepEqual(verdictProblems(colon), []);
  const sub = parseVerdict(doc('Verdict: BLOCK', [ROW('B-1')], '\n## Checklists run\n\n### sub\n- c\n\n## Not checked\n'), 'r');
  assert.deepEqual([sub.checklists, verdictProblems(sub)], [['c'], []]);
});

// D-43: the verdict names the head it reviewed, on one `Head:` line holding a commit SHA.
test('verdict » a missing, malformed or repeated Head line is a problem (REQ-2.11)', () => {
  const headless = doc('Verdict: APPROVE').replace(`${HEAD}\n`, '');
  assert.deepEqual(problems(headless), ['no "Head:" line naming the head reviewed']);
  assert.equal(parseVerdict(doc('Verdict: APPROVE'), 'r').head, 'abc1234abc1234abc1234abc1234abc1234abc12');
  assert.deepEqual(problems(headless.replace('Verdict: APPROVE\n', 'Verdict: APPROVE\nHead: the tip\n')), ['Head "the tip" is not a full commit id (40 lowercase hex)']);
  assert.deepEqual(problems(headless.replace('Verdict: APPROVE\n', 'Verdict: APPROVE\nHead: ABC1234\n')), ['Head "ABC1234" is not a full commit id (40 lowercase hex)']);
  // A short id is refused: a ref of that name could stand for another commit.
  assert.deepEqual(problems(headless.replace('Verdict: APPROVE\n', 'Verdict: APPROVE\nHead: abc1234\n')), ['Head "abc1234" is not a full commit id (40 lowercase hex)']);
  assert.deepEqual(problems(doc('Verdict: APPROVE') + '\nHead: def5678\n'), ['more than one "Head:" line']);
  // A Head line inside a fence is an example, not the verdict's head.
  assert.deepEqual(problems(headless + '\n```\nHead: abc1234abc1234abc1234abc1234abc1234abc12\n```\n'), ['no "Head:" line naming the head reviewed']);
});
