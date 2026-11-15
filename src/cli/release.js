// `slicekit release P<n> [--dry-run]` (02 REQ-2.9, D-54): writes the phase's release record, sets
// each slice released and rewrites BUILD.md; it commits nothing and deploys nothing (D-12, D-19).
// Exit 0 with the record's path and one `released <id>` line per slice (with --dry-run, the record's
// text and nothing written); 1 when it refuses, one `slicekit: <line>` per reason; 2 on bad usage, a
// bad config or a phase that is not one.
import { parseArgs } from 'node:util';
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { ConfigError, loadConfig } from '../config.js';
import { GitError } from '../git.js';
import { ReleaseError, writeRelease } from '../release.js';
import { SliceFileError } from '../slicefile.js';
import { LockError, TransitionError } from '../state/index.js';

const USAGE = 'release P<n> [--dry-run]';

const fail = (io, message, code) => {
  for (const line of message.split('\n')) io.stderr(`slicekit: ${line}\n`);
  return code;
};

async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args, options: { 'dry-run': { type: 'boolean' } }, allowPositionals: true }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  if (positionals.length !== 1 || !/^P[1-9]\d*$/.test(positionals[0])) {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  const root = io.cwd;
  try {
    const cfg = loadConfig(root);
    const host = getHost(cfg, io.env ?? process.env, root);
    const r = writeRelease(root, cfg, positionals[0], { host, dryRun: values['dry-run'] === true });
    if (values['dry-run']) io.stdout(r.text);
    else io.stdout(`${r.rel}\n${r.slices.map((id) => `released ${id}\n`).join('')}`);
    return 0;
  } catch (e) {
    if (e instanceof ConfigError) return fail(io, e.message, 2);
    if (e instanceof ReleaseError) return fail(io, e.message, e.code);
    if (e instanceof GitError || e instanceof GitHostError || e instanceof TransitionError || e instanceof LockError || e instanceof SliceFileError) return fail(io, e.message, 1);
    throw e;
  }
}

export const releaseCommand = { run, usage: USAGE };
