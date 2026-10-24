import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { main, COMMANDS } from '../src/cli/index.js';
import { runCli } from './helpers/run-cli.js';

test('unknown subcommand exits 2 with usage', () => {
  const r = runCli(['nope'], { cwd: os.tmpdir() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: slicekit <command>/);
  assert.match(r.stderr, /slicekit: unknown command 'nope'/);
});

test('no arguments exits 2 with usage', () => {
  const r = runCli([], { cwd: os.tmpdir() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: slicekit <command>/);
});

test('--version prints package version', () => {
  const r = runCli(['--version'], { cwd: os.tmpdir() });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^0\.0\.1/);
});

test('--help prints usage to stderr and exits 0', () => {
  const r = runCli(['--help'], { cwd: os.tmpdir() });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /^usage: slicekit <command>/);
});

test('main dispatches to a registered command with its args and io', async () => {
  const io = { marker: true };
  let received;
  COMMANDS.tmp = { usage: 'tmp', run: async (args, ioArg) => { received = { args, ioArg }; return 7; } };
  try {
    const code = await main(['tmp', 'a', 'b'], io);
    assert.equal(code, 7);
    assert.deepEqual(received.args, ['a', 'b']);
    assert.equal(received.ioArg, io);
  } finally {
    delete COMMANDS.tmp;
  }
});
