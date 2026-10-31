// REQ-4.6: the fixes of the S-20 independent review, round 2 (H-5 to H-7). A workspace repository
// cloned inside the program and not ignored is accepted; a worktree of the program is the program
// repository; a top-level folder only in the program's history still collides with a workspace name.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check } from '../../src/check/index.js';
import { commitFixed, gitIn } from '../helpers/graph-fixture.js';
import { runCli } from '../helpers/run-cli.js';
import { WORKSPACE_REL, workspaceProgram, writeJson } from '../helpers/workspace-fixture.js';

let ws;
let original;
const graphFile = () => path.join(ws.root, '.slicekit', 'graph', 'graph.json');
const graph = () => runCli(['graph', '--full'], { cwd: ws.root, env: { ...process.env, SLICEKIT_GITHOST_FIXTURE: ws.fixture } });
const wsFile = () => path.join(ws.root, ...WORKSPACE_REL.split('/'));

before(() => {
  ws = workspaceProgram();
  original = fs.readFileSync(wsFile(), 'utf8');
});
after(() => ws?.cleanup());

function withWorkspace(content, fn) {
  try {
    writeJson(ws.root, WORKSPACE_REL, content);
    return fn();
  } finally {
    fs.writeFileSync(wsFile(), original);
  }
}

test('H-7: a workspace repository cloned inside the program and not ignored is accepted', () => {
  const svc = path.join(ws.root, 'svc');
  fs.mkdirSync(svc);
  try {
    gitIn(svc, ['init', '-q', '-b', 'main']);
    gitIn(svc, ['config', 'user.name', 'Slicekit Test']);
    gitIn(svc, ['config', 'user.email', 'test@example.com']);
    commitFixed(svc, 'feat(P1/S-09): svc\n\nSlice: P1/S-09', { 'src/svc.js': '1\n' });
    withWorkspace({ repos: [{ name: 'svc', path: 'svc', defaultBranch: 'main' }] }, () => {
      const r = graph();
      assert.equal(r.code, 0, r.stdout + r.stderr);
      const g = JSON.parse(fs.readFileSync(graphFile(), 'utf8'));
      const ins = g.edges.filter((e) => e.kind === 'in' && e.from === 'file:svc/src/svc.js').map((e) => e.to);
      assert.deepEqual(ins, ['repo:svc']);
      const lines = check(ws.root).lines.filter((l) => l.startsWith('workspace ') && !/ names repo /.test(l));
      assert.deepEqual(lines, [], 'check refuses nothing about the svc entry');
    });
  } finally {
    fs.rmSync(svc, { recursive: true, force: true });
  }
});

test('H-6: a git worktree of the program is the program repository', () => {
  const twin = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-twin-')));
  fs.rmSync(twin, { recursive: true, force: true });
  gitIn(ws.root, ['worktree', 'add', '-q', '-b', 'twin', twin]);
  try {
    withWorkspace({ repos: [{ name: 'twin', path: twin, defaultBranch: 'main' }] }, () => {
      const r = graph();
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.equal(r.stderr.trim(), `${WORKSPACE_REL}: repos[0].path ${twin} is the program repository`);
    });
  } finally {
    gitIn(ws.root, ['worktree', 'remove', '--force', twin]);
  }
});

// Last: it changes the program's history.
test('H-5: a top-level folder only in the program history collides with a workspace name', () => {
  commitFixed(ws.root, 'feat(P1/S-01): an orders folder\n\nSlice: P1/S-01', { 'orders/src/topic.js': 'old\n' });
  gitIn(ws.root, ['rm', '-q', '-r', 'orders']);
  commitFixed(ws.root, 'chore: drop the orders folder');
  fs.mkdirSync(path.dirname(graphFile()), { recursive: true });
  fs.writeFileSync(graphFile(), 'prior\n');
  withWorkspace({ repos: [{ name: 'orders', path: ws.orders, defaultBranch: 'main' }] }, () => {
    const r = graph();
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.equal(r.stderr.trim(), `${WORKSPACE_REL}: repos[0].name orders is also a top-level path of the program repository`);
    assert.equal(fs.readFileSync(graphFile(), 'utf8'), 'prior\n', 'graph.json is not written');
  });
});
