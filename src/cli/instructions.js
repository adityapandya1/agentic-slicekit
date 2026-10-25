import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { InstructionsError, briefSlice, checkRole, renderBrief, renderProcedure, renderSummary } from '../instructions.js';

const USAGE =
  'instructions <role> [P<n>/S-<nn>] [--worktree <path> | --summary]\n' +
  '  slicekit instructions --command <name> [args...]';

const usage = (io, why) => {
  io.stderr(`${why ? `slicekit: ${why}\n` : ''}usage: slicekit ${USAGE}\n`);
  return 2;
};

// Prints an agent's brief, its short form (`--summary`, which subagent-start injects) or a command's
// procedure (REQ-2.12). Everything after `--command <name>`
// goes to the procedure unparsed. Exit 1 when the template is not built, 2 on usage or an unknown name.
async function run(args, io) {
  let produce;
  if (args[0] === '--command') {
    const [, name, ...rest] = args;
    if (name === undefined) return usage(io, 'missing command name');
    produce = (cfg) => renderProcedure(io.cwd, cfg, name, rest);
  } else {
    let values;
    let positionals;
    try {
      ({ values, positionals } = parseArgs({ args, options: { worktree: { type: 'string' }, summary: { type: 'boolean' } }, allowPositionals: true }));
    } catch (e) {
      return usage(io, e.message);
    }
    if (positionals.length === 0) return usage(io, 'missing role');
    if (positionals.length > 2) return usage(io, `unexpected argument ${positionals[2]}`);
    if (values.worktree !== undefined && values.worktree.trim() === '') return usage(io, '--worktree needs a path');
    if (values.summary && values.worktree !== undefined) return usage(io, '--summary takes no --worktree');
    const [role, slice] = positionals;
    // The role is checked before the slice is resolved, so a bad role is the error a caller sees.
    produce = (cfg) => {
      checkRole(cfg, role);
      const id = briefSlice(io.cwd, slice);
      const fromBranch = slice === undefined;
      return values.summary
        ? renderSummary(io.cwd, cfg, role, id, { fromBranch })
        : renderBrief(io.cwd, cfg, role, id, { worktree: values.worktree, fromBranch });
    };
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
