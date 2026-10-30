// impact (REQ-4.5, REQ-4.6): the files, slices and contracts that share files or contracts with a
// requirement, a contract, a slice or a path, across the repositories of a workspace. Reads the
// index only; no git, no host.
//
// The start set: for a requirement, the slices that implement it; for a contract, the contract; for a
// slice, the slice; for a path, its file nodes (a directory matches every file under it) and the
// slices whose commits touched them. The start files are the start set's files; the start contracts
// the contracts its slices produce or consume, or the contract itself. The kit's own bookkeeping
// (the queue file and the state, reviews, journal and graph directories) is never a start file: every
// slice touches it, so it would relate every slice to every other (S-20 review B-2).
import path from 'node:path';
import { kitPaths } from '../paths.js';
import { normalisePath } from './load.js';
import { GraphError, cmp, keyOf, kindOf } from './schema.js';

const TARGETS = new Set(['requirement', 'contract', 'slice', 'file', 'test']);

// bookkeeping(root, cfg) -> (file id) -> true for a file of the program repository that is the
// kit's bookkeeping, from kitPaths.
export function bookkeeping(root, cfg) {
  const kp = kitPaths(root, cfg);
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
  const files = new Set([rel(kp.build)]);
  const dirs = [kp.state, path.join(kp.kit, 'reviews'), kp.journalDir, kp.graph].map((d) => `${rel(d)}/`);
  return (id) => {
    const p = keyOf(id);
    return files.has(p) || dirs.some((d) => p.startsWith(d));
  };
}

const repoOf = (slice) => (typeof slice.repo === 'string' && slice.repo !== '' ? slice.repo : '.');

// The file ids touched by a slice's commits.
function filesOf(index, sliceId) {
  const out = new Set();
  for (const e of index.in(sliceId, 'in')) {
    if (kindOf(e.from) !== 'commit') continue;
    for (const t of index.out(e.from, 'touched')) out.add(t.to);
  }
  return out;
}

// The slice ids whose commits touched a file.
function slicesTouching(index, fileId) {
  const out = new Set();
  for (const e of index.in(fileId, 'touched')) {
    for (const s of index.out(e.from, 'in')) if (kindOf(s.to) === 'slice') out.add(s.to);
  }
  return out;
}

// The file node ids a path names: the file itself, else every file under it as a directory.
function filesAt(index, text) {
  const p = normalisePath(text);
  if (p === '') return [];
  if (index.node(`file:${p}`)) return [`file:${p}`];
  const under = `${p}/`;
  return index.byKind('file').filter((n) => keyOf(n.id).startsWith(under)).map((n) => n.id);
}

// The start set of a target -> {target, slices: Set, files: Set, contracts: Set}, or null when the
// target is nothing in the graph. `target` is the node id, or the path itself for a directory. A node
// of another kind is refused with its kind (S-20 review H-3).
function start(index, text, skip) {
  const id = index.find(text);
  const kind = id ? kindOf(id) : null;
  if (kind !== null && !TARGETS.has(kind)) {
    throw new GraphError(2, `impact takes a requirement, contract, slice or path; ${text} is a ${kind}`);
  }
  const s = { target: id, slices: new Set(), files: new Set(), contracts: new Set() };
  if (kind === 'requirement') {
    for (const e of index.in(id, 'implements')) if (index.node(e.from)) s.slices.add(e.from);
  } else if (kind === 'contract') {
    s.contracts.add(id);
  } else if (kind === 'slice') {
    s.slices.add(id);
  } else if (kind === null || kind === 'file' || kind === 'test') {
    const named = filesAt(index, text);
    if (named.length === 0) return null;
    if (kind !== 'file') s.target = normalisePath(text);
    for (const f of named.filter((x) => !skip(x))) {
      s.files.add(f);
      for (const slice of slicesTouching(index, f)) s.slices.add(slice);
    }
  }
  for (const slice of s.slices) {
    if (kind === 'requirement' || kind === 'slice') for (const f of filesOf(index, slice)) if (!skip(f)) s.files.add(f);
    for (const k of ['produces', 'consumes']) for (const e of index.out(slice, k)) s.contracts.add(e.to);
  }
  return s;
}

// impact(index, target) -> {target, contracts: [{id, label}], slices: [{id, name, repo, relations}],
// files: [path], repos: [name]}. Nothing found -> GraphError(2, `<target> is not in the graph`).
// `skip(file id)` is true for a file never counted as shared, e.g. bookkeeping(root, cfg).
export function impact(index, target, { skip = () => false } = {}) {
  const s = start(index, target, skip);
  if (!s) throw new GraphError(2, `${target} is not in the graph`);
  const implementing = new Set(kindOf(s.target) === 'requirement' ? index.in(s.target, 'implements').map((e) => e.from) : []);

  // Every listed slice and how it relates: implements, touched <k> shared files, produces or
  // consumes a start contract.
  const shared = new Map();
  for (const f of s.files) {
    for (const slice of slicesTouching(index, f)) shared.set(slice, (shared.get(slice) ?? 0) + 1);
  }
  const parties = new Map();
  for (const c of [...s.contracts].sort(cmp)) {
    for (const kind of ['produces', 'consumes']) {
      for (const e of index.in(c, kind)) {
        if (!parties.has(e.from)) parties.set(e.from, []);
        const rel = `${kind} ${keyOf(c)}`;
        if (!parties.get(e.from).includes(rel)) parties.get(e.from).push(rel);
      }
    }
  }
  const ids = [...new Set([...implementing, ...shared.keys(), ...parties.keys()])].filter((id) => index.node(id)).sort(cmp);
  const slices = ids.map((id) => {
    const node = index.node(id);
    const relations = [];
    if (implementing.has(id)) relations.push('implements');
    if (shared.has(id)) relations.push(`touched ${shared.get(id)} shared files`);
    relations.push(...(parties.get(id) ?? []));
    return { id: keyOf(id), name: node.name ?? node.label ?? keyOf(id), repo: repoOf(node), relations };
  });

  const files = [...s.files].map(keyOf).sort(cmp);
  const repos = new Set(slices.map((x) => x.repo));
  for (const f of s.files) for (const e of index.out(f, 'in')) if (kindOf(e.to) === 'repo') repos.add(keyOf(e.to));
  const contracts = [...s.contracts].sort(cmp).map((c) => ({ id: keyOf(c), label: index.node(c)?.label ?? '' }));
  return { target: s.target, contracts, slices, files, repos: [...repos].sort(cmp) };
}

// The text answer: four headed sections; an empty one says none.
export function impactLines(r) {
  const section = (head, items) => [head, ...(items.length === 0 ? ['  none'] : items.map((x) => `  ${x}`))];
  return [
    ...section('contracts:', r.contracts.map((c) => `${c.id}${c.label ? ` ${c.label}` : ''}`)),
    ...section('slices:', r.slices.map((x) => `${x.id}  repo ${x.repo}  ${x.relations.join(', ')}`)),
    ...section('files:', r.files),
    `repos: ${r.repos.length === 0 ? 'none' : r.repos.join(', ')}`,
  ];
}
