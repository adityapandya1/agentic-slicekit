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
// trailing slash is ignored, and on win32 the comparison ignores case.
export function isInstalledHooksPath(root, value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const norm = (p) => {
    const abs = path.resolve(root, p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? abs.toLowerCase() : abs;
  };
  return norm(value) === norm(HOOKS_PATH);
}
