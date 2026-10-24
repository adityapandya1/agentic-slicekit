import { parseArgs } from 'node:util';
import { ConfigError } from '../config.js';
import { readBaselines, updateBaselines } from '../baseline.js';
import { check } from '../check/index.js';

const USAGE = 'baseline <update|show> [--json]';

// `update` ratchets the baselines down to today's counts and refuses to raise any (REQ-3.7): exit 1
// when something was refused. `show` prints the current baselines as JSON. Exit 2 on bad usage.
async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args, options: { json: { type: 'boolean' } }, allowPositionals: true }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  const [sub, ...extra] = positionals;
  if ((sub !== 'update' && sub !== 'show') || extra.length > 0) {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  if (sub === 'show') {
    io.stdout(`${JSON.stringify(readBaselines(io.cwd), null, 2)}\n`);
    return 0;
  }
  let result;
  try {
    result = check(io.cwd, { env: io.env ?? process.env });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    io.stderr(`slicekit: ${e.message}\n`);
    return 2;
  }
  const { written, refused } = updateBaselines(io.cwd, result.ratchetCounts);
  if (values.json) {
    io.stdout(`${JSON.stringify({ written, refused }, null, 2)}\n`);
  } else {
    for (const w of written) io.stdout(`baseline ${w.rule} ${w.bucket}: ${w.from} → ${w.to}\n`);
    for (const r of refused) io.stdout(`refused ${r.rule} ${r.bucket}: ${r.from} → ${r.to} (a baseline may only go down)\n`);
  }
  return refused.length > 0 ? 1 : 0;
}

export const baselineCommand = { run, usage: USAGE };
