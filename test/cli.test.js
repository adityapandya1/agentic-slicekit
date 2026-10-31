// REQ-1.1, REQ-5.1: the command line the install layout puts on PATH, whose entry dispatches each subcommand; its help, its usage and its exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(r.stdout.trim(), version);
});

// P3/S-35: the help is the answer, so it goes to standard output and `slicekit --help | less` shows it.
test('--help prints the usage on standard output and exits 0', () => {
  const r = runCli(['--help'], { cwd: os.tmpdir() });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^usage: slicekit <command>/);
  assert.match(r.stdout, /\ncommands:\n/);
  assert.equal(r.stderr, '');
});

test('an unknown command prints the usage on standard error and exits 2', () => {
  const r = runCli(['nope'], { cwd: os.tmpdir() });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^usage: slicekit <command>/);
  assert.match(r.stderr, /\ncommands:\n/);
  assert.match(r.stderr, /slicekit: unknown command 'nope'\n$/);
});

// Each line of the commands list is `<name> <syntax>`: no `slicekit ` prefix, no description after it.
test("every usage line begins with its command's name", () => {
  const r = runCli(['--help'], { cwd: os.tmpdir() });
  const lines = r.stdout.split('\n');
  const start = lines.indexOf('commands:');
  assert.ok(start >= 0, r.stdout);
  const end = lines.indexOf('', start);
  const listed = lines.slice(start + 1, end);
  const expected = Object.keys(COMMANDS)
    .sort()
    .flatMap((name) => COMMANDS[name].usage.split('\n').map((l) => ({ name, line: l.trim() })));
  assert.deepEqual(listed, expected.map(({ line }) => `  ${line}`));
  for (const { name, line } of expected) {
    assert.ok(line === name || line.startsWith(`${name} `), `${name}: ${line}`);
    assert.doesNotMatch(line, /^slicekit /, line);
    assert.doesNotMatch(line, /\S {2,}\S/, `a description after the syntax: ${line}`);
  }
  for (const name of Object.keys(COMMANDS)) assert.ok(listed.some((l) => l.startsWith(`  ${name}`)), name);
});

// P3/S-36 (issue #77): `slicekit <command> --help` is the answer too, on standard output.
test("every command's --help prints its usage on standard output and exits 0", () => {
  for (const name of Object.keys(COMMANDS).sort()) {
    const r = runCli([name, '--help'], { cwd: os.tmpdir() });
    const lines = COMMANDS[name].usage.split('\n').map((l) => `  slicekit ${l.trim()}`);
    assert.equal(r.code, 0, `${name}: ${r.stderr}`);
    assert.equal(r.stdout, `usage:\n${lines.join('\n')}\n`, name);
    assert.equal(r.stderr, '', name);
  }
});

test('a --help after -- reaches the command as an argument', async () => {
  const calls = [];
  const out = [];
  COMMANDS.tmp = { usage: 'tmp [--x]', run: async (args) => { calls.push(args); return 3; } };
  try {
    const io = { stdout: (s) => out.push(s), stderr: (s) => out.push(s) };
    assert.equal(await main(['tmp', '--', '--help'], io), 3);
    assert.deepEqual(calls, [['--', '--help']]);
    assert.deepEqual(out, []);
    assert.equal(await main(['tmp', '--help'], io), 0);
    assert.deepEqual(calls, [['--', '--help']], 'the command does not run for its own --help');
    assert.deepEqual(out, ['usage:\n  slicekit tmp [--x]\n']);
  } finally {
    delete COMMANDS.tmp;
  }
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
