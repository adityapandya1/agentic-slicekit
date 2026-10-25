import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { InstructionsError, briefSlice, renderBrief, renderProcedure } from '../instructions.js';

const USAGE =
  'instructions <role> [P<n>/S-<nn>] [--worktree <path>]\n' +
  '  slicekit instructions --command <name> [args...]';

const usage = (io, why) => {
  io.stderr(`${why ? `slicekit: ${why}\n` : ''}usage: slicekit ${USAGE}\n`);
  return 2;
};

// Prints an agent's brief or a command's procedure (REQ-2.12). Everything after `--command <name>`
// goes to the procedure unparsed. Exit 1 when the template is not built, 2 on usage or an unknown name.
async function run(args, io) {
  let produce;
  if (args[0] === '--command') {
    const [, name, ...rest] = args;
    if (name === undefined) return usage(io);
    produce = (cfg) => renderProcedure(io.cwd, cfg, name, rest);
  } else {
    let values;
    let positionals;
    try {
      ({ values, positionals } = parseArgs({ args, options: { worktree: { type: 'string' } }, allowPositionals: true }));
    } catch (e) {
      return usage(io, e.message);
    }
    if (positionals.length < 1 || positionals.length > 2) return usage(io);
    const [role, slice] = positionals;
    produce = (cfg) => renderBrief(io.cwd, cfg, role, briefSlice(io.cwd, slice), { worktree: values.worktree });
  }
  try {
    const text = produce(loadConfig(io.cwd));
    io.stdout(text.endsWith('\n') ? text : `${text}\n`);
    return 0;
  } catch (e) {
    if (e instanceof InstructionsError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return e.code;
    }
    if (e instanceof ConfigError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export const instructionsCommand = { run, usage: USAGE };
