// trailer (01 REQ-1.9, 03 REQ-3.7): on a slice branch every commit the branch adds carries
// `Slice: P<n>/S-<nn>` naming the branch's slice. The commits judged are those beyond
// `origin/<defaultBranch>` when it exists, else beyond the merge base with `<defaultBranch>`, else
// every commit. A merge commit is exempt: git writes its message. No branch, a branch that is not a
// slice branch, or no commits at all: nothing to judge.
import { assertRef, commitsOnBranch, git, GitError } from '../../git.js';
import { sliceFromBranch } from '../../ids.js';

export const id = 'trailer';
export const blocking = true;
export const ratchet = false;

const quiet = (root, args) => {
  try {
    return git(root, args);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
};

function base(root, defaultBranch) {
  assertRef(defaultBranch);
  if (quiet(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${defaultBranch}`])) return `origin/${defaultBranch}`;
  if (!quiet(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${defaultBranch}`])) return null;
  return quiet(root, ['merge-base', 'HEAD', `refs/heads/${defaultBranch}`]);
}

export function run(ctx) {
  const { root, cfg } = ctx;
  const branch = ctx.git?.branch;
  if (!ctx.git?.isRepo || !ctx.git.hasCommits || !branch) return [];
  const slice = sliceFromBranch(branch);
  if (!slice) return [];

  const from = base(root, cfg.defaultBranch ?? 'main');
  const range = from == null ? 'HEAD' : `${from}..HEAD`;
  const merges = new Set(git(root, ['log', '--merges', '--format=%H', '--end-of-options', range, '--']).split('\n').filter(Boolean));
  const out = [];
  for (const c of commitsOnBranch(root, from)) {
    if (merges.has(c.sha)) continue;
    const named = c.trailers.Slice;
    const sha7 = c.sha.slice(0, 7);
    if (named === undefined) out.push({ file: branch, line: 0, message: `commit ${sha7} has no Slice trailer` });
    else if (named !== slice) out.push({ file: branch, line: 0, message: `commit ${sha7} names ${named}, branch is ${slice}` });
  }
  return out;
}

export default { id, blocking, ratchet, run };
