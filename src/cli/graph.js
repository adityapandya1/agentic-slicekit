import { parseArgs } from 'node:util';
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { ConfigError, loadConfig } from '../config.js';
import { buildGraph, writeGraph } from '../graph/build.js';
import { GraphError } from '../graph/schema.js';
import { reachRepos, readWorkspace } from '../graph/workspace.js';

const USAGE = 'graph [--full]';

// Builds the traceability graph (REQ-4.1 to REQ-4.4): the path first, then what was built and
// walked, then each workspace repository not reached (REQ-4.6), then each note; warnings go to
// stderr. The only command that reaches the git host (C-1).
async function run(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { full: { type: 'boolean' } }, allowPositionals: false }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  const root = io.cwd;
  let cfg;
  try {
    cfg = loadConfig(root);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    io.stderr(`slicekit: ${e.message}\n`);
    return 2;
  }
  const env = io.env ?? process.env;
  let reached;
  let unreached;
  try {
    ({ reached, unreached } = reachRepos(root, cfg, readWorkspace(root, cfg), env));
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    io.stderr(`${e.message}\n`);
    return e.code;
  }
  let host = null;
  let skipped = null;
  try {
    host = getHost(cfg, env, root);
  } catch (e) {
    if (!(e instanceof GitHostError)) throw e;
    skipped = `pull requests skipped: ${e.message}`;
  }
  try {
    const built = buildGraph(root, cfg, { host, full: Boolean(values.full), skipped, repos: reached });
    const rel = writeGraph(root, cfg, built);
    const { graph, report } = built;
    const lines = [
      rel,
      `nodes ${graph.nodes.length} edges ${graph.edges.length}`,
      `commits walked ${report.walked} of ${report.commits}`,
      `files read ${report.read} of ${report.files}`,
      `pull requests fetched ${report.fetched}, from the cache ${report.cached}`,
      ...unreached.map((u) => `repo ${u.name} not reached: ${u.reason}`),
      ...report.notes,
    ];
    io.stdout(`${lines.join('\n')}\n`);
    for (const w of report.warnings) io.stderr(`${w}\n`);
    return 0;
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    io.stderr(`${e.message.startsWith('graph: ') ? e.message : `graph: ${e.message}`}\n`);
    return e.code;
  }
}

export const graphCommand = { run, usage: USAGE };
