// P3/S-18, REQ-4.5's budget: trace, trace --file, history, uncovered, shipped and status --json each
// answer in under two seconds of wall time, Node's start included, on a 10,000-commit repository.
// The repository is generated here, in os.tmpdir(), by bigRepo (test/helpers/graph-fixture.js), and
// never committed. Its own file, so it runs beside the other 10,000-commit tests.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { bigRepo, commitFixed } from '../helpers/graph-fixture.js';
import { runCli } from '../helpers/run-cli.js';

const BUDGET_MS = 2_000;

let repo;
let host;
before(() => {
  repo = bigRepo();
  // The fixture gains a release record, so shipped P1 has something to answer.
  commitFixed(repo.root, 'docs: release P1', { 'docs/releases/P1.md': '# Release P1\n\nPull requests: none yet.\n' });
  host = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-graph-host-'));
  const r = runCli(['graph'], { cwd: repo.root, env: { ...process.env, SLICEKIT_GITHOST_FIXTURE: host } });
  assert.equal(r.code, 0, `graph failed: ${r.stderr}`);
});
after(() => {
  if (host) fs.rmSync(host, { recursive: true, force: true });
  repo?.cleanup();
});

test('each query answers in under two seconds on a 10,000-commit repository', () => {
  const commands = [
    ['trace', 'REQ-1.1'],
    ['trace', '--file', 'src/f1.js'],
    ['history', 'src'],
    ['uncovered'],
    ['shipped', 'P1'],
    ['status', '--json'],
  ];
  const misses = [];
  for (const args of commands) {
    const started = performance.now();
    const r = runCli(args, { cwd: repo.root });
    const ms = Math.round(performance.now() - started);
    const name = `slicekit ${args.join(' ')}`;
    if (r.code !== 0) misses.push(`${name} exited ${r.code} after ${ms} ms: ${r.stderr.split('\n')[0]}`);
    else if (ms >= BUDGET_MS) misses.push(`${name} took ${ms} ms`);
  }
  assert.deepEqual(misses, [], misses.join('\n'));
});
