// `build config` (REQ-2.6, D-50): a slice that changes the kit's own config commits the worktree's
// changed `.slicekit/config.json` alone, as `chore(slicekit): <id> config`, as `build render` commits
// a render. `build commit` never commits a kit file; it accepts this commit when its subject, its
// trailer and its one file match and the slice file at that commit names the config (issue #51).
import { ConfigError, loadConfig } from '../config.js';
import { GitError, commitPaths, git } from '../git.js';
import { parseSliceFile } from '../slicefile.js';
import { readSlice } from '../state/index.js';
import { posixRel, sliceIn } from './red.js';
import { BuildError, findWorktree } from './worktree.js';

export const CONFIG = '.slicekit/config.json';
// The states `build render` runs from.
const CONFIG_FROM = ['building', 'draft-pr', 'in-review', 'changes-requested', 'ci-green', 'ready'];

export const configSubject = (id) => `chore(slicekit): ${id} config`;

// Whether the slice file at `rev` (POSIX `sliceRel`) lists the config in its Expected changes.
export function namesConfigAt(wt, rev, sliceRel) {
  let text;
  try {
    text = git(wt, ['show', `${rev}:${sliceRel}`]);
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
  try {
    return parseSliceFile(text, sliceRel).expectedChanges.includes(CONFIG);
  } catch {
    return false;
  }
}

// -> { sha }: the config commit, or sha null when the worktree's config has no change.
export function configSlice(root, rootCfg, id, { worktree } = {}) {
  const wt = findWorktree(root, id, { worktree }).path;
  const current = readSlice(wt, rootCfg, id);
  if (!CONFIG_FROM.includes(current.state)) throw new BuildError(`${id} is ${current.state}; config runs from ${CONFIG_FROM.join(', ')}`);
  const sliceRel = posixRel(wt, sliceIn(wt, rootCfg, id).path);
  if (!namesConfigAt(wt, 'HEAD', sliceRel)) throw new BuildError(`slice ${id} does not name ${CONFIG} in its Expected changes`);
  try {
    loadConfig(wt);
  } catch (e) {
    if (e instanceof ConfigError) throw new BuildError(`${CONFIG}: ${e.message}`);
    throw e;
  }
  if (git(wt, ['--literal-pathspecs', 'status', '--porcelain', '--', CONFIG]) === '') return { sha: null };
  const sha = commitPaths(wt, [CONFIG], `${configSubject(id)}\n\nSlice: ${id}`);
  return { sha };
}
