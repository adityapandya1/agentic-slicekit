// `slicekit stage require <stage>` (REQ-1.7): a command's gate. Exit 0 with `ready: <stage>` when
// the stage and every one before it are complete; exit 1 with the first blocker and the command
// that clears it. Pending rows that do not block follow, one per line.
import { ConfigError, loadConfig } from '../config.js';
import { STAGES, StageError, programStage } from '../stage.js';

const USAGE = 'stage require <stage>';

async function run(args, io) {
  const [sub, stage, ...rest] = args;
  if (sub !== 'require' || stage === undefined || rest.length > 0) {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  if (!STAGES.includes(stage)) {
    io.stderr(`slicekit: unknown stage '${stage}'; one of ${STAGES.join(', ')}\n`);
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
  const now = programStage(io.cwd, cfg, { upTo: stage });
  const pending = (now.pending ?? []).map((line) => `${line}\n`).join('');
  if (!now.complete) {
    io.stderr(`${new StageError(now.stage, now.blockers[0]).message}\n${pending}`);
    return 1;
  }
  io.stdout(`ready: ${stage}\n${pending}`);
  return 0;
}

export const stageCommand = { run, usage: USAGE, subcommands: ['require'] };
