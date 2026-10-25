// hooks (03 REQ-3.9, REQ-3.7): git hooks do not survive a clone, so check fails until
// `core.hooksPath` names `.githooks` and the three slicekit hooks are there and executable. Silent
// outside a git repository. A hooks-path finding is reported on `.githooks` (line 0); a finding about
// one hook, on that hook's file. On win32 there is no mode bit: a tracked hook's index mode is read
// instead, and an untracked one is not judged for it.
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../git.js';
import { GITHOOKS, HOOKS_PATH, hooksPathValue, isInstalledHooksPath } from '../../githooks.js';

export const id = 'hooks';
export const blocking = true;
export const ratchet = false;

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

const isFile = (abs) => {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
};

export function run(ctx) {
  if (!ctx.git?.isRepo) return [];
  const out = [];
  const value = hooksPathValue(ctx.root);
  if (value === null) {
    out.push({ file: HOOKS_PATH, line: 0, message: 'core.hooksPath is not set; run slicekit init' });
  } else if (!isInstalledHooksPath(ctx.root, value)) {
    out.push({ file: HOOKS_PATH, line: 0, message: `core.hooksPath is ${value}, not ${HOOKS_PATH}; set it to ${HOOKS_PATH} or run slicekit init` });
  }
  for (const name of GITHOOKS) {
    const rel = `${HOOKS_PATH}/${name}`;
    if (!isFile(path.join(ctx.root, rel))) {
      out.push({ file: rel, line: 1, message: `${rel} is missing; run slicekit init` });
    } else if (executable(ctx.root, rel) === false) {
      out.push({ file: rel, line: 1, message: `${rel} is not executable; run git update-index --chmod=+x ${rel}` });
    }
  }
  return out;
}

export default { id, blocking, ratchet, run };
