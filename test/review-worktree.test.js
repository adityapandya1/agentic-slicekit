// REQ-2.8, REQ-2.12: a review worktree moved to a detached HEAD is refused by every step that takes
// --worktree, naming `review start` and the pull request (issue #61); the brief given --worktree reads
// the slice file, the requirements and the decisions the worktree holds (issue #56).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../src/git.js';
import { building, cli, green, reviewWorktree } from './helpers/build-flow.js';

const REVIEW = '.worktrees/review-P1-S-01';

test('build verdict on a detached review worktree names review start and the pull request', async () => {
  const p = await green();
  try {
    const opened = await p.pr();
    assert.equal(opened.code, 0, opened.stderr);
    const dir = reviewWorktree(p);
    git(dir, ['checkout', '-q', '--detach', git(dir, ['rev-parse', 'HEAD'])]);
    const want = `slicekit: ${REVIEW} is the review worktree of P1/S-01 on a detached HEAD; run slicekit review start 1 to move it to the pull request's head\n`;

    const v = await cli(p.root, ['build', 'verdict', 'P1/S-01', '.slicekit/reviews/P1-S-01i-r1.md', '--independent', '--worktree', REVIEW], p.env);
    assert.equal(v.code, 1, v.stdout);
    assert.equal(v.stderr, want);
    // Every other step that takes --worktree says the same.
    const s = await cli(p.root, ['build', 'sync', 'P1/S-01', '--worktree', REVIEW], p.env);
    assert.equal(s.code, 1, s.stdout);
    assert.equal(s.stderr, want);
  } finally {
    p.cleanup();
  }
});

test('the reviewer brief with --worktree quotes the slice file the worktree holds', async () => {
  const p = await building({ init: true });
  try {
    const edit = (rel, from, to) => {
      const file = path.join(p.wt, ...rel.split('/'));
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(text.includes(from), `${rel}: ${text}`);
      fs.writeFileSync(file, text.replace(from, to));
    };
    // Amended in the worktree only: the session root still holds the old text.
    edit('docs/phases/P1-x/S-01-thing-1.md', '1. It works.', '1. The worktree text holds.');
    edit('docs/spec/01-x.md', 'The kit SHALL work.', 'The kit SHALL work from the worktree.');
    edit('docs/decisions.md', '| Name? | demo |', '| Name? | demo-from-worktree |');

    const r = await cli(p.root, ['instructions', 'reviewer', 'P1/S-01', '--worktree', p.wt]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('1. The worktree text holds.'), r.stdout);
    assert.ok(!r.stdout.includes('1. It works.'), r.stdout);
    assert.ok(r.stdout.includes('The kit SHALL work from the worktree.'), r.stdout);
    assert.ok(r.stdout.includes('Name? → demo-from-worktree'), r.stdout);

    // A worktree holding no file for the slice: the session root's text, as before.
    fs.mkdirSync(path.join(p.root, 'elsewhere'));
    const root = await cli(p.root, ['instructions', 'reviewer', 'P1/S-01', '--worktree', 'elsewhere']);
    assert.equal(root.code, 0, root.stderr);
    assert.ok(root.stdout.includes('1. It works.'), root.stdout);
    assert.ok(!root.stdout.includes('The worktree text holds'), root.stdout);
  } finally {
    p.cleanup();
  }
});
