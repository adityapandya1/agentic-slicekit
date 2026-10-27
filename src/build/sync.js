// `build sync` (REQ-2.8): a slice worktree fast-forwarded to its branch on origin. Two worktrees can
// hold a slice once `review start` made the review one, and both push to the slice branch: the one
// that did not push is behind, and `build pr`, `build verdict` and `build finish` refuse it before
// pushing until it takes the other's commits here.
import { GitError, behindUpstream, git, headSha } from '../git.js';
import { BuildError, findWorktree } from './worktree.js';

export const commits = (n) => `${n} commit${n === 1 ? '' : 's'}`;

// The commits of the upstream as the last fetch left it that HEAD lacks; 0 without one.
function behindLastFetch(wt) {
  try {
    return Number(git(wt, ['rev-list', '--count', 'HEAD..@{u}']));
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    return 0;
  }
}

// Refuses, before anything is pushed, a worktree whose upstream has commits it lacks. A fetch that
// fails is git's refusal, unless `onFetchFail` says otherwise: 'last-fetch' judges on the last fetch
// (`build verdict` finishing a round already recorded, whose push failed: nothing new is recorded,
// and git refuses a push that is not a fast-forward anyway); a string is the refusal to give.
export function assertNotBehind(wt, branch, id, { onFetchFail } = {}) {
  let n;
  try {
    n = behindUpstream(wt);
  } catch (e) {
    if (!(e instanceof GitError) || onFetchFail === undefined) throw e;
    if (onFetchFail !== 'last-fetch') throw new BuildError(onFetchFail);
    n = behindLastFetch(wt);
  }
  if (n > 0) throw new BuildError(`${branch} is ${commits(n)} behind origin; run slicekit build sync ${id}`);
}

// -> {head, behind}: the worktree's head after the fast-forward, and how many commits it took.
export function syncWorktree(root, cfg, id, { worktree } = {}) {
  const held = findWorktree(root, id, { worktree });
  const wt = held.path;
  // behindUpstream fetches the upstream's remote first; 0 without an upstream.
  const behind = behindUpstream(wt);
  if (behind === 0) return { head: headSha(wt), behind };
  const ahead = Number(git(wt, ['rev-list', '--count', '@{u}..HEAD']));
  if (ahead > 0) throw new BuildError(`${held.branch} has diverged from origin; resolve it by hand`);
  git(wt, ['pull', '-q', '--no-rebase', '--ff-only']);
  return { head: headSha(wt), behind };
}
