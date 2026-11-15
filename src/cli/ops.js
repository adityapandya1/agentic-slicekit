// slicekit ops context <symptom> [--path <p>]… [--json] and slicekit ops check <report> (REQ-2.13,
// D-57): what `/slicekit ops` hands the ops agent, and the check of the report it replies with.
// Neither runs git, calls the host or takes an action.
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { historyLine } from '../graph/history.js';
import { indexGraph, loadGraph } from '../graph/load.js';
import { GraphError } from '../graph/schema.js';
import { opsContext, opsReportProblems } from '../ops.js';
import { readReport } from '../reports.js';

const USAGE = 'ops context <symptom> [--path <p>]… [--json]\n  ops check <report>';
const SUBCOMMANDS = ['context', 'check'];

const usage = (io, why) => {
  io.stderr(`${why ? `slicekit: ${why}\n` : ''}usage: slicekit ${USAGE}\n`);
  return 2;
};

function contextLines(c) {
  return [
    c.report,
    `symptom: ${c.symptom}`,
    ...c.files.map((f) => `file: ${f}`),
    ...c.broad.map((b) => `too broad: ${b.word} (${b.count} files)`),
    ...(c.unmatched.length > 0 ? [`no file: ${c.unmatched.join(', ')}`] : []),
    'history:',
    ...c.history.map(historyLine),
    `runbook: ${c.runbook}${c.missing.includes(c.runbook) ? ' (missing)' : ''}`,
    `observability: ${c.observability}${c.missing.includes(c.observability) ? ' (missing)' : ''}`,
    `last release: ${c.lastRelease ?? 'none'}`,
  ];
}

async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args, options: { path: { type: 'string', multiple: true }, json: { type: 'boolean' } }, allowPositionals: true }));
  } catch (e) {
    return usage(io, e.message);
  }
  const [sub, ...rest] = positionals;
  if (!SUBCOMMANDS.includes(sub)) return usage(io, sub === undefined ? 'missing subcommand' : `unknown subcommand '${sub}'`);
  const json = Boolean(values.json);
  const refuse = (message, code) => {
    io.stderr(`slicekit: ${message}\n`);
    if (json) io.stdout(`${JSON.stringify({ error: message }, null, 2)}\n`);
    return code;
  };
  const root = io.cwd;
  try {
    const cfg = loadConfig(root);
    if (sub === 'context') {
      // The words of a symptom typed without quotes are one symptom.
      const symptom = rest.join(' ').trim();
      const paths = values.path ?? [];
      if (symptom === '' && paths.length === 0) return usage(io, 'missing symptom');
      const context = opsContext(root, cfg, symptom, { paths });
      io.stdout(json ? `${JSON.stringify(context, null, 2)}\n` : contextLines(context).map((l) => `${l}\n`).join(''));
      return 0;
    }
    if (rest.length !== 1) return usage(io, rest.length === 0 ? 'missing report' : `unexpected argument ${rest[1]}`);
    if (values.path) return usage(io, 'ops check takes no --path');
    const { rel, text } = readReport(root, rest[0]);
    if (text === null) return refuse(`${rel} is not a file`, 2);
    const problems = opsReportProblems(root, indexGraph(loadGraph(root, cfg)), rel, text);
    if (json) io.stdout(`${JSON.stringify({ report: rel, problems }, null, 2)}\n`);
    else io.stdout(problems.length > 0 ? problems.map((p) => `${p}\n`).join('') : `ok ${rel}\n`);
    return problems.length > 0 ? 1 : 0;
  } catch (e) {
    if (e instanceof GraphError) return refuse(e.message, e.code);
    if (e instanceof ConfigError) return refuse(e.message, 2);
    throw e;
  }
}

export const opsCommand = { run, usage: USAGE, subcommands: SUBCOMMANDS };
