// slicekit history <path> [<path>…] [--json] (REQ-4.5): newest first, the slices and pull requests
// that touched those paths, each with its verdict and release, from graph.json.
import { GraphError } from '../graph/schema.js';
import { history, historyLine } from '../graph/history.js';
import { queryCommand } from './query.js';

const USAGE = 'history <path> [<path>…] [--json]';

export const historyCommand = queryCommand({
  name: 'history',
  usage: USAGE,
  answer(index, { positionals }) {
    if (positionals.length === 0) throw new GraphError(2, `give at least one path\nusage: slicekit ${USAGE}`);
    const entries = history(index, positionals);
    return { lines: entries.map(historyLine), json: entries };
  },
});
