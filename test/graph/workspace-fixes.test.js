// REQ-4.6 and REQ-4.5: the fixes of the S-20 independent review, round 1 (B-1, B-2, H-1 to H-4).
// A state file's pull request belongs to its slice's repository; impact leaves the kit's own
// bookkeeping out; workspace names and paths that collide are refused; an unreadable workspace file
// is a clean refusal; impact names the kind of a target it does not take; history names a workspace
// pull request by its repository.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { check } from '../../src/check/index.js';
import { commitFixed } from '../helpers/graph-fixture.js';
import { runCli } from '../helpers/run-cli.js';
import { WORKSPACE_REL, workspaceProgram, writeJson } from '../helpers/workspace-fixture.js';

const graphFile = (root) => path.join(root, '.slicekit', 'graph', 'graph.json');
const GRAPH = (root) => JSON.parse(fs.readFileSync(graphFile(root), 'utf8'));

let ws;
let original;
const env = () => ({ ...process.env, SLICEKIT_GITHOST_FIXTURE: ws.fixture });
const graph = () => runCli(['graph', '--full'], { cwd: ws.root, env: env() });
const impact = (...args) => runCli(['impact', ...args], { cwd: ws.root });
const wsFile = () => path.join(ws.root, ...WORKSPACE_REL.split('/'));

before(() => {
  ws = workspaceProgram();
  // B-1: P1/S-04 (repo orders) records orders' pull request 3 in its state file, and the program
  // repository has an unrelated pull request 3 of its own on its host.
  const state = { slice: 'P1/S-04', state: 'merged', branch: 'slice/P1-S-04-publish', pr: { number: 3, url: 'https://github.com/acme/orders/pull/3', headSha: null }, redCommit: null, frozenTests: [], unfrozen: [], verdicts: [], ci: null, mergedAt: null, handoff: null, history: [] };
  // B-2: every program slice also touches the queue file and its own state file, and P1/S-09 touches
  // nothing else in the program repository.
  commitFixed(ws.root, 'chore(P1/S-01): queue\n\nSlice: P1/S-01', { 'BUILD.md': '# Build\n\n1\n', '.slicekit/state/P1-S-01.json': '{"slice":"P1/S-01"}\n' });
  commitFixed(ws.root, 'chore(P1/S-02): queue\n\nSlice: P1/S-02', { 'BUILD.md': '# Build\n\n2\n', '.slicekit/reviews/P1-S-02-r1.md': 'Verdict: APPROVE\n' });
  commitFixed(ws.root, 'chore(P1/S-04): state\n\nSlice: P1/S-04', { '.slicekit/state/P1-S-04.json': `${JSON.stringify(state, null, 2)}\n` });
  commitFixed(ws.root, 'chore(P1/S-09): queue\n\nSlice: P1/S-09', { 'BUILD.md': '# Build\n\n9\n' });
  writeJson(ws.fixture, 'pr-3.json', {
    number: 3,
    url: 'https://github.com/acme/program/pull/3',
    state: 'MERGED',
    mergedAt: '2026-10-02T10:00:00Z',
    headRefOid: 'a'.repeat(40),
    headRefName: 'fix-typo',
    isDraft: false,
    title: 'Fix a typo in the README',
    body: '',
    labels: [],
  });
  original = fs.readFileSync(wsFile(), 'utf8');
  const r = graph();
  assert.equal(r.code, 0, r.stderr);
});
after(() => ws?.cleanup());

function withWorkspace(content, fn) {
  try {
    if (typeof content === 'function') content();
    else writeJson(ws.root, WORKSPACE_REL, content);
    return fn();
  } finally {
    fs.rmSync(wsFile(), { recursive: true, force: true });
    fs.writeFileSync(wsFile(), original);
  }
}

test("B-1: a state file's pull request is looked up in its slice's repository", () => {
  const r = graph();
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /pull request #3 is not on the host/);
  const g = GRAPH(ws.root);
  assert.ok(!g.nodes.some((n) => n.id === 'pull-request:3'), 'the program pull request 3 is not in the graph');
  assert.ok(g.nodes.some((n) => n.id === 'pull-request:orders#3'));
  const prsOf = g.edges.filter((e) => e.kind === 'in' && e.to === 'slice:P1/S-04' && e.from.startsWith('pull-request:')).map((e) => e.from);
  assert.deepEqual([...new Set(prsOf)], ['pull-request:orders#3']);
});

test("B-2: impact leaves the kit's bookkeeping out of shared files and files", () => {
  graph();
  const j = JSON.parse(impact('P1/S-02', '--json').stdout);
  assert.deepEqual(j.files, ['src/a.js', 'src/b.js']);
  assert.deepEqual(j.slices.map((s) => [s.id, s.relations]), [
    ['P1/S-01', ['touched 2 shared files']],
    ['P1/S-02', ['touched 2 shared files', 'produces C-3']],
  ]);
  const req = JSON.parse(impact('REQ-1.1', '--json').stdout);
  assert.ok(!req.files.some((f) => f === 'BUILD.md' || f.startsWith('.slicekit/')), req.files.join(', '));
  assert.ok(!req.slices.some((s) => s.id === 'P1/S-09' && s.relations.some((x) => x.startsWith('touched'))));
  const queue = JSON.parse(impact('BUILD.md', '--json').stdout);
  assert.deepEqual([queue.slices, queue.files], [[], []]);
});

const refused = (content, problem) =>
  withWorkspace(content, () => {
    const r = graph();
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.equal(r.stderr.trim(), `${WORKSPACE_REL}: ${problem}`);
  });

test('H-1: a workspace name that is a top-level path of the program repository is refused', () => {
  refused({ repos: [{ name: 'src', path: ws.orders, defaultBranch: 'main' }] }, 'repos[0].name src is also a top-level path of the program repository');
});

test('H-1: two names equal but for case are refused', () => {
  refused({ repos: [{ name: 'orders', path: ws.orders, defaultBranch: 'main' }, { name: 'Orders', url: 'https://x/o', defaultBranch: 'main' }] }, 'repos[1].name Orders is listed twice');
});

test('H-1: a path that is the program repository, or another entry’s repository, is refused', () => {
  refused({ repos: [{ name: 'self', path: '.', defaultBranch: 'main' }] }, 'repos[0].path . is the program repository');
  refused({ repos: [{ name: 'orders', path: ws.orders, defaultBranch: 'main' }, { name: 'again', path: `${ws.orders}/`, defaultBranch: 'main' }] }, `repos[1].path ${ws.orders}/ is the repository of repos[0]`);
});

test('H-2: a workspace file that cannot be read is refused, by graph and by check', () => {
  withWorkspace(() => {
    fs.rmSync(wsFile());
    fs.mkdirSync(wsFile());
  }, () => {
    const r = graph();
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stderr.trim(), new RegExp(`^${WORKSPACE_REL.replace(/\./g, '\\.')}: cannot be read: E[A-Z]+$`));
    const rule = check(ws.root);
    const lines = rule.lines.filter((l) => l.startsWith('workspace '));
    assert.equal(lines.length, 1, rule.lines.join('\n'));
    assert.match(lines[0], new RegExp(`^workspace ${WORKSPACE_REL.replace(/\./g, '\\.')}:1 .*cannot be read: E[A-Z]+$`));
  });
});

test('H-3: impact names the kind of a target in the graph that it does not take', () => {
  graph();
  for (const [target, kind] of [['D-01', 'decision'], ['P1', 'phase'], ['orders#3', 'pull-request']]) {
    const r = impact(target);
    assert.equal(r.code, 2, `${target}: ${r.stdout}`);
    assert.equal(r.stderr.trim(), `slicekit: impact takes a requirement, contract, slice or path; ${target} is a ${kind}`);
  }
});

test('H-4: history names a workspace pull request by its repository', () => {
  graph();
  const r = runCli(['history', 'orders/src/topic.js'], { cwd: ws.root });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^P1\/S-04 {2}PR orders#3 {2}/m);
  const j = JSON.parse(runCli(['history', 'orders/src/topic.js', '--json'], { cwd: ws.root }).stdout);
  assert.equal(j[0].pr, 3);
  assert.equal(j[0].prRepo, 'orders');
});
