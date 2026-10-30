// P3/S-17, the graph builder: REQ-4.1 (nodes and edges), REQ-4.2 (sources, the pull request cache),
// REQ-4.3 (tests link to requirements by ID), REQ-4.4 (build and storage, incremental, byte-identical)
// and REQ-4.8 (no source parsing). Every build here runs against graphRepo (test/helpers/graph-fixture.js)
// with the fixture host or a stub host; nothing reaches the network.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { getHost } from '../../src/adapters/githost/index.js';
import { GitHostError } from '../../src/adapters/githost/errors.js';
import { GH_NOT_FOUND } from '../../src/adapters/githost/github.js';
import { mapPullRequest } from '../../src/adapters/githost/gh-json.js';
import { cli } from '../helpers/build-flow.js';
import { makeRepo } from '../helpers/tmp-repo.js';
import { commitFixed, gitIn, graphRepo, prRaw, stateS01, write } from '../helpers/graph-fixture.js';

// The modules this slice adds, loaded per test so each test fails on its own while they are missing.
const load = (rel) => import(new URL(`../../src/${rel}`, import.meta.url));

const NODE_KINDS = ['intake', 'decision', 'requirement', 'gap', 'contract', 'phase', 'slice', 'test', 'commit', 'pull-request', 'file', 'release', 'runbook-section', 'repo', 'verdict'];
const EDGE_KINDS = ['cites', 'covers', 'implements', 'touched', 'in', 'reviewed-by', 'released-in', 'produces', 'consumes'];
const GRAPH_REL = '.slicekit/graph/graph.json';

const kinds = (items) => [...new Set(items.map((x) => x.kind))].sort();
const graphBytes = (root) => fs.readFileSync(path.join(root, ...GRAPH_REL.split('/')));
const rmGraphDir = (root) => fs.rmSync(path.join(root, '.slicekit', 'graph'), { recursive: true, force: true });
const fixtureEnv = (fixture) => ({ ...process.env, SLICEKIT_GITHOST_FIXTURE: fixture });

// A host that answers getPullRequest from `answer(n)` and counts the calls.
function stubHost(answer) {
  const host = {
    kind: 'stub',
    calls: 0,
    getPullRequest(n) {
      host.calls++;
      return answer(n);
    },
  };
  return host;
}

// One repository shared by the tests that do not change its history.
let shared;
let cfg;
before(() => {
  shared = graphRepo();
  cfg = loadConfig(shared.root);
});
after(() => shared?.cleanup());

async function buildShared(opts = {}) {
  const { buildGraph } = await load('graph/build.js');
  const host = opts.host ?? getHost(cfg, { SLICEKIT_GITHOST_FIXTURE: shared.fixture }, shared.root);
  return buildGraph(shared.root, cfg, { full: true, ...opts, host });
}

test('every node kind and edge kind on the fixture repository', async () => {
  rmGraphDir(shared.root);
  const { graph } = await buildShared();
  assert.equal(graph.schemaVersion, 1);
  assert.deepEqual(kinds(graph.nodes), [...NODE_KINDS].sort());
  // Every edge kind REQ-4.1 names (nine names; the slice file's "all ten" counts one twice).
  assert.deepEqual(kinds(graph.edges), [...EDGE_KINDS].sort());
  for (const n of graph.nodes) assert.ok(typeof n.from === 'string' && n.from !== '', `node ${n.id} has no from`);
  for (const e of graph.edges) assert.ok(typeof e.at === 'string' && e.at !== '', `edge ${e.kind} ${e.from} -> ${e.to} has no at`);
  // The top-level shape REQ-4.4 and D-44 fix: builtAt is the committer date of sha, never the clock.
  assert.equal(graph.defaultBranch, 'main');
  assert.equal(graph.sha, gitIn(shared.root, ['rev-parse', 'main']));
  assert.equal(Date.parse(graph.builtAt), Date.parse(gitIn(shared.root, ['show', '-s', '--format=%cI', 'main'])));
  assert.deepEqual(graph.repos, [{ name: '.', sha: graph.sha }]);
});

test("a slice naming a requirement gets an implements edge with the slice file's path and line", async () => {
  const { graph } = await buildShared();
  const edge = graph.edges.find((e) => e.kind === 'implements' && e.from === 'slice:P1/S-01' && e.to === 'requirement:REQ-1.3');
  assert.ok(edge, 'no implements edge from slice:P1/S-01 to requirement:REQ-1.3');
  assert.equal(edge.at, 'docs/phases/P1-x/S-01-a.md:7');
  const slice = graph.nodes.find((n) => n.id === 'slice:P1/S-01');
  assert.ok(slice, 'no slice node P1/S-01');
  assert.match(slice.from, /^docs\/phases\/P1-x\/S-01-a\.md:\d+$/);
});

test('an edge between kinds the schema does not allow is refused and graph.json is not written', async () => {
  const written = await cli(shared.root, ['graph'], fixtureEnv(shared.fixture));
  assert.equal(written.code, 0, written.stderr);
  const before = graphBytes(shared.root);

  const { writeGraph } = await load('graph/build.js');
  const built = await buildShared();
  const commitNode = built.graph.nodes.find((n) => n.kind === 'commit');
  assert.ok(commitNode, 'no commit node to start the bad edge from');
  const bad = {
    ...built.graph,
    edges: [...built.graph.edges, { kind: 'implements', from: commitNode.id, to: 'requirement:REQ-1.1', at: commitNode.id.slice('commit:'.length) }],
  };
  await assert.rejects(
    async () => writeGraph(shared.root, cfg, { ...built, graph: bad }),
    (e) => {
      assert.equal(e.name, 'GraphError');
      assert.equal(e.code, 1);
      assert.ok(e.message.startsWith('graph: schema: edge implements runs from commit to requirement'), e.message);
      return true;
    },
  );
  assert.ok(graphBytes(shared.root).equals(before), 'graph.json changed');
});

test('a doc naming an ID that is not in the graph drops the edge with a warning', async () => {
  const { graph, report } = await buildShared();
  assert.ok(!graph.edges.some((e) => e.to === 'requirement:REQ-9.9'), 'an edge to the unknown REQ-9.9 was kept');
  assert.ok(!graph.nodes.some((n) => n.id === 'requirement:REQ-9.9'));
  const warning = report.warnings.find((w) => w.startsWith('graph: docs/phases/P1-x/S-02-b.md:7 names '));
  assert.ok(warning, `no warning naming the slice file's line: ${JSON.stringify(report.warnings)}`);
  assert.match(warning, /REQ-9\.9, which is not in the graph$/);
  // The known requirement on the same line still gets its edge.
  assert.ok(graph.edges.some((e) => e.kind === 'implements' && e.from === 'slice:P1/S-02' && e.to === 'requirement:REQ-1.2'));
});

test('a test naming a requirement gets a covers edge with its file and line', async () => {
  const { graph } = await buildShared();
  for (const [file, req, line] of [
    ['test/a.test.js', 'REQ-1.1', 3],
    ['test/crlf.test.js', 'REQ-1.2', 3], // CRLF endings number the same as LF
  ]) {
    assert.ok(graph.nodes.some((n) => n.id === `test:${file}` && n.kind === 'test'), `no test node ${file}`);
    const edge = graph.edges.find((e) => e.kind === 'covers' && e.from === `test:${file}` && e.to === `requirement:${req}`);
    assert.ok(edge, `no covers edge from ${file} to ${req}`);
    assert.equal(edge.at, `${file}:${line}`);
    assert.ok(graph.edges.some((e) => e.kind === 'in' && e.from === `test:${file}` && e.to === 'repo:.' && e.at === `${file}:1`));
  }
});

test('Java sources produce no node or edge', async () => {
  const { graph } = await buildShared();
  const java = 'src/Billing.java';
  for (const n of graph.nodes) assert.ok(!n.from.startsWith(java), `node ${n.id} comes from ${n.from}`);
  for (const e of graph.edges) assert.ok(!e.at.startsWith(java), `edge ${e.kind} ${e.from} -> ${e.to} at ${e.at}`);
  assert.ok(!graph.nodes.some((n) => n.id === `test:${java}`), 'the Java source became a test node');
  // What git says it touched is all the graph knows of it: no covers edge, nothing read from its lines.
  assert.ok(!graph.edges.some((e) => e.kind === 'covers' && e.from.endsWith(java)));
});

test('a second run walks only the new commit and leaves git status clean', async () => {
  const p = graphRepo();
  try {
    const env = fixtureEnv(p.fixture);
    const first = await cli(p.root, ['graph'], env);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stdout.split('\n')[0], GRAPH_REL);
    const m = /commits walked (\d+) of (\d+)/.exec(first.stdout);
    assert.ok(m, first.stdout);
    const n = Number(m[2]);
    assert.equal(Number(m[1]), n, 'the first run walks every commit');

    commitFixed(p.root, 'feat(P1/S-01): more\n\nSlice: P1/S-01', { 'src/new.js': 'export const n = 3;\n' });
    const second = await cli(p.root, ['graph'], env);
    assert.equal(second.code, 0, second.stderr);
    assert.ok(second.stdout.split('\n').includes(`commits walked 1 of ${n + 1}`), second.stdout);
    assert.equal(gitIn(p.root, ['status', '--porcelain']), '');
  } finally {
    p.cleanup();
  }
});

test('an incremental build is byte-identical to a full build, after a new commit and a deleted branch', async () => {
  const p = graphRepo();
  try {
    const env = fixtureEnv(p.fixture);
    const first = await cli(p.root, ['graph'], env);
    assert.equal(first.code, 0, first.stderr);
    const ids = (bytes) => JSON.parse(bytes.toString('utf8')).nodes.map((n) => n.id);
    assert.ok(ids(graphBytes(p.root)).includes(`commit:${p.shas.sliceB}`), "the slice branch's commit is in the first graph");

    commitFixed(p.root, 'feat(P1/S-01): more\n\nSlice: P1/S-01', { 'src/new.js': 'export const n = 3;\n' });
    gitIn(p.root, ['branch', '-q', '-D', 'slice/P1-S-02-b']);

    const incremental = await cli(p.root, ['graph'], env);
    assert.equal(incremental.code, 0, incremental.stderr);
    const a = graphBytes(p.root);
    const full = await cli(p.root, ['graph', '--full'], env);
    assert.equal(full.code, 0, full.stderr);
    const b = graphBytes(p.root);

    assert.ok(a.equals(b), 'the incremental graph differs from the full one');
    assert.ok(!ids(b).includes(`commit:${p.shas.sliceB}`), "the deleted branch's commit is still a node");
  } finally {
    p.cleanup();
  }
});

test('two full builds from the same inputs are byte-identical', async () => {
  const env = fixtureEnv(shared.fixture);
  const one = await cli(shared.root, ['graph', '--full'], env);
  assert.equal(one.code, 0, one.stderr);
  const a = graphBytes(shared.root);
  const two = await cli(shared.root, ['graph', '--full'], env);
  assert.equal(two.code, 0, two.stderr);
  const b = graphBytes(shared.root);
  assert.ok(a.length > 0);
  assert.ok(a.equals(b), 'two full builds gave different bytes');
});

test('pull requests are fetched once and then read from the cache', async () => {
  rmGraphDir(shared.root);
  const host = stubHost((n) => mapPullRequest(prRaw(shared.shas.sliceA, { state: 'MERGED' })));
  const first = await buildShared({ host, full: false });
  assert.equal(host.calls, 1, 'the first build fetches pull request 1 once');
  assert.ok(first.graph.nodes.some((n) => n.id === 'pull-request:1'));
  assert.ok(fs.existsSync(path.join(shared.root, '.slicekit', 'graph', 'cache', 'pr-1.json')), 'no cache file for pull request 1');

  const second = await buildShared({ host, full: false });
  assert.equal(host.calls, 1, 'the second build calls the host again');
  const pr = second.graph.nodes.find((n) => n.id === 'pull-request:1');
  assert.ok(pr, 'no pull request node from the cache');
  assert.equal(pr.url, 'https://github.com/acme/demo/pull/1');
  assert.ok(!pr.stale, 'a cached merged pull request is not stale');
});

test('with gh not found the build skips pull requests and says so', async () => {
  rmGraphDir(shared.root);
  const host = stubHost(() => {
    throw new GitHostError(GH_NOT_FOUND);
  });
  const { graph, report } = await buildShared({ host });
  assert.ok(!graph.nodes.some((n) => n.kind === 'pull-request'), 'a pull request node without gh or a cache');
  assert.deepEqual(kinds(graph.nodes), NODE_KINDS.filter((k) => k !== 'pull-request').sort());
  assert.ok(report.notes.includes('pull requests skipped: gh not found'), JSON.stringify(report.notes));
});

test('with the host unreachable pull requests come from the cache marked stale', async () => {
  const p = graphRepo();
  try {
    const c = loadConfig(p.root);
    const { buildGraph } = await load('graph/build.js');
    // An open pull request, fetched and cached at the head the state file names.
    const open = stubHost(() => mapPullRequest(prRaw(p.shas.sliceA, { state: 'OPEN' })));
    const first = await buildGraph(p.root, c, { host: open });
    assert.equal(open.calls, 1);
    assert.equal(first.graph.nodes.find((n) => n.id === 'pull-request:1')?.stale, undefined);

    // The state's head moves, so the open answer must be fetched again, and the host cannot be reached.
    commitFixed(p.root, 'chore(P1/S-01): head moved\n\nSlice: P1/S-01', { '.slicekit/state/P1-S-01.json': stateS01('b'.repeat(40)) });
    const down = stubHost(() => {
      throw new GitHostError('gh pr view failed: could not connect');
    });
    const { graph, report } = await buildGraph(p.root, c, { host: down });
    assert.equal(down.calls, 1, 'one failing call stops the rest');
    const pr = graph.nodes.find((n) => n.id === 'pull-request:1');
    assert.ok(pr, 'the cached pull request is left out');
    assert.equal(pr.stale, true);
    assert.equal(pr.state, 'OPEN');
    assert.ok(report.notes.includes('pull requests from the cache: gh pr view failed: could not connect'), JSON.stringify(report.notes));
  } finally {
    p.cleanup();
  }
});

test('a query with no graph built says to run slicekit graph', async () => {
  const { queryCommand } = await load('cli/query.js');
  const r = makeRepo({ files: { '.slicekit/config.json': fs.readFileSync(path.join(shared.root, '.slicekit', 'config.json'), 'utf8') } });
  try {
    const probe = queryCommand({ name: 'probe', usage: 'probe', answer: () => ({ lines: ['never'], json: {} }) });
    let stdout = '';
    let stderr = '';
    const code = await probe.run([], { cwd: r.root, env: process.env, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } });
    assert.equal(code, 1);
    assert.equal(stderr, 'slicekit: no graph at .slicekit/graph/graph.json; run slicekit graph\n');
    assert.equal(stdout, '');
  } finally {
    r.cleanup();
  }
});
