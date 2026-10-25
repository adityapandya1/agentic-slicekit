import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { writeText } from '../fs.js';
import { WORKFLOW_DRIFT, WORKFLOW_PATH, workflowState } from '../workflow.js';

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
  try {
    state = workflowState(io.cwd, loadConfig(io.cwd));
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
