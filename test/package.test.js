import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packProblems } from './helpers/package.js';
import { makeRepo } from './helpers/tmp-repo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const REPO = 'https://github.com/adityapandya1/agentic-slicekit';

// npm and npx are .cmd scripts on Windows, which only a shell runs.
function npm(cmd, args, cwd) {
  const win = process.platform === 'win32';
  const r = spawnSync(win ? `${cmd}.cmd` : cmd, args, { cwd, encoding: 'utf8', shell: win, env: { ...process.env, npm_config_update_notifier: 'false' } });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

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

test('package.json is 0.1.1, links the repository and has no dependencies', () => {
  assert.equal(pkg.version, '0.1.1');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.repository.url, `git+${REPO}.git`);
  assert.equal(pkg.homepage, `${REPO}#readme`);
  assert.equal(pkg.bugs.url, `${REPO}/issues`);
});

test('npm pack ships bin, src, templates and the files npm adds, and nothing else', () => {
  const r = npm('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], root);
  assert.equal(r.code, 0, r.stderr);
  const files = JSON.parse(r.stdout)[0].files.map((f) => f.path.split(path.sep).join('/'));
  assert.deepEqual(packProblems(files), []);
  for (const f of ['package.json', 'README.md', 'LICENSE', 'bin/slicekit.js']) assert.ok(files.includes(f), f);
  assert.ok(files.some((f) => f.startsWith('templates/')));
});

test('a packed file outside bin, src and templates is refused, naming it', () => {
  assert.deepEqual(packProblems(['package.json', 'bin/slicekit.js', 'docs/runbook.md']), ['docs/runbook.md is outside bin, src and templates']);
  assert.deepEqual(packProblems(['package.json']), ['bin/slicekit.js is missing']);
});

test('the packed kit installs into an empty project and runs version, init and check', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-pack-'));
  const repo = makeRepo({ commits: 1 });
  try {
    const packed = npm('npm', ['pack', '--ignore-scripts', '--pack-destination', out], root);
    assert.equal(packed.code, 0, packed.stderr);
    const tarball = path.join(out, `slicekit-${pkg.version}.tgz`);
    assert.ok(fs.existsSync(tarball), packed.stdout);
    fs.writeFileSync(path.join(repo.root, 'package.json'), '{ "name": "demo", "private": true }\n');
    const installed = npm('npm', ['install', '--offline', '--no-audit', '--no-fund', '-D', tarball], repo.root);
    assert.equal(installed.code, 0, installed.stderr);

    const version = npm('npx', ['--no-install', 'slicekit', '--version'], repo.root);
    assert.equal(version.code, 0, version.stderr);
    assert.equal(version.stdout.trim(), pkg.version);

    const init = npm('npx', ['--no-install', 'slicekit', 'init', '--shape', 'backend', '--name', 'demo'], repo.root);
    assert.equal(init.code, 0, init.stderr);
    assert.match(init.stdout, /^hooks run: node node_modules\/slicekit\/bin\/slicekit\.js$/m);

    const check = npm('npx', ['--no-install', 'slicekit', 'check'], repo.root);
    assert.equal(check.code, 0, check.stdout + check.stderr);
    assert.match(check.stdout, /check: 0 findings/);
  } finally {
    repo.cleanup();
    fs.rmSync(out, { recursive: true, force: true });
  }
});
