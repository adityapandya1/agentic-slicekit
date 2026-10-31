// REQ-4.6 (D-15, D-47) and REQ-4.5: `slicekit graph` in a program repository walks every workspace
// entry whose path is a git repository on disk, prefixes its file and test nodes with its name, names
// its pull requests pull-request:<name>#<n>, adds repo:<name>, reports each other entry and goes on;
// a workspace file it cannot read stops the build with exit 1 and `<workspace file>: <problem>`.
// `slicekit impact <REQ, C-n, slice or path> [--json]` follows produces and consumes edges across
// those repositories (REQ-4.6's scenario); an unknown target exits 2.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli } from '../helpers/run-cli.js';
import { WORKSPACE_REL, workspaceProgram, writeJson } from '../helpers/workspace-fixture.js';

const graphFile = (root) => path.join(root, '.slicekit', 'graph', 'graph.json');
const GRAPH = (root) => JSON.parse(fs.readFileSync(graphFile(root), 'utf8'));
const env = (fixture) => ({ ...process.env, SLICEKIT_GITHOST_FIXTURE: fixture });

let ws;
let built;
before(() => {
  ws = workspaceProgram();
  built = runCli(['graph', '--full'], { cwd: ws.root, env: env(ws.fixture) });
});
after(() => ws?.cleanup());

const lines = (text) => text.split(/\r?\n/);
const graph = (args = ['--full']) => runCli(['graph', ...args], { cwd: ws.root, env: env(ws.fixture) });
const impact = (...args) => runCli(['impact', ...args], { cwd: ws.root });

// Runs fn with the workspace file holding `content`, then puts the original back.
function withWorkspace(content, fn) {
  const file = path.join(ws.root, ...WORKSPACE_REL.split('/'));
  const original = fs.readFileSync(file, 'utf8');
  try {
    if (content === null) fs.rmSync(file);
    else writeJson(ws.root, WORKSPACE_REL, content);
    return fn();
  } finally {
    fs.writeFileSync(file, original);
  }
}

test('files of a workspace repository are prefixed with its name', () => {
  assert.equal(built.code, 0, built.stderr);
  const g = GRAPH(ws.root);
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const id of ['repo:.', 'repo:orders', 'repo:billing', 'file:orders/src/topic.js', 'file:orders/test/topic.test.js', 'test:orders/test/topic.test.js', 'file:billing/src/consumer.js', 'file:src/a.js']) {
    assert.ok(ids.has(id), `${id} missing`);
  }
  assert.ok(!ids.has('file:src/topic.js') && !ids.has('file:src/consumer.js'), 'no unprefixed workspace file');
  assert.deepEqual(g.repos.map((r) => r.name), ['.', 'billing', 'orders']);
  const has = (kind, from, to) => g.edges.some((e) => e.kind === kind && e.from === from && e.to === to);
  assert.ok(has('in', 'file:orders/src/topic.js', 'repo:orders'));
  assert.ok(has('in', 'test:orders/test/topic.test.js', 'repo:orders'));
  assert.ok(has('covers', 'test:orders/test/topic.test.js', 'requirement:REQ-1.1'));
  assert.ok(has('in', 'file:billing/src/consumer.js', 'repo:billing'));
  assert.ok(has('produces', 'slice:P1/S-04', 'contract:C-2'));
  assert.ok(has('consumes', 'slice:P1/S-09', 'contract:C-2'));
  const commitsOf = (slice) => g.edges.filter((e) => e.kind === 'in' && e.to === slice && e.from.startsWith('commit:'));
  assert.equal(commitsOf('slice:P1/S-04').length, 1, 'the orders commit is in P1/S-04');
  assert.equal(commitsOf('slice:P1/S-09').length, 1, 'the billing commit is in P1/S-09');
});

test("a workspace repository's pull requests are named pull-request:<name>#<n>", () => {
  const g = GRAPH(ws.root);
  const pr = g.nodes.find((n) => n.id === 'pull-request:orders#3');
  assert.ok(pr, `no pull-request:orders#3 in ${g.nodes.filter((n) => n.kind === 'pull-request').map((n) => n.id)}`);
  assert.equal(pr.number, 3);
  assert.equal(pr.repo, 'orders');
  assert.equal(pr.url, 'https://github.com/acme/orders/pull/3');
  assert.ok(!g.nodes.some((n) => n.id === 'pull-request:3'), 'the program repository has no pull request 3');
  assert.ok(g.edges.some((e) => e.kind === 'in' && e.from === 'pull-request:orders#3' && e.to === 'slice:P1/S-04'));
  assert.ok(fs.existsSync(path.join(ws.root, '.slicekit', 'graph', 'cache', 'pr-orders-3.json')), 'cached as pr-orders-3.json');
  assert.match(built.stdout, /pull requests fetched 1, from the cache 0/);
});

test('a listed repository that is not on disk is reported', () => {
  assert.equal(built.code, 0, built.stderr);
  const out = lines(built.stdout);
  assert.ok(out.includes('repo remote not reached: no path; https://github.com/acme/remote is not on disk'), built.stdout);
  assert.ok(out.includes('repo gone not reached: ../slicekit-no-such-repo does not exist'), built.stdout);
  assert.ok(out.includes(`repo plain not reached: ${ws.plain} is not a git repository`), built.stdout);
  assert.ok(out[0].endsWith('graph.json'));
  const ids = new Set(GRAPH(ws.root).nodes.map((n) => n.id));
  for (const name of ['remote', 'gone', 'plain']) assert.ok(!ids.has(`repo:${name}`), `repo:${name} is not a node`);
  for (const id of ['slice:P1/S-01', 'requirement:REQ-1.1', 'contract:C-2', 'file:src/a.js']) assert.ok(ids.has(id), `${id} missing`);
});

test('a workspace entry whose default branch is missing is not reached', () => {
  withWorkspace({ repos: [{ name: 'orders', path: ws.orders, defaultBranch: 'trunk' }] }, () => {
    const r = graph();
    assert.equal(r.code, 0, r.stderr);
    assert.ok(lines(r.stdout).includes('repo orders not reached: the default branch trunk is not present'), r.stdout);
    assert.ok(!GRAPH(ws.root).nodes.some((n) => n.id === 'repo:orders'));
  });
});

test('a second build walks only what changed in the workspace and gives the same bytes as --full', () => {
  graph();
  const full = fs.readFileSync(graphFile(ws.root));
  const again = graph([]);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /commits walked 0 of /);
  assert.deepEqual(fs.readFileSync(graphFile(ws.root)), full);
});

// Runs graph with the workspace file holding `content` -> asserts it stopped with exit 1, the
// message on stderr and graph.json untouched.
function refused(content, problem) {
  graph();
  const prior = fs.readFileSync(graphFile(ws.root));
  withWorkspace(content, () => {
    const r = graph();
    assert.equal(r.code, 1, r.stdout + r.stderr);
    if (problem instanceof RegExp) assert.match(r.stderr.trim(), problem);
    else assert.equal(r.stderr.trim(), `${WORKSPACE_REL}: ${problem}`);
    assert.equal(r.stdout, '');
    assert.deepEqual(fs.readFileSync(graphFile(ws.root)), prior, 'graph.json is not written');
  });
}

test('a workspace file repeating a name is refused', () => {
  refused({ repos: [{ name: 'a', path: '../a', defaultBranch: 'main' }, { name: 'a', url: 'https://x/a', defaultBranch: 'main' }] }, 'repos[1].name a is listed twice');
});

const BAD = [
  ['not JSON', '{ repos: [', new RegExp(`^${WORKSPACE_REL.replace(/\./g, '\\.')}: not valid JSON: .+`)],
  ['no repos array', { repos: 'orders' }, 'repos must be an array'],
  ['no object at all', '[]\n', 'repos must be an array'],
  ['the name .', { repos: [{ name: '.', path: '../a', defaultBranch: 'main' }] }, 'repos[0].name must be a name of letters, digits, . _ or -, and not .'],
  ['no name', { repos: [{ path: '../a', defaultBranch: 'main' }] }, 'repos[0].name must be a name of letters, digits, . _ or -, and not .'],
  ['a name with a slash', { repos: [{ name: 'a/b', path: '../a', defaultBranch: 'main' }] }, 'repos[0].name must be a name of letters, digits, . _ or -, and not .'],
  ['neither path nor url', { repos: [{ name: 'a', defaultBranch: 'main' }] }, 'repos[0] gives neither path nor url'],
  ['no defaultBranch', { repos: [{ name: 'a', path: '../a' }] }, 'repos[0].defaultBranch must be a branch name'],
];

for (const [what, content, problem] of BAD) {
  test(`a workspace file with ${what} stops graph with exit 1`, () => refused(content, problem));
}

test('a repository with no workspace file builds as one repository', () => {
  withWorkspace(null, () => {
    const r = graph();
    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /not reached/);
    assert.deepEqual(GRAPH(ws.root).repos.map((x) => x.name), ['.']);
  });
});

test('impact on a contract lists its producer and consumer slices and both repositories', () => {
  graph();
  const r = impact('C-2');
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [
    'contracts:',
    '  C-2 order.created topic',
    'slices:',
    '  P1/S-04  repo orders  produces C-2',
    '  P1/S-09  repo billing  consumes C-2',
    'files:',
    '  none',
    'repos: billing, orders',
    '',
  ]);
  const j = JSON.parse(impact('C-2', '--json').stdout);
  assert.equal(j.target, 'contract:C-2');
  assert.deepEqual(j.contracts, [{ id: 'C-2', label: 'order.created topic' }]);
  assert.deepEqual(j.slices, [
    { id: 'P1/S-04', name: 'Publish orders', repo: 'orders', relations: ['produces C-2'] },
    { id: 'P1/S-09', name: 'Bill orders', repo: 'billing', relations: ['consumes C-2'] },
  ]);
  assert.deepEqual(j.files, []);
  assert.deepEqual(j.repos, ['billing', 'orders']);
});

test('impact on a path lists the slices and contracts that share it', () => {
  graph();
  const r = impact('src/a.js');
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [
    'contracts:',
    '  C-3 billing API',
    'slices:',
    '  P1/S-01  repo .  touched 1 shared files',
    '  P1/S-02  repo .  touched 1 shared files, produces C-3',
    'files:',
    '  src/a.js',
    'repos: .',
    '',
  ]);
  const dir = JSON.parse(impact('src/', '--json').stdout);
  assert.deepEqual(dir.files, ['src/a.js', 'src/b.js', 'src/c.js']);
  assert.deepEqual(dir.slices.map((s) => [s.id, s.relations]), [
    ['P1/S-01', ['touched 3 shared files']],
    ['P1/S-02', ['touched 2 shared files', 'produces C-3']],
  ]);
  const across = JSON.parse(impact('orders/src/topic.js', '--json').stdout);
  assert.deepEqual(across.slices.map((s) => [s.id, s.repo, s.relations]), [
    ['P1/S-04', 'orders', ['touched 1 shared files', 'produces C-2']],
    ['P1/S-09', 'billing', ['consumes C-2']],
  ]);
  assert.deepEqual(across.repos, ['billing', 'orders']);
});

test('impact on a requirement starts from the slices that implement it', () => {
  graph();
  const r = impact('REQ-1.1', '--json');
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.contracts.map((c) => c.id), ['C-2']);
  assert.deepEqual(j.slices.map((s) => [s.id, s.repo, s.relations]), [
    ['P1/S-01', '.', ['implements', 'touched 3 shared files']],
    ['P1/S-02', '.', ['touched 2 shared files']],
    ['P1/S-04', 'orders', ['implements', 'touched 2 shared files', 'produces C-2']],
    ['P1/S-09', 'billing', ['consumes C-2']],
  ]);
  assert.deepEqual(j.files, ['orders/src/topic.js', 'orders/test/topic.test.js', 'src/a.js', 'src/b.js', 'src/c.js']);
  assert.deepEqual(j.repos, ['.', 'billing', 'orders']);
});

test('impact on a slice starts from its own files and contracts', () => {
  graph();
  const j = JSON.parse(impact('P1/S-02', '--json').stdout);
  assert.deepEqual(j.contracts.map((c) => c.id), ['C-3']);
  assert.deepEqual(j.slices.map((s) => [s.id, s.relations]), [
    ['P1/S-01', ['touched 2 shared files']],
    ['P1/S-02', ['touched 2 shared files', 'produces C-3']],
  ]);
  assert.deepEqual(j.files, ['src/a.js', 'src/b.js']);
});

test('impact on a target not in the graph exits 2 naming it', () => {
  graph();
  for (const target of ['C-9', 'REQ-9.9', 'P1/S-77', 'src/nope.js', 'nope/']) {
    const r = impact(target);
    assert.equal(r.code, 2, `${target}: ${r.stdout}`);
    assert.equal(r.stderr.trim(), `slicekit: ${target} is not in the graph`);
  }
  const j = impact('C-9', '--json');
  assert.equal(j.code, 2);
  assert.deepEqual(JSON.parse(j.stdout), { error: 'C-9 is not in the graph' });
  for (const args of [[], ['C-2', 'REQ-1.1']]) {
    const r = impact(...args);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /usage: slicekit impact/);
  }
});
