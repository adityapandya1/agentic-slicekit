// One line per node, and a tree of them, for the query commands (S-18, S-20).
import { keyOf } from './schema.js';

const join = (...parts) => parts.filter((p) => p !== undefined && p !== null && p !== '').join(' ');

export function nodeLine(node) {
  const key = keyOf(node.id);
  switch (node.kind) {
    case 'requirement': return join('requirement', key, node.label);
    case 'slice': return join('slice', key, node.name ?? node.label, node.state ? `(${node.state})` : undefined);
    case 'test': return join('test', key);
    case 'commit': return join('commit', key.slice(0, 7), node.subject ?? node.label);
    case 'pull-request': return `${join('pull request', `#${node.number ?? key}`, node.url)}${node.stale ? ', stale' : ''}`;
    case 'file': return join('file', key);
    case 'release': return join('release', key);
    case 'contract': return join('contract', key, node.label);
    case 'decision': return join('decision', key);
    case 'verdict': return join('verdict', key, node.verdict ?? node.label);
    default: return join(node.kind, key, node.label);
  }
}

// {node, children} -> lines, two spaces per level, children in the order given.
export function renderTree(tree, depth = 0) {
  const out = [`${'  '.repeat(depth)}${nodeLine(tree.node)}`];
  for (const c of tree.children ?? []) out.push(...renderTree(c, depth + 1));
  return out;
}
