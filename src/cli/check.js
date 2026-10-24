import { parseArgs } from 'node:util';
import { ConfigError } from '../config.js';
import { check } from '../check/index.js';

const USAGE = 'check [--ci] [--json]';

const OPTIONS = {
  ci: { type: 'boolean' },
  json: { type: 'boolean' },
};

// The kit's one gate: the Stop hook and CI both run it. Exit 0 clean, 1 on a failing finding,
// 2 when it cannot run (bad arguments or config). Under --json stdout carries one JSON document.
async function run(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  let result;
  try {
    result = check(io.cwd, { ci: Boolean(values.ci), env: io.env ?? process.env });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    if (values.json) io.stdout(`${JSON.stringify({ error: e.message }, null, 2)}\n`);
    io.stderr(`slicekit: ${e.message}\n`);
    return 2;
  }
  if (values.json) {
    const { findings, counts, exitCode } = result;
    io.stdout(`${JSON.stringify({ findings, counts, exitCode }, null, 2)}\n`);
  } else {
    io.stdout(`${result.lines.join('\n')}\n`);
  }
  return result.exitCode;
}

export const checkCommand = { run, usage: USAGE };
