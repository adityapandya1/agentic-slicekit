// trailer (01 REQ-1.9, 03 REQ-3.7): on a slice branch every commit the branch adds carries
// `Slice: P<n>/S-<nn>` naming the branch's slice. The commits judged are HEAD's first-parent line,
// excluding everything reachable from `<defaultBranch>` and `origin/<defaultBranch>` (whichever
// exist; neither: every commit). First-parent only, so a stacked slice merged into this branch is
// judged on its own branch, not here. A merge commit is exempt: git writes its message. git itself
// reads the trailers (`%(trailers)`), so what counts as a trailer block, a folded value or a key's
// case is git's rule, not a parser of ours. No branch, a branch that is not a slice branch, or no
// commits at all: nothing to judge.
//
// Under --ci on a pull request, actions/checkout leaves a detached merge commit whose first parent is
// the base: the branch is GITHUB_HEAD_REF and the tip judged is the pull request's head, from the
// event's head sha (or the merge commit's second parent when the event has none).
import { assertRef, git, GitError } from '../../git.js';
import { branchTip } from '../ci-event.js';
import { sliceFromBranch } from '../../ids.js';

export const id = 'trailer';
export const blocking = true;
export const ratchet = false;

const FORMAT = '--format=%H%x1f%P%x1f%(trailers:key=Slice,valueonly,unfold,separator=%x1d)%x1e';

const refExists = (root, ref) => {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
};

export function run(ctx) {
  const { root, cfg } = ctx;
  const at = branchTip(ctx);
  if (!at) return [];
  const { branch, tip } = at;
  const slice = sliceFromBranch(branch);
  if (!slice) return [];

  const def = assertRef(cfg.defaultBranch ?? 'main');
  const exclude = [`refs/heads/${def}`, `refs/remotes/origin/${def}`].filter((ref) => refExists(root, ref)).map((ref) => `^${ref}`);
  const log = git(root, ['log', '--first-parent', FORMAT, '--end-of-options', tip, ...exclude, '--']);
  const out = [];
  for (const rec of log.split('\x1e')) {
    const [sha, parents = '', slices = ''] = rec.replace(/^\n/, '').split('\x1f');
    if (!sha || parents.trim().split(/\s+/).length > 1) continue;
    const named = slices.split('\x1d').map((s) => s.trim()).filter(Boolean);
    const sha7 = sha.slice(0, 7);
    if (named.length === 0) out.push({ file: branch, line: 0, message: `commit ${sha7} has no Slice trailer` });
    else if (!named.includes(slice)) out.push({ file: branch, line: 0, message: `commit ${sha7} names ${named[0]}, branch is ${slice}` });
  }
  return out;
}

export default { id, blocking, ratchet, run };
