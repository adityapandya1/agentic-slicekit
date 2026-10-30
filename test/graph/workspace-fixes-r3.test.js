// REQ-4.6: the fixes of the S-20 independent review, round 3 (H-8, H-9). A folder that is no git
// repository still gets `graph: not a git repository` and exit 2; a nested repository in a folder
// the program tracks files in collides, in check as in graph.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check } from '../../src/check/index.js';
import { defaultConfig } from '../../src/config.js';
import { commitFixed, gitIn } from '../helpers/graph-fixture.js';
import { runCli } from '../helpers/run-cli.js';
import { WORKSPACE_REL, workspaceProgram, writeJson } from '../helpers/workspace-fixture.js';

let ws;
before(() => {
  ws = workspaceProgram();
});
after(() => ws?.cleanup());

test('H-8: graph in a folder that is no git repository says so and exits 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-nogit-'));
  try {
    const cfg = defaultConfig({ name: 'nogit', shape: 'backend', commands: { test: 'node --test' } });
    writeJson(dir, '.slicekit/config.json', cfg);
    for (const workspace of [null, { repos: [{ name: 'orders', path: ws.orders, defaultBranch: 'main' }] }]) {
      if (workspace) writeJson(dir, WORKSPACE_REL, workspace);
      const r = runCli(['graph'], { cwd: dir });
      assert.equal(r.code, 2, r.stdout + r.stderr);
      assert.equal(r.stderr.trim(), 'graph: not a git repository');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('H-9: a nested repository in a folder the program tracks files in is refused by check', () => {
  commitFixed(ws.root, 'docs: svc notes', { 'svc/notes.md': '# svc\n' });
  const svc = path.join(ws.root, 'svc');
  gitIn(svc, ['init', '-q', '-b', 'main']);
  writeJson(ws.root, WORKSPACE_REL, { repos: [{ name: 'svc', path: 'svc', defaultBranch: 'main' }] });
  const lines = check(ws.root).lines.filter((l) => l.startsWith('workspace ') && !/ names repo /.test(l));
  assert.deepEqual(lines, [`workspace ${WORKSPACE_REL}:1 ${WORKSPACE_REL}: repos[0].name svc is also a top-level path of the program repository`]);
});
