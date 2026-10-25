// `slicekit pr open` (02 REQ-2.10, REQ-2.1): commits the named paths, pushes the branch, and opens
// its pull request through the git host (C-1), or updates the body of the one already open. The
// command owns git (D-19). Exit 0 with `#<n> <url>` or `updated #<n> <url>`; 1 when git, the host
// or the body refuses; 2 on bad usage.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { GitError } from '../git.js';
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { PrError, openOrUpdate } from '../pr.js';

const USAGE = 'pr open --title <t> --body-file <f> [--commit <message> --paths <a,b>] [--draft] [--base <b>]';
const OPTIONS = {
  title: { type: 'string' },
  'body-file': { type: 'string' },
  commit: { type: 'string' },
  paths: { type: 'string' },
  base: { type: 'string' },
  draft: { type: 'boolean' },
};

const usage = (io, why) => {
  io.stderr(`${why ? `slicekit: ${why}\n` : ''}usage: slicekit ${USAGE}\n`);
  return 2;
};

const fail = (io, message, code) => {
  for (const line of message.split('\n')) io.stderr(`slicekit: ${line}\n`);
  return code;
};

async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true }));
  } catch (e) {
    return usage(io, e.message);
  }
  if (positionals.length !== 1 || positionals[0] !== 'open') return usage(io);
  if (values.title === undefined || values['body-file'] === undefined) return usage(io);
  if ((values.commit === undefined) !== (values.paths === undefined)) return usage(io, '--commit and --paths go together');
  const paths = values.paths === undefined ? undefined : values.paths.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (paths !== undefined && paths.length === 0) return usage(io, '--paths names no path');
  if (values.commit !== undefined && values.commit.trim() === '') return usage(io, '--commit needs a message');

  const root = io.cwd;
  let body;
  try {
    body = fs.readFileSync(path.resolve(root, values['body-file']), 'utf8');
  } catch (e) {
    return usage(io, `cannot read the body file ${values['body-file']}: ${e.code ?? e.message}`);
  }
  try {
    const cfg = loadConfig(root);
    const host = getHost(cfg, io.env ?? process.env, root);
    const r = openOrUpdate(root, cfg, host, {
      title: values.title,
      body,
      base: values.base ?? cfg.defaultBranch,
      draft: values.draft,
      commit: values.commit === undefined ? undefined : { message: values.commit, paths },
    });
    io.stdout(`${r.created ? '' : 'updated '}#${r.number} ${r.url}\n`);
    return 0;
  } catch (e) {
    if (e instanceof PrError) return fail(io, e.message, e.code);
    if (e instanceof ConfigError) return fail(io, e.message, 2);
    if (e instanceof GitError || e instanceof GitHostError) return fail(io, e.message, 1);
    throw e;
  }
}

export const prCommand = { run, usage: USAGE, subcommands: ['open'] };
