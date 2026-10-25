import fs from 'node:fs';
import path from 'node:path';
import { git, GitError } from './git.js';

// The slicekit git hooks (REQ-3.9) and the hooks path that runs them; init and the hooks rule share
// these, so they never disagree about what "installed" means.
export const HOOKS_PATH = '.githooks';
export const GITHOOKS = ['pre-commit', 'pre-merge-commit', 'prepare-commit-msg'];

// The configured core.hooksPath, or null when it is unset.
export function hooksPathValue(root) {
  try {
    return git(root, ['config', '--get', 'core.hooksPath']);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

// Whether `value` names <root>/.githooks: git resolves a relative path against the worktree root, a
// trailing slash is ignored, on win32 the comparison ignores case, and when both paths exist their
// real paths are compared, so a junction or symlink to .githooks counts.
export function isInstalledHooksPath(root, value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const resolved = [value, HOOKS_PATH].map((p) => path.resolve(root, p));
  let real;
  try {
    real = resolved.map((p) => fs.realpathSync.native(p));
  } catch {
    real = resolved;
  }
  const norm = (abs) => {
    const trimmed = abs.replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
  };
  return norm(real[0]) === norm(real[1]);
}
