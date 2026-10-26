// `slicekit build <sub>` (REQ-2.6): the deterministic steps of `/slicekit build`. Each subcommand
// lands with its task; S-15 and S-16 add theirs.
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { GitError } from '../git.js';
import { SliceFileError } from '../slicefile.js';
import { LockError, TransitionError } from '../state/index.js';
import { runnable, waiting } from '../build/order.js';
import { red } from '../build/red.js';
import { BuildError, startSlice } from '../build/worktree.js';

const SUBCOMMANDS = ['next', 'start', 'red', 'commit', 'amend', 'pr'];
const USAGE = 'build next | build start <id> [--descr <d>] | build red <id> --tests <a,b> [--worktree <p>]';

const OPTIONS = {
  descr: { type: 'string' },
  tests: { type: 'string' },
  worktree: { type: 'string' },
};

function next(root, io, positionals) {
  if (positionals.length > 0) return usage(io);
  const cfg = loadConfig(root);
  const ready = runnable(root, cfg);
  if (ready.length > 0) {
    io.stdout(`${ready[0].id}\n`);
    return 0;
  }
  io.stdout(['no slice is ready to build', ...waiting(root, cfg)].map((l) => `${l}\n`).join(''));
  return 1;
}

function start(root, io, positionals, values) {
  if (positionals.length !== 1) return usage(io);
  const cfg = loadConfig(root);
  const { worktree, branch } = startSlice(root, cfg, positionals[0], {
    descr: values.descr,
    onWarning: (msg) => io.stderr(`${msg}\n`),
  });
  io.stdout(`${worktree}\n${branch}\n`);
  return 0;
}

function redStep(root, io, positionals, values) {
  if (positionals.length !== 1 || values.tests === undefined) return usage(io);
  const cfg = loadConfig(root);
  const { commit } = red(root, cfg, positionals[0], { tests: values.tests, worktree: values.worktree });
  io.stdout(`${commit}
tests-red → building
`);
  return 0;
}

const HANDLERS = { next, start, red: redStep };

function usage(io) {
  io.stderr(`usage: slicekit ${USAGE}\n`);
  return 2;
}

async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\n`);
    return usage(io);
  }
  const [sub, ...rest] = positionals;
  const handler = Object.hasOwn(HANDLERS, sub ?? '') ? HANDLERS[sub] : undefined;
  if (!handler) return usage(io);
  try {
    return handler(io.cwd, io, rest, values);
  } catch (e) {
    if (e instanceof BuildError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return e.code;
    }
    if (e instanceof ConfigError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    if (e instanceof GitError || e instanceof SliceFileError || e instanceof TransitionError || e instanceof LockError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 1;
    }
    if (/^unknown slice /.test(e.message)) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export const buildCommand = { run, usage: USAGE, subcommands: SUBCOMMANDS };
