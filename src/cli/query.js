// The shell every query command is made from (S-18, S-20): argument parsing with --json, the config
// and the graph loaded, the missing-graph and unknown-ID refusals. A query runs no git and no host call.
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { indexGraph, loadGraph } from '../graph/load.js';
import { GraphError } from '../graph/schema.js';

// answer(index, {positionals, values, root, cfg}) -> {lines: string[], json}
export function queryCommand({ name, usage, options = {}, answer }) {
  async function run(args, io) {
    let parsed;
    try {
      parsed = parseArgs({ args, options: { ...options, json: { type: 'boolean' } }, allowPositionals: true });
    } catch (e) {
      io.stderr(`slicekit: ${e.message}\nusage: slicekit ${usage}\n`);
      if (args.includes('--json')) io.stdout(`${JSON.stringify({ error: e.message })}\n`);
      return 2;
    }
    const json = Boolean(parsed.values.json);
    const refuse = (message, code) => {
      io.stderr(`slicekit: ${message}\n`);
      if (json) io.stdout(`${JSON.stringify({ error: message }, null, 2)}\n`);
      return code;
    };
    try {
      const cfg = loadConfig(io.cwd);
      const index = indexGraph(loadGraph(io.cwd, cfg));
      const result = await answer(index, { positionals: parsed.positionals, values: parsed.values, root: io.cwd, cfg });
      io.stdout(json ? `${JSON.stringify(result.json, null, 2)}\n` : result.lines.map((l) => `${l}\n`).join(''));
      return 0;
    } catch (e) {
      if (e instanceof GraphError) return refuse(e.message, e.code);
      if (e instanceof ConfigError) return refuse(e.message, 2);
      throw e;
    }
  }
  void name;
  return { run, usage };
}
