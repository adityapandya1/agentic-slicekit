import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { check } from '../../src/check/index.js';
import { buildContext } from '../../src/check/context.js';
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

test('runs every rule file and aggregates counts', () => {
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
    assert.match(over.lines.at(-1), /^check: 2 findings, 1 over baseline, 0 blocking$/);
    fs.writeFileSync(file, JSON.stringify({ 'a.md': 2 }));
    const at = check(repo.root, { rules: [rule] });
    assert.equal(at.exitCode, 0);
    assert.equal(at.lines.at(-1), 'check: 2 findings, 0 over baseline, 0 blocking');
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
    assert.match(result.lines.at(-1), /1 blocking$/);
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
      'check: 1 findings, 0 over baseline, 1 blocking',
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
    assert.equal(r.stdout, 'check: 0 findings, 0 over baseline, 0 blocking\n');
    const j = runCli(['check', '--json', '--ci'], { cwd: repo.root });
    assert.equal(j.code, 0, j.stderr);
    assert.deepEqual(JSON.parse(j.stdout), { findings: [], counts: {}, exitCode: 0 });
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
