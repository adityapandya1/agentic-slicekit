// Nodes and edges from the kit's own files (REQ-4.2): state files, verdict files and the journal.
import path from 'node:path';
import { parseLine } from '../journal.js';
import { re } from '../ids.js';
import { parseVerdict } from '../verdict.js';
import { nodeId } from './schema.js';

const lineOf = (text, needle) => {
  const i = String(text).replace(/\r\n/g, '\n').split('\n').findIndex((l) => l.includes(needle));
  return i === -1 ? 1 : i + 1;
};

// A state file: a patch on its slice (state, mergedAt, history), and the slice's pull request as a
// reference. A file that is not JSON gives a warning.
export function stateFragment(rel, text) {
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    return { nodes: [], edges: [], warnings: [`graph: ${rel} is not valid JSON`] };
  }
  if (!s || typeof s.slice !== 'string' || !re('sliceAddr').test(s.slice)) return { nodes: [], edges: [] };
  const id = nodeId('slice', s.slice);
  const history = (Array.isArray(s.history) ? s.history : []).map((h) => ({ to: h?.to ?? null, at: h?.at ?? null }));
  const out = { nodes: [{ id, patch: true, state: s.state ?? null, mergedAt: s.mergedAt ?? null, history }], edges: [], prRefs: [] };
  const n = s.pr?.number;
  if (Number.isInteger(n) && n > 0) {
    out.prRefs.push({ number: n, at: `${rel}:${lineOf(text, '"number"')}`, slice: id });
  }
  return out;
}

const VERDICT_NAME = /^(P\d+)-(S-\d{2})(i?)-r([1-9]\d*)\.md$/;

// A verdict file `P<n>-S-<nn>[i]-r<k>.md`: a verdict node and its `in` edge to the slice.
export function verdictFragment(rel, text) {
  const m = VERDICT_NAME.exec(path.posix.basename(rel));
  if (!m) return { nodes: [], edges: [] };
  const stem = path.posix.basename(rel, '.md');
  const v = parseVerdict(text, rel);
  const id = nodeId('verdict', stem);
  const at = `${rel}:1`;
  return {
    nodes: [{ id, kind: 'verdict', label: v.verdict ?? 'unreadable', from: at, verdict: v.verdict, head: v.head, independent: m[3] === 'i', round: Number(m[4]) }],
    edges: [{ kind: 'in', from: id, to: nodeId('slice', `${m[1]}/${m[2]}`), at }],
  };
}

// A journal file: each line's decisions cited by its slice, at that line.
export function journalFragment(rel, text) {
  const out = { nodes: [], edges: [] };
  String(text).split('\n').forEach((line, i) => {
    const p = parseLine(line);
    if (!p || !re('sliceAddr').test(p.slice)) return;
    for (const d of new Set(p.decisions)) {
      if (new RegExp(`^${re('decision').source}$`).test(d)) out.edges.push({ kind: 'cites', from: nodeId('slice', p.slice), to: nodeId('decision', d), at: `${rel}:${i + 1}` });
    }
  });
  return out;
}
