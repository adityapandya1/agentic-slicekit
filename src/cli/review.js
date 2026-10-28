// `slicekit review <sub>` (REQ-2.8): the deterministic steps of `/slicekit review`. `review start <PR>`
// prints the slice, the review worktree, the round and the verdict path; later `build` calls in that
// worktree pass `--worktree <path>`, since two worktrees then hold the slice.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { GitError } from '../git.js';
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { LockError, TransitionError } from '../state/index.js';
import { startReview } from '../build/review.js';
import { BuildError } from '../build/worktree.js';

const SUBCOMMANDS = ['start'];
const USAGE = 'review start <PR>';

function usage(io) {
  io.stderr(`usage: slicekit ${USAGE}\n`);
  return 2;
}

function start(root, io, positionals) {
  if (positionals.length !== 1 || !/^[1-9]\d*$/.test(positionals[0])) return usage(io);
  const cfg = loadConfig(root);
  const host = getHost(cfg, io.env ?? process.env, root);
  const r = startReview(root, cfg, host, Number(positionals[0]));
  const where = path.resolve(r.worktree).split(path.sep).join('/');
  io.stdout(`slice ${r.id}\nworktree ${where}\nround ${r.round}\nverdict ${r.verdictPath}\n`);
  return 0;
}

const HANDLERS = { start };

async function run(args, io) {
  let positionals;
  try {
    ({ positionals } = parseArgs({ args, options: {}, allowPositionals: true }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\n`);
    return usage(io);
  }
  const [sub, ...rest] = positionals;
  const handler = Object.hasOwn(HANDLERS, sub ?? '') ? HANDLERS[sub] : undefined;
  if (!handler) return usage(io);
  try {
    return handler(io.cwd, io, rest);
  } catch (e) {
    if (e instanceof BuildError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return e.code;
    }
    if (e instanceof ConfigError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    if (e instanceof GitError || e instanceof GitHostError || e instanceof TransitionError || e instanceof LockError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

export const reviewCommand = { run, usage: USAGE, subcommands: SUBCOMMANDS };
