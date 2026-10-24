import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { check, loadRules } from '../../src/check/index.js';
import { buildContext } from '../../src/check/context.js';
import os from 'node:os';
import { makeRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/run-cli.js';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function initRepo() {
  const repo = makeRepo({ commits: 1 });
  init(repo.root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js' });
  return repo;
}

const ratchetRule = (findings) => ({
  id: 'stubratchet',
  blocking: true,
  ratchet: true,
  run: () => findings,
});

const blockingRule = (findings) => ({
  id: 'stubblock',
  blocking: true,
  ratchet: false,
  run: () => findings,
});

test('aggregates counts across injected rules and passes them the context', () => {
  const repo = initRepo();
  try {
    let seen;
    const r1 = ratchetRule([
      { rule: 'stubratchet', file: 'a.md', line: 1, message: 'one' },
      { rule: 'stubratchet', file: 'a.md', line: 2, message: 'two' },
      { rule: 'stubratchet', file: 'b.md', line: 3, message: 'three', bucket: 'custom' },
    ]);
    const r2 = { ...blockingRule([]), run: (ctx) => { seen = ctx; return []; } };
    const result = check(repo.root, { rules: [r1, r2] });
    assert.deepEqual(result.counts, { stubratchet: { 'a.md': 2, custom: 1 }, stubblock: {} });
    assert.equal(result.findings.length, 3);
    assert.equal(result.findings[0].bucket, 'a.md');
    assert.equal(result.exitCode, 1);
    assert.ok(seen && seen.root === repo.root && seen.ids.req instanceof Set, 'the rule received the context');
  } finally {
    repo.cleanup();
  }
});

test('exit 1 on over-baseline, 0 at baseline', () => {
  const repo = initRepo();
  try {
    const rule = ratchetRule([
      { rule: 'stubratchet', file: 'a.md', line: 1, message: 'one' },
      { rule: 'stubratchet', file: 'a.md', line: 2, message: 'two' },
    ]);
    const file = path.join(repo.root, '.slicekit', 'baselines', 'stubratchet.json');
    fs.writeFileSync(file, JSON.stringify({ 'a.md': 1 }));
    const over = check(repo.root, { rules: [rule] });
    assert.equal(over.exitCode, 1);
    assert.match(over.lines.at(-1), /^check: 2 findings, 1 over baseline, 0 blocking, 1 rules$/);
    fs.writeFileSync(file, JSON.stringify({ 'a.md': 2 }));
    const at = check(repo.root, { rules: [rule] });
    assert.equal(at.exitCode, 0);
    assert.equal(at.lines.at(-1), 'check: 2 findings, 0 over baseline, 0 blocking, 1 rules');
    assert.equal(at.lines[0], '(baseline) stubratchet a.md:1 one');
  } finally {
    repo.cleanup();
  }
});

test('a crashing rule is a blocking finding', () => {
  const repo = initRepo();
  try {
    const boom = { id: 'boom', blocking: false, ratchet: true, run: () => { throw new Error('kaput'); } };
    const result = check(repo.root, { rules: [boom] });
    assert.equal(result.exitCode, 1);
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0].message, /^rule boom crashed: kaput$/);
    assert.match(result.lines.at(-1), /1 blocking, 1 rules$/);
  } finally {
    repo.cleanup();
  }
});

test('prints findings in the fixed format', () => {
  const repo = initRepo();
  try {
    const result = check(repo.root, {
      rules: [blockingRule([{ rule: 'stubblock', file: 'docs/x.md', line: 7, message: 'broken thing' }])],
    });
    assert.deepEqual(result.lines, [
      'stubblock docs/x.md:7 broken thing',
      'check: 1 findings, 0 over baseline, 1 blocking, 1 rules',
    ]);
    assert.equal(result.exitCode, 1);
  } finally {
    repo.cleanup();
  }
});

test('buildContext collects ids from the kit\'s own docs', () => {
  const cfg = loadConfig(kitRoot);
  const ctx = buildContext(kitRoot, cfg);
  assert.ok(ctx.ids.req.has('REQ-1.1'));
  assert.ok(ctx.ids.decision.has('D-01'));
  assert.ok(ctx.ids.contract.has('C-1'));
  assert.ok(ctx.ids.slice.has('P1/S-01'));
  assert.ok(ctx.ids.phase.has('P1'));
  assert.ok(ctx.docs.some((d) => d.rel === 'docs/spec/03-hooks-gates-ci.md'));
  assert.ok(ctx.docs.some((d) => d.rel === 'BUILD.md'));
  assert.equal(ctx.git.isRepo, true);
});

test('check on an empty init\'d repo exits 0', () => {
  const repo = initRepo();
  try {
    const r = runCli(['check'], { cwd: repo.root });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'check: 0 findings, 0 over baseline, 0 blocking, 0 rules\n');
    const j = runCli(['check', '--json', '--ci'], { cwd: repo.root });
    assert.equal(j.code, 0, j.stderr);
    assert.deepEqual(JSON.parse(j.stdout), { findings: [], counts: {}, exitCode: 0, rules: 0 });
  } finally {
    repo.cleanup();
  }
});

test('check without a config exits 2', () => {
  const repo = makeRepo();
  try {
    const r = runCli(['check'], { cwd: repo.root });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^slicekit: config: cannot read/);
  } finally {
    repo.cleanup();
  }
});

function ruleDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-rules-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

test('runs every rule file and aggregates counts', async () => {
  const repo = initRepo();
  const dir = ruleDir({
    'b-block.js': "export const id = 'blk'; export const blocking = true; export const ratchet = false;\nexport function run() { return [{ file: 'x.md', line: 2, message: 'bad' }]; }\n",
    'a-ratchet.js': "export default { id: 'rat', blocking: true, ratchet: true, run: () => [{ file: 'y.md', line: 1, message: 'old' }] };\n",
    'c-broken.js': 'export const = ;\n',
    'notes.txt': 'not a rule',
  });
  try {
    const rules = await loadRules(dir);
    assert.deepEqual(rules.map((r) => r.id), ['rat', 'blk', 'c-broken']);
    fs.writeFileSync(path.join(repo.root, '.slicekit', 'baselines', 'rat.json'), JSON.stringify({ 'y.md': 1 }));
    const result = check(repo.root, { rules });
    assert.deepEqual(result.counts, { rat: { 'y.md': 1 }, blk: { 'x.md': 1 }, 'c-broken': {} });
    assert.match(result.findings.at(-1).message, /^rule c-broken crashed: import failed: /);
    assert.equal(result.exitCode, 1);
    assert.equal(result.rules, 3);
    assert.match(result.lines.at(-1), /^check: 3 findings, 0 over baseline, 2 blocking, 3 rules$/);
  } finally {
    repo.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing rules directory is a blocking finding; injected [] is not', async () => {
  const repo = initRepo();
  try {
    const missing = path.join(repo.root, 'no-such-rules');
    const rules = await loadRules(missing);
    const result = check(repo.root, { rules });
    assert.equal(result.exitCode, 1);
    assert.equal(result.rules, 0);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].message, `rule loader: rules directory missing at ${missing}`);
    assert.match(result.lines.at(-1), /, 1 blocking, 0 rules$/);
    const none = check(repo.root, { rules: [] });
    assert.equal(none.exitCode, 0);
    assert.equal(none.lines.at(-1), 'check: 0 findings, 0 over baseline, 0 blocking, 0 rules');
  } finally {
    repo.cleanup();
  }
});

test('a rule id defined twice is a blocking finding', async () => {
  const repo = initRepo();
  const body = "export const id = 'dup'; export const blocking = true; export const ratchet = true;\nexport function run() { return []; }\n";
  const dir = ruleDir({ 'a.js': body, 'b.js': body });
  try {
    const result = check(repo.root, { rules: await loadRules(dir) });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.findings.map((f) => f.message), ['rule dup defined twice (a.js, b.js)']);
    assert.match(result.lines.at(-1), /1 blocking, 2 rules$/);
  } finally {
    repo.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every malformed rule shape fails closed', () => {
  const repo = initRepo();
  try {
    const cases = [
      [{ id: 'notarray', blocking: true, ratchet: true, run: () => ({}) }, /^rule notarray crashed: run did not return an array$/],
      [{ id: 'nofile', blocking: true, ratchet: true, run: () => [{ line: 1, message: 'm' }] }, /^rule nofile crashed: finding 0 is not/],
      [{ id: 'norun', blocking: false, ratchet: false }, /^rule norun crashed: not a rule module/],
    ];
    for (const [rule, message] of cases) {
      const result = check(repo.root, { rules: [rule] });
      assert.equal(result.exitCode, 1, rule.id);
      assert.equal(result.findings.length, 1, rule.id);
      assert.match(result.findings[0].message, message);
      assert.deepEqual(result.counts[rule.id], {});
    }
  } finally {
    repo.cleanup();
  }
});

test('an over-baseline bucket prints every finding without the baseline prefix', () => {
  const repo = initRepo();
  try {
    fs.writeFileSync(path.join(repo.root, '.slicekit', 'baselines', 'stubratchet.json'), JSON.stringify({ 'a.md': 1, 'b.md': 1 }));
    const result = check(repo.root, {
      rules: [ratchetRule([
        { file: 'a.md', line: 1, message: 'one' },
        { file: 'a.md', line: 2, message: 'two' },
        { file: 'b.md', line: 3, message: 'three' },
      ])],
    });
    assert.deepEqual(result.lines, [
      'stubratchet a.md:1 one',
      'stubratchet a.md:2 two',
      '(baseline) stubratchet b.md:3 three',
      'check: 3 findings, 1 over baseline, 0 blocking, 1 rules',
    ]);
  } finally {
    repo.cleanup();
  }
});

test('a fractional baseline counts as zero and is reported', () => {
  const repo = initRepo();
  try {
    fs.writeFileSync(path.join(repo.root, '.slicekit', 'baselines', 'stubratchet.json'), JSON.stringify({ 'a.md': 1.5 }));
    const result = check(repo.root, {
      rules: [ratchetRule([{ file: 'a.md', line: 1, message: 'one' }, { file: 'a.md', line: 2, message: 'two' }])],
    });
    assert.equal(result.lines.at(-1), 'check: 3 findings, 2 over baseline, 1 blocking, 1 rules');
    assert.ok(result.lines.includes('baseline .slicekit/baselines/stubratchet.json:0 a.md is not a non-negative integer (read as 0)'));
    assert.equal(result.exitCode, 1);
  } finally {
    repo.cleanup();
  }
});
