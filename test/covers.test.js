// D-35, REQ-1.8, REQ-3.11: a verdict given on head H still holds on a later head H' when every
// commit between them touches only the kit's own bookkeeping (state, reviews, journal, BUILD.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { init } from '../src/init.js';
import { loadConfig } from '../src/config.js';
import { headCovers } from '../src/state/covers.js';
import { readSlice, setState, writeSlice } from '../src/state/index.js';
import { decideReady } from '../src/ready-label.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { writeSliceFixtures } from './helpers/slice-fixture.js';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function write(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function commitAll(root, message) {
  git(root, 'add', '-A');
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '--no-verify', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

// H: the reviewed code. H1: only bookkeeping on top. H2: a code change on top of H1. C: a sibling of H1.
function withHistory(fn) {
  const repo = makeRepo();
  try {
    const root = repo.root;
    init(root, { name: 'demo', shape: 'backend' });
    const [id] = writeSliceFixtures(root, 1);
    write(root, 'src/x.js', 'export const x = 1;\n');
    const H = commitAll(root, 'code');
    write(root, '.slicekit/state/P1-S-01.json', '{}\n');
    write(root, '.slicekit/reviews/P1-S-01-r1.md', '# review\n');
    write(root, '.slicekit/reviews/P1-S-01i-r1.md', 'Verdict: APPROVE\n');
    write(root, '.slicekit/journal/main--abc123.log', 'line\n');
    write(root, 'BUILD.md', '# Build\n');
    const H1 = commitAll(root, 'bookkeeping');
    write(root, 'src/x.js', 'export const x = 2;\n');
    const H2 = commitAll(root, 'more code');
    git(root, 'checkout', '-q', '-b', 'side', H);
    write(root, '.slicekit/state/P1-S-01.json', '{"side":true}\n');
    const C = commitAll(root, 'side bookkeeping');
    git(root, 'checkout', '-q', '-b', 'oldjournal', H1);
    write(root, '.slicekit/journal.log', 'line\n');
    const J = commitAll(root, 'the old single journal file');
    return fn({ root, cfg: loadConfig(root), id, H, H1, H2, C, J });
  } finally {
    repo.cleanup();
  }
}

test('a later head with only bookkeeping commits is covered; any other change is not', () => {
  withHistory(({ root, H, H1, H2, C, J }) => {
    assert.equal(headCovers(root, H, H), true);
    assert.equal(headCovers(root, H, H1), true, 'state, review, journal and BUILD.md only');
    assert.equal(headCovers(root, H, H1.slice(0, 7)), true, 'an abbreviated head resolves');
    assert.equal(headCovers(root, H, H2), false, 'src/x.js changed');
    assert.equal(headCovers(root, H1, H2), false);
    assert.equal(headCovers(root, H1, C), false, 'not a descendant');
    assert.equal(headCovers(root, H1, H), false, 'an older head is not covered');
    assert.equal(headCovers(root, H, 'f'.repeat(40)), false, 'unknown commit');
    assert.equal(headCovers(root, undefined, H1), false);
    assert.equal(headCovers(root, H, '--all'), false, 'not a sha');
    assert.equal(headCovers(root, H1, J), false, '.slicekit/journal.log is no longer bookkeeping');
  });
});

test('outside a git repository nothing is covered but the same head', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? process.env.TEMP ?? '.', 'slicekit-nogit-'));
  try {
    assert.equal(headCovers(dir, 'a'.repeat(40), 'b'.repeat(40)), false);
    assert.equal(headCovers(dir, 'a'.repeat(40), 'a'.repeat(40)), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('decideReady and the ready transition count a verdict whose head covers the live one', () => {
  withHistory(({ root, cfg, id, H, H1, H2 }) => {
    const verdicts = [{ round: 1, path: '.slicekit/reviews/P1-S-01i-r1.md', blockers: 0, independent: true, headSha: H }];
    const state = { slice: id, state: 'ci-green', pr: { number: 3, headSha: H1 }, verdicts };
    assert.equal(decideReady(state, cfg, { headSha: H1, root }).ready, true);
    assert.deepEqual(decideReady(state, cfg, { headSha: H2, root }), { ready: false, reason: 'no review verdict on the current head' });
    // Without a repository to look in, only the exact head counts.
    assert.equal(decideReady(state, cfg, { headSha: H1 }).ready, false);
    writeSlice(root, cfg, { ...readSlice(root, cfg, id), ...state });
    assert.equal(setState(root, cfg, id, 'ready', {}).state, 'ready');
  });
});

// P8/S-58 (REQ-1.8, D-100): a slice branch that merged the default branch. The pull request changes
// src/x.js; A is its reviewed head, then a bookkeeping commit, then B, a merge of main. On main, after
// the branch point, `mainChange` is committed with a state file of another slice and BUILD.md.
const X = ['one', 'two', 'three', 'four', 'five'].map((w) => `export const ${w} = 1;`).join('\n');
function withMergedDefault(mainChange, fn) {
  const repo = makeRepo();
  try {
    const root = repo.root;
    init(root, { name: 'demo', shape: 'backend' });
    const ids = writeSliceFixtures(root, 2);
    write(root, 'src/x.js', `${X}\n`);
    commitAll(root, 'plan');
    git(root, 'checkout', '-q', '-b', 'slice/P1-S-01-a');
    write(root, 'src/x.js', `${X.replace('one = 1', 'one = 2')}\n`);
    const A = commitAll(root, 'feat: x\n\nSlice: P1/S-01');
    write(root, '.slicekit/state/P1-S-01.json', '{"bookkeeping":true}\n');
    write(root, '.slicekit/reviews/P1-S-01i-r1.md', 'Verdict: APPROVE\n');
    commitAll(root, 'chore(slicekit): P1/S-01 verdict\n\nSlice: P1/S-01');
    git(root, 'checkout', '-q', 'main');
    for (const [rel, text] of Object.entries(mainChange)) write(root, rel, text);
    write(root, '.slicekit/state/P1-S-02.json', '{"other":true}\n');
    write(root, 'BUILD.md', '# Build on main\n');
    commitAll(root, 'another slice merged');
    git(root, 'checkout', '-q', 'slice/P1-S-01-a');
    git(root, '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '--no-edit', '-q', 'main');
    const B = git(root, 'rev-parse', 'HEAD');
    assert.equal(git(root, 'rev-list', '--parents', '-n', '1', B).split(' ').length, 3, 'B is a merge commit');
    return fn({ root, cfg: loadConfig(root), id: ids[0], A, B });
  } finally {
    repo.cleanup();
  }
}

// The slice parked at ci-green on head B with an independent verdict on head A.
function parkOnA(root, cfg, id, A, B) {
  const verdicts = [{ round: 1, path: '.slicekit/reviews/P1-S-01i-r1.md', blockers: 0, independent: true, headSha: A }];
  writeSlice(root, cfg, { ...readSlice(root, cfg, id), state: 'ci-green', pr: { number: 3, headSha: B }, verdicts });
}

test("a merge of the default branch that leaves the pull request's files as they were covers the verdict", () => {
  withMergedDefault({ 'src/other.js': 'export const other = 1;\n' }, ({ root, cfg, id, A, B }) => {
    assert.equal(git(root, 'show', `${B}:src/x.js`), git(root, 'show', `${A}:src/x.js`));
    assert.equal(headCovers(root, A, B), true);
    parkOnA(root, cfg, id, A, B);
    assert.equal(setState(root, cfg, id, 'ready', {}).state, 'ready');
  });
});

test('a merge that changes a file the pull request changes does not cover the verdict', () => {
  withMergedDefault({ 'src/x.js': `${X.replace('five = 1', 'five = 5')}\n` }, ({ root, cfg, id, A, B }) => {
    assert.notEqual(git(root, 'show', `${B}:src/x.js`), git(root, 'show', `${A}:src/x.js`));
    assert.equal(headCovers(root, A, B), false);
    parkOnA(root, cfg, id, A, B);
    assert.throws(() => setState(root, cfg, id, 'ready', {}));
    assert.equal(readSlice(root, cfg, id).state, 'ci-green');
  });
});
