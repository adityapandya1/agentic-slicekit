// P2/S-29 review fixes (D-43): the guards the new loop steps must keep. A merge of the default branch
// passes `build commit` by what it changes, offline, and a hand change to this slice's state never
// does; a hand-edited state file never authorises `build amend`; a verdict is taken only on the full
// id of the head it reviewed; a backfilled merge with no recorded pull request must be the slice's
// own; the files a render writes are judged at HEAD, and a stale render is answered by rendering again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { git } from '../src/git.js';
import { recordState } from '../src/build/record.js';
import { kitVersion } from '../src/render/index.js';
import { GREEN, IMPORTING, building, cli, commitAll, commitIn, commitWorkCli, green, project, red1, stateIn, write } from './helpers/build-flow.js';

const SLICE_FILE = 'docs/phases/P1-x/S-01-thing-1.md';
const STATE = '.slicekit/state/P1-S-01.json';
const at = (root, rel) => path.join(root, ...rel.split('/'));
const head = (wt) => git(wt, ['rev-parse', 'HEAD']);

// A well-formed verdict on head `sha`.
const verdictText = (verdict, sha) =>
  [`Verdict: ${verdict}`, `Head: ${sha}`, '', '| ID | File:line | What is wrong | Why it matters | How verified |', '|---|---|---|---|---|', '', '## Checklists run', '', '- correctness', '', '## Not checked', '', '- performance', ''].join('\n');

// A hand commit that unfreezes the frozen test, then a weakened test and the code.
function forgeUnfreeze(p) {
  const file = at(p.wt, STATE);
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...st, unfrozen: ['test/a.test.js'] }, null, 2)}\n`);
  commitIn(p.wt, 'by hand state');
  const forged = head(p.wt);
  fs.writeFileSync(at(p.wt, 'test/a.test.js'), "import { test } from 'node:test';\ntest('works', () => {});\n");
  write(p.wt, 'src/t1.js', GREEN);
  return forged;
}

test('a merge of main that changes another slice\'s state and BUILD.md passes build commit offline', async () => {
  // No origin at all: nothing is asked of the network.
  const p = await building({ init: true });
  try {
    write(p.root, '.slicekit/state/P1-S-02.json', '{"slice":"P1/S-02","state":"merged","history":[]}\n');
    // Main's BUILD.md: the slice's own view of it plus a line, so the merge is clean.
    fs.writeFileSync(at(p.root, 'BUILD.md'), `${fs.readFileSync(at(p.wt, 'BUILD.md'), 'utf8')}\nAnother slice merged.\n`);
    write(p.root, '.slicekit/reviews/P1-S-02-r1.md', 'Verdict: APPROVE\n');
    commitAll(p.root, 'P1/S-02 merged');
    git(p.wt, ['merge', '-q', '--no-ff', '-m', 'Merge main into the slice\n\nSlice: P1/S-01', 'main']);
    write(p.wt, 'src/t1.js', GREEN);
    const r = await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green');
    assert.equal(r.code, 0, r.stderr);
  } finally {
    p.cleanup();
  }
});

test('a hand change to this slice\'s state file is refused even when main holds the commit', async () => {
  const p = await building();
  try {
    const forged = forgeUnfreeze(p);
    git(p.root, ['update-ref', 'refs/heads/main', forged]);
    const r = await commitWorkCli(p, '--message', 'weakened');
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stderr, new RegExp(`\\.slicekit/state/P1-S-01\\.json was changed in ${forged.slice(0, 7)} outside the kit`));
  } finally {
    p.cleanup();
  }
});

test('build amend from ready is refused when the state file on disk is edited to building', async () => {
  const p = await green();
  try {
    assert.equal((await p.pr()).code, 0);
    const rel = '.slicekit/reviews/P1-S-01-r1.md';
    write(p.root, rel, verdictText('APPROVE', head(p.wt)));
    const v = await cli(p.root, ['build', 'verdict', 'P1/S-01', rel], p.env);
    assert.equal(v.code, 0, v.stderr);
    const cfg = loadConfig(p.root);
    recordState(p.wt, cfg, 'P1/S-01', 'ci-green', { ci: { status: 'success', sha: stateIn(p.wt).pr.headSha } });
    recordState(p.wt, { ...cfg, review: { ...cfg.review, independent: 'optional' } }, 'P1/S-01', 'ready', {});
    // By hand: the slice file "amended", the state on disk at building with the test unfrozen.
    fs.appendFileSync(at(p.wt, SLICE_FILE), '\nAmended by hand.\n');
    const sliceSha = git(p.wt, ['hash-object', '-w', '--', SLICE_FILE]);
    const st = stateIn(p.wt);
    const forged = {
      ...st,
      state: 'building',
      unfrozen: ['test/a.test.js'],
      history: [...st.history, { from: 'ready', to: 'building', at: '2026-10-29T00:00:00Z', by: 'cli', evidence: { unfreeze: 'test/a.test.js', amendCommit: sliceSha.slice(0, 7), reason: 'x' } }],
    };
    fs.writeFileSync(at(p.wt, STATE), `${JSON.stringify(forged, null, 2)}\n`);
    const before = head(p.wt);
    const r = await cli(p.root, ['build', 'amend', 'P1/S-01', '--test', 'test/a.test.js', '--reason', 'x']);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stderr, /P1\/S-01 is ready; amend runs from building, draft-pr, in-review, changes-requested/);
    assert.equal(head(p.wt), before);
  } finally {
    p.cleanup();
  }
});

test('a verdict written before build pr recorded a moved head is refused, naming both heads', async () => {
  const p = await green();
  try {
    assert.equal((await p.pr()).code, 0);
    const old = head(p.wt);
    const rel = '.slicekit/reviews/P1-S-01-r1.md';
    write(p.root, rel, verdictText('APPROVE', old));
    // New code lands after the verdict was written; build pr records it.
    write(p.wt, 'src/extra.js', 'export const z = 3;\n');
    commitIn(p.wt, 'more code\n\nSlice: P1/S-01');
    const moved = head(p.wt);
    const again = await p.pr();
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, new RegExp(`^head ${moved} recorded; the next verdict reviews it$`, 'm'));
    assert.match(again.stdout, /verdict .*P1-S-01-r1\.md\n$/);
    // A short id is refused, even with a branch of that name pointing at the recorded head.
    git(p.wt, ['branch', old.slice(0, 7), moved]);
    write(p.root, rel, verdictText('APPROVE', old.slice(0, 7)));
    const short = await cli(p.root, ['build', 'verdict', 'P1/S-01', rel], p.env);
    assert.equal(short.code, 1, short.stdout);
    assert.ok(short.stderr.includes(`Head "${old.slice(0, 7)}" is not a full commit id (40 lowercase hex)`), short.stderr);
    write(p.root, rel, verdictText('APPROVE', old));
    const refused = await cli(p.root, ['build', 'verdict', 'P1/S-01', rel], p.env);
    assert.equal(refused.code, 1, refused.stdout);
    assert.ok(refused.stderr.includes(`reviewed head ${old.slice(0, 7)}; the recorded head is ${moved.slice(0, 7)}`), refused.stderr);
    assert.equal(stateIn(p.wt).state, 'draft-pr');
    // The same verdict given on the head build pr recorded is taken.
    write(p.root, rel, verdictText('APPROVE', head(p.wt)));
    const taken = await cli(p.root, ['build', 'verdict', 'P1/S-01', rel], p.env);
    assert.equal(taken.code, 0, taken.stderr);
    assert.equal(stateIn(p.wt).state, 'in-review');
  } finally {
    p.cleanup();
  }
});

test('backfill with no recorded pull request takes only a pull request titled or branched for the slice', async () => {
  const p = project({ slices: [{ n: 1, group: 'A' }] });
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-host-'));
  try {
    const env = { ...process.env, SLICEKIT_GITHOST_FIXTURE: host };
    const pr = (n, title, branch) =>
      fs.writeFileSync(path.join(host, `pr-${n}.json`), JSON.stringify({ number: n, url: `u/${n}`, state: 'MERGED', mergedAt: '2026-10-28T09:30:00Z', headRefOid: 'abc1234', headRefName: branch, title }));
    pr(9, '[P7/S-07] Other', 'slice/P7-S-07-other');
    pr(10, 'Thing 1', 'slice/P1-S-01-thing-1');
    pr(11, '[P1/S-01] Thing 1', 'feature/x');
    const backfill = (n) => cli(p.root, ['state', 'set', 'P1/S-01', 'merged', '--backfill', '--pr-number', String(n)], env);
    const other = await backfill(9);
    assert.equal(other.code, 1);
    assert.equal(other.stderr, 'refused: the git host reports pull request #9 titled "[P7/S-07] Other" on branch slice/P7-S-07-other; it is not P1/S-01\'s pull request\n');
    assert.equal(stateIn(p.root).state, 'todo');
    // The slice's branch, or its title, names it.
    const byBranch = await backfill(10);
    assert.equal(byBranch.code, 0, byBranch.stderr);
    assert.equal(stateIn(p.root).pr.number, 10);
    const q = project({ slices: [{ n: 1, group: 'A' }] });
    try {
      const byTitle = await cli(q.root, ['state', 'set', 'P1/S-01', 'merged', '--backfill', '--pr-number', '11'], env);
      assert.equal(byTitle.code, 0, byTitle.stderr);
    } finally {
      q.cleanup();
    }
  } finally {
    fs.rmSync(host, { recursive: true, force: true });
    p.cleanup();
  }
});

// The kit installed by an older version, so `update --yes` re-renders settings.json and the copies.
function olderInstall(root) {
  const file = at(root, '.claude/settings.json');
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...settings, _slicekit: { ...settings._slicekit, version: '0.0.1' } }, null, 2)}\n`);
  fs.renameSync(at(root, `.slicekit/rendered/${kitVersion()}`), at(root, '.slicekit/rendered/0.0.1'));
  commitAll(root, 'kit installed at 0.0.1');
}

test('a stale render commit is answered by build render again, with other work left uncommitted', async () => {
  const proj = project({ slices: [{ n: 1, group: 'A', evalFile: 'a.test.js' }], commands: { test: 'node --test' }, init: true });
  try {
    olderInstall(proj.root);
    const started = await cli(proj.root, ['build', 'start', 'P1/S-01']);
    assert.equal(started.code, 0, started.stderr);
    const p = { ...proj, wt: started.stdout.split('\n')[0] };
    write(p.wt, 'test/a.test.js', IMPORTING);
    assert.equal((await red1(p, 'test/a.test.js')).code, 0);
    const render = () => cli(p.root, ['build', 'render', 'P1/S-01']);
    assert.equal((await render()).code, 0);
    // The render commit no longer matches what this kit renders (a template changed since).
    fs.appendFileSync(at(p.wt, `.slicekit/rendered/${kitVersion()}/.claude/settings.json`), '\n');
    git(p.wt, ['add', '-A']);
    git(p.wt, ['commit', '-q', '--amend', '--no-edit']);
    const stale = await commitWorkCli(p, '--message', 'x');
    assert.equal(stale.code, 1, stale.stdout);
    assert.match(stale.stderr, /at HEAD is not what slicekit update renders: changed outside the kit or by another kit; run slicekit build render P1\/S-01 again/);
    // Rendering again commits over it; the developer's uncommitted work stays as it is.
    write(p.wt, 'src/t1.js', GREEN);
    const again = await render();
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, /^[0-9a-f]{7} render \(1 files\)\n$/);
    assert.deepEqual(git(p.wt, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n'), [`.slicekit/rendered/${kitVersion()}/.claude/settings.json`]);
    assert.equal(git(p.wt, ['status', '--porcelain', '-uall']), '?? src/t1.js');
    const done = await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green');
    assert.equal(done.code, 0, done.stderr);
  } finally {
    proj.cleanup();
  }
});

test('a render commit that empties the hooks is refused though a later render commit does not rewrite settings.json', async () => {
  const proj = project({ slices: [{ n: 1, group: 'A', evalFile: 'a.test.js' }], commands: { test: 'node --test' }, init: true });
  try {
    olderInstall(proj.root);
    const started = await cli(proj.root, ['build', 'start', 'P1/S-01']);
    assert.equal(started.code, 0, started.stderr);
    const p = { ...proj, wt: started.stdout.split('\n')[0] };
    write(p.wt, 'test/a.test.js', IMPORTING);
    assert.equal((await red1(p, 'test/a.test.js')).code, 0);
    assert.equal((await cli(p.root, ['build', 'render', 'P1/S-01'])).code, 0);
    // The render commit, amended to hold settings.json with no hooks: still only files update writes.
    const file = at(p.wt, '.claude/settings.json');
    fs.writeFileSync(file, `${JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), hooks: {} }, null, 2)}\n`);
    git(p.wt, ['add', '-A']);
    git(p.wt, ['commit', '-q', '--amend', '--no-edit']);
    // A later render commit that leaves settings.json alone.
    write(p.wt, '.slicekit/rendered/9.9.9/note.md', 'x\n');
    git(p.wt, ['add', '-A']);
    git(p.wt, ['commit', '-q', '-m', 'chore(slicekit): P1/S-01 render\n\nSlice: P1/S-01']);
    write(p.wt, 'src/t1.js', GREEN);
    const r = await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green');
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stderr, /\.claude\/settings\.json at HEAD is not what slicekit update renders: changed outside the kit or by another kit; run slicekit build render P1\/S-01 again/);
  } finally {
    proj.cleanup();
  }
});
