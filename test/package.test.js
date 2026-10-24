import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('no dependencies', () => {
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=22');
});

test('the test script runs only *.test.js files', () => {
  assert.equal(pkg.scripts.test, 'node --test "test/**/*.test.js"');
});

test('package metadata', () => {
  assert.equal(pkg.name, 'slicekit');
  assert.equal(pkg.license, 'MIT');
  assert.deepEqual(pkg.bin, { slicekit: 'bin/slicekit.js' });
  assert.deepEqual(pkg.files, ['bin', 'src', 'templates']);
});
