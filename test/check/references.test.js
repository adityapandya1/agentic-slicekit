import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../../src/init.js';
import { check } from '../../src/check/index.js';
import references from '../../src/check/rules/references.js';
import { makeRepo } from '../helpers/tmp-repo.js';
import { loadConfig } from '../../src/config.js';
import { readSlice, writeSlice } from '../../src/state/index.js';
import { renderBuild, MARKER as BUILD_MARKER } from '../../src/state/build.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'check', 'references');

// An init'd repo with the shared base (D-01, REQ-1.1, a heading) and one case's docs on top.
function run(name, setup = () => {}) {
  const repo = makeRepo({ commits: 1 });
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js' });
    fs.cpSync(path.join(FIXTURES, 'base'), repo.root, { recursive: true });
    fs.cpSync(path.join(FIXTURES, name), repo.root, { recursive: true });
    setup(repo.root);
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
    'references docs/spec/02-dead.md:7 missing file docs/spec/01-core.md/',
    'check: 3 findings, 3 over baseline, 0 blocking, 1 rules',
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

test('a target that differs only in case is a finding on every OS', () => {
  const r = run('case');
  assert.deepEqual(r.lines, [
    'references docs/spec/02-case.md:4 missing file ../../notes/Core.md',
    'references docs/spec/02-case.md:4 missing file Notes/core.md',
    'check: 2 findings, 2 over baseline, 0 blocking, 1 rules',
  ]);
});

test('a backslash path is extracted and resolved on every OS', () => {
  const r = run('backslash');
  assert.deepEqual(r.lines, [
    'references docs/spec/02-backslash.md:4 missing file docs\\spec\\gone.md',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});

test('a promise in an unmerged slice file is skipped', () => {
  const r = run('slice-promises');
  assert.deepEqual(r.lines, ['check: 0 findings, 0 over baseline, 0 blocking, 1 rules']);
});

test('a pointer in an unmerged slice file is checked', () => {
  const r = run('slice-pointer');
  assert.deepEqual(r.lines, [
    'references docs/phases/P1-x/S-01-promises.md:30 missing file ../../spec/promised.md',
    'references docs/phases/P1-x/S-01-promises.md:30 missing file src/pointer.js',
    'check: 2 findings, 2 over baseline, 0 blocking, 1 rules',
  ]);
});

test('an unparseable state file is a finding and every path in its slice file is checked', () => {
  const r = run('slice-promises', (root) => {
    fs.mkdirSync(path.join(root, '.slicekit', 'state'), { recursive: true });
    fs.writeFileSync(path.join(root, '.slicekit', 'state', 'P1-S-01.json'), '{ not json');
  });
  const f = 'references docs/phases/P1-x/S-01-promises.md';
  assert.deepEqual(r.lines, [
    `${f}:0 state file .slicekit/state/P1-S-01.json is not valid JSON`,
    `${f}:23 missing file src/promised.js`,
    `${f}:23 missing file test/promised.test.js`,
    `${f}:29 missing file src/also-promised.js`,
    `${f}:29 missing file docs/spec/promised.md`,
    'check: 5 findings, 5 over baseline, 0 blocking, 1 rules',
  ]);
  assert.equal(r.findings[0].bucket, 'docs/phases/P1-x/S-01-promises.md');
});

test('a promise in a merged slice file is checked', () => {
  const r = run('slice-promises', (root) => {
    const cfg = loadConfig(root);
    writeSlice(root, cfg, { ...readSlice(root, cfg, 'P1/S-01'), state: 'merged' });
  });
  const f = 'references docs/phases/P1-x/S-01-promises.md';
  assert.deepEqual(r.lines, [
    `${f}:23 missing file src/promised.js`,
    `${f}:23 missing file test/promised.test.js`,
    `${f}:29 missing file src/also-promised.js`,
    `${f}:29 missing file docs/spec/promised.md`,
    'check: 4 findings, 4 over baseline, 0 blocking, 1 rules',
  ]);
});

// Writes an intake file and, unless `sha` is false, its sidecar (`sha` overrides the true hash).
function intakeFile(root, name, text, { sha, sidecar = `${name}.meta.json` } = {}) {
  const dir = path.join(root, 'docs', 'intake');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
  if (sha === false) return;
  const sum = sha ?? crypto.createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(path.join(dir, sidecar), JSON.stringify({ origin: 'test', sha256: sum }));
}

test('an intake file pinned by its sidecar is frozen and exempt', () => {
  const r = run('base', (root) => {
    intakeFile(root, 'req.md', '# Req\n\nSee `src/gone.js`, [x](gone.md) and REQ-9.9.\n');
    intakeFile(root, 'by-stem.md', '# Stem\n\nSee `src/gone.js`.\n', { sidecar: 'by-stem.meta.json' });
    fs.writeFileSync(path.join(root, 'docs', 'notes.md'), '# Notes\n\nSee `src/gone.js`.\n');
  });
  assert.deepEqual(r.lines, [
    'references docs/notes.md:3 missing file src/gone.js',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});

test('an intake file without a valid sidecar is checked and is itself a finding', () => {
  const r = run('base', (root) => {
    intakeFile(root, 'req.md', '# Req\n\nThe founding text.\n');
    intakeFile(root, 'extra.md', '# Extra\n\nWe delve into [x](gone.md).\n', { sha: false });
    intakeFile(root, 'stale.md', '# Stale\n\nSee `src/gone.js`.\n', { sha: '0'.repeat(64) });
  });
  assert.deepEqual(r.lines, [
    'references docs/intake/extra.md:0 intake file has no valid sidecar',
    'references docs/intake/extra.md:3 missing file gone.md',
    'references docs/intake/stale.md:0 intake file has no valid sidecar',
    'references docs/intake/stale.md:3 missing file src/gone.js',
    'check: 4 findings, 4 over baseline, 0 blocking, 1 rules',
  ]);
});

test('a link resolves against its own directory; a backticked path may also resolve from the root', () => {
  const r = run('base', (root) => {
    fs.writeFileSync(
      path.join(root, 'docs', 'spec', '02-links.md'),
      [
        '# Links', // 1
        '', // 2
        'See [the queue](BUILD.md) and [decisions](decisions.md#x).', // 3
        'Rooted [queue](/BUILD.md) and [up](../decisions.md).', // 4
        'Backticked `docs/decisions.md` resolves from the root.', // 5
      ].join('\n'),
    );
  });
  assert.deepEqual(r.lines, [
    'references docs/spec/02-links.md:3 missing file BUILD.md',
    'references docs/spec/02-links.md:3 missing file decisions.md',
    'check: 2 findings, 2 over baseline, 0 blocking, 1 rules',
  ]);
});

test('a reference-style link definition to a missing file is a finding', () => {
  const r = run('base', (root) => {
    fs.writeFileSync(
      path.join(root, 'docs', 'spec', '02-defs.md'),
      ['# Defs', '', 'Read [core][c] and [gone][g].', '', '[c]: 01-core.md', '[g]: gone.md', '[w]: https://example.com/x.md'].join('\n'),
    );
  });
  assert.deepEqual(r.lines, [
    'references docs/spec/02-defs.md:6 missing file gone.md',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});

test("BUILD.md's generated region: paths are not checked, ids are", () => {
  const r = run('base', (root) => {
    fs.writeFileSync(
      path.join(root, 'BUILD.md'),
      ['# BUILD — the queue', '', '| S-01 | x | `src/gone.js` and REQ-9.9 | A | Todo |', '', BUILD_MARKER, '', 'Tail `src/tail-gone.js`.', ''].join('\n'),
    );
  });
  assert.deepEqual(r.lines, [
    'references BUILD.md:3 unknown id REQ-9.9',
    'references BUILD.md:7 missing file src/tail-gone.js',
    'check: 2 findings, 2 over baseline, 0 blocking, 1 rules',
  ]);
});

test("a dead path in a slice file's done-when is reported on the slice file, not on BUILD.md", () => {
  const r = run('base', (root) => {
    const dir = path.join(root, 'docs', 'phases', 'P1-x');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'S-01-a.md'),
      [
        '---', 'slice: P1/S-01', 'name: A', 'repo: .', 'group: A', 'runbook: no', 'requirements: [REQ-1.1]', 'decisions: []', '---',
        '', '## Done when', '', '1. `src/gone.js` exists.', '', '## Evaluation set', '', '| Test | Kind | Covers |', '|---|---|---|',
        '| `a.test.js » works` | happy | REQ-1.1 |', '',
      ].join('\n'),
    );
    const cfg = loadConfig(root);
    fs.writeFileSync(path.join(root, 'BUILD.md'), renderBuild(root, cfg, fs.readFileSync(path.join(root, 'BUILD.md'), 'utf8')));
    assert.ok(fs.readFileSync(path.join(root, 'BUILD.md'), 'utf8').includes('`src/gone.js` exists'));
  });
  assert.deepEqual(r.lines, [
    'references docs/phases/P1-x/S-01-a.md:13 missing file src/gone.js',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});
