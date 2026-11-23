// REQ-2.6, D-10 (P6/S-51, issue #71): build commit judges the slice's own state file before it runs
// a test. A state file marked skip-worktree or assume-unchanged, or one that differs on disk from the
// file at HEAD, is refused with a line naming the file and saying which it is: an unfreeze written
// into the file by hand, then hidden from git, would otherwise let a frozen test be emptied and
// committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/git.js';
import { GREEN, IMPORTING, building, commitWorkCli, write } from './helpers/build-flow.js';

const STATE = '.slicekit/state/P1-S-01.json';
const TEST = 'test/a.test.js';

const stateText = (wt) => fs.readFileSync(path.join(wt, ...STATE.split('/')), 'utf8');

// The state file on disk with the frozen test unfrozen by hand, as no build command wrote it.
function unfreezeOnDisk(wt) {
  const state = JSON.parse(stateText(wt));
  // P8/S-60 (D-102): build red records the evaluation test by its file and its name.
  assert.deepEqual(state.frozenTests, [{ file: TEST, name: 'works' }]);
  state.unfrozen = [TEST];
  write(wt, STATE, `${JSON.stringify(state, null, 2)}\n`);
}

// The one line of standard error that names the state file.
function stateLine(r) {
  const lines = r.stderr.split(/\r?\n/).filter((l) => l.includes(STATE));
  assert.equal(lines.length, 1, r.stderr);
  return lines[0];
}

test('build commit refuses a state file hidden from git or changed on disk', async () => {
  const p = await building();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-state-probe-'));
  // The frozen test emptied: it passes whatever src/t1.js holds, and leaves a file when it is run.
  const ran = path.join(scratch, 'ran');
  const EMPTIED = `// REQ-1.1\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(ran)}, 'ran');\n`;
  try {
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    const committed = stateText(p.wt);
    // Refused with exit 1, no commit, and before the test command ran.
    const refused = async (what, ...args) => {
      const r = await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green', ...args);
      assert.equal(r.code, 1, `${what}: ${r.stdout}${r.stderr}`);
      assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head, `${what}: a commit was made`);
      assert.ok(!fs.existsSync(ran), `${what}: the test command ran`);
      return stateLine(r);
    };

    // The steps of issue #71: unfreeze the test in the state file on disk, hide the file from git,
    // empty the frozen test.
    unfreezeOnDisk(p.wt);
    git(p.wt, ['update-index', '--skip-worktree', '--', STATE]);
    write(p.wt, TEST, EMPTIED);
    write(p.wt, 'src/t1.js', GREEN);
    assert.ok(!git(p.wt, ['status', '--porcelain']).includes(STATE), 'git sees no change in the state file');
    const skipped = await refused('skip-worktree');
    assert.match(skipped, /skip-worktree/);
    assert.doesNotMatch(skipped, /assume-unchanged/);

    // The same, hidden with assume-unchanged.
    git(p.wt, ['update-index', '--no-skip-worktree', '--', STATE]);
    git(p.wt, ['update-index', '--assume-unchanged', '--', STATE]);
    assert.ok(!git(p.wt, ['status', '--porcelain']).includes(STATE), 'git sees no change in the state file');
    const assumed = await refused('assume-unchanged');
    assert.match(assumed, /assume-unchanged/);
    assert.doesNotMatch(assumed, /skip-worktree/);

    // No mark: the state file edited on disk, and the emptied test staged with the code, so the
    // state file is not among the paths the commit would hold.
    git(p.wt, ['update-index', '--no-assume-unchanged', '--', STATE]);
    git(p.wt, ['add', '--', TEST, 'src/t1.js']);
    const edited = await refused('changed on disk');
    assert.match(edited, /differs/);
    assert.match(edited, /HEAD/);
    assert.doesNotMatch(edited, /skip-worktree|assume-unchanged/);
    assert.equal(git(p.wt, ['diff', '--cached', '--name-only']), `src/t1.js\n${TEST}`, 'the refusal left the index as it was');

    // With the state file as HEAD holds it and the frozen test as it was at red, the commit is made.
    write(p.wt, STATE, committed);
    write(p.wt, TEST, IMPORTING);
    git(p.wt, ['add', '--', TEST]);
    assert.equal(git(p.wt, ['status', '--porcelain']), 'A  src/t1.js');
    const done = await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green');
    assert.equal(done.code, 0, done.stderr);
    assert.notEqual(git(p.wt, ['rev-parse', 'HEAD']), head);
    assert.ok(!fs.existsSync(ran));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    p.cleanup();
  }
});
