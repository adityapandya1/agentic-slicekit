// Path and slice helpers the hooks share: pre-bash, pre-edit and session-start read paths and the
// active slice the same way.
import fs from 'node:fs';
import path from 'node:path';
import { GitError, currentBranch } from '../git.js';
import { sliceFromBranch } from '../ids.js';
import { readSlice } from '../state/index.js';

export const toPosix = (p) => p.split(path.sep).join('/');

// Git Bash's `/c/...` spelling of a Windows path as `C:/...`; unchanged off win32.
export function fromGitBash(p) {
  if (process.platform !== 'win32') return p;
  const m = /^\/([A-Za-z])(\/.*)?$/.exec(p);
  return m ? `${m[1].toUpperCase()}:/${(m[2] ?? '').slice(1)}` : p;
}

// The deepest existing ancestor of abs (abs itself when it exists).
export function existingAncestor(abs) {
  let dir = abs;
  while (!fs.existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

// p with its deepest existing ancestor replaced by that ancestor's real path and the missing segments
// re-appended, so 8.3 short names and links resolve.
export function real(p) {
  const existing = existingAncestor(p);
  let resolved = existing;
  try {
    resolved = fs.realpathSync.native(existing);
  } catch {
    // keep the path as given
  }
  const rest = path.relative(existing, p);
  return rest === '' ? resolved : path.join(resolved, rest);
}

// The slice the branch at root names: {id, state}, or {id, error} when its state file cannot be read,
// or null when the branch is not a slice branch, has no state file, or root is not a repository.
export function activeSlice(root, cfg) {
  let branch;
  try {
    branch = currentBranch(root);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
  const id = branch ? sliceFromBranch(branch) : null;
  if (!id) return null;
  try {
    return { id, state: readSlice(root, cfg, id) };
  } catch (e) {
    if (/^unknown slice /.test(e?.message ?? '')) return null;
    return { id, error: e?.message ?? String(e) };
  }
}
