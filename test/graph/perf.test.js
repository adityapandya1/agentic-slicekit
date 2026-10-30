// P3/S-17, REQ-4.4 and REQ-4.5's alarm: a full build of a 10,000-commit repository through the CLI
// in under thirty seconds. The repository is generated here, in os.tmpdir(), by one git fast-import
// (test/helpers/graph-fixture.js), and never committed. Its own file, so it runs beside the others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { bigRepo } from '../helpers/graph-fixture.js';
import { runCli } from '../helpers/run-cli.js';

test('a 10,000-commit repository builds in under thirty seconds', () => {
  const repo = bigRepo();
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-graph-host-'));
  try {
    const started = performance.now();
    const r = runCli(['graph'], { cwd: repo.root, env: { ...process.env, SLICEKIT_GITHOST_FIXTURE: host } });
    const ms = performance.now() - started;
    assert.equal(r.code, 0, r.stderr);
    assert.ok(ms < 30_000, `the build took ${Math.round(ms)} ms`);
    const graph = JSON.parse(fs.readFileSync(path.join(repo.root, '.slicekit', 'graph', 'graph.json'), 'utf8'));
    const commits = graph.nodes.filter((n) => n.kind === 'commit').length;
    assert.ok(commits >= 10_001, `${commits} commit nodes`);
  } finally {
    fs.rmSync(host, { recursive: true, force: true });
    repo.cleanup();
  }
});
