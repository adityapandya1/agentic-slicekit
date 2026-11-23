// REQ-1.8, REQ-1.5, D-102: `build red` records each evaluation test as its file and its name, read
// from the `<file> » <name>` cell, and refuses with exit 1 when a named test is not in its file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { git } from '../src/git.js';
import { red1, startedWithTest, stateIn, write } from './helpers/build-flow.js';

// REQ-1.8
test('build red refuses an evaluation test whose name is not in its file', async () => {
  // The slice's rows are `a.test.js » works`. The file holds `works` in a test's longer name and in
  // an assertion message, but no test named `works`; it fails when run, so only the name is wrong.
  const wrong = [
    '// REQ-1.1',
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('works fine', () => assert.equal(1, 2, 'works'));",
    '',
  ].join('\n');
  const p = await startedWithTest(wrong);
  try {
    const r = await red1(p, 'test/a.test.js');
    assert.equal(r.code, 1, r.stdout);
    assert.ok(r.stderr.includes('a.test.js'), r.stderr);
    assert.ok(r.stderr.includes('works'), r.stderr);
    const st = stateIn(p.wt);
    assert.equal(st.state, 'todo');
    assert.ok(!st.redCommit, JSON.stringify(st));

    // The same file with a test named `works`: red records the test by its file and its name.
    write(p.wt, 'test/a.test.js', wrong.replace("test('works fine'", "test('works'"));
    const ok = await red1(p, 'test/a.test.js');
    assert.equal(ok.code, 0, ok.stderr);
    const after = stateIn(p.wt);
    assert.equal(after.state, 'building');
    assert.equal(after.redCommit, git(p.wt, ['log', '-1', '--format=%H', '--', 'test/a.test.js']));
    assert.deepEqual(after.frozenTests, [{ file: 'test/a.test.js', name: 'works' }]);
  } finally {
    p.cleanup();
  }
});
