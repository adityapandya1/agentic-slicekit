// REQ-3.3, D-102: a test of the evaluation set is found in its file by its name. `findTest(text, name)`
// -> { line, text } for the one `test(...)` or `it(...)` call at any depth whose name is `name`
// (single, double or backtick quotes, no substitution): `line` is the 1-based line the call starts on
// and `text` runs from `test`/`it` to the call's matching close parenthesis; null when no call has it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTest } from '../src/testnames.js';

// REQ-3.3
test("a named test's body is found in a node:test file and a missing name is null", () => {
  const file = [
    "import { describe, it, test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    '',
    "test('adds two numbers', () => {",
    '  assert.equal(1 + 1, 2);',
    '});',
    '',
    "describe('totals', () => {",
    '  it("keeps a ) and a } in a string", async () => {',
    "    const s = ')}';",
    '    if (s) { assert.ok(s); }',
    '  });',
    '',
    '  test(`a backtick name`, { timeout: 5 }, () => {',
    '    // a comment with ) and }',
    '    assert.ok(true);',
    '  });',
    '});',
    '',
    "test('adds two numbers twice over', () => {});",
    "const label = 'missing in a string';",
    "// test('missing in a comment', () => {});",
    '',
  ].join('\n');

  assert.deepEqual(findTest(file, 'adds two numbers'), {
    line: 4,
    text: "test('adds two numbers', () => {\n  assert.equal(1 + 1, 2);\n})",
  });
  // Nested in a describe, with a close parenthesis and a close brace inside a string.
  assert.deepEqual(findTest(file, 'keeps a ) and a } in a string'), {
    line: 9,
    text: 'it("keeps a ) and a } in a string", async () => {\n    const s = \')}\';\n    if (s) { assert.ok(s); }\n  })',
  });
  // A backtick name with options, and a close parenthesis inside a comment.
  assert.deepEqual(findTest(file, 'a backtick name'), {
    line: 14,
    text: 'test(`a backtick name`, { timeout: 5 }, () => {\n    // a comment with ) and }\n    assert.ok(true);\n  })',
  });
  // A name that begins with another test's name is its own test.
  assert.deepEqual(findTest(file, 'adds two numbers twice over'), {
    line: 20,
    text: "test('adds two numbers twice over', () => {})",
  });

  // No call has the name: a missing name, a prefix of a name, a describe's name, a name only in a
  // string or a comment.
  for (const name of ['subtracts', 'adds two', 'totals', 'missing in a string', 'missing in a comment']) {
    assert.equal(findTest(file, name), null, name);
  }
});
