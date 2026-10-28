// Where a slice's worktrees are and how to know them: the build worktree `build start` makes and the
// review worktree `review start` makes (D-39). Pure path and branch rules plus git's own worktree
// list, shared by the build steps and the state transitions, so the rule that an independent verdict
// is recorded only in the review worktree holds whichever command records it.
import fs from 'node:fs';
import path from 'node:path';
import { GitError, git } from './git.js';
import { parseSliceAddr } from './ids.js';

export const pad = (n) => String(n).padStart(2, '0');
export const branchPrefix = (addr) => `slice/P${addr.phase}-S-${pad(addr.slice)}`;
export const worktreeDir = (root, addr) => path.join(root, '.worktrees', `P${addr.phase}-S-${pad(addr.slice)}`);
// The review worktree `review start` makes, at a fixed path on a fixed branch: an independent verdict
// is recorded only there (D-39), so no build branch may take that name.
export const REVIEW_DESCR = 'review';
export const reviewBranch = (addr) => `${branchPrefix(addr)}-${REVIEW_DESCR}`;
export const reviewWorktreeDir = (root, addr) => path.join(root, '.worktrees', `review-P${addr.phase}-S-${pad(addr.slice)}`);

// One spelling of a path, so `C:/x` from git and `C:\x` from path.resolve compare equal.
export function samePath(a, b) {
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

// Every worktree of the repository as { path, branch }, the main one first; branch is null when
// HEAD is detached.
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

// Whether `dir` is the review worktree of slice `id`: at review start's path under the main
// checkout (real paths compared, so a junction to it counts), on the review branch, and not the
// slice's build worktree. False outside a repository, or for a directory that is no worktree.
export function isReviewWorktreeAt(dir, id) {
  const addr = parseSliceAddr(id);
  if (!addr) return false;
  let all;
  let top;
  try {
    top = git(dir, ['rev-parse', '--show-toplevel']);
    all = listWorktrees(dir);
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
  const main = all[0]?.path;
  const me = all.find((w) => samePath(w.path, top));
  if (!main || !me) return false;
  return me.branch === reviewBranch(addr) && samePath(me.path, reviewWorktreeDir(main, addr)) && !samePath(me.path, worktreeDir(main, addr));
}
