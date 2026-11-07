// `slicekit sync open` (03 REQ-3.11, D-78, D-80): the CI sync job's second step, after `status --sync
// --write` on the default branch. It puts the state change on a `sync/<short sha>` branch, opens a
// `[sync]` pull request for it through the git host (C-1) and starts the workflow there; see
// openSyncPullRequest. With that pull request already open it opens no second one and starts the
// workflow on the branch again. Exit 0 when it opened one, found one open, or had nothing to open; 1 when git,
// the host or the body refuses; 2 on bad usage or a bad config.
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { GitError } from '../git.js';
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { SLICEKIT_WORKFLOW } from '../adapters/githost/gh-json.js';
import { SyncOpenError, openSyncPullRequest } from '../state/sync.js';

const USAGE = 'sync open';

const fail = (io, message, code) => {
  for (const line of message.split('\n')) io.stderr(`slicekit: ${line}\n`);
  return code;
};

async function run(args, io) {
  let positionals;
  try {
    ({ positionals } = parseArgs({ args, options: {}, allowPositionals: true }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  if (positionals.length !== 1 || positionals[0] !== 'open') {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  const root = io.cwd;
  try {
    const cfg = loadConfig(root);
    const host = getHost(cfg, io.env ?? process.env, root);
    const r = openSyncPullRequest(root, cfg, host);
    if (r.outcome === 'unchanged') io.stdout('sync: no state change; nothing to open\n');
    else if (r.outcome === 'open') io.stdout(`sync: #${r.number} ${r.url} is already open for ${r.branch}\n`);
    else io.stdout(`#${r.number} ${r.url}\ndispatched ${SLICEKIT_WORKFLOW.file} on ${r.branch}\n`);
    return 0;
  } catch (e) {
    if (e instanceof ConfigError) return fail(io, e.message, 2);
    if (e instanceof SyncOpenError || e instanceof GitError || e instanceof GitHostError) return fail(io, e.message, 1);
    throw e;
  }
}

export const syncCommand = { run, usage: USAGE, subcommands: ['open'] };
