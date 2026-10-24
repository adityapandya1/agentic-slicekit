import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readText, writeText, exists, listFiles } from '../src/fs.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-fs-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('fs » writeText is atomic', () => {
  const file = path.join(dir, 'a', 'b', 'out.txt');
  writeText(file, 'one\r\ntwo\r\n');
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\ntwo\n');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['out.txt']);
  writeText(file, 'again');
  assert.equal(fs.readFileSync(file, 'utf8'), 'again');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['out.txt']);
});

test('fs » readText normalises CRLF', () => {
  const file = path.join(dir, 'crlf.txt');
  fs.writeFileSync(file, 'x\r\ny\r\n');
  assert.equal(readText(file), 'x\ny\n');
});

test('fs » exists and listFiles', () => {
  const root = path.join(dir, 'tree');
  writeText(path.join(root, 'b.md'), '');
  writeText(path.join(root, 'a', 'c.md'), '');
  writeText(path.join(root, 'a', 'd.txt'), '');
  writeText(path.join(root, 'node_modules', 'x', 'e.md'), '');
  writeText(path.join(root, '.git', 'f.md'), '');
  assert.ok(exists(root));
  assert.ok(!exists(path.join(root, 'nope')));
  assert.deepEqual(listFiles(root, { ext: '.md' }), ['a/c.md', 'b.md']);
  assert.deepEqual(listFiles(root), ['a/c.md', 'a/d.txt', 'b.md']);
  assert.deepEqual(listFiles(root, { ignore: ['a'] }), ['.git/f.md', 'b.md', 'node_modules/x/e.md']);
});
