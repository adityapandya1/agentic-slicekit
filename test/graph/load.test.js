// P3/S-17 Task 4: loading the graph (REQ-4.4), its index, and the lines queries print.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defaultConfig } from '../../src/config.js';
import { graphFile, indexGraph, loadGraph } from '../../src/graph/load.js';
import { nodeLine, renderTree } from '../../src/graph/render.js';
import { serializeGraph } from '../../src/graph/schema.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const graph = {
  schemaVersion: 1,
  builtAt: '2026-10-01T00:00:00Z',
  defaultBranch: 'main',
  sha: SHA,
  repos: [{ name: '.', sha: SHA }],
  nodes: [
    { id: 'requirement:REQ-4.1', kind: 'requirement', label: 'Nodes and edges', from: 'docs/spec/04.md:3' },
    { id: 'slice:P3/S-17', kind: 'slice', label: 'Graph builder', from: 'docs/phases/P3-trace/S-17.md:2', name: 'Graph builder', state: 'building' },
    { id: 'file:src/a.js', kind: 'file', label: 'src/a.js', from: SHA },
    { id: `commit:${SHA}`, kind: 'commit', label: 'feat: a', from: SHA, subject: 'feat: a' },
    { id: 'pull-request:19', kind: 'pull-request', label: 't', from: '#19', number: 19, url: 'https://github.com/o/r/pull/19', stale: true },
  ],
  edges: [
    { kind: 'implements', from: 'slice:P3/S-17', to: 'requirement:REQ-4.1', at: 'docs/phases/P3-trace/S-17.md:7' },
    { kind: 'touched', from: `commit:${SHA}`, to: 'file:src/a.js', at: SHA },
  ],
};

let repo;
let cfg;
before(() => {
  repo = makeRepo();
  cfg = defaultConfig({ name: 'demo', shape: 'backend' });
});
after(() => repo.cleanup());

test('REQ-4.4 find gives the same id for a path written three ways', () => {
  const idx = indexGraph(graph);
  for (const p of ['src\\a.js', './src/a.js', 'src/a.js', 'src/a.js/']) assert.equal(idx.find(p), 'file:src/a.js', p);
  assert.equal(idx.find('REQ-4.1'), 'requirement:REQ-4.1');
  assert.equal(idx.find('P3/S-17'), 'slice:P3/S-17');
  assert.equal(idx.find('#19'), 'pull-request:19');
  assert.equal(idx.find(SHA.slice(0, 7)), `commit:${SHA}`);
  assert.equal(idx.find('REQ-9.9'), null);
  assert.equal(idx.find('src/b.js'), null);
  assert.deepEqual(idx.out('slice:P3/S-17').map((e) => e.to), ['requirement:REQ-4.1']);
  assert.deepEqual(idx.in('file:src/a.js', 'touched').map((e) => e.from), [`commit:${SHA}`]);
  assert.equal(idx.byKind('file').length, 1);
});

test('REQ-4.4 loadGraph refuses a missing graph and a graph of another schema', () => {
  assert.throws(() => loadGraph(repo.root, cfg), (e) => e.code === 1 && e.message === 'no graph at .slicekit/graph/graph.json; run slicekit graph');
  const file = graphFile(repo.root, cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeGraph({ ...graph, schemaVersion: 2 }));
  assert.throws(() => loadGraph(repo.root, cfg), (e) => e.code === 1 && /schema 2; this kit reads 1; run slicekit graph --full$/.test(e.message));
  fs.writeFileSync(file, serializeGraph(graph));
  assert.equal(loadGraph(repo.root, cfg).nodes.length, 5);
});

test('REQ-4.4 nodeLine and renderTree', () => {
  const idx = indexGraph(graph);
  assert.equal(nodeLine(idx.node('requirement:REQ-4.1')), 'requirement REQ-4.1 Nodes and edges');
  assert.equal(nodeLine(idx.node('slice:P3/S-17')), 'slice P3/S-17 Graph builder (building)');
  assert.equal(nodeLine(idx.node(`commit:${SHA}`)), 'commit 0123456 feat: a');
  assert.equal(nodeLine(idx.node('pull-request:19')), 'pull request #19 https://github.com/o/r/pull/19, stale');
  const tree = { node: idx.node('requirement:REQ-4.1'), children: [{ node: idx.node('slice:P3/S-17'), children: [{ node: idx.node('file:src/a.js') }] }] };
  assert.deepEqual(renderTree(tree), ['requirement REQ-4.1 Nodes and edges', '  slice P3/S-17 Graph builder (building)', '    file src/a.js']);
});
