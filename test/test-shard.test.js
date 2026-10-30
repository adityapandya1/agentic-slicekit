// REQ-3.11, D-49: the kit's own test command splits the suite into SLICEKIT_SHARD shards by weight,
// and a split file into parts by top-level test index; every test runs in exactly one shard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SPLIT, assign, parseShard, shardPlan, testFiles } from '../scripts/test-shard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every file part lands in exactly one shard, and the heavy files are split apart', () => {
  const files = testFiles(ROOT);
  assert.ok(files.includes('test/test-shard.test.js'));
  for (const file of Object.keys(SPLIT)) assert.ok(files.includes(file), file);
  for (const n of [1, 2, 3, 4, 7]) {
    const shards = assign(files, n);
    assert.equal(shards.length, n);
    const units = shards.flat().map((u) => `${u.file}#${u.part}`);
    const expected = files.flatMap((f) => Array.from({ length: SPLIT[f] ?? 1 }, (_x, i) => `${f}#${i}`));
    assert.deepEqual([...units].sort(), [...expected].sort(), `n=${n}`);
    // Same input, same plan: every shard computes it alike.
    assert.deepEqual(assign(files, n), shards);
  }
  const three = assign(files, 3).map(shardPlan);
  for (const file of Object.keys(SPLIT)) {
    assert.deepEqual(three.filter((p) => p.files.includes(file)).length, 3, `${file} is spread over the three shards`);
  }
  const loads = assign(files, 3).map((s) => s.reduce((t, u) => t + u.weight, 0));
  assert.ok(Math.max(...loads) - Math.min(...loads) < 0.1 * Math.max(...loads), loads.join(', '));
});

test('SLICEKIT_SHARD must be k/n with 1 <= k <= n', () => {
  assert.deepEqual(parseShard('2/3'), { k: 2, n: 3 });
  for (const bad of ['', '0/3', '4/3', '1', 'a/b', '1/0']) assert.throws(() => parseShard(bad), /SLICEKIT_SHARD/, bad);
});

test('a split file runs only its kept parts; other files run whole', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-parts-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n');
    fs.mkdirSync(path.join(dir, 'test'));
    const body = "import { test } from 'node:test';\nfor (let i = 0; i < 5; i++) test(`t${i}`, async (t) => { await t.test('sub', () => {}); });\n";
    fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), body);
    fs.writeFileSync(path.join(dir, 'test', 'b.test.js'), body);
    const hook = pathToFileURL(path.join(ROOT, 'scripts', 'test-parts-hook.js')).href;
    const ran = (keep) => {
      const env = { ...process.env, SLICEKIT_TEST_PARTS: JSON.stringify({ 'test/a.test.js': { parts: 2, keep } }) };
      delete env.NODE_TEST_CONTEXT;
      const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--import', hook, 'test/a.test.js', 'test/b.test.js'], { cwd: dir, env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      return [...r.stdout.matchAll(/^ok \d+ - (t\d)$/gm)].map((m) => m[1]);
    };
    const whole = ['t0', 't1', 't2', 't3', 't4'];
    assert.deepEqual(ran([0]), ['t0', 't2', 't4', ...whole]);
    assert.deepEqual(ran([1]), ['t1', 't3', ...whole]);
    assert.deepEqual(ran([0, 1]), [...whole, ...whole]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
