// `slicekit ci bookkeeping` (REQ-3.11, D-49): whether the commits of a pull request push change only
// the kit's own bookkeeping, by the D-35 rule `build finish` uses (headCovers). It prints one line,
// `bookkeeping <base>..<head>` or `code <base>..<head>` (or `code (<why>)`), and exits 0 either way:
// the gate turns the first word into a job output and the team command jobs run unless it is
// `bookkeeping`. Any doubt is `code`, so the tests run.
//
// Without --base the base is found: the newest commit of the pull request (from the head back, only
// commits not on the base branch) whose CI the git host reports as success, by its newest run of each
// workflow (S-30). github.event.before is never trusted: its run may have failed or been cancelled.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { loadConfig } from '../config.js';
import { isSha } from '../evidence.js';
import { GitError, git, resolveCommit } from '../git.js';
import { headCovers } from '../state/covers.js';

const USAGE = 'ci bookkeeping [--base <sha>] [--head <sha>] [--base-branch <branch>] [--output <file>]';
// How far back the walk for a green commit goes; each commit is one git host call.
export const BASE_WALK_LIMIT = 20;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const short = (sha) => sha.slice(0, 7);

function commitOf(root, ref) {
  try {
    return isSha(ref) || ref === 'HEAD' ? resolveCommit(root, ref) : null;
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

// The base branch's tip in the clone: the remote-tracking ref CI fetched, else the local branch.
function branchTip(root, branch) {
  if (!BRANCH.test(branch)) return null;
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    try {
      return git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    } catch (e) {
      if (!(e instanceof GitError)) throw e;
    }
  }
  return null;
}

// { base } for the newest green commit of the pull request, or { why } when there is none.
export function findGreenBase(root, head, { baseBranch, env = process.env } = {}) {
  let cfg;
  try {
    cfg = loadConfig(root);
  } catch (e) {
    return { why: `no config: ${e.message}` };
  }
  const branch = baseBranch || cfg.defaultBranch;
  const tip = branchTip(root, branch);
  if (!tip) return { why: `no base branch ${branch} in the clone` };
  let commits;
  try {
    const out = git(root, ['rev-list', `--max-count=${BASE_WALK_LIMIT}`, head, `^${tip}`]);
    commits = out === '' ? [] : out.split('\n');
  } catch (e) {
    if (e instanceof GitError) return { why: 'cannot list the pull request commits' };
    throw e;
  }
  let host;
  try {
    host = getHost(cfg, env, root);
    for (const sha of commits) {
      if (host.ciStatus(sha).status === 'success') return { base: sha };
    }
  } catch (e) {
    if (e instanceof GitHostError || e instanceof GitError) return { why: `git host: ${e.message}` };
    throw e;
  }
  return { why: `no commit of the last ${commits.length} with green CI` };
}

// The decision as { kind, line }.
export function judgeBookkeeping(root, { base, head = 'HEAD', baseBranch, env = process.env } = {}) {
  const code = (why) => ({ kind: 'code', line: `code (${why})` });
  if (!head) return code('no head');
  const h = commitOf(root, head);
  if (!h) return code(`head ${head} is not a commit in the clone`);
  let b;
  if (base === undefined) {
    const found = findGreenBase(root, h, { baseBranch, env });
    if (!found.base) return code(found.why);
    b = found.base;
  } else {
    if (base === '' || /^0+$/.test(base)) return code('no base');
    b = commitOf(root, base);
    if (!b) return code(`base ${base} is not a commit in the clone`);
  }
  const kind = headCovers(root, b, h) ? 'bookkeeping' : 'code';
  return { kind, line: `${kind} ${short(b)}..${short(h)}` };
}

async function run(args, io) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { base: { type: 'string' }, head: { type: 'string' }, 'base-branch': { type: 'string' }, output: { type: 'string' } },
      allowPositionals: true,
    });
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1 || positionals[0] !== 'bookkeeping') {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  const { kind, line } = judgeBookkeeping(io.cwd, {
    base: values.base,
    head: values.head ?? 'HEAD',
    baseBranch: values['base-branch'],
    env: io.env ?? process.env,
  });
  io.stdout(`${line}\n`);
  // The gate's job output: GitHub's step output file, named by the workflow, never read from env here.
  if (values.output) fs.appendFileSync(values.output, `kind=${kind}\n`);
  return 0;
}

export const ciCommand = { run, usage: USAGE };
