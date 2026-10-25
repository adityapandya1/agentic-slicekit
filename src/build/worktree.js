// A slice's worktree (REQ-2.6 step 1): `build start` makes it at `<root>/.worktrees/P<n>-S-<nn>` on
// `slice/P<n>-S-<nn>-<descr>` and pushes the branch at once, so another clone's `build next` skips
// the slice; every later `build` subcommand finds it again from the slice ID.
import fs from 'node:fs';
import path from 'node:path';
import { GitError, assertRef, git, hasRemote } from '../git.js';
import { parseSliceAddr, sliceFromBranch } from '../ids.js';
import { findSliceFiles } from '../slicefile.js';
import { readSlice } from '../state/index.js';
import { heldSlices, runnable, waitingOn } from './order.js';

// A refusal from a `build` step: `code` 1 refused, 2 usage or unknown ID (the CLI's exit code).
export class BuildError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'BuildError';
    this.code = code;
  }
}

const pad = (n) => String(n).padStart(2, '0');
export const branchPrefix = (addr) => `slice/P${addr.phase}-S-${pad(addr.slice)}`;
export const worktreeDir = (root, addr) => path.join(root, '.worktrees', `P${addr.phase}-S-${pad(addr.slice)}`);

// One spelling of a path, so `C:/x` from git and `C:\x` from path.resolve compare equal.
function samePath(a, b) {
  const norm = (p) => {
    let abs = path.resolve(p);
    try {
      abs = fs.realpathSync.native(abs);
    } catch {
      // A path that is gone is compared as written.
    }
    return process.platform === 'win32' ? abs.toLowerCase() : abs;
  };
  return norm(a) === norm(b);
}

// Every worktree of the repository as { path, branch }; branch is null when HEAD is detached.
export function listWorktrees(root) {
  const out = [];
  let cur = null;
  for (const line of git(root, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: path.resolve(line.slice('worktree '.length)), branch: null };
      out.push(cur);
    } else if (cur && line.startsWith('branch refs/heads/')) {
      cur.branch = line.slice('branch refs/heads/'.length);
    }
  }
  return out;
}

export function findWorktree(root, id, { worktree } = {}) {
  const held = listWorktrees(root).filter((w) => w.branch !== null && sliceFromBranch(w.branch) === id);
  if (worktree !== undefined) {
    const match = held.find((w) => samePath(w.path, path.resolve(root, worktree)));
    if (!match) throw new BuildError(`${worktree} is not a worktree holding ${id}`);
    return match;
  }
  if (held.length === 0) throw new BuildError(`no worktree holds ${id}; run slicekit build start ${id}`);
  if (held.length > 1) {
    throw new BuildError(`two worktrees hold ${id}: ${held.map((w) => w.path).join(', ')}; pass --worktree`, 2);
  }
  return held[0];
}

const resolves = (root, ref) => {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
};

const DESCR = /^[a-z0-9][a-z0-9._-]{0,59}$/i;

function sliceFileOf(root, cfg, addr) {
  const name = `S-${pad(addr.slice)}`;
  return findSliceFiles(root, cfg).find(
    (f) => f.phaseId === `P${addr.phase}` && (path.basename(f.path) === `${name}.md` || path.basename(f.path).startsWith(`${name}-`)),
  );
}

const stderrWarning = (msg) => process.stderr.write(`${msg}\n`);

export function startSlice(root, cfg, id, { descr, onWarning = stderrWarning } = {}) {
  const addr = parseSliceAddr(id);
  const file = addr && sliceFileOf(root, cfg, addr);
  if (!file) throw new BuildError(`unknown slice ${id}`, 2);
  if (descr === undefined) {
    const m = /^S-\d+-(.+)\.md$/.exec(path.basename(file.path));
    if (!m) throw new BuildError(`${path.basename(file.path)} names no description; pass --descr`, 2);
    descr = m[1];
  }
  if (!DESCR.test(descr)) {
    throw new BuildError(`descr '${descr}' must be letters, digits, dots, dashes and underscores, at most 60`, 2);
  }
  const branch = assertRef(`${branchPrefix(addr)}-${descr}`);
  const dir = worktreeDir(root, addr);

  // runnable fetches origin, so a branch pushed from another clone is seen here too.
  const ready = runnable(root, cfg);
  const held = heldSlices(root).get(id);
  if (held) throw new BuildError(`${id} is already started in ${held}`);
  if (fs.existsSync(dir)) throw new BuildError(`${id} is already started in ${dir}`);
  if (!ready.some((s) => s.id === id)) {
    const line = waitingOn(root, cfg, id);
    if (line) throw new BuildError(line);
    throw new BuildError(`${id} is ${readSlice(root, cfg, id).state}; build start runs from todo`);
  }

  const base = assertRef(cfg.defaultBranch);
  const origin = hasRemote(root, 'origin');
  if (origin) git(root, ['fetch', '-q', 'origin', base]);
  // Full refs: a tag named like the default branch is never what the branch is cut from.
  const from = origin && resolves(root, `refs/remotes/origin/${base}`) ? `refs/remotes/origin/${base}` : `refs/heads/${base}`;
  if (!resolves(root, from)) throw new BuildError(`${base} has no commit to start ${id} from`);
  // --no-track: a branch cut from origin/main must never push to main.
  git(root, ['worktree', 'add', '-q', '--no-track', '-b', branch, dir, from]);

  if (origin) {
    try {
      git(dir, ['push', '-q', '-u', 'origin', `HEAD:refs/heads/${branch}`]);
    } catch (e) {
      if (!(e instanceof GitError)) throw e;
      // Unclaimed on the host means not started: take the worktree and branch back so a re-run starts clean.
      git(root, ['worktree', 'remove', '--force', dir]);
      git(root, ['branch', '-q', '-D', branch]);
      throw new BuildError(`could not push ${branch} (${e.stderr.split('\n')[0]}); ${id} was not started`);
    }
  } else {
    onWarning(`slicekit: no origin; other clones will not see ${branch}`);
  }
  return { worktree: dir, branch };
}
