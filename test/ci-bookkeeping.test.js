// REQ-3.11, D-49, D-35: `slicekit ci bookkeeping --base <sha> --head <sha>` tells the gate whether the
// commits of a pull request push change only the kit's own bookkeeping (the slice's state file, the
// verdict files under the reviews directory, BUILD.md), printing `bookkeeping` or `code` with the
// range it judged. Any doubt is `code`, so the tests run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { init } from '../src/init.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';
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

// A slice branch: BASE is the head the last run tested (code), then two bookkeeping commits up to
// BOOK (state file, then a verdict and BUILD.md), then CODE adds a source change on top of BOOK.
// SIDE is a bookkeeping commit on BASE beside BOOK's line, as a force push leaves the old head.
function withSliceBranch(fn) {
  const repo = makeRepo();
  try {
    const root = repo.root;
    init(root, { name: 'demo', shape: 'backend' });
    writeSliceFixtures(root, 1);
    write(root, 'src/x.js', 'export const x = 1;\n');
    commitAll(root, 'main');
    git(root, 'checkout', '-q', '-b', 'slice/P1-S-01-a');
    write(root, 'src/x.js', 'export const x = 2;\n');
    const BASE = commitAll(root, 'feat(P1/S-01): code');
    write(root, '.slicekit/state/P1-S-01.json', '{"state":"in-review"}\n');
    commitAll(root, 'chore(slicekit): P1/S-01 in-review');
    write(root, '.slicekit/reviews/P1-S-01-r1.md', 'Verdict: APPROVE\n');
    write(root, 'BUILD.md', '# Build\n');
    const BOOK = commitAll(root, 'chore(slicekit): P1/S-01 verdict r1');
    write(root, 'src/y.js', 'export const y = 1;\n');
    const CODE = commitAll(root, 'fix(P1/S-01): another file');
    git(root, 'checkout', '-q', '-b', 'rewritten', BASE);
    write(root, '.slicekit/state/P1-S-01.json', '{"state":"draft-pr"}\n');
    const SIDE = commitAll(root, 'chore(slicekit): P1/S-01 draft-pr');
    git(root, 'checkout', '-q', 'slice/P1-S-01-a');
    return fn({ root, BASE, BOOK, CODE, SIDE });
  } finally {
    repo.cleanup();
  }
}

const judge = (root, args) => runCli(['ci', 'bookkeeping', ...args], { cwd: root });

// One line: the decision first, then the range it judged (each sha at least as its 7-character prefix).
function assertDecision(r, kind, { base, head } = {}) {
  assert.equal(r.code, 0, r.stderr);
  const out = r.stdout.trim();
  assert.equal(out.split('\n').length, 1, r.stdout);
  assert.match(out, new RegExp(`^${kind}\\b`), r.stdout);
  if (base) assert.ok(out.includes(base.slice(0, 7)), `base in ${r.stdout}`);
  if (head) assert.ok(out.includes(head.slice(0, 7)), `head in ${r.stdout}`);
}

test('a push of only state, verdict and BUILD.md is bookkeeping', () => {
  withSliceBranch(({ root, BASE, BOOK }) => {
    assertDecision(judge(root, ['--base', BASE, '--head', BOOK]), 'bookkeeping', { base: BASE, head: BOOK });
    // The same head as the base adds nothing: nothing to test again.
    assertDecision(judge(root, ['--base', BOOK, '--head', BOOK]), 'bookkeeping', { base: BOOK, head: BOOK });
  });
});

test('a push that changes any other file, or has no base, is code', () => {
  withSliceBranch(({ root, BASE, BOOK, CODE, SIDE }) => {
    // A file outside the set, in the last commit of the range or anywhere in it.
    assertDecision(judge(root, ['--base', BOOK, '--head', CODE]), 'code', { base: BOOK, head: CODE });
    assertDecision(judge(root, ['--base', BASE, '--head', CODE]), 'code', { base: BASE, head: CODE });
    // No base to compare: absent, empty, or the all-zero sha GitHub sends when there is no before.
    assertDecision(judge(root, ['--head', BOOK]), 'code');
    assertDecision(judge(root, ['--base', '', '--head', BOOK]), 'code');
    assertDecision(judge(root, ['--base', '0'.repeat(40), '--head', BOOK]), 'code');
    // A force push: the base is not an ancestor of the head, even though only bookkeeping differs.
    assertDecision(judge(root, ['--base', SIDE, '--head', BOOK]), 'code');
    // A base the clone does not have.
    assertDecision(judge(root, ['--base', 'f'.repeat(40), '--head', BOOK]), 'code');
  });
});
