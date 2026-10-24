import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCli, probeCli } from '../src/hook-cli.js';
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

test('probe order: a local install, then slicekit on PATH, then npx pinned to the kit version', () => {
  const global = fakeGlobal();
  const empty = tmp('slicekit-empty-');

  const local = tmp('slicekit-probe-');
  fakeLocal(local);
  assert.equal(probeCli(local, { version: VERSION, env: envWith(global) }), 'node node_modules/slicekit/bin/slicekit.js');

  const bare = tmp('slicekit-probe-');
  assert.equal(probeCli(bare, { version: VERSION, env: envWith(global) }), 'slicekit');
  assert.equal(probeCli(bare, { version: VERSION, env: envWith(empty) }), `npx --yes slicekit@${VERSION}`);
  assert.equal(probeCli(bare, { version: VERSION, env: {} }), `npx --yes slicekit@${VERSION}`);
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
