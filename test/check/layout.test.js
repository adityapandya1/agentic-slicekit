import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/check/context.js';
import layout from '../../src/check/rules/layout.js';
import { makeRepo } from '../helpers/tmp-repo.js';

function withInstall(shape, fn) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape, cli: 'npx --no-install slicekit' });
    const run = () => layout.run(buildContext(repo.root, loadConfig(repo.root)));
    return fn({ root: repo.root, run });
  } finally {
    repo.cleanup();
  }
}

test('the rule is blocking and not a ratchet', () => {
  assert.equal(layout.id, 'layout');
  assert.equal(layout.blocking, true);
  assert.equal(layout.ratchet, false);
});

test('missing path and shape-foreign file are findings', () => {
  withInstall('backend', ({ root, run }) => {
    fs.rmSync(path.join(root, 'docs', 'runbook.md'));
    fs.writeFileSync(path.join(root, '.claude', 'agents', 'designer.md'), '# designer\n');
    const found = run();
    assert.deepEqual(
      found.map((f) => [f.file, f.line, f.message]).sort(),
      [
        ['.claude/agents/designer.md', 1, '.claude/agents/designer.md is not part of shape backend; run slicekit update'],
        ['.slicekit/config.json', 1, 'docs/runbook.md is missing; run slicekit init'],
      ],
    );
  });
});

test('a missing gaps or stack file is a finding', () => {
  withInstall('backend', ({ root, run }) => {
    fs.rmSync(path.join(root, 'docs', 'spec', 'gaps.md'));
    fs.rmSync(path.join(root, 'docs', 'spec', 'stack.md'));
    assert.deepEqual(run().map((f) => [f.file, f.line, f.message]).sort(), [
      ['.slicekit/config.json', 1, 'docs/spec/gaps.md is missing; run slicekit init'],
      ['.slicekit/config.json', 1, 'docs/spec/stack.md is missing; run slicekit init'],
    ]);
  });
});

test('a path of the wrong kind is missing', () => {
  withInstall('backend', ({ root, run }) => {
    fs.rmSync(path.join(root, 'docs', 'intake'), { recursive: true, force: true });
    fs.writeFileSync(path.join(root, 'docs', 'intake'), 'not a directory\n');
    assert.deepEqual(run().map((f) => f.message), ['docs/intake is missing; run slicekit init']);
  });
});

test('a team file under .claude is not a finding', () => {
  withInstall('backend', ({ root, run }) => {
    fs.writeFileSync(path.join(root, '.claude', 'agents', 'our-own.md'), '# ours\n');
    fs.mkdirSync(path.join(root, '.claude', 'notes'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'notes', 'x.md'), 'x\n');
    assert.deepEqual(run(), []);
  });
});

test('a fullstack-only file is fine in a fullstack install', () => {
  withInstall('fullstack', ({ run }) => assert.deepEqual(run(), []));
});

test('a complete install is silent', () => {
  withInstall('backend', ({ run }) => assert.deepEqual(run(), []));
});

test('no config means no findings', () => {
  withInstall('backend', ({ root }) => {
    const cfg = loadConfig(root);
    const ctx = buildContext(root, cfg);
    fs.rmSync(path.join(root, '.slicekit', 'config.json'));
    fs.rmSync(path.join(root, 'docs', 'runbook.md'));
    assert.deepEqual(layout.run(ctx), []);
  });
});

test('a missing workflow file is a finding (I3)', () => {
  withInstall('backend', ({ root, run }) => {
    fs.rmSync(path.join(root, '.github', 'workflows', 'slicekit.yml'));
    assert.deepEqual(run().map((f) => [f.file, f.line, f.message]), [
      ['.slicekit/config.json', 1, '.github/workflows/slicekit.yml is missing; run slicekit init'],
    ]);
  });
});
