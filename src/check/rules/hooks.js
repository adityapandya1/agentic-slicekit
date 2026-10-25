// hooks (03 REQ-3.9, REQ-3.7): git hooks do not survive a clone, so check fails until
// `core.hooksPath` is `.githooks` and both slicekit hooks are there and executable. Silent outside
// a git repository. On win32 there is no mode bit: a tracked hook's index mode is read instead, and
// an untracked one is not judged for it.
import fs from 'node:fs';
import path from 'node:path';
import { git, GitError } from '../../git.js';

export const id = 'hooks';
export const blocking = true;
export const ratchet = false;

const CONFIG = '.slicekit/config.json';
const HOOKS_PATH = '.githooks';
const HOOKS = ['pre-commit', 'prepare-commit-msg'];

function hooksPath(root) {
  try {
    return git(root, ['config', '--get', 'core.hooksPath']);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

// true or false, or null when the platform cannot tell.
function executable(root, rel) {
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(path.join(root, rel), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const staged = git(root, ['ls-files', '-s', '--', rel]);
  if (staged === '') return null;
  return staged.split(/\s/)[0] === '100755';
}

export function run(ctx) {
  if (!ctx.git?.isRepo) return [];
  const out = [];
  const value = hooksPath(ctx.root);
  if ((value ?? '').replace(/^\.\//, '').replace(/\/+$/, '') !== HOOKS_PATH) {
    out.push({ file: CONFIG, line: 1, message: 'git hooks not installed; run slicekit init' });
  }
  for (const name of HOOKS) {
    const rel = `${HOOKS_PATH}/${name}`;
    let isFile = false;
    try {
      isFile = fs.statSync(path.join(ctx.root, rel)).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) out.push({ file: rel, line: 1, message: `${rel} is missing; run slicekit init` });
    else if (executable(ctx.root, rel) === false) out.push({ file: rel, line: 1, message: `${rel} is not executable` });
  }
  return out;
}

export default { id, blocking, ratchet, run };
