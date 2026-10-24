import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../../src/init.js';
import { check } from '../../src/check/index.js';
import references from '../../src/check/rules/references.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'check', 'references');

// An init'd repo with the shared base (D-01, REQ-1.1, a heading) and one case's docs on top.
function run(name) {
  const repo = makeRepo({ commits: 1 });
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js' });
    fs.cpSync(path.join(FIXTURES, 'base'), repo.root, { recursive: true });
    fs.cpSync(path.join(FIXTURES, name), repo.root, { recursive: true });
    return check(repo.root, { rules: [references] });
  } finally {
    repo.cleanup();
  }
}

test('references is a blocking ratchet', () => {
  assert.equal(references.id, 'references');
  assert.equal(references.blocking, true);
  assert.equal(references.ratchet, true);
});

test('dead relative link is a finding with line', () => {
  const r = run('dead-link');
  assert.deepEqual(r.lines, [
    'references docs/spec/02-dead.md:3 missing file no-such.md',
    'references docs/spec/02-dead.md:5 missing file docs/spec/gone.md',
    'check: 2 findings, 2 over baseline, 0 blocking, 1 rules',
  ]);
  assert.equal(r.findings[0].bucket, 'docs/spec/02-dead.md');
  assert.equal(r.exitCode, 1);
});

test('missing heading anchor is a finding', () => {
  const r = run('missing-anchor');
  assert.deepEqual(r.lines, [
    'references docs/spec/02-anchor.md:4 missing anchor #no-such-heading in 01-core.md',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});

test('unknown REQ or D id is a finding', () => {
  const r = run('unknown-id');
  assert.deepEqual(r.lines, [
    'references docs/spec/02-ids.md:4 unknown id REQ-9.9',
    'references docs/spec/02-ids.md:4 unknown id D-77',
    'check: 2 findings, 2 over baseline, 0 blocking, 1 rules',
  ]);
});

test('live references are not findings', () => {
  const r = run('live');
  assert.deepEqual(r.lines, ['check: 0 findings, 0 over baseline, 0 blocking, 1 rules']);
  assert.equal(r.exitCode, 0);
});

test('code fences and example lines are skipped', () => {
  const r = run('skipped');
  assert.deepEqual(r.lines, ['check: 0 findings, 0 over baseline, 0 blocking, 1 rules']);
});

test('placeholders, URLs and globs are not paths', () => {
  const r = run('not-paths');
  assert.deepEqual(r.lines, ['check: 0 findings, 0 over baseline, 0 blocking, 1 rules']);
});
