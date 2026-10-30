// The traceability graph's schema (REQ-4.1, D-13, D-45): the node kinds, the edge kinds with the
// (from kind, to kind) pairs each admits, node ids, validation and the one byte-stable serialisation.
export const SCHEMA_VERSION = 1;

export const NODE_KINDS = Object.freeze([
  'intake', 'decision', 'requirement', 'gap', 'contract', 'phase', 'slice', 'test', 'commit',
  'pull-request', 'file', 'release', 'runbook-section', 'repo', 'verdict',
]);

const pairs = (...list) => Object.freeze(list.map((p) => Object.freeze(p.split('>'))));
export const EDGE_KINDS = Object.freeze({
  cites: pairs(
    'requirement>decision', 'requirement>intake', 'slice>decision', 'gap>decision', 'gap>requirement',
    'decision>decision', 'runbook-section>slice', 'runbook-section>requirement', 'runbook-section>decision',
  ),
  covers: pairs('test>requirement'),
  implements: pairs('slice>requirement'),
  touched: pairs('commit>file'),
  in: pairs('commit>slice', 'slice>phase', 'file>repo', 'test>repo', 'pull-request>slice', 'verdict>slice'),
  'reviewed-by': pairs('pull-request>verdict'),
  'released-in': pairs('pull-request>release'),
  produces: pairs('slice>contract'),
  consumes: pairs('slice>contract'),
});

export const nodeId = (kind, key) => `${kind}:${key}`;
export const kindOf = (id) => {
  const i = String(id).indexOf(':');
  return i === -1 ? null : id.slice(0, i);
};
export const keyOf = (id) => String(id).slice(String(id).indexOf(':') + 1);

// code 1: refused (no graph, a bad graph); code 2: usage or an unknown id.
export class GraphError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GraphError';
    this.code = code;
  }
}

const NODE_SET = new Set(NODE_KINDS);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Every problem, in a stable order: the version, then each node in the order given, then each edge.
export function validateGraph(graph) {
  const out = [];
  if (graph?.schemaVersion !== SCHEMA_VERSION) out.push(`schemaVersion is ${graph?.schemaVersion}, not ${SCHEMA_VERSION}`);
  const kinds = new Map();
  for (const n of graph?.nodes ?? []) {
    if (!NODE_SET.has(n.kind)) out.push(`node ${n.id} has kind ${n.kind}, which is not a node kind`);
    else if (!String(n.id).startsWith(`${n.kind}:`)) out.push(`node ${n.id} does not start with ${n.kind}:`);
    if (typeof n.from !== 'string' || n.from === '') out.push(`node ${n.id} has no from`);
    if (kinds.has(n.id)) out.push(`duplicate node ${n.id}`);
    else kinds.set(n.id, n.kind);
  }
  for (const e of graph?.edges ?? []) {
    if (typeof e.at !== 'string' || e.at === '') out.push(`edge ${e.kind} from ${e.from} to ${e.to} has no at`);
    if (!hasOwn(EDGE_KINDS, e.kind)) {
      out.push(`edge kind ${e.kind} is not an edge kind`);
      continue;
    }
    const a = kinds.get(e.from) ?? kindOf(e.from);
    const b = kinds.get(e.to) ?? kindOf(e.to);
    if (!EDGE_KINDS[e.kind].some(([x, y]) => x === a && y === b)) {
      out.push(`edge ${e.kind} runs from ${a} to ${b}, which ${e.kind} does not allow`);
    }
  }
  return out;
}

// Code-unit order, never the locale.
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const edgeCmp = (x, y) => cmp(x.from, y.from) || cmp(x.kind, y.kind) || cmp(x.to, y.to) || cmp(x.at, y.at);

// Keys first in `head`, then the rest sorted; nested values written with sorted keys too.
function ordered(value, head = []) {
  if (Array.isArray(value)) return value.map((v) => ordered(v));
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const k of head) if (hasOwn(value, k) && value[k] !== undefined) out[k] = ordered(value[k]);
  for (const k of Object.keys(value).filter((k) => !head.includes(k)).sort(cmp)) {
    if (value[k] !== undefined) out[k] = ordered(value[k]);
  }
  return out;
}

const NODE_HEAD = ['id', 'kind', 'label', 'from'];
const EDGE_HEAD = ['kind', 'from', 'to', 'at'];

// The graph file's text: one node or edge per line, sorted, keys in a fixed order, ending in a newline.
export function serializeGraph(graph) {
  const nodes = [...(graph.nodes ?? [])].sort((a, b) => cmp(a.id, b.id));
  const edges = [...(graph.edges ?? [])].sort(edgeCmp);
  const list = (items, head) => (items.length === 0 ? '[]' : `[\n${items.map((x) => JSON.stringify(ordered(x, head))).join(',\n')}\n]`);
  const top = [
    `"schemaVersion":${JSON.stringify(graph.schemaVersion)}`,
    `"builtAt":${JSON.stringify(graph.builtAt ?? null)}`,
    `"defaultBranch":${JSON.stringify(graph.defaultBranch ?? null)}`,
    `"sha":${JSON.stringify(graph.sha ?? null)}`,
    `"repos":${JSON.stringify((graph.repos ?? []).map((r) => ordered(r, ['name', 'sha'])))}`,
    `"nodes":${list(nodes, NODE_HEAD)}`,
    `"edges":${list(edges, EDGE_HEAD)}`,
  ];
  return `{\n${top.join(',\n')}\n}\n`;
}

export const sortEdges = (edges) => [...edges].sort(edgeCmp);
