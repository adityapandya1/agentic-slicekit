// REQ-1.1, REQ-5.1: the command line the install layout puts on PATH, whose entry dispatches each subcommand; its help, its usage and its exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_VERSION, ConfigNewerError, defaultConfig, migrateConfig, migrateConfigFile, validateConfig } from '../src/config.js';
import { main, COMMANDS } from '../src/cli/index.js';
import { runCli } from './helpers/run-cli.js';
import { makeRepo } from './helpers/tmp-repo.js';

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

// ---- P5/S-24 (REQ-5.6, D-60): the migration runs before the command, init included ----

// A repository whose config a version 1 kit wrote: today's defaults at configVersion 1, holding repos.
function repoWithConfig(change) {
  const repo = makeRepo({ commits: 1 });
  const file = path.join(repo.root, '.slicekit', 'config.json');
  fs.mkdirSync(path.dirname(file));
  const cfg = { ...defaultConfig({ name: 'demo', shape: 'backend' }), ...change };
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return { ...repo, file };
}

test('init rerun on an older config migrates it first', () => {
  const repo = repoWithConfig({ configVersion: 1, repos: [] });
  try {
    const r = runCli(['init', '--shape', 'backend'], { cwd: repo.root });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /^config: migrated \.slicekit\/config\.json from configVersion 1 to 2$/m);
    assert.ok(r.stderr.split(/\r?\n/).includes('  - removed repos, unread since D-47'), r.stderr);
    const text = fs.readFileSync(repo.file, 'utf8');
    assert.ok(text.includes('\n  "configVersion": 2,\n'), text);
    assert.ok(!('repos' in JSON.parse(text)), text);
  } finally {
    repo.cleanup();
  }
});

test('a version 2 config holding repos is refused naming repos', () => {
  const error = 'repos: removed in configVersion 2; list repositories in .slicekit/workspace.json';
  const cfg = { ...defaultConfig({ name: 'demo', shape: 'backend' }), repos: [] };
  assert.equal(cfg.configVersion, 2);
  assert.deepEqual(validateConfig(cfg), [error]);
  const repo = repoWithConfig({ repos: ['api'] });
  try {
    const before = fs.readFileSync(repo.file);
    const r = runCli(['check'], { cwd: repo.root });
    assert.notEqual(r.code, 0, r.stdout + r.stderr);
    assert.ok(`${r.stdout}${r.stderr}`.includes(error), r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /config: migrated/);
    assert.ok(fs.readFileSync(repo.file).equals(before), 'a refused config was rewritten');
  } finally {
    repo.cleanup();
  }
});

test('migrateConfig copies, names the version read, and leaves a version that is no integer to validateConfig', () => {
  const old = { ...defaultConfig({ name: 'demo', shape: 'backend' }), configVersion: 1, repos: [{ name: 'api' }, 'web'] };
  const { cfg, from, changes } = migrateConfig(old);
  assert.equal(from, 1);
  assert.equal(cfg.configVersion, CONFIG_VERSION);
  assert.ok(!('repos' in cfg));
  assert.deepEqual(old.repos, [{ name: 'api' }, 'web'], 'the config passed in is not changed');
  assert.deepEqual(changes, ['removed repos, unread since D-47', 'repos held api, web; list them in .slicekit/workspace.json']);
  assert.deepEqual(validateConfig(cfg), []);

  const current = defaultConfig({ name: 'demo', shape: 'backend' });
  assert.deepEqual(migrateConfig(current), { cfg: current, from: CONFIG_VERSION, changes: [] });
  for (const bad of ['1', 0, 1.5, null, undefined]) {
    const odd = { ...current, configVersion: bad };
    assert.deepEqual(migrateConfig(odd).changes, []);
    assert.ok(validateConfig(migrateConfig(odd).cfg).includes(`configVersion: must be ${CONFIG_VERSION}`), String(bad));
  }
  assert.throws(() => migrateConfig({ ...current, configVersion: CONFIG_VERSION + 1 }), ConfigNewerError);

  // No config file, or one that is not JSON, is not this function's to report.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-migrate-'));
  try {
    assert.equal(migrateConfigFile(dir), null);
    fs.mkdirSync(path.join(dir, '.slicekit'));
    fs.writeFileSync(path.join(dir, '.slicekit', 'config.json'), '{not json');
    assert.equal(migrateConfigFile(dir), null);
    assert.equal(fs.readFileSync(path.join(dir, '.slicekit', 'config.json'), 'utf8'), '{not json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
