import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONFIG_VERSION,
  SHAPES,
  ConfigError,
  compileDestructive,
  defaultConfig,
  validateConfig,
  loadConfig,
  localTestCommand,
} from '../src/config.js';

const base = () => defaultConfig({ name: 'demo', shape: 'backend' });

test('defaultConfig has every key and validates clean', () => {
  const cfg = base();
  assert.equal(cfg.configVersion, CONFIG_VERSION);
  assert.deepEqual(SHAPES, ['backend', 'fullstack', 'data']);
  for (const key of ['name', 'shape', 'docsRoot', 'defaultBranch', 'protectedBranches', 'commands', 'repos', 'gitHost', 'tracker', 'review', 'freezeTests', 'style', 'destructive', 'ci']) {
    assert.ok(key in cfg, key);
  }
  assert.deepEqual(validateConfig(cfg), []);
});

test('rejects unknown shape with the field name', () => {
  const errors = validateConfig({ ...base(), shape: 'mobile' });
  assert.ok(errors.includes('shape: must be one of backend, fullstack, data'));
});

test('empty command strings are valid', () => {
  const cfg = { ...base(), commands: { test: '', lint: '', build: '', e2e: '' } };
  assert.deepEqual(validateConfig(cfg), []);
});

test('rejects non-string command', () => {
  const cfg = { ...base(), commands: { ...base().commands, test: 3 } };
  assert.ok(validateConfig(cfg).includes('commands.test: must be a string'));
});

test('defaultConfig seeds banned phrases from templates/style.json', () => {
  assert.ok(base().style.banned.includes('minting at the gate'));
});

test('default destructive patterns match their commands and spare benign ones', () => {
  const patterns = base().destructive.map((p) => new RegExp(p));
  assert.equal(patterns.length, 4);
  const blocked = [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf ..',
    'DROP TABLE x',
    'DROP DATABASE y',
    'TRUNCATE TABLE users',
    'git reset --hard origin/main',
  ];
  for (const cmd of blocked) assert.ok(patterns.some((re) => re.test(cmd)), `should match: ${cmd}`);
  for (const cmd of ['rm -rf ./build', 'git push origin slice/x', 'git reset --soft HEAD~1', 'truncate long titles']) {
    assert.ok(!patterns.some((re) => re.test(cmd)), `should not match: ${cmd}`);
  }
});

test('compileDestructive matches case-insensitively', () => {
  const patterns = compileDestructive(base());
  assert.equal(patterns.length, 4);
  assert.ok(patterns.every((re) => re instanceof RegExp && re.flags.includes('i')));
  assert.ok(patterns.some((re) => re.test('drop database y')));
  assert.ok(patterns.some((re) => re.test('Truncate table users')));
  assert.ok(!patterns.some((re) => re.test('git push origin slice/x')));
});

test('docsRoot must be a clean relative path', () => {
  const rejected = {
    '../outside': 'docsRoot: no .. segment',
    'a/../b': 'docsRoot: no .. segment',
    'C:/Temp/x': 'docsRoot: must be relative',
    '/abs': 'docsRoot: must be relative',
    'docs/': 'docsRoot: no trailing slash',
    'a\\b': 'docsRoot: use forward slashes',
    '': 'docsRoot: must be a non-empty string',
  };
  for (const [docsRoot, message] of Object.entries(rejected)) {
    assert.ok(validateConfig({ ...base(), docsRoot }).includes(message), `${docsRoot}: ${message}`);
  }
  for (const docsRoot of ['docs', 'handbook/specs']) assert.deepEqual(validateConfig({ ...base(), docsRoot }), [], docsRoot);
  assert.equal(defaultConfig({ name: 'demo', shape: 'backend', docsRoot: 'docs/' }).docsRoot, 'docs/');
});

test('branch names must not look like options', () => {
  assert.ok(validateConfig({ ...base(), defaultBranch: '-x' }).includes('defaultBranch: must be a branch name'));
  assert.ok(validateConfig({ ...base(), protectedBranches: ['main', '--force'] }).includes('protectedBranches[1]: must be a branch name'));
  assert.ok(validateConfig({ ...base(), defaultBranch: 'a b' }).includes('defaultBranch: must be a branch name'));
  const ok = { ...base(), defaultBranch: 'release/1.x', protectedBranches: ['main', 'release/1.x', 'dev_2'] };
  assert.deepEqual(validateConfig(ok), []);
});

test('rejects unknown command keys', () => {
  const cfg = { ...base(), commands: { ...base().commands, tests: 'npm test' } };
  assert.ok(validateConfig(cfg).includes('commands.tests: unknown command; use test, lint, build, e2e'));
});

test('review.independent is required or optional', () => {
  assert.deepEqual(validateConfig({ ...base(), review: { independent: 'optional' } }), []);
  assert.ok(validateConfig({ ...base(), review: { independent: 'sometimes' } }).includes('review.independent: must be required or optional'));
  assert.ok(validateConfig({ ...base(), review: {} }).includes('review.independent: must be required or optional'));
});

test('loadConfig throws ConfigError when file missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-cfg-'));
  assert.throws(() => loadConfig(root), (e) => e instanceof ConfigError && e.errors.length === 1 && e.message === e.errors.join('; '));
});

test('loadConfig returns a valid config and throws on an invalid one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-cfg-'));
  fs.mkdirSync(path.join(root, '.slicekit'));
  const file = path.join(root, '.slicekit', 'config.json');
  fs.writeFileSync(file, JSON.stringify(base()));
  assert.deepEqual(loadConfig(root), base());
  fs.writeFileSync(file, JSON.stringify({ ...base(), shape: 'mobile' }));
  assert.throws(() => loadConfig(root), (e) => e instanceof ConfigError && e.errors.includes('shape: must be one of backend, fullstack, data'));
  fs.writeFileSync(file, '{not json');
  assert.throws(() => loadConfig(root), ConfigError);
});

test('cli is a non-empty string, default slicekit', () => {
  const cfg = base();
  assert.equal(cfg.cli, 'slicekit');
  assert.deepEqual(validateConfig({ ...cfg, cli: '' }), ['cli: must be a non-empty string']);
  assert.deepEqual(validateConfig({ ...cfg, cli: 3 }), ['cli: must be a non-empty string']);
});

// D-37: the bots whose pull requests skip the title and body rules.
test('ci.botActors defaults to dependabot and renovate and is validated', () => {
  assert.deepEqual(base().ci.botActors, ['dependabot[bot]', 'renovate[bot]']);
  const withBots = (botActors) => validateConfig({ ...base(), ci: { ...base().ci, botActors } });
  assert.deepEqual(withBots([]), []);
  assert.deepEqual(withBots(['my-bot[bot]']), []);
  const { botActors, ...absent } = base().ci;
  assert.deepEqual(validateConfig({ ...base(), ci: absent }), [], 'absent reads as the default');
  for (const bad of ['dependabot[bot]', [''], [1], ['a', ' ']]) {
    assert.ok(withBots(bad).includes('ci.botActors: must be an array of non-empty strings'), JSON.stringify(bad));
  }
});

// A git attribute pattern cannot hold a space, so the intake rule could not be written for it.
test('a docsRoot with whitespace is refused', () => {
  for (const docsRoot of ['my docs', 'docs\tx']) {
    assert.ok(validateConfig({ ...base(), docsRoot }).includes('docsRoot must not contain spaces (git attribute patterns cannot hold them)'), docsRoot);
  }
});

// P2/S-29 review H-2 (D-43): .slicekit/local.json is never read when CI is set.
test('the local test command is read outside CI only, and a malformed file is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-local-'));
  try {
    assert.equal(localTestCommand(root, {}), null);
    fs.mkdirSync(path.join(root, '.slicekit'));
    const file = path.join(root, '.slicekit', 'local.json');
    fs.writeFileSync(file, JSON.stringify({ testCommand: 'node --test --test-concurrency=2' }));
    assert.equal(localTestCommand(root, {}), 'node --test --test-concurrency=2');
    assert.equal(localTestCommand(root, { CI: 'true' }), null);
    assert.equal(localTestCommand(root, { CI: '1' }), null);
    fs.writeFileSync(file, JSON.stringify({}));
    assert.equal(localTestCommand(root, {}), null);
    for (const [text, why] of [['{', 'is not valid JSON'], ['[]', 'must be a JSON object'], ['{"testCommand": " "}', 'testCommand must be a non-empty string']]) {
      fs.writeFileSync(file, text);
      assert.throws(() => localTestCommand(root, {}), (e) => e instanceof ConfigError && e.message.includes(why), text);
      assert.equal(localTestCommand(root, { CI: 'true' }), null, text);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// D-46, REQ-4.3: testFiles is optional and each entry must compile as a regular expression.
test('testFiles is optional, and an entry that is not a regular expression is refused by index', () => {
  const cfg = base();
  assert.ok(!('testFiles' in cfg), 'defaultConfig does not add testFiles');
  assert.deepEqual(validateConfig({ ...cfg, testFiles: ['\.spec\.ts$'] }), []);
  const errors = validateConfig({ ...cfg, testFiles: ['ok$', '('] });
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.ok(errors[0].startsWith('testFiles[1]: '), errors[0]);
  assert.ok(validateConfig({ ...cfg, testFiles: ['('] })[0].startsWith('testFiles[0]: '));
  assert.deepEqual(validateConfig({ ...cfg, testFiles: 'x' }), ['testFiles: must be an array of strings']);
});
