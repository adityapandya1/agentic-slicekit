// P3/S-17 Task 1: the graph's schema (REQ-4.1), its byte-stable serialisation (REQ-4.4) and which
// files are tests (REQ-4.3, D-46).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NODE_KINDS, EDGE_KINDS, SCHEMA_VERSION, nodeId, serializeGraph, validateGraph } from '../../src/graph/schema.js';
import { DEFAULT_TEST_FILES, isTestFile, reqMentions } from '../../src/graph/tests.js';

const SHA = 'a'.repeat(40);
const nodes = () => [
  { id: nodeId('requirement', 'REQ-1.1'), kind: 'requirement', label: 'It works', from: 'docs/spec/01-x.md:3' },
  { id: nodeId('commit', SHA), kind: 'commit', label: 'c', from: SHA, date: '2026-10-01T00:00:00Z' },
  { id: nodeId('slice', 'P1/S-01'), kind: 'slice', label: 'a', from: 'docs/phases/P1-x/S-01-a.md:2', state: 'merged', group: 'A' },
];
const edges = () => [
  { kind: 'implements', from: 'commit:' + SHA, to: 'requirement:REQ-1.1', at: SHA },
  { kind: 'implements', from: 'slice:P1/S-01', to: 'requirement:REQ-1.1', at: 'docs/phases/P1-x/S-01-a.md:7' },
];
const graph = (n, e) => ({ schemaVersion: SCHEMA_VERSION, builtAt: '2026-10-01T00:00:00Z', defaultBranch: 'main', sha: SHA, repos: [{ name: '.', sha: SHA }], nodes: n, edges: e });

test('REQ-4.1 the kinds: fifteen node kinds and nine edge kinds', () => {
  assert.equal(NODE_KINDS.length, 15);
  assert.ok(NODE_KINDS.includes('verdict'));
  assert.equal(Object.keys(EDGE_KINDS).length, 9);
  assert.deepEqual(EDGE_KINDS.covers, [['test', 'requirement']]);
});

test('REQ-4.1 validateGraph refuses an implements edge from a commit to a requirement', () => {
  assert.deepEqual(validateGraph(graph(nodes(), edges())), ['edge implements runs from commit to requirement, which implements does not allow']);
  assert.deepEqual(validateGraph(graph(nodes(), edges().slice(1))), []);
});

test('REQ-4.1 validateGraph names each problem in a stable order', () => {
  const bad = graph(
    [
      { id: 'thing:x', kind: 'thing', label: '', from: 'x' },
      { id: 'slice:P1/S-01', kind: 'requirement', label: '', from: 'y' },
      { id: 'test:a.test.js', kind: 'test', label: '' },
      { id: 'test:a.test.js', kind: 'test', label: '', from: 'a.test.js:1' },
    ],
    [{ kind: 'links', from: 'a', to: 'b', at: '' }],
  );
  bad.schemaVersion = 2;
  assert.deepEqual(validateGraph(bad), [
    'schemaVersion is 2, not 1',
    'node thing:x has kind thing, which is not a node kind',
    'node slice:P1/S-01 does not start with requirement:',
    'node test:a.test.js has no from',
    'duplicate node test:a.test.js',
    'edge links from a to b has no at',
    'edge kind links is not an edge kind',
  ]);
});

test('REQ-4.4 serializeGraph gives one string for nodes and edges in any order', () => {
  const ok = edges().slice(1);
  const a = serializeGraph(graph(nodes(), [...ok, { kind: 'in', from: 'slice:P1/S-01', to: 'phase:P1', at: 'x:2' }]));
  const b = serializeGraph(graph(nodes().reverse(), [{ at: 'x:2', to: 'phase:P1', from: 'slice:P1/S-01', kind: 'in' }, ...ok]));
  assert.equal(a, b);
  assert.ok(a.endsWith('\n'));
  const lines = a.split('\n');
  assert.equal(lines[1], '"schemaVersion":1,');
  // A node's keys: id, kind, label, from, then the rest sorted.
  assert.ok(lines.includes('{"id":"slice:P1/S-01","kind":"slice","label":"a","from":"docs/phases/P1-x/S-01-a.md:2","group":"A","state":"merged"}'), a);
  assert.deepEqual(JSON.parse(a).nodes.map((n) => n.id), ['commit:' + SHA, 'requirement:REQ-1.1', 'slice:P1/S-01']);
});

test('REQ-4.3 isTestFile: the three default shapes, and nothing else', () => {
  assert.equal(DEFAULT_TEST_FILES.length, 3);
  for (const p of ['a.test.js', 'pkg/a_test.go', 'test_a.py', 'src/BillingTest.java', 'web/a-spec.ts', 'src/BillingTests.cs']) assert.ok(isTestFile(p, {}), p);
  for (const p of ['src/Billing.java', 'test/helpers/x.js', 'docs/testing.md', 'src/contest.js']) assert.ok(!isTestFile(p, {}), p);
  assert.ok(isTestFile('spec/a.rb', { testFiles: ['^spec/'] }));
  assert.ok(!isTestFile('a.test.js', { testFiles: ['^spec/'] }));
});

test('REQ-4.3 reqMentions counts lines the same with CRLF and LF', () => {
  assert.deepEqual(reqMentions('a\r\nb REQ-1.2 and REQ-3.4\r\n// REQ-1.2\r\n'), [
    { req: 'REQ-1.2', line: 2 },
    { req: 'REQ-3.4', line: 2 },
    { req: 'REQ-1.2', line: 3 },
  ]);
});
