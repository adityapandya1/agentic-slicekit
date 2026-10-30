// slicekit impact <REQ, C-n, slice or path> [--json] (REQ-4.5, REQ-4.6): the contracts, slices, files
// and repositories that share files or contracts with the target, from graph.json.
import { bookkeeping, impact, impactLines } from '../graph/impact.js';
import { GraphError } from '../graph/schema.js';
import { queryCommand } from './query.js';

const USAGE = 'impact <REQ-…|C-…|P<n>/S-<nn>|path> [--json]';

export const impactCommand = queryCommand({
  name: 'impact',
  usage: USAGE,
  answer(index, { positionals, root, cfg }) {
    if (positionals.length !== 1) throw new GraphError(2, `give one requirement, contract, slice or path\nusage: slicekit ${USAGE}`);
    const r = impact(index, positionals[0], { skip: bookkeeping(root, cfg) });
    return { lines: impactLines(r), json: r };
  },
});
