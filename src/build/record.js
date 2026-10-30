// State moves of a `build` step (REQ-1.8, D-35): setState, BUILD.md, and one bookkeeping commit that
// touches nothing else, so a verdict given on the head before it still holds.
import path from 'node:path';
import { exists, readText, writeText } from '../fs.js';
import { commitPaths } from '../git.js';
import { stateFileName } from '../ids.js';
import { kitPaths } from '../paths.js';
import { renderBuild } from '../state/build.js';
import { setState } from '../state/index.js';

const posixRel = (wt, abs) => path.relative(wt, abs).split(path.sep).join('/');

export function commitBookkeeping(wt, id, what, paths) {
  return commitPaths(wt, paths, `chore(slicekit): ${id} ${what}\n\nSlice: ${id}`);
}

// A TransitionError from setState passes through unchanged, before anything is written.
export function recordState(wt, cfg, id, to, evidence) {
  const state = setState(wt, cfg, id, to, evidence);
  commitState(wt, cfg, id, to);
  return state;
}

// BUILD.md rendered again from the state files, then one bookkeeping commit of the slice's state file
// and BUILD.md: `chore(slicekit): <id> <what>`.
export function commitState(wt, cfg, id, what) {
  const paths = kitPaths(wt, cfg);
  const before = exists(paths.build) ? readText(paths.build) : '';
  const after = renderBuild(wt, cfg, before);
  if (after !== before) writeText(paths.build, after);
  const files = [posixRel(wt, path.join(paths.state, stateFileName(id)))];
  if (exists(paths.build)) files.push(posixRel(wt, paths.build));
  return commitBookkeeping(wt, id, what, files);
}
