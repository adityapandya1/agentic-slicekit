import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../src/init.js';
import { check } from '../src/check/index.js';
import { baselineCommand } from '../src/cli/baseline.js';
import { readBaselines, readBaselinesWithProblems, updateBaselines } from '../src/baseline.js';
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
    // The references rule counts zero for a.md, so its bucket is lowered; a file for a rule that is
    // not registered is left as it is.
    fs.writeFileSync(baselineFile(repo.root, 'references'), '{"a.md":2}');
    fs.writeFileSync(baselineFile(repo.root, 'unregistered'), '{"b.md":3}');
    const r = runCli(['baseline', 'update'], { cwd: repo.root });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'baseline references a.md: 2 → 0\n');
    assert.equal(readBaselines(repo.root).references?.['a.md'], undefined);
    assert.deepEqual(readBaselines(repo.root).unregistered, { 'b.md': 3 });
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
    assert.ok(result.lines.some((l) => l.includes('.slicekit/baselines/stubratchet.json:0 is not valid JSON')), result.lines.join('\n'));
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

async function cli(args, root, { rules, env = {} } = {}) {
  let stdout = '';
  let stderr = '';
  const code = await baselineCommand.run(args, {
    cwd: root,
    env,
    rules,
    stdout: (x) => { stdout += x; },
    stderr: (x) => { stderr += x; },
  });
  return { code, stdout, stderr };
}

const three = () => [ratchetRule([finding('a.md', 1), finding('a.md', 2), finding('a.md', 3)])];
const read = (root, rule) => fs.readFileSync(baselineFile(root, rule), 'utf8');

test('update without --adopt still refuses (CLI)', async () => {
  const repo = initRepo();
  try {
    fs.writeFileSync(baselineFile(repo.root, 'stubratchet'), '{"a.md":1,"gone.md":2}');
    const r = await cli(['update'], repo.root, { rules: three() });
    assert.equal(r.code, 1);
    assert.equal(r.stdout, 'baseline stubratchet gone.md: 2 → 0\nrefused stubratchet a.md: 1 → 3 (a baseline may only go down)\n');
    assert.equal(read(repo.root, 'stubratchet'), '{\n  "a.md": 1\n}\n');
    const j = await cli(['update', '--json'], repo.root, { rules: three() });
    assert.equal(j.code, 1);
    assert.deepEqual(JSON.parse(j.stdout).refused, [{ rule: 'stubratchet', bucket: 'a.md', from: 1, to: 3 }]);
  } finally {
    repo.cleanup();
  }
});

test('update --adopt records and prints a raise', async () => {
  const repo = initRepo();
  try {
    fs.writeFileSync(baselineFile(repo.root, 'stubratchet'), '{"a.md":1}');
    const r = await cli(['update', '--adopt'], repo.root, { rules: three() });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'adopted stubratchet a.md: 1 → 3\n');
    assert.deepEqual(readBaselines(repo.root).stubratchet, { 'a.md': 3 });
    const fresh = updateBaselines(repo.root, { stubratchet: { 'a.md': 5 } }, { adopt: true });
    assert.deepEqual(fresh.adopted, [{ rule: 'stubratchet', bucket: 'a.md', from: 3, to: 5 }]);
    assert.deepEqual(fresh.refused, []);
    const j = await cli(['update', '--adopt', '--json'], repo.root, { rules: [ratchetRule([finding('b.md', 1)])] });
    assert.equal(j.code, 0);
    assert.deepEqual(JSON.parse(j.stdout).adopted, [{ rule: 'stubratchet', bucket: 'b.md', from: 0, to: 1 }]);
  } finally {
    repo.cleanup();
  }
});

test('--adopt is refused when CI is set', async () => {
  const repo = initRepo();
  try {
    fs.writeFileSync(baselineFile(repo.root, 'stubratchet'), '{"a.md":1}');
    const r = await cli(['update', '--adopt'], repo.root, { rules: three(), env: { CI: 'true' } });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--adopt is not allowed in CI; adopt a baseline from a developer machine and commit it/);
    assert.deepEqual(readBaselines(repo.root).stubratchet, { 'a.md': 1 });
  } finally {
    repo.cleanup();
  }
});

for (const [content, problem] of [['{bad', 'is not valid JSON'], ['[]', 'is not a JSON object of counts']]) {
  test(`a damaged baseline (${content}) is surfaced by update, rewritten by --adopt, shown on stderr`, async () => {
    const repo = initRepo();
    try {
      fs.writeFileSync(baselineFile(repo.root, 'stubratchet'), content);
      const rules = [ratchetRule([finding('a.md', 1)])];
      const u = await cli(['update'], repo.root, { rules });
      assert.equal(u.code, 1);
      assert.ok(u.stdout.includes(`baseline stubratchet.json: ${problem}\n`), u.stdout);
      assert.equal(read(repo.root, 'stubratchet'), content);
      const s = await cli(['show'], repo.root);
      assert.ok(s.stderr.includes(`baseline stubratchet.json: ${problem}`), s.stderr);
      const a = await cli(['update', '--adopt'], repo.root, { rules });
      assert.equal(a.code, 0, a.stdout);
      assert.ok(a.stdout.includes(`rewrote stubratchet.json (was: ${problem})`), a.stdout);
      assert.deepEqual(JSON.parse(read(repo.root, 'stubratchet')), { 'a.md': 1 });
    } finally {
      repo.cleanup();
    }
  });
}

test('invalid values are problems, not silent coercions; zero removal is reported; bad rule ids throw', () => {
  const repo = initRepo();
  try {
    fs.writeFileSync(baselineFile(repo.root, 'stubratchet'), '{"a.md":-1,"b.md":1.5,"c.md":"2","d.md":1}');
    const { baselines, problems } = readBaselinesWithProblems(repo.root);
    assert.deepEqual(baselines.stubratchet, { 'a.md': 0, 'b.md': 0, 'c.md': 0, 'd.md': 1 });
    assert.equal(problems.length, 3);
    assert.equal(problems[0].file, 'stubratchet.json');
    assert.equal(problems[0].problem, 'a.md is not a non-negative integer (read as 0)');
    const r = updateBaselines(repo.root, { stubratchet: {} });
    assert.deepEqual(r.written, [{ rule: 'stubratchet', bucket: 'd.md', from: 1, to: 0 }]);
    assert.throws(() => updateBaselines(repo.root, { '../evil': {} }), /rule id/);
  } finally {
    repo.cleanup();
  }
});
