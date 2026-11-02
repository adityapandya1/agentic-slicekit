// REQ-1.6: BUILD.md is rendered from the slice and state files by status --write, keeping the tail below the marker.
// REQ-2.6: build commit commits only the staged paths when some are staged, and a deletion staged with git rm (P4/S-45).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../src/init.js';
import { loadConfig } from '../src/config.js';
import { setState } from '../src/state/index.js';
import { renderBuild, generatedRegion, MARKER } from '../src/state/build.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';
import { git } from '../src/git.js';
import { GREEN, building, commitWorkCli, write } from './helpers/build-flow.js';
import { writeSliceFixture, writeSliceFixtures } from './helpers/slice-fixture.js';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PHASE_FILE = `# Phase 1 — Spine: implementation plan

Intro.

## Order

Group A first, then B.

## Later

Not copied.
`;

function withKit(fn, { slices = 3 } = {}) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const ids = writeSliceFixtures(repo.root, slices);
    fs.writeFileSync(path.join(repo.root, 'docs', 'phases', 'P1-x', 'P1.md'), PHASE_FILE);
    return fn(repo.root, loadConfig(repo.root), ids);
  } finally {
    repo.cleanup();
  }
}

const PR = { number: 14, url: 'http://x/14', headSha: 'abc1234', title: '[P1/S-02] x' };

test('renderBuild lists phases and slices from files and state', () => {
  withKit((root, cfg, ids) => {
    setState(root, cfg, ids[1], 'draft-pr', { backfill: true, testExit: 0, checkExit: 0, pr: PR });
    setState(root, cfg, ids[2], 'merged', { backfill: true, source: 'host', pr: { ...PR, number: 15 }, mergedAt: '2026-10-24T00:00:00Z' });
    const out = renderBuild(root, cfg, '');
    assert.match(out, /^# BUILD — the queue\n/);
    assert.ok(out.includes('Spec: `docs/spec/`.'), out);
    assert.ok(!out.includes('{{'), out);
    assert.ok(out.includes('## Phase 1 — Spine\n'), out);
    assert.ok(out.includes('| Slice | Name | Done when | Group | Status |'), out);
    assert.ok(out.includes('| S-01 | Fixture 1 | It works | B | Todo |'), out);
    assert.ok(out.includes('| S-02 | Fixture 2 | It works | B | PR #14 |'), out);
    assert.ok(out.includes('| S-03 | Fixture 3 | It works | B | Done |'), out);
    assert.ok(out.includes('Group A first, then B.'), out);
    assert.ok(!out.includes('Not copied.'), out);
    assert.ok(out.trimEnd().endsWith(MARKER), out);
  });
});

test('renderBuild shows an in-progress slice and joins Done when items', () => {
  withKit((root, cfg, ids) => {
    const file = path.join(root, 'docs', 'phases', 'P1-x', 'S-01-a.md');
    const text = fs.readFileSync(file, 'utf8').replace('1. It works.', '1. It works.\n2. It has a | pipe.');
    fs.writeFileSync(file, text);
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    setState(root, cfg, ids[0], 'tests-red', { commit: 'c1c1c1c', testExit: 1, tests: ['a.test.js'] });
    const out = renderBuild(root, cfg, '');
    assert.ok(out.includes('| S-01 | Fixture 1 | It works; It has a \\| pipe | B | Todo (in progress) |'), out);
  }, { slices: 1 });
});

test('renderBuild keeps everything below the marker verbatim', () => {
  withKit((root, cfg) => {
    const tail = '\n## Notes\n\nHand-written | kept.\n';
    const existing = `# old\n\nstale\n${MARKER}\n${tail}`;
    const out = renderBuild(root, cfg, existing);
    assert.ok(out.endsWith(`${MARKER}\n${tail}`), out);
    assert.ok(!out.includes('stale'), out);
    assert.equal(renderBuild(root, cfg, out), out);
  }, { slices: 1 });
});

test('renderBuild migrates a hand-written BUILD.md with no marker', () => {
  withKit((root, cfg) => {
    const existing = [
      '# BUILD — the queue',
      '',
      'Old preamble.',
      '',
      '## Phase 1 — Spine',
      '',
      '| Slice | Name | Done when | Group | Status |',
      '|---|---|---|---|---|',
      '| S-01 | Old | old | A | Todo |',
      '',
      '## Phase 2 — Loop',
      '',
      'Loop intro.',
      '',
      '| S-09 | x | y | A | Todo |',
      '',
      '## Phase 3 — Trace',
      '',
      'Trace text.',
      '',
    ].join('\n');
    const out = renderBuild(root, cfg, existing);
    const { generated, tail } = generatedRegion(out);
    assert.ok(!generated.includes('Old preamble.'), generated);
    assert.ok(!generated.includes('| S-01 | Old |'), generated);
    assert.ok(generated.includes('| S-01 | Fixture 1 |'), generated);
    assert.ok(!tail.includes('## Phase 1'), tail);
    assert.ok(!tail.includes('Old preamble.'), tail);
    assert.ok(tail.includes('## Phase 2 — Loop\n\nLoop intro.\n\n| S-09 | x | y | A | Todo |'), tail);
    assert.ok(tail.includes('## Phase 3 — Trace\n\nTrace text.'), tail);
    assert.equal(out.split('## Phase 1 — Spine').length, 2, out);
    assert.equal(renderBuild(root, cfg, out), out);
  }, { slices: 1 });
});

test('a phase that gains a phase file leaves the tail once', () => {
  withKit((root, cfg) => {
    const existing = `${renderBuild(root, cfg, '')}\n## Phase 2 — Loop\n\nHand-written loop.\n\n## Notes\n\nKept.\n`;
    assert.ok(existing.includes(`${MARKER}\n\n## Phase 2 — Loop`), existing);
    writeSliceFixture(root, { phase: 2, n: 9 });
    fs.writeFileSync(path.join(root, 'docs', 'phases', 'P2-x', 'P2.md'), '# Phase 2 — Loop\n');
    const out = renderBuild(root, cfg, existing);
    assert.equal(out.match(/^## Phase 2\b/gm).length, 1, out);
    assert.ok(!out.includes('Hand-written loop.'), out);
    assert.ok(out.indexOf('## Phase 2 — Loop') < out.indexOf(MARKER), out);
    assert.ok(out.includes('| S-09 | Fixture 9 |'), out);
    assert.ok(out.endsWith(`${MARKER}\n\n## Notes\n\nKept.\n`), out);
    assert.equal(renderBuild(root, cfg, out), out);
  }, { slices: 1 });
});

test('status --write --json writes BUILD.md and emits the JSON', () => {
  withKit((root) => {
    const r = runCli(['status', '--write', '--json'], { cwd: root });
    assert.equal(r.code, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.equal(data.build, 'updated');
    assert.equal(data.slices[0].id, 'P1/S-01');
    assert.equal(typeof data.stage.stage, 'string');
    assert.ok(fs.readFileSync(path.join(root, 'BUILD.md'), 'utf8').includes('| S-01 | Fixture 1 |'));
    assert.equal(JSON.parse(runCli(['status', '--write', '--json'], { cwd: root }).stdout).build, 'unchanged');
  }, { slices: 1 });
});

test('generatedRegion splits at the marker', () => {
  assert.deepEqual(generatedRegion(`a\n${MARKER}\nb\n`), { generated: 'a\n', tail: 'b\n' });
  assert.deepEqual(generatedRegion('no marker\n'), { generated: 'no marker\n', tail: null });
});

test('status prints one line per slice and --json the stage and slices', () => {
  withKit((root, cfg, ids) => {
    setState(root, cfg, ids[1], 'draft-pr', { backfill: true, testExit: 0, checkExit: 0, pr: PR });
    const text = runCli(['status'], { cwd: root });
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout, 'P1/S-01  todo  PR -  Fixture 1\nP1/S-02  draft-pr  PR #14  Fixture 2\n');
    const json = runCli(['status', '--json'], { cwd: root });
    assert.equal(json.code, 0, json.stderr);
    const data = JSON.parse(json.stdout);
    assert.equal(typeof data.stage.stage, 'string');
    assert.deepEqual(data.slices[1], { id: 'P1/S-02', state: 'draft-pr', pr: 14, name: 'Fixture 2', phase: 'P1' });
    assert.equal(data.slices[0].pr, null);
  }, { slices: 2 });
});

test('status --write writes BUILD.md once, then reports it unchanged', () => {
  withKit((root) => {
    const first = runCli(['status', '--write'], { cwd: root });
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stdout, 'BUILD.md updated\n');
    const text = fs.readFileSync(path.join(root, 'BUILD.md'), 'utf8');
    assert.ok(text.includes('| S-01 | Fixture 1 |'), text);
    const second = runCli(['status', '--write'], { cwd: root });
    assert.equal(second.stdout, 'BUILD.md unchanged\n');
  }, { slices: 1 });
});

test('a Done when item ending in an ellipsis keeps it', () => {
  withKit((root, cfg) => {
    const file = path.join(root, 'docs', 'phases', 'P1-x', 'S-01-a.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('1. It works.', '1. It works...\n2. It ends.'));
    const out = renderBuild(root, cfg, '');
    assert.ok(out.includes('| S-01 | Fixture 1 | It works...; It ends | B | Todo |'), out);
  }, { slices: 1 });
});

test('a bare ## Phase 2 heading in the tail is pruned once phase 2 is generated', () => {
  withKit((root, cfg) => {
    const existing = `${renderBuild(root, cfg, '')}\n## Phase 2\n\nHand-written loop.\n\n## Notes\n\nKept.\n`;
    writeSliceFixture(root, { phase: 2, n: 9 });
    fs.writeFileSync(path.join(root, 'docs', 'phases', 'P2-x', 'P2.md'), '# Phase 2 — Loop\n');
    const out = renderBuild(root, cfg, existing);
    assert.ok(!out.includes('Hand-written loop.'), out);
    assert.ok(out.endsWith(`${MARKER}\n\n## Notes\n\nKept.\n`), out);
  }, { slices: 1 });
});

test('a phase directory with slices but no phase file renders from the directory name, with a warning', () => {
  withKit((root, cfg) => {
    writeSliceFixture(root, { phase: 2, n: 9 });
    const warnings = [];
    const out = renderBuild(root, cfg, '', { onWarning: (w) => warnings.push(w) });
    assert.ok(out.includes('## Phase 2 — x\n'), out);
    assert.ok(out.includes('| S-09 | Fixture 9 |'), out);
    assert.ok(out.indexOf('## Phase 1 — Spine') < out.indexOf('## Phase 2 — x'), out);
    assert.ok(out.indexOf('## Phase 2 — x') < out.indexOf(MARKER), out);
    assert.deepEqual(warnings, ['phase P2 has no phase file; heading taken from the directory']);
    const r = runCli(['status', '--write'], { cwd: root });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'BUILD.md updated\n');
    assert.equal(r.stderr, 'slicekit: phase P2 has no phase file; heading taken from the directory\n');
    const json = JSON.parse(runCli(['status', '--write', '--json'], { cwd: root }).stdout);
    assert.deepEqual(json.warnings, ['phase P2 has no phase file; heading taken from the directory']);
  }, { slices: 1 });
});

test('a zero-padded phase directory keeps its slices under its phase', () => {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    writeSliceFixture(repo.root, { n: 1 });
    const from = path.join(repo.root, 'docs', 'phases', 'P1-x');
    const to = path.join(repo.root, 'docs', 'phases', 'P01-spine');
    fs.renameSync(from, to);
    fs.writeFileSync(path.join(to, 'P1.md'), PHASE_FILE);
    const warnings = [];
    const out = renderBuild(repo.root, loadConfig(repo.root), '', { onWarning: (w) => warnings.push(w) });
    assert.ok(out.includes('## Phase 1 — Spine\n'), out);
    assert.ok(out.includes('| S-01 | Fixture 1 |'), out);
    assert.deepEqual(warnings, []);
  } finally {
    repo.cleanup();
  }
});

test('status without a config exits 2', () => {
  const repo = makeRepo();
  try {
    const r = runCli(['status'], { cwd: repo.root });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /config/);
  } finally {
    repo.cleanup();
  }
});

test("status --write regenerates the kit's own BUILD.md", () => {
  const r = runCli(['status', '--write'], { cwd: kitRoot });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'BUILD.md unchanged\n', 'the committed BUILD.md is stale; the rewrite left in the tree is the fix');
  const text = fs.readFileSync(path.join(kitRoot, 'BUILD.md'), 'utf8');
  assert.ok(text.includes('## Phase 1 — Spine'), text);
  assert.match(text, /^\| S-01 \|.*\| Done \|$/m);
  assert.ok(text.includes(MARKER), text);
  // Every phase has slice files now, so every phase is generated and nothing below the marker is a phase.
  for (const phase of ['## Phase 2 — Loop', '## Phase 3 — Trace', '## Phase 4 — Hardening', '## Phase 5 — Ops']) {
    assert.ok(text.includes(phase) && text.indexOf(phase) < text.indexOf(MARKER), phase);
  }
  assert.doesNotMatch(text.slice(text.indexOf(MARKER)), /^## Phase /m);
});

test('a done-when example marker does not reach the rendered row', () => {
  withKit((root, cfg, ids) => {
    const file = path.join(root, 'docs', 'phases', 'P1-x', 'S-01-a.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('1. It works.', '1. It works. <!-- slicekit:example -->'));
    const out = renderBuild(root, cfg, '');
    assert.ok(out.includes('| S-01 | Fixture 1 | It works | B | Todo |'), out);
    assert.ok(!out.includes('slicekit:example'), out);
  }, { slices: 1 });
});

test('a done-when pending marker does not reach the rendered row', () => {
  withKit((root, cfg) => {
    const file = path.join(root, 'docs', 'phases', 'P1-x', 'S-01-a.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('1. It works.', '1. It works. <!-- slicekit:pending P1/S-08 -->'));
    const out = renderBuild(root, cfg, '');
    assert.ok(out.includes('| S-01 | Fixture 1 | It works | B | Todo |'), out);
    assert.ok(!out.includes('slicekit:pending'), out);
  }, { slices: 1 });
});

// The paths and statuses of commit `rev`, as `git diff-tree --name-status` prints them.
const committedFiles = (wt, rev) =>
  git(wt, ['diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', rev])
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => l.replace('\t', ' '));

test('build commit with staged paths commits only those paths', async () => {
  const p = await building();
  try {
    write(p.wt, 'src/t1.js', GREEN);
    write(p.wt, 'notes.txt', 'not part of this commit\n');
    git(p.wt, ['add', '--', 'src/t1.js']);
    const r = await commitWorkCli(p, '--message', 'feat(P1/S-01): x');
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(committedFiles(p.wt, 'HEAD'), ['A src/t1.js']);
    // The unstaged path is left as it was: on disk, untracked, not staged.
    assert.equal(fs.readFileSync(path.join(p.wt, 'notes.txt'), 'utf8'), 'not part of this commit\n');
    assert.equal(git(p.wt, ['status', '--porcelain', '--', 'notes.txt']), '?? notes.txt');
  } finally {
    p.cleanup();
  }
});

test('build commit commits a deletion staged with git rm', async () => {
  const p = await building();
  try {
    write(p.wt, 'src/t1.js', GREEN);
    write(p.wt, 'src/old.js', 'export const old = 1;\n');
    const first = await commitWorkCli(p, '--message', 'feat(P1/S-01): x');
    assert.equal(first.code, 0, first.stderr);
    git(p.wt, ['rm', '-q', '--', 'src/old.js']);
    const r = await commitWorkCli(p, '--message', 'chore(P1/S-01): drop old');
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stderr.includes('did not match'), r.stderr);
    assert.deepEqual(committedFiles(p.wt, 'HEAD'), ['D src/old.js']);
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
  } finally {
    p.cleanup();
  }
});
