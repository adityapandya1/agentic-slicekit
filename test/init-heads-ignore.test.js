// P4/S-47 (REQ-1.1, REQ-3.8, D-89): init un-ignores .slicekit/journal-heads.log, so a `*.log` rule
// does not make the sync job's `git add` refuse the heads log; journal locks stay ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../src/init.js';
import { git } from '../src/git.js';
import { makeRepo } from './helpers/tmp-repo.js';

const HEADS = '.slicekit/journal-heads.log';
const JOURNAL_FILE = '.slicekit/journal/main--0123abcd.log';
const JOURNAL_LOCK = '.slicekit/journal/main--0123abcd.log.lock';
const HEADS_FORMS = ['!.slicekit/journal-heads.log', '!/.slicekit/journal-heads.log'];
const KIT_RULES = [
  '.slicekit/graph/',
  '.slicekit/.subagent-*',
  '.slicekit/local.json',
  '!.slicekit/journal/',
  '!.slicekit/journal/*.log',
  '.slicekit/journal/*.lock',
  '!.slicekit/journal-heads.log',
  '.worktrees/',
  'node_modules/',
];

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const lines = (root) => read(root, '.gitignore').split(/\r?\n/);

function withRepo(fn, opts) {
  const repo = makeRepo(opts);
  try {
    return fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

// Whether git ignores `rel`, with the file present so check-ignore sees it as it would on `git add`.
function ignored(root, rel) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  try {
    git(root, ['check-ignore', '--quiet', rel]);
    return true;
  } catch {
    return false;
  }
}

test('init un-ignores the journal heads log after a *.log rule', () => {
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend' });
    const all = lines(root);
    const heads = all.indexOf('!.slicekit/journal-heads.log');
    assert.ok(heads > -1, 'the heads log un-ignore is written');
    assert.ok(heads > all.indexOf('!.slicekit/journal/*.log'), 'after the journal un-ignores');
    assert.ok(heads > all.indexOf('*.log'), 'after the *.log rule');
    assert.equal(ignored(root, HEADS), false);
    assert.equal(ignored(root, JOURNAL_FILE), false);
    assert.equal(ignored(root, JOURNAL_LOCK), true);
    assert.equal(ignored(root, 'build/other.log'), true);
  }, { files: { '.gitignore': 'node_modules\n*.log\n' } });
});

test('init adds the heads log rule once in either spelling', () => {
  // A fresh repository, init run twice: one heads line.
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend' });
    init(root, { name: 'demo', shape: 'backend' });
    assert.equal(lines(root).filter((l) => HEADS_FORMS.includes(l)).length, 1);
    assert.equal(ignored(root, HEADS), false);
  });
  // The rooted spelling already present: no second, unrooted line.
  const rooted = KIT_RULES.map((r) => (r === '!.slicekit/journal-heads.log' ? '!/.slicekit/journal-heads.log' : r));
  withRepo((root) => {
    const before = read(root, '.gitignore');
    const result = init(root, { name: 'demo', shape: 'backend' });
    assert.ok(result.skipped.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), before);
    assert.equal(lines(root).filter((l) => HEADS_FORMS.includes(l)).length, 1);
    assert.ok(!lines(root).includes('!.slicekit/journal-heads.log'));
    assert.equal(ignored(root, HEADS), false);
  }, { files: { '.gitignore': `${rooted.join('\n')}\n` } });
});

test('init appends the un-ignores again when a later *.log rule overrides them', () => {
  withRepo((root) => {
    const result = init(root, { name: 'demo', shape: 'backend' });
    assert.ok(result.updated.includes('.gitignore'));
    const all = lines(root);
    const star = all.lastIndexOf('*.log');
    assert.ok(all.lastIndexOf('!.slicekit/journal/*.log') > star, 'journal un-ignore appended after *.log');
    assert.ok(all.lastIndexOf('!.slicekit/journal-heads.log') > star, 'heads un-ignore appended after *.log');
    assert.equal(ignored(root, HEADS), false);
    assert.equal(ignored(root, JOURNAL_FILE), false);
    assert.equal(ignored(root, JOURNAL_LOCK), true);
    // Now that git honours them, a second init appends nothing.
    const after = read(root, '.gitignore');
    const again = init(root, { name: 'demo', shape: 'backend' });
    assert.ok(again.skipped.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), after);
  }, { files: { '.gitignore': `${KIT_RULES.join('\n')}\n*.log\n` } });
});
