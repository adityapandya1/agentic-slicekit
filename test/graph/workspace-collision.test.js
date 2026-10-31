// REQ-4.6: the workspace collision check counts only the first segment of tracked paths that hold a
// slash (P3/S-34, issue #62). An entry whose folder is a git submodule of the program (one gitlink,
// the node file:<name>) or whose name is that of a top-level file shares no file node, so graph and
// check accept it; an entry named like a top-level folder with tracked files under it is refused.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { check } from '../../src/check/index.js';
import { commitFixed, gitIn } from '../helpers/graph-fixture.js';
import { runCli } from '../helpers/run-cli.js';
import { WORKSPACE_REL, workspaceProgram, writeJson } from '../helpers/workspace-fixture.js';

let ws;
let original;
const env = () => ({ ...process.env, SLICEKIT_GITHOST_FIXTURE: ws.fixture });
const graph = () => runCli(['graph', '--full'], { cwd: ws.root, env: env() });
const wsFile = () => path.join(ws.root, ...WORKSPACE_REL.split('/'));
const collisions = () => check(ws.root).lines.filter((l) => l.startsWith('workspace ') && /also a top-level path/.test(l));

before(() => {
  ws = workspaceProgram();
  // bill is a git submodule of the program: one gitlink, no tracked file under it. ledger is a
  // top-level file. svc holds tracked files.
  const sub = gitIn(ws.billing, ['rev-parse', 'HEAD']);
  gitIn(ws.root, ['update-index', '--add', '--cacheinfo', `160000,${sub},bill`]);
  // An empty folder is a submodule not checked out, so the commit keeps the gitlink.
  fs.mkdirSync(path.join(ws.root, 'bill'));
  commitFixed(ws.root, 'chore: bill as a submodule, a ledger file, svc notes', { ledger: 'ledger\n', 'svc/notes.md': '# svc\n' });
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

test('an entry whose folder is a submodule, or named like a top-level file, is no collision', () => {
  const tracked = gitIn(ws.root, ['ls-files', '-s', 'bill']);
  assert.match(tracked, /^160000 /, 'bill is a gitlink');
  for (const entry of [
    { name: 'bill', path: ws.billing, defaultBranch: 'main' },
    { name: 'ledger', path: ws.billing, defaultBranch: 'main' },
  ]) {
    withWorkspace({ repos: [entry] }, () => {
      const r = graph();
      assert.equal(r.code, 0, `${entry.name}: ${r.stdout}${r.stderr}`);
      assert.deepEqual(collisions(), [], entry.name);
    });
  }
});

test('an entry named like a top-level folder with tracked files is still refused', () => {
  withWorkspace({ repos: [{ name: 'svc', path: ws.billing, defaultBranch: 'main' }] }, () => {
    const r = graph();
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.equal(r.stderr.trim(), `${WORKSPACE_REL}: repos[0].name svc is also a top-level path of the program repository`);
    assert.deepEqual(collisions(), [`workspace ${WORKSPACE_REL}:1 ${WORKSPACE_REL}: repos[0].name svc is also a top-level path of the program repository`]);
  });
});
