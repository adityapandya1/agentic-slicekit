// uncovered (REQ-4.5, REQ-4.3): requirements no test covers, test files naming no requirement, and
// commits on the default branch with no slice trailer (merge commits left out). Reads the index only.
import { cmp, kindOf } from './schema.js';
import { newestFirst } from './trace.js';

const byId = (a, b) => cmp(a.id, b.id);

export function uncovered(index) {
  const requirements = index.byKind('requirement').filter((r) => index.in(r.id, 'covers').length === 0).sort(byId);
  const tests = index.byKind('test').filter((t) => index.out(t.id, 'covers').length === 0).sort(byId);
  const commits = index
    .byKind('commit')
    .filter((c) => c.default === true && c.merge === false && !index.out(c.id, 'in').some((e) => kindOf(e.to) === 'slice'))
    .sort(newestFirst);
  return { requirements, tests, commits };
}
