import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { writeText } from '../fs.js';
import { WORKFLOW_DRIFT, WORKFLOW_PATH, shardWarnings, workflowState } from '../workflow.js';

const USAGE = 'workflow [--write | --check]';

// Prints the workflow the config renders; --write puts it at .github/workflows/slicekit.yml and
// --check exits 1 when that file is missing or differs from the render (REQ-3.11, REQ-5.5).
async function run(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { write: { type: 'boolean' }, check: { type: 'boolean' } }, allowPositionals: false }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  if (values.write && values.check) {
    io.stderr(`slicekit: --write and --check do not go together\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  let state;
  let cfg;
  try {
    cfg = loadConfig(io.cwd);
    state = workflowState(io.cwd, cfg);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    io.stderr(`slicekit: ${e.message}\n`);
    return 2;
  }
  if (values.check) {
    if (state.current === state.expected) return 0;
    io.stderr(`slicekit: ${state.current === null ? `${WORKFLOW_PATH} is missing; run slicekit workflow --write to create it` : WORKFLOW_DRIFT}\n`);
    return 1;
  }
  if (values.write) {
    // D-49: a test command that never reads SLICEKIT_SHARD runs whole in every shard.
    for (const w of shardWarnings(io.cwd, cfg)) io.stderr(`slicekit: warning: ${w}\n`);
    if (state.current === state.expected) {
      io.stdout(`unchanged ${WORKFLOW_PATH}\n`);
    } else {
      writeText(state.file, state.expected);
      io.stdout(`${state.current === null ? 'created' : 'updated'} ${WORKFLOW_PATH}\n`);
    }
    return 0;
  }
  io.stdout(state.expected);
  return 0;
}

export const workflowCommand = { run, usage: USAGE };
