// `review start <PR>` (REQ-2.8, D-39): a slice pull request's head in a fresh review worktree, for an
// independent review from a new session. The worktree is `<root>/.worktrees/review-P<n>-S-<nn>` on
// `slice/P<n>-S-<nn>-review`, the only place `build verdict --independent` records from. The branch
// tracks the pull request's branch on origin, so `pushBranch` pushes the review's fixes and verdicts
// to the slice branch, and the hooks and pre-edit read the slice from the branch name.
import fs from 'node:fs';
import { GitError, assertRef, git } from '../git.js';
import { parseSliceAddr, sliceFromBranch } from '../ids.js';
import { readSlice } from '../state/index.js';
import { titleSlice } from '../check/rules/ci-title.js';
import { independentVerdictPath } from './verdict.js';
import { BuildError, listWorktrees, reviewBranch, reviewWorktreeDir, samePath } from './worktree.js';

const fwd = (p) => p.replaceAll('\\', '/');
const lines = (out) => out.split('\n').filter((l) => l !== '');

// A review worktree left by an earlier start is removed, so the review starts fresh; one holding work
// (uncommitted, or committed and not on origin) is refused and left as it is.
function clearOld(root, id, dir, branch) {
  const old = listWorktrees(root).find((w) => samePath(w.path, dir));
  if (old) {
    if (git(dir, ['status', '--porcelain']) !== '') throw new BuildError(`${fwd(dir)} has uncommitted changes`);
    let ahead = 0;
    try {
      ahead = Number(git(dir, ['rev-list', '--count', '@{u}..HEAD']));
    } catch (e) {
      if (!(e instanceof GitError)) throw e;
      // No upstream (or it is gone from origin): nothing to compare, the worktree is the kit's own.
    }
    if (ahead > 0) {
      throw new BuildError(
        `${fwd(dir)} has ${ahead} commits not on origin; push them with slicekit build pr ${id} --worktree ${fwd(dir)}, or remove the worktree by hand`,
      );
    }
    git(root, ['worktree', 'remove', dir]);
  } else if (fs.existsSync(dir)) {
    throw new BuildError(`${fwd(dir)} exists and holds no worktree; remove it`);
  }
  if (lines(git(root, ['branch', '--list', branch])).length > 0) git(root, ['branch', '-q', '-D', branch]);
}

// -> {id, worktree, branch, round, verdictPath}: `round` is the slice's verdict count plus one, and
// `verdictPath` the absolute session-root path of that round's independent verdict.
export function startReview(root, cfg, host, number) {
  const pr = host.getPullRequest(number);
  const id = titleSlice(pr.title ?? '');
  const addr = id && parseSliceAddr(id);
  if (!addr) throw new BuildError(`pull request #${number} is not a slice pull request`, 2);
  if (pr.state !== 'OPEN') {
    throw new BuildError(`pull request #${number} is ${String(pr.state ?? 'not open').toLowerCase()}; review start runs on an open pull request`);
  }
  const headRef = pr.headRef;
  const branch = reviewBranch(addr);
  if (typeof headRef !== 'string' || sliceFromBranch(headRef) !== id || headRef === branch) {
    throw new BuildError(`pull request #${number} is from ${headRef ?? 'no branch'}, not a build branch of ${id}`);
  }
  assertRef(headRef);
  // The head as origin has it now: `+` because a slice branch the review pushed to may since have been
  // pushed to from the build worktree.
  git(root, ['fetch', '-q', 'origin', `+refs/heads/${headRef}:refs/remotes/origin/${headRef}`]);

  const dir = reviewWorktreeDir(root, addr);
  clearOld(root, id, dir, branch);
  git(root, ['worktree', 'add', '-q', '--track', '-b', branch, dir, `refs/remotes/origin/${headRef}`]);

  const verdicts = readSlice(dir, cfg, id).verdicts ?? [];
  return { id, worktree: dir, branch, round: verdicts.length + 1, verdictPath: independentVerdictPath(root, id, verdicts) };
}
