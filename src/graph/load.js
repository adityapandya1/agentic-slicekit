// Reading the graph (S-18, S-19, S-20): queries and visualize never run git or call the host; they
// load graph.json and work on an in-memory index by id, by kind and by edge direction.
import fs from 'node:fs';
import path from 'node:path';
import { kitPaths } from '../paths.js';
import { GraphError, SCHEMA_VERSION } from './schema.js';

const posix = (p) => p.split(path.sep).join('/');

export const graphFile = (root, cfg) => path.join(kitPaths(root, cfg).graph, 'graph.json');

export function loadGraph(root, cfg) {
  const file = graphFile(root, cfg);
  const rel = posix(path.relative(root, file));
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new GraphError(1, `no graph at ${rel}; run slicekit graph`);
    throw e;
  }
  let graph;
  try {
    graph = JSON.parse(text);
  } catch {
    throw new GraphError(1, `${rel} is not valid JSON; run slicekit graph --full`);
  }
  if (graph?.schemaVersion !== SCHEMA_VERSION) {
    throw new GraphError(1, `${rel} is schema ${graph?.schemaVersion}; this kit reads ${SCHEMA_VERSION}; run slicekit graph --full`);
  }
  return graph;
}

// What a user types for a path: backslashes to /, a leading ./ and a trailing / removed.
export const normalisePath = (p) => String(p).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');

const ID_FORMS = [
  [/^REQ-\d+\.\d+$/, 'requirement'],
  [/^D-\d+$/, 'decision'],
  [/^G-\d+$/, 'gap'],
  [/^C-\d+$/, 'contract'],
  [/^P\d+\/S-\d{2}$/, 'slice'],
];

export function indexGraph(graph) {
  const byId = new Map();
  const kinds = new Map();
  const outs = new Map();
  const ins = new Map();
  for (const n of graph.nodes ?? []) {
    byId.set(n.id, n);
    if (!kinds.has(n.kind)) kinds.set(n.kind, []);
    kinds.get(n.kind).push(n);
  }
  for (const e of graph.edges ?? []) {
    if (!outs.has(e.from)) outs.set(e.from, []);
    outs.get(e.from).push(e);
    if (!ins.has(e.to)) ins.set(e.to, []);
    ins.get(e.to).push(e);
  }
  const pick = (map, id, kind) => (map.get(id) ?? []).filter((e) => kind === undefined || e.kind === kind);
  const commits = kinds.get('commit') ?? [];

  function find(text) {
    const t = String(text ?? '').trim();
    if (t === '') return null;
    for (const [form, kind] of ID_FORMS) if (form.test(t)) return byId.has(`${kind}:${t}`) ? `${kind}:${t}` : null;
    if (/^P\d+$/.test(t)) return byId.has(`phase:${t}`) ? `phase:${t}` : byId.has(`release:${t}`) ? `release:${t}` : null;
    const pr = /^#(\d+)$/.exec(t);
    if (pr) return byId.has(`pull-request:${pr[1]}`) ? `pull-request:${pr[1]}` : null;
    // A workspace repository's pull request, <name>#<n> (S-20).
    if (/^[A-Za-z0-9._-]+#\d+$/.test(t)) return byId.has(`pull-request:${t}`) ? `pull-request:${t}` : null;
    if (/^[0-9a-f]{7,40}$/i.test(t)) {
      const lower = t.toLowerCase();
      const hits = commits.filter((c) => c.id.slice('commit:'.length).startsWith(lower));
      if (hits.length === 1) return hits[0].id;
      if (hits.length > 1) return null;
    }
    if (byId.has(t)) return t;
    const p = normalisePath(t);
    for (const kind of ['file', 'test']) if (byId.has(`${kind}:${p}`)) return `${kind}:${p}`;
    return null;
  }

  return {
    graph,
    node: (id) => byId.get(id) ?? null,
    byKind: (kind) => kinds.get(kind) ?? [],
    out: (id, kind) => pick(outs, id, kind),
    in: (id, kind) => pick(ins, id, kind),
    find,
  };
}
