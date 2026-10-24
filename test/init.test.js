import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../src/init.js';
import { ConfigError, validateConfig } from '../src/config.js';
import { git } from '../src/git.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const isDir = (root, rel) => fs.statSync(path.join(root, rel)).isDirectory();

function withRepo(fn, opts) {
  const repo = makeRepo(opts);
  try {
    return fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

test('creates the layout for shape backend', () => {
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend' });
    const files = [
      '.slicekit/config.json',
      '.slicekit/baselines/references.json',
      '.slicekit/baselines/style.json',
      'docs/decisions.md',
      'docs/spec/00-overview.md',
      'docs/spec/gaps.md',
      'docs/spec/stack.md',
      'docs/platform.md',
      'docs/observability.md',
      'docs/runbook.md',
      'BUILD.md',
    ];
    for (const rel of files) assert.ok(fs.statSync(path.join(root, rel)).isFile(), rel);
    const dirs = [
      '.slicekit/state',
      'docs/intake',
      'docs/spec/contracts',
      'docs/phases',
      'docs/releases',
      '.githooks',
    ];
    for (const rel of dirs) assert.ok(isDir(root, rel), rel);
    assert.deepEqual(JSON.parse(read(root, '.slicekit/baselines/references.json')), {});
    assert.deepEqual(JSON.parse(read(root, '.slicekit/baselines/style.json')), {});
    const cfg = JSON.parse(read(root, '.slicekit/config.json'));
    assert.deepEqual(validateConfig(cfg), []);
    assert.equal(cfg.name, 'demo');
    assert.equal(cfg.shape, 'backend');
    assert.equal(fs.existsSync(path.join(root, '.slicekit/journal.log')), false);
    assert.match(read(root, 'docs/runbook.md'), /^# Runbook: demo$/m);
    assert.match(read(root, 'BUILD.md'), /Spec: `docs\/spec\/`/);
  });
});

test('creates platform, observability and runbook with "Not yet known" sections', () => {
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend' });
    const expected = {
      'docs/platform.md': [
        'Providers and services',
        'Environments',
        'How a change reaches each environment',
        'Access and ownership',
        'Secrets',
        'Network boundaries',
      ],
      'docs/observability.md': [
        'Dashboards',
        'Alert routes',
        'Log shape and required fields',
        'Trace and correlation IDs',
        'CI steps the monitoring setup requires',
        'On-call contact',
      ],
      'docs/runbook.md': [
        'How to run it',
        'Dependencies and their owners',
        'Known failure modes and the first thing to check',
        'Actions and who may take them',
        'Rollback',
      ],
    };
    for (const [rel, headings] of Object.entries(expected)) {
      const text = read(root, rel);
      for (const heading of headings) {
        assert.ok(text.includes(`## ${heading}\n\nNot yet known\n`), `${rel}: ${heading}`);
      }
    }
  });
});

test('second run skips everything and overwrites nothing', () => {
  withRepo((root) => {
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs/README.md'), 'X');
    const opts = { name: 'demo', shape: 'backend' };
    const first = init(root, opts);
    fs.writeFileSync(path.join(root, 'docs/platform.md'), 'edited');
    const second = init(root, opts);
    assert.equal(read(root, 'docs/README.md'), 'X');
    assert.equal(read(root, 'docs/platform.md'), 'edited');
    assert.deepEqual(second.created, []);
    assert.deepEqual(second.skipped, first.created);
    assert.ok(first.created.includes('docs/platform.md'));
    assert.deepEqual(first.created, [...first.created].sort());
  });
});

test('init on a repo with no commits', () => {
  withRepo((root) => {
    const result = init(root, { name: 'demo', shape: 'fullstack' });
    assert.equal(git(root, ['config', 'core.hooksPath']), '.githooks');
    assert.equal(result.warnings, undefined);
  }, { commits: 0 });
});

test('init outside a git repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-plain-'));
  try {
    const r = runCli(['init', '--shape', 'data', '--name', 'demo'], { cwd: root });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /not a git repository; git hooks were not configured/);
    assert.match(r.stdout, /^created \.slicekit\/config\.json$/m);
    assert.equal(fs.existsSync(path.join(root, '.git')), false);
    const direct = init(root, { name: 'demo', shape: 'data' });
    assert.deepEqual(direct.warnings, ['not a git repository; git hooks were not configured']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writes gitignore rule once', () => {
  withRepo((root) => {
    const opts = { name: 'demo', shape: 'backend' };
    const first = init(root, opts);
    assert.ok(first.created.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), '.slicekit/graph/\n');
    const second = init(root, opts);
    assert.ok(second.skipped.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), '.slicekit/graph/\n');
  });
  withRepo((root) => {
    const result = init(root, { name: 'demo', shape: 'backend' });
    assert.ok(result.skipped.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), 'node_modules\n.slicekit/graph/\n');
  }, { files: { '.gitignore': 'node_modules' } });
});

test('a bad shape throws ConfigError and writes nothing', () => {
  withRepo((root) => {
    assert.throws(() => init(root, { name: 'demo', shape: 'nope' }), ConfigError);
    assert.equal(fs.existsSync(path.join(root, '.slicekit')), false);
  });
});

test('cli: no shape prints usage and exits 2; bad shape prints the error', () => {
  withRepo((root) => {
    const none = runCli(['init'], { cwd: root });
    assert.equal(none.code, 2);
    assert.match(none.stderr, /usage: slicekit init --shape/);
    const bad = runCli(['init', '--shape', 'nope'], { cwd: root });
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /shape: must be one of/);
  });
});

test('cli: flags reach the config', () => {
  withRepo((root) => {
    const r = runCli(['init', '--shape', 'backend', '--docs', 'handbook', '--test', 'npm test'], { cwd: root });
    assert.equal(r.code, 0);
    const cfg = JSON.parse(read(root, '.slicekit/config.json'));
    assert.equal(cfg.docsRoot, 'handbook');
    assert.equal(cfg.commands.test, 'npm test');
    assert.equal(cfg.name, path.basename(root));
    assert.ok(fs.existsSync(path.join(root, 'handbook/decisions.md')));
  });
});
