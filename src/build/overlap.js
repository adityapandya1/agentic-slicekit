// The overlap stop (D-06): two slices of one Order step run side by side because the plan said their
// changes do not overlap. `build pr` asks, before it pushes, whether this branch changes a path a
// branch of another slice of the same step already changes on origin; a path both change is a plan
// defect, not a merge conflict to resolve in the branch.
//
// What counts as both changing a path:
// - the same path, compared without regard to case: on a case-insensitive checkout `a.js` and `A.js`
//   are one file, and a false alarm is a defect a person settles while a miss is silent;
// - a directory one branch deletes outright and a path the other changes or adds inside it.
// Renames count as a delete and an add (`--no-renames`). Shared roots (coverage's `isSharedRoot`)
// and the kit's bookkeeping never count.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitError, assertRef, git, hasRemote } from '../git.js';
import { parseSliceAddr, sliceFromBranch } from '../ids.js';
import { isSharedRoot } from '../check/rules/coverage.js';
import { kitPaths } from '../paths.js';
import { SliceFileError } from '../slicefile.js';
import { bookkeepingTest } from '../state/covers.js';
import { sliceSteps } from './order.js';
import { reviewBranch } from './worktree.js';

const posix = (p) => p.split(path.sep).join('/');
const fold = (p) => p.toLowerCase();

const resolves = (wt, ref) => {
  try {
    git(wt, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
};

const nul = (out) => out.split('\0').filter((f) => f !== '');

// What `ref` changes since it left `base` (their merge base): `paths`, folded path → its spelling,
// and `gone`, each directory it deletes outright (shortest first), as {key, spelling}.
function changesOf(wt, base, ref) {
  const from = git(wt, ['merge-base', base, ref]);
  const fields = nul(git(wt, ['diff', '-z', '--name-status', '--no-renames', from, ref, '--']));
  const paths = new Map();
  const deleted = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    paths.set(fold(fields[i + 1]), fields[i + 1]);
    if (fields[i] === 'D') deleted.push(fields[i + 1]);
  }
  const gone = new Map();
  if (deleted.length > 0) {
    const kept = new Set(nul(git(wt, ['ls-tree', '-r', '-d', '-z', '--name-only', ref])).map(fold));
    for (const f of deleted) {
      const parts = f.split('/');
      for (let k = 1; k < parts.length; k++) {
        const dir = parts.slice(0, k).join('/');
        if (!kept.has(fold(dir)) && !gone.has(fold(dir))) gone.set(fold(dir), dir);
      }
    }
  }
  const dirs = [...gone].map(([key, spelling]) => ({ key, spelling })).sort((a, b) => a.key.length - b.key.length);
  return { paths, gone: dirs };
}

// The slice and phase files as `ref` holds them, written into a scratch directory, then `fn` on it.
// null when they cannot be read or do not parse.
function withPlanAt(wt, cfg, ref, fn) {
  const phasesRel = posix(path.relative(wt, kitPaths(wt, cfg).phases));
  let tmp;
  try {
    const files = nul(git(wt, ['ls-tree', '-r', '-z', '--name-only', ref, '--', phasesRel])).filter((f) => f.endsWith('.md'));
    if (files.length === 0) return null;
    // One process for every file: `cat-file --batch` answers `<sha> blob <size>\n<bytes>\n` per name.
    const out = execFileSync('git', ['cat-file', '--batch'], { cwd: wt, input: files.map((f) => `${ref}:${f}\n`).join(''), maxBuffer: 256 * 1024 * 1024 });
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-plan-'));
    let at = 0;
    for (const f of files) {
      const eol = out.indexOf(0x0a, at);
      const header = out.subarray(at, eol).toString('utf8').split(' ');
      if (header[1] !== 'blob') return null;
      const size = Number(header[2]);
      const target = path.join(tmp, ...f.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, out.subarray(eol + 1, eol + 1 + size));
      at = eol + 1 + size + 1;
    }
    return fn(tmp);
  } catch (e) {
    if (e instanceof GitError || e instanceof SliceFileError || e.status !== undefined) return null;
    throw e;
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The other slices of `id`'s phase and Order step in either plan: the worktree's, and origin's
// default branch's. The branch under judgement can edit its own plan (move its slice to another
// group), so its plan alone cannot clear it; origin's alone would miss a step the branch adds.
function matesOf(wt, cfg, id, base) {
  const plans = [];
  try {
    plans.push(sliceSteps(wt, cfg));
  } catch (e) {
    // A plan file that does not parse is `slicekit check`'s to report, later in `build pr` and still
    // before any push; origin's plan still judges.
    if (!(e instanceof SliceFileError)) throw e;
  }
  const atBase = withPlanAt(wt, cfg, base, (dir) => sliceSteps(dir, cfg));
  if (atBase) plans.push(atBase);
  const mates = new Set();
  for (const steps of plans) {
    const mine = steps.get(id);
    if (!mine || mine.step < 0) continue;
    for (const [other, s] of steps) if (other !== id && s.phase === mine.phase && s.step === mine.step) mates.add(other);
  }
  return mates;
}

// -> [{other, path, otherPath}], sorted: for each other slice of `id`'s phase and Order step (its
// group, without an Order line) that has a branch on origin, each path both that branch and HEAD
// change since their merge base with origin's default branch (see the top of this file), less shared
// roots and the kit's bookkeeping. `path` is this branch's spelling, `otherPath` the other's. A
// slice's review branch is never one of its branches here, and `id`'s own branches are skipped.
// Without an origin, or without the default branch on it, there is nothing to compare: [].
export function overlapWith(wt, cfg, id) {
  if (!hasRemote(wt, 'origin')) return [];
  git(wt, ['fetch', '-q', '--prune', 'origin']);
  const base = `refs/remotes/origin/${assertRef(cfg.defaultBranch)}`;
  if (!resolves(wt, base)) return [];
  const mates = matesOf(wt, cfg, id, base);
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

  // The runbook as coverage resolves it, so `docsRoot: "./docs"` names the same file.
  const runbook = posix(path.relative(wt, kitPaths(wt, cfg).runbook));
  const kept = bookkeepingTest(wt);
  const counts = (f) => !isSharedRoot(f, runbook) && !kept(f);
  const ours = changesOf(wt, base, 'HEAD');
  const out = new Map();
  const add = (other, p, otherPath) => {
    const key = `${other}\0${fold(p)}`;
    if (counts(p) && counts(otherPath) && !out.has(key)) out.set(key, { other, path: p, otherPath });
  };
  // The shortest directory of `gone` holding `key`, or null.
  const under = (gone, key) => gone.find((d) => key.startsWith(`${d.key}/`)) ?? null;
  for (const { other, ref } of others) {
    const theirs = changesOf(wt, base, ref);
    for (const [key, spelling] of ours.paths) {
      if (theirs.paths.has(key)) add(other, spelling, theirs.paths.get(key));
      const dir = under(theirs.gone, key);
      if (dir) add(other, dir.spelling, dir.spelling);
    }
    for (const [key] of theirs.paths) {
      const dir = under(ours.gone, key);
      if (dir) add(other, dir.spelling, dir.spelling);
    }
  }
  return [...out.values()].sort((a, b) => a.other.localeCompare(b.other) || a.path.localeCompare(b.path));
}

// The refusal line; the other branch's spelling is given when it differs from this branch's.
export const planDefectLine = (id, { other, path: p, otherPath }) =>
  `plan defect: ${id} and ${other} both change ${p}${otherPath && otherPath !== p ? ` (as ${otherPath} in ${other})` : ''}; the plan said they do not overlap`;
