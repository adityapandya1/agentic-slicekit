// State moves of a `build` step (REQ-1.8, D-35): setState and one bookkeeping commit of the slice's
// state file that touches nothing else, so a verdict given on the head before it still holds. A slice
// branch commits no BUILD.md: the sync after the merge regenerates it on the default branch (D-100).
import path from 'node:path';
import { commitPaths } from '../git.js';
import { stateFileName } from '../ids.js';
import { kitPaths } from '../paths.js';
import { appendHistory, setState } from '../state/index.js';

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

// An amendment of the slice file alone (build amend with no test named, issue #72): one history
// entry that leaves the state where it is, with the amendment commit and the reason, then one
// bookkeeping commit.
// The entry is written under the slice lock (appendHistory), as setState writes its own.
export function recordAmendment(wt, cfg, id, evidence) {
  const entry = appendHistory(wt, cfg, id, evidence);
  commitState(wt, cfg, id, 'amend');
  return entry;
}

// One bookkeeping commit of the slice's state file alone: `chore(slicekit): <id> <what>`.
export function commitState(wt, cfg, id, what) {
  const paths = kitPaths(wt, cfg);
  return commitBookkeeping(wt, id, what, [posixRel(wt, path.join(paths.state, stateFileName(id)))]);
}
