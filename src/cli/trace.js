// slicekit trace <REQ> | trace --file <path> [--json] (REQ-4.5): the tree under a requirement or
// above a file, from graph.json.
import { GraphError } from '../graph/schema.js';
import { renderLines, traceFile, traceRequirement, treeJson } from '../graph/trace.js';
import { queryCommand } from './query.js';

const USAGE = 'trace <REQ-…> | trace --file <path> [--json]';

export const traceCommand = queryCommand({
  name: 'trace',
  usage: USAGE,
  options: { file: { type: 'string' } },
  answer(index, { positionals, values }) {
    const hasFile = typeof values.file === 'string';
    if (hasFile === positionals.length > 0 || positionals.length > 1) {
      throw new GraphError(2, `give one requirement or --file <path>\nusage: slicekit ${USAGE}`);
    }
    const tree = hasFile ? traceFile(index, values.file) : traceRequirement(index, positionals[0]);
    return { lines: renderLines(tree), json: treeJson(tree) };
  },
});
