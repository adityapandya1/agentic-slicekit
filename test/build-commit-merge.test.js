// REQ-2.6, D-50: the kit-file guard of `build commit` leaves out the commits of the default branch, so
// a merge of main bringing another slice's render commit or a config change passes (issue #32), and it
// judges a merge commit by the files its resolution changed, so a hand edit of this slice's state file
// made during a merge is refused (issue #31).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { git } from '../src/git.js';
import { GREEN, building, commitAll, commitWorkCli, write } from './helpers/build-flow.js';

const STATE = '.slicekit/state/P1-S-01.json';

// A plain git command in the worktree, as a person would type it; the kit's hooks run.
const plain = (wt, ...args) => execFileSync('git', args, { cwd: wt, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Commits on main in the session root, pushed to origin.
function onMain(p, change, message) {
  change();
  commitAll(p.root, message);
  git(p.root, ['push', '-q', 'origin', 'main']);
}

test("a merge of main bringing another slice's render and config commits passes build commit", async () => {
  const p = await building({ remote: true, init: true });
  try {
    // Another slice's render commit: the settings file and a reference copy, under its own subject.
    onMain(
      p,
      () => {
        fs.appendFileSync(path.join(p.root, '.claude', 'settings.json'), '\n');
        write(p.root, '.slicekit/rendered/9.9.9/README.md', 'a reference copy\n');
      },
      'chore(slicekit): P1/S-02 render\n\nSlice: P1/S-02',
    );
    // A config change made on main.
    onMain(
      p,
      () => {
        const file = path.join(p.root, '.slicekit', 'config.json');
        const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.writeFileSync(file, `${JSON.stringify({ ...cfg, commands: { ...cfg.commands, lint: 'node -e 0' } }, null, 2)}\n`);
      },
      'chore: lint command',
    );
    plain(p.wt, 'fetch', '-q', 'origin');
    plain(p.wt, 'merge', '-q', '--no-edit', 'origin/main');
    assert.equal(git(p.wt, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').length, 3, 'a merge commit');

    write(p.wt, 'src/t1.js', GREEN);
    const done = await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green');
    assert.equal(done.code, 0, done.stderr);
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
  } finally {
    p.cleanup();
  }
});

test("a merge whose resolution edits this slice's state file is refused at build commit", async () => {
  const p = await building({ remote: true, init: true });
  try {
    onMain(p, () => write(p.root, 'src/other.js', 'export const o = 1;\n'), 'feat: other');
    plain(p.wt, 'fetch', '-q', 'origin');
    plain(p.wt, 'merge', '-q', '--no-commit', '--no-ff', 'origin/main');
    // The resolution unfreezes the frozen test by hand, then the merge is committed.
    const file = path.join(p.wt, ...STATE.split('/'));
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, `${JSON.stringify({ ...state, unfrozen: ['test/a.test.js'] }, null, 2)}\n`);
    plain(p.wt, 'add', STATE);
    plain(p.wt, 'commit', '-q', '--no-edit');
    const merge = git(p.wt, ['rev-parse', 'HEAD']);
    assert.equal(git(p.wt, ['rev-list', '--parents', '-n', '1', merge]).split(' ').length, 3, 'a merge commit');

    // Then the frozen test is emptied: without the guard, nothing would stop it.
    write(p.wt, 'test/a.test.js', "// REQ-1.1\nimport { test } from 'node:test';\ntest('works', () => {});\n");
    write(p.wt, 'src/t1.js', GREEN);
    const r = await commitWorkCli(p, '--message', 'feat(P1/S-01): x');
    assert.equal(r.code, 1, r.stdout);
    assert.equal(r.stderr, `slicekit: ${STATE} was changed in ${merge.slice(0, 7)}, a merge, outside the kit; only build commands write it\n`);
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), merge);
  } finally {
    p.cleanup();
  }
});

// D-53: a merge's kit files are judged against its first parent, so a resolution that takes this
// slice's state file whole from the other parent is caught, and so is a parentless commit's own file.
test("a merge that takes this slice's state file from an orphan branch is refused at build commit", async () => {
  const p = await building({ remote: true, init: true });
  try {
    const branch = plain(p.wt, 'branch', '--show-current');
    plain(p.wt, 'checkout', '-q', '--orphan', 'forge');
    const file = path.join(p.wt, ...STATE.split('/'));
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, `${JSON.stringify({ ...state, unfrozen: ['test/a.test.js'] }, null, 2)}\n`);
    plain(p.wt, 'add', '-A');
    plain(p.wt, 'commit', '-q', '--no-verify', '-m', 'unrelated');
    const orphan = git(p.wt, ['rev-parse', 'HEAD']);
    plain(p.wt, 'checkout', '-q', branch);
    plain(p.wt, 'merge', '-q', '--no-verify', '--allow-unrelated-histories', '-X', 'theirs', '--no-edit', 'forge');
    const merge = git(p.wt, ['rev-parse', 'HEAD']);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).unfrozen, ['test/a.test.js']);

    write(p.wt, 'test/a.test.js', "// REQ-1.1\nimport { test } from 'node:test';\ntest('works', () => {});\n");
    write(p.wt, 'src/t1.js', GREEN);
    const r = await commitWorkCli(p, '--message', 'feat(P1/S-01): x');
    assert.equal(r.code, 1, r.stdout);
    // The merge takes the file whole from the orphan line, so the orphan commit, judged on its own with
    // its files listed though it has no parent, is what is refused.
    assert.notEqual(merge, orphan);
    assert.match(r.stderr, new RegExp(`was changed in ${orphan.slice(0, 7)} outside the kit`));

    // The orphan commit alone on the branch: a commit with no parent has its files judged too.
    plain(p.wt, 'reset', '-q', '--hard', orphan);
    write(p.wt, 'test/a.test.js', "// REQ-1.1\nimport { test } from 'node:test';\ntest('works', () => {});\n");
    write(p.wt, 'src/t1.js', GREEN);
    const root = await commitWorkCli(p, '--message', 'feat(P1/S-01): x');
    assert.equal(root.code, 1, root.stdout);
    assert.match(root.stderr, new RegExp(`was changed in ${orphan.slice(0, 7)} outside the kit`));
  } finally {
    p.cleanup();
  }
});

// Review r2 H-1: two worktrees push the slice branch, so it can diverge: a kit commit of the other
// worktree on one line, a build commit on the other. Their merge takes this slice's state file from a
// parent off the default branch whose own commits the guard judges one by one, and passes.
test("a merge of the slice branch's own two lines passes build commit", async () => {
  const p = await building({ remote: true, init: true });
  try {
    const branch = plain(p.wt, 'branch', '--show-current');
    plain(p.wt, 'checkout', '-q', '-b', 'other');
    const file = path.join(p.wt, ...STATE.split('/'));
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const step = { from: 'building', to: 'building', at: '2026-10-31T00:00:00Z', by: 'cli' };
    fs.writeFileSync(file, `${JSON.stringify({ ...state, history: [...state.history, step] }, null, 2)}\n`);
    plain(p.wt, 'commit', '-q', '--no-verify', '-am', 'chore(slicekit): P1/S-01 building\n\nSlice: P1/S-01');
    plain(p.wt, 'checkout', '-q', branch);
    write(p.wt, 'src/t1.js', GREEN);
    const first = await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green');
    assert.equal(first.code, 0, first.stderr);
    plain(p.wt, 'merge', '-q', '--no-verify', '--no-ff', '--no-edit', 'other');
    write(p.wt, 'src/t2.js', 'export const y = 1;\n');
    const after = await commitWorkCli(p, '--message', 'feat(P1/S-01): y');
    assert.equal(after.code, 0, after.stderr);

    // A line whose own commit is a hand edit: the merge takes its state file whole, and that commit,
    // judged on its own, is refused.
    plain(p.wt, 'checkout', '-q', '-b', 'forged', 'other');
    fs.writeFileSync(file, `${JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), unfrozen: ['test/a.test.js'] }, null, 2)}\n`);
    plain(p.wt, 'commit', '-q', '--no-verify', '-am', 'by hand');
    const forged = git(p.wt, ['rev-parse', 'HEAD']);
    plain(p.wt, 'checkout', '-q', branch);
    plain(p.wt, 'merge', '-q', '--no-verify', '--no-ff', '--no-edit', 'forged');
    write(p.wt, 'src/t3.js', 'export const z = 1;\n');
    const refused = await commitWorkCli(p, '--message', 'feat(P1/S-01): z');
    assert.equal(refused.code, 1, refused.stdout);
    assert.match(refused.stderr, new RegExp(`${STATE.replace(/[./]/g, '\$&')} was changed in ${forged.slice(0, 7)} outside the kit`));
  } finally {
    p.cleanup();
  }
});
