// REQ-3.11, D-49: the kit's own test command splits the suite into SLICEKIT_SHARD shards by weight;
// every test file runs whole in exactly one shard, with no module hook and no file split into parts
// (issue #55: the two heaviest files are split into three files each instead).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shard from '../scripts/test-shard.js';

const { WEIGHTS, assign, parseShard, shardPlan, testFiles } = shard;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIX = ['review-1', 'review-2', 'review-3', 'review-loop-1', 'review-loop-2', 'review-loop-3'].map((n) => `test/commands/${n}.test.js`);

test('every test file runs whole in exactly one shard', () => {
  const files = testFiles(ROOT);
  assert.ok(files.includes('test/test-shard.test.js'));
  // No parts: the hook and its table are gone, and the six files take the two old files' weight.
  assert.ok(!('SPLIT' in shard), 'scripts/test-shard.js still exports SPLIT');
  for (const hook of ['test-parts-hook.js', 'test-parts-loader.js', 'test-parts-wrapper.js']) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'scripts', hook)), `scripts/${hook} still exists`);
  }
  for (const old of ['test/commands/review.test.js', 'test/commands/review-loop.test.js']) {
    assert.ok(!files.includes(old), `${old} still exists`);
    assert.ok(!Object.hasOwn(WEIGHTS, old), `WEIGHTS still names ${old}`);
  }
  for (const file of SIX) {
    assert.ok(files.includes(file), `${file} is missing`);
    assert.ok(WEIGHTS[file] > 0, `WEIGHTS does not name ${file}`);
  }
  for (const n of [1, 2, 3, 4, 7]) {
    const shards = assign(files, n);
    assert.equal(shards.length, n);
    const units = shards.flat();
    assert.ok(units.every((u) => u.part === undefined && u.parts === undefined), `n=${n}: a shard was given a file part`);
    assert.deepEqual(units.map((u) => u.file).sort(), [...files].sort(), `n=${n}`);
    // Same input, same plan: every shard computes it alike.
    assert.deepEqual(assign(files, n), shards);
  }
  const three = assign(files, 3);
  for (const plan of three.map(shardPlan)) assert.deepEqual(Object.keys(plan), ['files']);
  const loads = three.map((s) => s.reduce((t, u) => t + u.weight, 0));
  assert.ok(Math.max(...loads) - Math.min(...loads) < 0.1 * Math.max(...loads), loads.join(', '));
});

test('SLICEKIT_SHARD must be k/n with 1 <= k <= n', () => {
  assert.deepEqual(parseShard('2/3'), { k: 2, n: 3 });
  for (const bad of ['', '0/3', '4/3', '1', 'a/b', '1/0']) assert.throws(() => parseShard(bad), /SLICEKIT_SHARD/, bad);
});
