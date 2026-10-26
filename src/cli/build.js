// `slicekit build <sub>` (REQ-2.6): the deterministic steps of `/slicekit build`. Each subcommand
// lands with its task; S-15 and S-16 add theirs.
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { GitError } from '../git.js';
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { PrError } from '../pr.js';
import { SliceFileError } from '../slicefile.js';
import { LockError, TransitionError } from '../state/index.js';
import { runnable, waiting } from '../build/order.js';
import { amend, commitWork } from '../build/commit.js';
import { openSlicePr } from '../build/pr.js';
import { red } from '../build/red.js';
import { BuildError, startSlice } from '../build/worktree.js';

const SUBCOMMANDS = ['next', 'start', 'red', 'commit', 'amend', 'pr'];
const USAGE =
  'build next | build start <id> [--descr <d>] | build red <id> --tests <a,b> [--worktree <p>] | build commit <id> --message <m> [--require-green] [--worktree <p>] | build amend <id> --test <path> --reason <r> [--worktree <p>] | build pr <id> --notes <file> [--worktree <p>]';

const OPTIONS = {
  descr: { type: 'string' },
  tests: { type: 'string' },
  worktree: { type: 'string' },
  message: { type: 'string' },
  'require-green': { type: 'boolean' },
  test: { type: 'string' },
  reason: { type: 'string' },
  notes: { type: 'string' },
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
  io.stdout(`${commit}\ntests-red → building\n`);
  return 0;
}

function commitStep(root, io, positionals, values) {
  if (positionals.length !== 1 || values.message === undefined) return usage(io);
  const cfg = loadConfig(root);
  const { sha, exit } = commitWork(root, cfg, positionals[0], {
    message: values.message,
    requireGreen: Boolean(values['require-green']),
    worktree: values.worktree,
  });
  io.stdout(sha === null ? 'nothing to commit\n' : `${sha.slice(0, 7)} exit ${exit}\n`);
  return 0;
}

function amendStep(root, io, positionals, values) {
  if (positionals.length !== 1 || values.test === undefined || values.reason === undefined) return usage(io);
  const cfg = loadConfig(root);
  const { test } = amend(root, cfg, positionals[0], { test: values.test, reason: values.reason, worktree: values.worktree });
  io.stdout(`unfroze ${test}\n`);
  return 0;
}

function prStep(root, io, positionals, values) {
  if (positionals.length !== 1 || values.notes === undefined) return usage(io);
  const cfg = loadConfig(root);
  const host = getHost(cfg, io.env ?? process.env, root);
  const { number, url } = openSlicePr(root, cfg, host, positionals[0], { notes: values.notes, worktree: values.worktree });
  io.stdout(`#${number} ${url}
`);
  return 0;
}

const HANDLERS = { next, start, red: redStep, commit: commitStep, amend: amendStep, pr: prStep };

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
    if (e instanceof BuildError || e instanceof PrError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return e.code;
    }
    if (e instanceof ConfigError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    if (e instanceof GitError || e instanceof GitHostError || e instanceof SliceFileError || e instanceof TransitionError || e instanceof LockError) {
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
