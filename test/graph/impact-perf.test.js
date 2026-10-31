// REQ-4.5's budget for impact (P3/S-20): `slicekit impact` on a requirement, a slice and a path each
// answers in under two seconds of wall time, Node's start included, on a 10,000-commit repository.
// The repository is generated here, in os.tmpdir(), by bigRepo (test/helpers/graph-fixture.js), and
// never committed. Its own file, so it runs beside the other 10,000-commit tests.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { bigRepo } from '../helpers/graph-fixture.js';
import { runCli } from '../helpers/run-cli.js';

const BUDGET_MS = 2_000;

let repo;
let host;
before(() => {
  repo = bigRepo();
  host = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-graph-host-'));
  const r = runCli(['graph'], { cwd: repo.root, env: { ...process.env, SLICEKIT_GITHOST_FIXTURE: host } });
  assert.equal(r.code, 0, `graph failed: ${r.stderr}`);
});
after(() => {
  if (host) fs.rmSync(host, { recursive: true, force: true });
  repo?.cleanup();
});

test('impact answers in under two seconds on a 10,000-commit repository', (t) => {
  const commands = [
    ['impact', 'REQ-1.1'],
    ['impact', 'P1/S-01', '--json'],
    ['impact', 'src/f1.js'],
  ];
  const misses = [];
  const timings = [];
  for (const args of commands) {
    const started = performance.now();
    const r = runCli(args, { cwd: repo.root });
    const ms = Math.round(performance.now() - started);
    const name = `slicekit ${args.join(' ')}`;
    timings.push(`${name}: ${ms} ms`);
    if (r.code !== 0) misses.push(`${name} exited ${r.code} after ${ms} ms: ${r.stderr.split('\n')[0]}`);
    else if (ms >= BUDGET_MS) misses.push(`${name} took ${ms} ms`);
  }
  t.diagnostic(timings.join('; '));
  assert.deepEqual(misses, [], misses.join('\n'));
});
