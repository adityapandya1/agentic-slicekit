import { parseArgs } from 'node:util';
import { ConfigError } from '../config.js';
import { readBaselinesWithProblems, updateBaselines } from '../baseline.js';
import { check } from '../check/index.js';

const USAGE = 'baseline <update [--adopt]|show> [--json]';

// `update` ratchets the baselines down to today's counts and refuses to raise any (REQ-3.7): exit 1
// when something was refused or a baseline file is damaged. `update --adopt` is the one exception,
// a first adoption from a developer machine, and is refused in CI. `show` prints the baselines as
// JSON and any problems on stderr. Exit 2 on bad usage. `io.rules` is a test seam; production
// leaves it unset and `check` loads the rule files.
async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: { json: { type: 'boolean' }, adopt: { type: 'boolean' } },
      allowPositionals: true,
    }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  const [sub, ...extra] = positionals;
  if ((sub !== 'update' && sub !== 'show') || extra.length > 0 || (values.adopt && sub !== 'update')) {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  const env = io.env ?? process.env;
  if (sub === 'show') {
    const { baselines, problems } = readBaselinesWithProblems(io.cwd);
    for (const p of problems) io.stderr(`baseline ${p.file}: ${p.problem}\n`);
    io.stdout(`${JSON.stringify(baselines, null, 2)}\n`);
    return 0;
  }
  if (values.adopt && env.CI) {
    io.stderr('slicekit: --adopt is not allowed in CI; adopt a baseline from a developer machine and commit it\n');
    return 2;
  }
  let result;
  try {
    result = check(io.cwd, { env, ...(io.rules ? { rules: io.rules } : {}) });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    io.stderr(`slicekit: ${e.message}\n`);
    return 2;
  }
  const before = readBaselinesWithProblems(io.cwd).problems;
  const { written, refused, adopted, rewrote } = updateBaselines(io.cwd, result.ratchetCounts, { adopt: Boolean(values.adopt) });
  const rewroteFiles = new Set(rewrote.map((r) => r.file));
  const remaining = before.filter((p) => !rewroteFiles.has(p.file));
  if (values.json) {
    io.stdout(`${JSON.stringify({ written, refused, adopted, rewrote, problems: remaining }, null, 2)}\n`);
  } else {
    for (const r of rewrote) io.stdout(`rewrote ${r.file} (was: ${r.problem})\n`);
    for (const p of remaining) io.stdout(`baseline ${p.file}: ${p.problem}\n`);
    for (const w of written) io.stdout(`baseline ${w.rule} ${w.bucket}: ${w.from} → ${w.to}\n`);
    for (const a of adopted) io.stdout(`adopted ${a.rule} ${a.bucket}: ${a.from} → ${a.to}\n`);
    for (const r of refused) io.stdout(`refused ${r.rule} ${r.bucket}: ${r.from} → ${r.to} (${r.reason ?? 'a baseline may only go down'})\n`);
  }
  return refused.length > 0 || remaining.length > 0 ? 1 : 0;
}

export const baselineCommand = { run, usage: USAGE };
