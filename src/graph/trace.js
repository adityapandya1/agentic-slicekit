// trace (REQ-4.5): the tree under a requirement (its slices with their pull requests, commits and
// files, then the tests that cover it) and the tree above a file (the slices whose commits touched
// it, with the requirements and decisions above each). Reads the index only; no git, no host.
import { nodeLine } from './render.js';
import { GraphError, cmp, keyOf, kindOf } from './schema.js';

const byId = (a, b) => cmp(a.id, b.id);
// Commit dates keep each committer's time-zone offset, so they are compared as instants, not text.
export const timeOf = (d) => (d ? Date.parse(d) : Number.NEGATIVE_INFINITY);
const byTime = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
export const newestFirst = (a, b) => byTime(timeOf(b.date), timeOf(a.date)) || cmp(a.id, b.id);

// The distinct nodes of `kind` at the `side` end of `edges`, in id order.
function ends(index, edges, side, kind) {
  const seen = new Map();
  for (const e of edges) {
    const id = e[side];
    if (kindOf(id) !== kind || seen.has(id)) continue;
    const n = index.node(id);
    if (n) seen.set(id, n);
  }
  return [...seen.values()].sort(byId);
}

const leaf = (node, children = []) => ({ node, children });
const byNumber = (a, b) => (a.number ?? 0) - (b.number ?? 0) || byId(a, b);

function sliceUnderRequirement(index, slice) {
  const ins = index.in(slice.id, 'in');
  const prs = ends(index, ins, 'from', 'pull-request').sort(byNumber);
  const commits = ends(index, ins, 'from', 'commit').sort(newestFirst);
  return leaf(slice, [
    ...prs.map((p) => leaf(p)),
    ...commits.map((c) => leaf(c, ends(index, index.out(c.id, 'touched'), 'to', 'file').map((f) => leaf(f)))),
  ]);
}

const lineOf = (at) => Number(/:(\d+)$/.exec(at ?? '')?.[1] ?? 0);

export function traceRequirement(index, id) {
  const rid = index.find(id);
  if (!rid || kindOf(rid) !== 'requirement') throw new GraphError(2, `${id} is not in the graph`);
  const slices = ends(index, index.in(rid, 'implements'), 'from', 'slice').map((s) => sliceUnderRequirement(index, s));
  const tests = index
    .in(rid, 'covers')
    .filter((e) => kindOf(e.from) === 'test' && index.node(e.from))
    .sort((a, b) => cmp(a.from, b.from) || lineOf(a.at) - lineOf(b.at))
    .map((e) => ({ node: index.node(e.from), at: e.at, text: `test ${e.at}`, children: [] }));
  return { node: index.node(rid), children: [...slices, ...tests] };
}

const decisionsCited = (index, id) => ends(index, index.out(id, 'cites'), 'to', 'decision').map((d) => leaf(d));

export function traceFile(index, path) {
  const fid = index.find(path);
  if (!fid || kindOf(fid) !== 'file') throw new GraphError(2, `${path} is not in the graph`);
  const sliceEdges = index.in(fid, 'touched').flatMap((e) => index.out(e.from, 'in'));
  const slices = ends(index, sliceEdges, 'to', 'slice').map((s) => {
    const reqs = ends(index, index.out(s.id, 'implements'), 'to', 'requirement').map((r) => leaf(r, decisionsCited(index, r.id)));
    return leaf(s, [...reqs, ...decisionsCited(index, s.id)]);
  });
  return { node: index.node(fid), children: slices };
}

// Two spaces per level; a child with its own text (a test at its line) prints that text.
export function renderLines(tree, depth = 0) {
  const out = [`${'  '.repeat(depth)}${tree.text ?? nodeLine(tree.node)}`];
  for (const c of tree.children ?? []) out.push(...renderLines(c, depth + 1));
  return out;
}

// {id, kind, label, from, at?, children}
export function treeJson(tree) {
  const n = tree.node;
  return {
    id: n.id,
    kind: n.kind,
    label: n.label ?? keyOf(n.id),
    from: n.from,
    ...(tree.at ? { at: tree.at } : {}),
    children: (tree.children ?? []).map(treeJson),
  };
}
