// REQ-3.1: hook session-start outside a repository prints {} and exits 0; hook without a name is a usage error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { runCli } from './helpers/run-cli.js';

test('hook <name> reads stdin, prints {} and exits 0', () => {
  const r = runCli(['hook', 'session-start'], { cwd: os.tmpdir(), stdin: '{"session_id":"x"}' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '{}');
});

test('hook without a name exits 2 with usage', () => {
  const r = runCli(['hook'], { cwd: os.tmpdir(), stdin: '' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: slicekit hook <name>/);
});
