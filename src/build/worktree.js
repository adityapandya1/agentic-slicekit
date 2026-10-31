// A slice's worktree (REQ-2.6 step 1): `build start` makes it at `<root>/.worktrees/P<n>-S-<nn>` on
// `slice/P<n>-S-<nn>-<descr>`, commits one empty claim and pushes it at once, so another clone's
// `build next` skips the slice; every later `build` subcommand finds it again from the slice ID.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { GitError, assertRef, git, hasRemote, pushBranch } from '../git.js';
import { parseSliceAddr, sliceFromBranch } from '../ids.js';
import { findSliceFiles } from '../slicefile.js';
import { REVIEW_DESCR, branchPrefix, listWorktrees, pad, reviewBranch, reviewWorktreeDir, samePath, worktreeDir } from '../worktrees.js';
import { readSlice } from '../state/index.js';
import { heldSlices, prepare, runnable, waitingOn } from './order.js';

// A refusal from a `build` step: `code` 1 refused, 2 usage or unknown ID (the CLI's exit code).
export class BuildError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'BuildError';
    this.code = code;
  }
}

export { REVIEW_DESCR, branchPrefix, listWorktrees, reviewBranch, reviewWorktreeDir, samePath, worktreeDir } from '../worktrees.js';

// The review worktree `review start` makes for the slice at `addr`, known by its branch or its path.
export const isReviewWorktree = (root, addr, w) => w.branch === reviewBranch(addr) || samePath(w.path, reviewWorktreeDir(root, addr));

// The pull request number the state file in `dir` records for `id`, read through `dir`'s own config,
// or `<PR>` when none is recorded or the file cannot be read.
function recordedPr(dir, id) {
  try {
    const n = readSlice(dir, loadConfig(dir), id).pr?.number;
    return Number.isInteger(n) ? String(n) : '<PR>';
  } catch {
    return '<PR>';
  }
}

// The worktree holding `id`: the one `--worktree` names, else the build worktree. Without
// `--worktree` the review worktree is never picked, so the building session needs no flag while a
// review session runs; the review session always names its worktree.
export function findWorktree(root, id, { worktree } = {}) {
  const every = listWorktrees(root);
  const all = every.filter((w) => w.branch !== null && sliceFromBranch(w.branch) === id);
  const addr = parseSliceAddr(id);
  if (worktree !== undefined) {
    const given = path.resolve(root, worktree);
    const match = all.find((w) => samePath(w.path, given));
    if (match) return match;
    // The review worktree moved to a detached HEAD (issue #61) is never accepted, since build verdict
    // pushes the review branch; review start moves it to the pull request's head.
    const main = every[0]?.path;
    const detached = every.find((w) => w.branch === null && samePath(w.path, given));
    if (addr && main && detached && samePath(given, reviewWorktreeDir(main, addr))) {
      throw new BuildError(`${worktree} is the review worktree of ${id} on a detached HEAD; run slicekit review start ${recordedPr(detached.path, id)} to move it to the pull request's head`);
    }
    throw new BuildError(`${worktree} is not a worktree holding ${id}`);
  }
  const held = addr ? all.filter((w) => !isReviewWorktree(root, addr, w)) : all;
  if (held.length === 0) throw new BuildError(`no worktree holds ${id}; run slicekit build start ${id}`);
  if (held.length > 1) {
    throw new BuildError(`two worktrees hold ${id}: ${held.map((w) => w.path).join(', ')}; pass --worktree`, 2);
  }
  return held[0];
}

function sliceFileOf(root, cfg, addr) {
  const name = `S-${pad(addr.slice)}`;
  return findSliceFiles(root, cfg).find(
    (f) => f.phaseId === `P${addr.phase}` && (path.basename(f.path) === `${name}.md` || path.basename(f.path).startsWith(`${name}-`)),
  );
}

// `slice/P<n>-S-<nn>-<descr>` when git accepts it as a branch name and it is not the review
// branch, else a usage refusal. `file` is the slice file the descr was taken from, if it was. The
// review name is refused in any case: on a case-insensitive file system `Review` is the same ref.
function branchName(root, addr, descr, file) {
  const name = `${branchPrefix(addr)}-${descr}`;
  if (descr.toLowerCase() === REVIEW_DESCR) {
    const from = file ? `the slice file ${file} gives that name, so ` : '';
    throw new BuildError(`the branch name ${name} is kept for the review worktree; ${from}choose another --descr`, 2);
  }
  try {
    assertRef(name);
    git(root, ['check-ref-format', '--branch', name]);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    throw new BuildError(`branch name ${name} is not valid; pass --descr`, 2);
  }
  return name;
}

// The slice's branches as origin has them now, not as the last fetch saw them.
function claimsOnOrigin(root, id) {
  const out = git(root, ['ls-remote', '--heads', 'origin']);
  return (out === '' ? [] : out.split('\n'))
    .map((l) => l.split(/\s+/)[1] ?? '')
    .filter((ref) => ref.startsWith('refs/heads/'))
    .map((ref) => ref.slice('refs/heads/'.length))
    .filter((b) => sliceFromBranch(b) === id);
}

const stderrWarning = (msg) => process.stderr.write(`${msg}\n`);

// `beforePush` is a test seam: it runs between the claim commit and its push.
export function startSlice(root, cfg, id, { descr, onWarning = stderrWarning, beforePush } = {}) {
  prepare(root, cfg);
  const addr = parseSliceAddr(id);
  const file = addr && sliceFileOf(root, cfg, addr);
  if (!file) throw new BuildError(`unknown slice ${id}`, 2);
  let sliceFile;
  if (descr === undefined) {
    const m = /^S-\d+-(.+)\.md$/.exec(path.basename(file.path));
    if (!m) throw new BuildError(`${path.basename(file.path)} names no description; pass --descr`, 2);
    descr = m[1];
    sliceFile = path.basename(file.path);
  }
  const branch = branchName(root, addr, descr, sliceFile);
  const dir = worktreeDir(root, addr);

  // A worktree of this clone on the slice's branch: the start already happened, so this is a resume
  // at the state that worktree holds. Nothing is committed or pushed. The review worktree `review
  // start` made is never the build worktree (M-3).
  const mine = listWorktrees(root).find((w) => w.branch !== null && sliceFromBranch(w.branch) === id && !samePath(w.path, root) && !isReviewWorktree(root, addr, w));
  if (mine) return { worktree: mine.path, branch: mine.branch, resumed: true, state: readSlice(mine.path, cfg, id).state };

  const ready = runnable(root, cfg, { prepared: true });
  const held = heldSlices(root).get(id);
  if (held?.startsWith('origin/')) throw new BuildError(`${id} is already started in ${held}; another clone holds it`);
  if (held) throw new BuildError(`${id} is already started in ${held}`);
  if (fs.existsSync(dir)) throw new BuildError(`${dir} exists and holds no worktree of ${id}; remove it`);
  if (!ready.some((s) => s.id === id)) {
    const line = waitingOn(root, cfg, id);
    if (line) throw new BuildError(line);
    throw new BuildError(`${id} is ${readSlice(root, cfg, id).state}; build start runs from todo`);
  }

  const base = assertRef(cfg.defaultBranch);
  const origin = hasRemote(root, 'origin');
  // prepare fetched origin and found HEAD equal to its default branch. Full refs: a tag named like
  // the default branch is never what the branch is cut from. --no-track: never push to main.
  const from = origin ? `refs/remotes/origin/${base}` : `refs/heads/${base}`;
  git(root, ['worktree', 'add', '-q', '--no-track', '-b', branch, dir, from]);
  const takeBack = () => {
    git(root, ['worktree', 'remove', '--force', dir]);
    git(root, ['branch', '-q', '-D', branch]);
  };

  // The claim: one empty commit of this start's own, so a second push of the same name is not a
  // fast-forward and origin refuses it. The nonce keeps two claims made in one second distinct.
  try {
    const nonce = randomBytes(8).toString('hex');
    git(dir, ['commit', '-q', '--allow-empty', '-m', `chore(slicekit): ${id} started\n\nclaim ${nonce}\n\nSlice: ${id}`]);
  } catch (e) {
    takeBack();
    throw e;
  }

  if (!origin) {
    onWarning(`slicekit: no origin; other clones will not see ${branch}`);
    return { worktree: dir, branch };
  }
  beforePush?.();
  try {
    pushBranch(dir, { protectedBranches: cfg.protectedBranches, defaultBranch: cfg.defaultBranch });
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    takeBack();
    let other = null;
    try {
      other = claimsOnOrigin(root, id)[0] ?? null;
    } catch (le) {
      if (!(le instanceof GitError)) throw le;
    }
    if (other) throw new BuildError(`${id} was claimed by ${other} while starting`);
    throw new BuildError(`could not push ${branch} (${e.stderr.split('\n')[0]}); ${id} was not started`);
  }
  // Another clone may have pushed a branch of another name for this slice between our fetch and our
  // push: then we back out, deleting only the branch we just pushed. Whoever checks second backs out,
  // whatever the names: a name tie-break would let a second checker with the lower name keep it
  // while the first, which saw nothing, keeps it too.
  const others = claimsOnOrigin(root, id).filter((b) => b !== branch);
  if (others.length > 0) {
    git(dir, ['push', '-q', 'origin', '--delete', branch]);
    takeBack();
    throw new BuildError(`${id} was claimed by ${others[0]} while starting`);
  }
  return { worktree: dir, branch };
}
