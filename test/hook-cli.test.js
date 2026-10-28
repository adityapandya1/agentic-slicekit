import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCli, NOT_INSTALLED, probeCli } from '../src/hook-cli.js';
import { init } from '../src/init.js';
import { binPath } from './helpers/run-cli.js';

const VERSION = '0.0.1';
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function fakeLocal(root) {
  const file = path.join(root, 'node_modules/slicekit/bin/slicekit.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}

// A directory holding an executable named slicekit, the way a global install leaves one on PATH.
function fakeGlobal() {
  const dir = tmp('slicekit-path-');
  if (process.platform === 'win32') fs.writeFileSync(path.join(dir, 'slicekit.cmd'), '@echo 0.0.1\r\n');
  else fs.writeFileSync(path.join(dir, 'slicekit'), '#!/bin/sh\necho 0.0.1\n', { mode: 0o755 });
  return dir;
}

const envWith = (dir) => ({ PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' });

test('probe order: a local install, then slicekit on PATH, else the PATH form with a warning, never the registry', () => {
  const global = fakeGlobal();
  const empty = tmp('slicekit-empty-');

  const local = tmp('slicekit-probe-');
  fakeLocal(local);
  assert.deepEqual(probeCli(local, { env: envWith(global) }), { cli: 'node node_modules/slicekit/bin/slicekit.js', warning: null });

  const bare = tmp('slicekit-probe-');
  assert.deepEqual(probeCli(bare, { env: envWith(global) }), { cli: 'slicekit', warning: null });
  assert.deepEqual(probeCli(bare, { env: envWith(empty) }), { cli: 'slicekit', warning: NOT_INSTALLED });
  assert.deepEqual(probeCli(bare, { env: {} }), { cli: 'slicekit', warning: NOT_INSTALLED });
  assert.equal(
    NOT_INSTALLED,
    'slicekit is not installed locally or on PATH; hooks will fail until it is (npm i -D slicekit, or set cli in .slicekit/config.json)',
  );
});

test('init with nothing installed records slicekit and returns the not-installed warning once', () => {
  const root = tmp('slicekit-probe-init-');
  const r = init(root, { name: 'demo', shape: 'backend', env: envWith(tmp('slicekit-empty-')) });
  assert.equal(r.cli, 'slicekit');
  assert.equal(r.warnings.filter((w) => w === NOT_INSTALLED).length, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'), /npx/);
});

test('init records the probed cli; --cli wins; an existing config keeps its own', () => {
  const root = tmp('slicekit-probe-init-');
  fakeLocal(root);
  const first = init(root, { name: 'demo', shape: 'backend' });
  assert.equal(first.cli, 'node node_modules/slicekit/bin/slicekit.js');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.slicekit/config.json'), 'utf8')).cli, first.cli);
  assert.equal(init(root, { name: 'demo' }).cli, first.cli);
  assert.equal(init(root, { name: 'demo', cli: first.cli }).cli, first.cli);
  assert.throws(() => init(root, { name: 'demo', cli: 'slicekit' }), /config\.json already sets cli = node node_modules/);

  const chosen = tmp('slicekit-probe-init-');
  fakeLocal(chosen);
  assert.equal(init(chosen, { name: 'demo', shape: 'backend', cli: 'my-slicekit' }).cli, 'my-slicekit');
});

test('checkCli: null when the command prints the kit version, a warning when it fails or differs', () => {
  const cwd = tmp('slicekit-check-');
  const self = `node "${binPath}"`;
  const actual = JSON.parse(fs.readFileSync(path.join(path.dirname(binPath), '..', 'package.json'), 'utf8')).version;
  assert.equal(checkCli(self, { version: actual, cwd }), null);
  const warning = (cli) =>
    `hook command "${cli}" did not answer; hooks will report errors on every tool call until .slicekit/config.json cli is fixed`;
  assert.equal(checkCli(self, { version: '9.9.9', cwd }), warning(self));
  const failing = 'node -e "process.exit(3)"';
  assert.equal(checkCli(failing, { version: actual, cwd }), warning(failing));
});

// S-25 review M-8: when the probe fails, the warning names the likely cause it can see in the command.
test('checkCli names an unquoted path with spaces, and on Windows an MSYS path, as the likely cause', () => {
  const cwd = tmp('slicekit-check-');
  const actual = JSON.parse(fs.readFileSync(path.join(path.dirname(binPath), '..', 'package.json'), 'utf8')).version;
  const spaced = checkCli('node /no such/dir/bin/slicekit.js', { version: actual, cwd, platform: 'linux' });
  assert.match(spaced, /did not answer/);
  assert.match(spaced, /quote a path that has spaces/);
  assert.doesNotMatch(spaced, /pwd -W/);
  const msys = checkCli('node /c/nowhere/bin/slicekit.js', { version: actual, cwd, platform: 'win32' });
  assert.match(msys, /pwd -W/);
  assert.doesNotMatch(msys, /quote a path/);
  // The same path off Windows is a real path: no Windows hint.
  assert.doesNotMatch(checkCli('node /c/nowhere/bin/slicekit.js', { version: actual, cwd, platform: 'linux' }), /pwd -W/);
  // A quoted command gives no spaces hint.
  assert.doesNotMatch(checkCli('node "/no such/bin/slicekit.js"', { version: actual, cwd, platform: 'linux' }), /quote a path/);
});
