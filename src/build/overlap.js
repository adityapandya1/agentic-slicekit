// The overlap stop (D-06): two slices of one Order step run side by side because the plan said their
// changes do not overlap. `build pr` asks, before it pushes, whether this branch changes a path a
// branch of another slice of the same step already changes on origin; a path both change is a plan
// defect, not a merge conflict to resolve in the branch.
import { GitError, assertRef, git, hasRemote } from '../git.js';
import { parseSliceAddr, sliceFromBranch } from '../ids.js';
import { isSharedRoot } from '../check/rules/coverage.js';
import { SliceFileError } from '../slicefile.js';
import { isBookkeepingPath } from '../state/covers.js';
import { sliceSteps } from './order.js';
import { reviewBranch } from './worktree.js';

const runbookOf = (cfg) => (cfg.docsRoot === '.' ? 'runbook.md' : `${cfg.docsRoot}/runbook.md`);

const resolves = (wt, ref) => {
  try {
    git(wt, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
};

// The paths `ref` changes since it left `base` (their merge base), NUL-separated so no path is quoted.
function changedSince(wt, base, ref) {
  const from = git(wt, ['merge-base', base, ref]);
  return git(wt, ['diff', '-z', '--name-only', '--no-renames', from, ref, '--']).split('\0').filter((f) => f !== '');
}

// -> [{other, path}], sorted: for each other slice of `id`'s phase and Order step (its group, without
// an Order line) that has a branch on origin, each path both that branch and HEAD change since their
// merge base with origin's default branch, less shared roots and the kit's bookkeeping. A slice's
// review branch is never one of its branches here, and `id`'s own branches are skipped. Without an
// origin, or without the default branch on it, there is nothing to compare: [].
export function overlapWith(wt, cfg, id) {
  if (!hasRemote(wt, 'origin')) return [];
  git(wt, ['fetch', '-q', '--prune', 'origin']);
  const base = `refs/remotes/origin/${assertRef(cfg.defaultBranch)}`;
  if (!resolves(wt, base)) return [];
  // A plan file that does not parse is `slicekit check`'s to report, with its finding, later in
  // `build pr` and still before any push: the overlap cannot be judged on it, so it gives way.
  let steps;
  try {
    steps = sliceSteps(wt, cfg);
  } catch (e) {
    if (e instanceof SliceFileError) return [];
    throw e;
  }
  const mine = steps.get(id);
  if (!mine || mine.step < 0) return [];
  const mates = new Set(
    [...steps].filter(([other, s]) => other !== id && s.phase === mine.phase && s.step === mine.step).map(([other]) => other),
  );
  if (mates.size === 0) return [];

  const refs = git(wt, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/slice/']);
  const others = [];
  for (const ref of refs === '' ? [] : refs.split('\n')) {
    const branch = ref.slice('refs/remotes/origin/'.length);
    const other = sliceFromBranch(branch);
    if (!other || !mates.has(other) || branch === reviewBranch(parseSliceAddr(other))) continue;
    others.push({ other, ref });
  }
  if (others.length === 0) return [];

  const runbook = runbookOf(cfg);
  const counts = (f) => !isSharedRoot(f, runbook) && !isBookkeepingPath(wt, f);
  const ours = new Set(changedSince(wt, base, 'HEAD').filter(counts));
  const out = [];
  const seen = new Set();
  for (const { other, ref } of others) {
    for (const f of changedSince(wt, base, ref)) {
      const key = `${other}\0${f}`;
      if (ours.has(f) && !seen.has(key)) {
        seen.add(key);
        out.push({ other, path: f });
      }
    }
  }
  return out.sort((a, b) => a.other.localeCompare(b.other) || a.path.localeCompare(b.path));
}

export const planDefectLine = (id, { other, path }) => `plan defect: ${id} and ${other} both change ${path}; the plan said they do not overlap`;
