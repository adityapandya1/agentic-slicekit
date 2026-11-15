// slicekit audit context [area] [--all] [--no-report] [--json] and
// slicekit audit check <report> [area] [--every-claim] (REQ-2.14, D-58):
// the claims `/slicekit audit` hands the auditor, each with the files it names and its candidate
// commits, and the check of the auditor's report against the claims of the same area, which the
// check reads from the spec and the runbook as the context does. With --no-report the context is
// printed alone and no report file is reserved (issue #157). With --every-claim a claim of the
// area that has no row is a problem. Neither changes a tracked file.
import { parseArgs } from 'node:util';
import { auditClaims, auditContext, auditReportProblems } from '../audit.js';
import { ConfigError, loadConfig } from '../config.js';
import { GitError } from '../git.js';
import { indexGraph, loadGraph } from '../graph/load.js';
import { GraphError } from '../graph/schema.js';
import { readReport } from '../reports.js';

const USAGE = 'audit context [area] [--all] [--no-report] [--json]\n  audit check <report> [area] [--every-claim]';
const SUBCOMMANDS = ['context', 'check'];

const usage = (io, why) => {
  io.stderr(`${why ? `slicekit: ${why}\n` : ''}usage: slicekit ${USAGE}\n`);
  return 2;
};

// `(none)` is what a procedure prints for no argument.
const areaOf = (arg) => (arg === undefined || arg === '(none)' ? undefined : arg);

// The candidate commits printed for one claim without --all (P5/S-23 review H-7).
export const SHOWN = 10;

// The narrowest area that names `claim`: its REQ ID, or `runbook` for a runbook section.
const areaFor = (claim) => (claim.id.startsWith('runbook#') ? 'runbook' : claim.id);

// The report path when one was reserved, then at most SHOWN candidates per claim, the newest, then
// one line counting the rest and naming the command that prints them and reserves no report, with
// the kit's command prefix `cli`; with `all`, each one. --json and the check hold every candidate.
function contextLines(c, { all = false, cli = 'slicekit' } = {}) {
  const out = c.report === null ? [] : [c.report];
  for (const claim of c.claims) {
    out.push(`${claim.id} ${claim.where} ${claim.title}`.trimEnd());
    out.push(`  files: ${claim.files.join(', ')}`.trimEnd());
    const shown = all ? claim.candidates : claim.candidates.slice(0, SHOWN);
    for (const k of shown) out.push(`  candidate ${k.sha.slice(0, 7)} ${k.date} ${k.subject}`.trimEnd());
    const more = claim.candidates.length - shown.length;
    if (more > 0) out.push(`  ${more} more candidate${more === 1 ? '' : 's'}, each older: ${cli} audit context ${areaFor(claim)} --all --no-report`);
  }
  return out;
}

async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args, options: { json: { type: 'boolean' }, all: { type: 'boolean' }, 'no-report': { type: 'boolean' }, 'every-claim': { type: 'boolean' } }, allowPositionals: true }));
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
      if (rest.length > 1) return usage(io, `unexpected argument ${rest[1]}`);
      const context = auditContext(root, cfg, areaOf(rest[0]), { report: !values['no-report'] });
      io.stdout(json ? `${JSON.stringify(context, null, 2)}\n` : contextLines(context, { all: Boolean(values.all), cli: cfg.cli }).map((l) => `${l}\n`).join(''));
      return 0;
    }
    if (rest.length === 0) return usage(io, 'missing report');
    if (rest.length > 2) return usage(io, `unexpected argument ${rest[2]}`);
    const { rel, text } = readReport(root, rest[0]);
    if (text === null) return refuse(`${rel} is not a file`, 2);
    const claims = auditClaims(root, cfg, indexGraph(loadGraph(root, cfg)), areaOf(rest[1]));
    const problems = auditReportProblems(root, rel, text, claims, { everyClaim: Boolean(values['every-claim']) });
    if (json) io.stdout(`${JSON.stringify({ report: rel, problems }, null, 2)}\n`);
    else io.stdout(problems.length > 0 ? problems.map((p) => `${p}\n`).join('') : `ok ${rel}\n`);
    return problems.length > 0 ? 1 : 0;
  } catch (e) {
    if (e instanceof GraphError) return refuse(e.message, e.code);
    if (e instanceof ConfigError) return refuse(e.message, 2);
    if (e instanceof GitError) return refuse(e.message, 1);
    throw e;
  }
}

export const auditCommand = { run, usage: USAGE, subcommands: SUBCOMMANDS };
