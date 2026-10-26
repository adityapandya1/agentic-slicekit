// `slicekit plan check` (REQ-2.5): exit 0 with `ready to plan`, or exit 1 with one blocker per line.
import { ConfigError, loadConfig } from '../config.js';
import { planBlockers } from '../plan.js';

const USAGE = 'plan check';

async function run(args, io) {
  if (args.length !== 1 || args[0] !== 'check') {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  let cfg;
  try {
    cfg = loadConfig(io.cwd);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    io.stderr(`slicekit: ${e.message}\n`);
    return 2;
  }
  const blockers = planBlockers(io.cwd, cfg);
  if (blockers.length > 0) {
    io.stdout(blockers.map((b) => `${b}\n`).join(''));
    return 1;
  }
  io.stdout('ready to plan\n');
  return 0;
}

export const planCommand = { run, usage: USAGE, subcommands: ['check'] };
