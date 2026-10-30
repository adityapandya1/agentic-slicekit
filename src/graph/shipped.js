// shipped (REQ-4.5): a release record's pull requests and the requirements their slices implement.
// Reads the index only.
import { GraphError, cmp, kindOf } from './schema.js';

const PHASE = /^P\d+$/;

export function shipped(index, phase) {
  const p = String(phase ?? '').trim();
  const release = PHASE.test(p) ? index.node(`release:${p}`) : null;
  if (!release) {
    if (PHASE.test(p) && index.node(`phase:${p}`)) throw new GraphError(1, `${p} has no release record`);
    throw new GraphError(2, `${p} is not in the graph`);
  }
  const pullRequests = index
    .in(release.id, 'released-in')
    .filter((e) => kindOf(e.from) === 'pull-request')
    .map((e) => index.node(e.from))
    .filter(Boolean)
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || cmp(a.id, b.id));
  const reqs = new Map();
  for (const pr of pullRequests) {
    for (const s of index.out(pr.id, 'in')) {
      if (kindOf(s.to) !== 'slice') continue;
      for (const e of index.out(s.to, 'implements')) {
        const r = index.node(e.to);
        if (r?.kind === 'requirement') reqs.set(r.id, r);
      }
    }
  }
  const requirements = [...reqs.values()].sort((a, b) => cmp(a.id, b.id));
  return { release, path: String(release.from ?? '').replace(/:\d+$/, ''), requirements, pullRequests };
}
