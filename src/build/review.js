// `review start <PR>` (REQ-2.8, D-39): a slice pull request's head in a fresh review worktree, for an
// independent review from a new session. The worktree is `<root>/.worktrees/review-P<n>-S-<nn>` on
// `slice/P<n>-S-<nn>-review`, the only place `build verdict --independent` records from. The branch
// tracks the pull request's branch on origin, so `pushBranch` pushes the review's fixes and verdicts
// to the slice branch, and the hooks and pre-edit read the slice from the branch name.
import fs from 'node:fs';
import path from 'node:path';
import { GitError, assertRef, git } from '../git.js';
import { parseSliceAddr, sliceFromBranch, stateFileName } from '../ids.js';
import { kitPaths } from '../paths.js';
import { readSlice } from '../state/index.js';
import { titleSlice } from '../check/rules/ci-title.js';
import { posixRel } from './red.js';
import { commits } from './sync.js';
import { independentVerdictPath } from './verdict.js';
import { BuildError, listWorktrees, reviewBranch, reviewWorktreeDir, samePath } from './worktree.js';

const fwd = (p) => p.replaceAll('\\', '/');
const lines = (out) => out.split('\n').filter((l) => l !== '');

// Whether git takes `name` as a branch name, as written: `check-ref-format --branch` also expands
// `@{-1}`-style names, so its output must be the name itself.
function validBranch(root, name) {
  try {
    assertRef(name);
    return git(root, ['check-ref-format', '--branch', name]) === name;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}

// A review worktree left by an earlier start is removed, so the review starts fresh; one holding work
// (uncommitted, or committed and not on origin) is refused and left as it is. One whose folder was
// deleted by hand is pruned: nothing in it can be lost.
function clearOld(root, id, dir, branch) {
  const old = listWorktrees(root).find((w) => samePath(w.path, dir));
  if (old && !fs.existsSync(dir)) {
    git(root, ['worktree', 'prune']);
  } else if (old) {
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
        `${fwd(dir)} has ${commits(ahead)} not on origin; push them with slicekit build pr ${id} --worktree ${fwd(dir)}, or remove the worktree by hand`,
      );
    }
    git(root, ['worktree', 'remove', dir]);
  } else if (fs.existsSync(dir)) {
    throw new BuildError(`${fwd(dir)} exists and holds no worktree; remove it`);
  }
  if (lines(git(root, ['branch', '--list', branch])).length > 0) git(root, ['branch', '-q', '-D', branch]);
}

// The pull request number the slice's state on `ref` records, or null when it records none.
function recordedNumber(root, cfg, id, ref) {
  const rel = posixRel(root, path.join(kitPaths(root, cfg).state, stateFileName(id)));
  let text;
  try {
    text = git(root, ['show', `${ref}:${rel}`]);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    return null;
  }
  try {
    return JSON.parse(text).pr?.number ?? null;
  } catch {
    return null;
  }
}

// -> {id, worktree, branch, round, verdictPath}: `round` is the slice's verdict count plus one, and
// `verdictPath` the absolute session-root path of that round's independent verdict. Every refusal
// comes before an earlier review worktree is touched.
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
  // The name is checked before git sees it in a fetch, where `*` would make a glob refspec.
  if (typeof headRef !== 'string' || !validBranch(root, headRef)) {
    throw new BuildError(`pull request #${number}'s branch ${headRef ?? '(none)'} is not a valid branch name`, 2);
  }
  if (sliceFromBranch(headRef) !== id || headRef === branch) {
    throw new BuildError(`pull request #${number} is from ${headRef}, not a build branch of ${id}`);
  }
  if (git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${headRef}`]) === '') {
    throw new BuildError(`pull request #${number}'s branch ${headRef} is not on origin; a fork's pull request cannot be reviewed here`);
  }
  // The head as origin has it now: `+` because a slice branch the review pushed to may since have been
  // pushed to from the build worktree.
  const tracking = `refs/remotes/origin/${headRef}`;
  git(root, ['fetch', '-q', 'origin', `+refs/heads/${headRef}:${tracking}`]);
  // The pull request's own head, not another branch of the same name: a fork's has a head origin's
  // branch does not.
  const tip = git(root, ['rev-parse', tracking]);
  if (typeof pr.headSha === 'string' && pr.headSha !== '' && pr.headSha !== tip) {
    throw new BuildError(`pull request #${number}'s head ${pr.headSha.slice(0, 7)} is not origin/${headRef}; is it from a fork? If the branch was just pushed, run the same command again in a minute`);
  }
  const recorded = recordedNumber(root, cfg, id, tracking);
  if (recorded !== null && recorded !== number) throw new BuildError(`pull request #${number} is not the one recorded for ${id} (#${recorded})`);

  const dir = reviewWorktreeDir(root, addr);
  clearOld(root, id, dir, branch);
  git(root, ['worktree', 'add', '-q', '--track', '-b', branch, dir, tracking]);

  const verdicts = readSlice(dir, cfg, id).verdicts ?? [];
  const verdictPath = independentVerdictPath(root, id, verdicts);
  // The reviewer writes there at once: its directory is made here, as the path is printed.
  fs.mkdirSync(path.dirname(verdictPath), { recursive: true });
  return { id, worktree: dir, branch, round: verdicts.length + 1, verdictPath };
}
