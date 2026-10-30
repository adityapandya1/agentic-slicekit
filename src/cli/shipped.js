// slicekit shipped P<n> [--json] (REQ-4.5): the release record of a phase, its requirements and its
// pull requests with their URLs, from graph.json.
import { GraphError, keyOf } from '../graph/schema.js';
import { shipped } from '../graph/shipped.js';
import { queryCommand } from './query.js';

const USAGE = 'shipped P<n> [--json]';

export const shippedCommand = queryCommand({
  name: 'shipped',
  usage: USAGE,
  answer(index, { positionals }) {
    if (positionals.length !== 1) throw new GraphError(2, `give one phase\nusage: slicekit ${USAGE}`);
    const phase = positionals[0];
    const s = shipped(index, phase);
    const lines = [
      `${keyOf(s.release.id)} ${s.path}`,
      `requirements: ${s.requirements.length}`,
      ...s.requirements.map((r) => `  ${keyOf(r.id)} ${r.label}  ${r.from}`),
      `pull requests: ${s.pullRequests.length}`,
      ...s.pullRequests.map((p) => `  #${p.number ?? keyOf(p.id)} ${p.label} ${p.url ?? ''}`.trimEnd()),
    ];
    return {
      lines,
      json: {
        release: { id: s.release.id, path: s.path, from: s.release.from },
        requirements: s.requirements.map((r) => ({ id: r.id, label: r.label, from: r.from })),
        pullRequests: s.pullRequests.map((p) => ({ id: p.id, number: p.number ?? Number(keyOf(p.id)), title: p.label, url: p.url ?? null })),
      },
    };
  },
});
