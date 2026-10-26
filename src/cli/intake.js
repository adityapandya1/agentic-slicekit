// `slicekit intake snapshot <file|url>` (REQ-1.2): prints the snapshot's path relative to root.
// `ask`, `answer` and `done` (REQ-2.2) hold the interview.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { GitError } from '../git.js';
import { IntakeError, snapshot } from '../intake.js';

const SUBCOMMANDS = ['snapshot', 'ask', 'answer', 'done'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const USAGE = 'intake snapshot <file|url> [--slug <s>] [--who <w>]';
const OPTIONS = { slug: { type: 'string' }, who: { type: 'string' } };

const usage = (io, why) => {
  io.stderr(`${why ? `slicekit: ${why}\n` : ''}usage: slicekit ${USAGE}\n`);
  return 2;
};

async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true }));
  } catch (e) {
    return usage(io, e.message);
  }
  const [sub, source, ...rest] = positionals;
  if (sub !== 'snapshot' || source === undefined || rest.length > 0) return usage(io);
  // SLICEKIT_NOW is for tests only: it fixes the instant a snapshot is named and stamped with.
  const fixed = (io.env ?? process.env).SLICEKIT_NOW;
  let now = new Date();
  if (fixed !== undefined && fixed !== '') {
    now = new Date(fixed);
    if (!ISO.test(fixed) || Number.isNaN(now.getTime())) return usage(io, `SLICEKIT_NOW '${fixed}' is not an ISO time`);
  }
  const root = io.cwd;
  try {
    const cfg = loadConfig(root);
    const { file } = await snapshot(root, cfg, source, { slug: values.slug, who: values.who, now });
    io.stdout(`${path.relative(root, file).split(path.sep).join('/')}\n`);
    return 0;
  } catch (e) {
    if (e instanceof IntakeError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return e.code;
    }
    if (e instanceof ConfigError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    if (e instanceof GitError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

export const intakeCommand = { run, usage: USAGE, subcommands: SUBCOMMANDS };
