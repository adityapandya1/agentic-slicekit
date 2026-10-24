import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../src/init.js';
import { check } from '../src/check/index.js';
import { readBaselines, updateBaselines } from '../src/baseline.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';

function initRepo() {
  const repo = makeRepo({ commits: 1 });
  init(repo.root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js' });
  return repo;
}

const baselineFile = (root, rule) => path.join(root, '.slicekit', 'baselines', `${rule}.json`);
const ratchetRule = (findings) => ({ id: 'stubratchet', blocking: true, ratchet: true, run: () => findings });
const finding = (file, line) => ({ rule: 'stubratchet', file, line, message: 'm' });

test('update refuses to raise a count', () => {
  const repo = initRepo();
  try {
    const file = baselineFile(repo.root, 'references');
    fs.writeFileSync(file, '{"a.md":1}');
    const before = fs.readFileSync(file, 'utf8');
    const r = updateBaselines(repo.root, { references: { 'a.md': 3 } });
    assert.deepEqual(r.refused, [{ rule: 'references', bucket: 'a.md', from: 1, to: 3 }]);
    assert.deepEqual(r.written, []);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    repo.cleanup();
  }
});

test('baseline update through the CLI touches only ratchet rules and exits 0 with nothing to refuse', () => {
  const repo = initRepo();
  try {
    // No ratchet rule is registered yet, so the CLI has no counts and leaves every file as it is.
    fs.writeFileSync(baselineFile(repo.root, 'references'), '{"a.md":2}');
    const r = runCli(['baseline', 'update'], { cwd: repo.root });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.deepEqual(readBaselines(repo.root).references, { 'a.md': 2 });
    assert.equal(runCli(['baseline'], { cwd: repo.root }).code, 2);
  } finally {
    repo.cleanup();
  }
});

test('count under baseline passes, over fails', () => {
  const repo = initRepo();
  try {
    fs.writeFileSync(baselineFile(repo.root, 'stubratchet'), '{"a.md":2}');
    const under = check(repo.root, { rules: [ratchetRule([finding('a.md', 1)])] });
    assert.equal(under.exitCode, 0);
    const over = check(repo.root, { rules: [ratchetRule([finding('a.md', 1), finding('a.md', 2), finding('a.md', 3)])] });
    assert.equal(over.exitCode, 1);
    assert.deepEqual(over.ratchetCounts, { stubratchet: { 'a.md': 3 } });
  } finally {
    repo.cleanup();
  }
});

test('update lowers and removes buckets', () => {
  const repo = initRepo();
  try {
    const file = baselineFile(repo.root, 'references');
    fs.writeFileSync(file, '{"a.md":2,"b.md":1}');
    const r = updateBaselines(repo.root, { references: { 'a.md': 1, 'c.md': 4 } });
    assert.deepEqual(r.written, [
      { rule: 'references', bucket: 'a.md', from: 2, to: 1 },
      { rule: 'references', bucket: 'b.md', from: 1, to: 0 },
    ]);
    assert.deepEqual(r.refused, [{ rule: 'references', bucket: 'c.md', from: 0, to: 4 }]);
    assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "a.md": 1\n}\n');
  } finally {
    repo.cleanup();
  }
});

test('a damaged baseline file is a blocking finding and reads as zero', () => {
  const repo = initRepo();
  try {
    fs.writeFileSync(baselineFile(repo.root, 'stubratchet'), '{not json');
    assert.deepEqual(readBaselines(repo.root).stubratchet, {});
    const result = check(repo.root, { rules: [ratchetRule([])] });
    assert.equal(result.exitCode, 1);
    assert.ok(result.lines.some((l) => l.includes('baseline stubratchet.json is not valid JSON')), result.lines.join('\n'));
  } finally {
    repo.cleanup();
  }
});

test('show prints the baselines', () => {
  const repo = initRepo();
  try {
    fs.writeFileSync(baselineFile(repo.root, 'references'), '{"a.md":2}');
    const r = runCli(['baseline', 'show'], { cwd: repo.root });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { references: { 'a.md': 2 }, style: {} });
  } finally {
    repo.cleanup();
  }
});
