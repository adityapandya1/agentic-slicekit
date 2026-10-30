// slicekit uncovered [--json] (REQ-4.5): requirements with no covering test, tests naming no
// requirement, and commits on the default branch with no slice trailer, from graph.json.
import { nodeLine } from '../graph/render.js';
import { GraphError } from '../graph/schema.js';
import { uncovered } from '../graph/uncovered.js';
import { queryCommand } from './query.js';

const USAGE = 'uncovered [--json]';

const brief = (n) => ({ id: n.id, kind: n.kind, label: n.label, from: n.from, ...(n.kind === 'commit' ? { date: n.date } : {}) });

export const uncoveredCommand = queryCommand({
  name: 'uncovered',
  usage: USAGE,
  answer(index, { positionals }) {
    if (positionals.length > 0) throw new GraphError(2, `uncovered takes no argument\nusage: slicekit ${USAGE}`);
    const u = uncovered(index);
    const def = index.graph.defaultBranch ?? 'main';
    const lines = [
      `requirements with no covering test: ${u.requirements.length}`,
      ...u.requirements.map((n) => `  ${nodeLine(n)}  ${n.from}`),
      `tests naming no requirement: ${u.tests.length}`,
      ...u.tests.map((n) => `  ${nodeLine(n)}`),
      `commits on ${def} with no slice trailer: ${u.commits.length}`,
      ...u.commits.map((n) => `  ${nodeLine(n)}`),
    ];
    return {
      lines,
      json: { defaultBranch: def, requirements: u.requirements.map(brief), tests: u.tests.map(brief), commits: u.commits.map(brief) },
    };
  },
});
