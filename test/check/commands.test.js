import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/check/context.js';
import commands from '../../src/check/rules/commands.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const win = process.platform === 'win32';

// An initialised repo whose config declares `cmds`; `fn` gets the root and a function that runs the
// rule with the given PATH (an empty directory by default, so only what a test adds can be found).
function withCommands(cmds, fn) {
  const repo = makeRepo();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-path-'));
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const file = path.join(repo.root, '.slicekit', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    cfg.commands = { test: '', lint: '', build: '', e2e: '', ...cmds };
    fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
    const run = (PATH = empty) => {
      const env = { PATH, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
      return commands.run(buildContext(repo.root, loadConfig(repo.root), { env }));
    };
    return fn({ root: repo.root, run, file, empty });
  } finally {
    repo.cleanup();
    fs.rmSync(empty, { recursive: true, force: true });
  }
}

const fakeTool = (dir, name) => {
  const f = path.join(dir, win ? `${name}.cmd` : name);
  fs.writeFileSync(f, win ? '@echo off\r\n' : '#!/bin/sh\n', { mode: 0o755 });
  return f;
};

test('the rule is blocking and not a ratchet', () => {
  assert.equal(commands.id, 'commands');
  assert.equal(commands.blocking, true);
  assert.equal(commands.ratchet, false);
});

test('empty command is skipped', () => {
  withCommands({ test: '', lint: '   ' }, ({ run }) => assert.deepEqual(run(), []));
});

test('unknown executable is a finding', () => {
  withCommands({ lint: 'no-such-tool-xyz --fix' }, ({ run, file }) => {
    const found = run();
    assert.equal(found.length, 1);
    assert.equal(found[0].file, '.slicekit/config.json');
    assert.equal(found[0].line, fs.readFileSync(file, 'utf8').split('\n').findIndex((l) => l.includes('"lint"')) + 1);
    assert.equal(found[0].message, 'commands.lint: "no-such-tool-xyz" not found on PATH or under node_modules/.bin');
  });
});

test('a command found on PATH passes', () => {
  withCommands({ test: 'mytool run all', build: 'node_modules_free' }, ({ run, empty }) => {
    fakeTool(empty, 'mytool');
    const found = run(empty);
    assert.deepEqual(found.map((f) => f.message), ['commands.build: "node_modules_free" not found on PATH or under node_modules/.bin']);
  });
});

test('a tool under node_modules/.bin passes', () => {
  withCommands({ lint: 'eslint .' }, ({ root, run }) => {
    const bin = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(bin, { recursive: true });
    fakeTool(bin, 'eslint');
    assert.deepEqual(run(), []);
  });
});

test('a relative script path must exist', () => {
  withCommands({ test: './scripts/test.sh', build: 'scripts/build.sh' }, ({ root, run }) => {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'scripts', 'build.sh'), '');
    const found = run();
    assert.equal(found.length, 1);
    assert.match(found[0].message, /^commands\.test: "\.\/scripts\/test\.sh" not found/);
  });
});

test('a quoted first token is resolved', () => {
  withCommands({ test: `"${process.execPath}" --test`, lint: '"C:/nope dir/x/y.exe" --fix' }, ({ run }) => {
    const found = run();
    assert.equal(found.length, 1);
    assert.match(found[0].message, /^commands\.lint: "C:\/nope dir\/x\/y\.exe" not found/);
  });
});

test('the kit\'s own commands resolve', () => {
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` };
  const ctx = buildContext(kitRoot, loadConfig(kitRoot), { env });
  assert.deepEqual(commands.run(ctx), []);
});
