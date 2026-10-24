import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { kitPaths } from '../src/paths.js';

test('kitPaths returns the 23 keys as absolute paths with exact relative forms', () => {
  const root = path.resolve('some', 'root');
  const p = kitPaths(root, { docsRoot: 'docs' });
  const expected = {
    kit: '.slicekit',
    config: '.slicekit/config.json',
    state: '.slicekit/state',
    baselines: '.slicekit/baselines',
    journal: '.slicekit/journal.log',
    graph: '.slicekit/graph',
    workspace: '.slicekit/workspace.json',
    docs: 'docs',
    intake: 'docs/intake',
    decisions: 'docs/decisions.md',
    spec: 'docs/spec',
    contracts: 'docs/spec/contracts',
    gaps: 'docs/spec/gaps.md',
    stack: 'docs/spec/stack.md',
    platform: 'docs/platform.md',
    observability: 'docs/observability.md',
    runbook: 'docs/runbook.md',
    phases: 'docs/phases',
    releases: 'docs/releases',
    build: 'BUILD.md',
    claude: '.claude',
    githooks: '.githooks',
    workflow: '.github/workflows/slicekit.yml',
  };
  assert.equal(Object.keys(expected).length, 23);
  assert.deepEqual(Object.keys(p).sort(), Object.keys(expected).sort());
  for (const [key, rel] of Object.entries(expected)) {
    assert.ok(path.isAbsolute(p[key]), key);
    assert.equal(path.relative(root, p[key]).split(path.sep).join('/'), rel, key);
  }
});
