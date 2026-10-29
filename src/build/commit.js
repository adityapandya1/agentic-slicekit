// `build commit` and `build amend` (REQ-2.6 step 4, D-10): the developer's work is committed with the
// test run that went with it, never touching a frozen test; a frozen test changes only after the
// human has amended the slice file, and then only that one test.
import fs from 'node:fs';
import path from 'node:path';
import { buildTestCommand } from '../config.js';
import { GitError, commitPaths, git, parseTrailers } from '../git.js';
import { isFreshRender, renderSubject } from './render.js';
import { stateFileName, verdictFilePattern } from '../ids.js';
import { kitPaths } from '../paths.js';
import { TransitionError, readSlice, unfreeze } from '../state/index.js';
import { isKitFile, posixRel, runCommand, sliceIn, toWorktreePath, unusableRun } from './red.js';
import { commitState } from './record.js';
import { BuildError, findWorktree } from './worktree.js';

const short = (sha) => sha.slice(0, 7);
const lines = (out) => out.split('\n').filter((l) => l !== '');

// A fix for review findings is committed the same way while the pull request is in review, and after
// CI or the independent review passed (build pr then takes the slice back to draft-pr).
const COMMIT_FROM = ['building', 'in-review', 'changes-requested', 'ci-green', 'ready'];

function building(wt, cfg, id, step, from = ['building']) {
  const current = readSlice(wt, cfg, id);
  if (!from.includes(current.state)) throw new BuildError(`${id} is ${current.state}; ${step} runs from ${from.join(', ')}`);
  return current;
}

// Every changed path in the worktree (staged, unstaged, untracked; both sides of a rename), POSIX.
function changedPaths(wt) {
  const list = (args) => git(wt, args).split('\0').filter((e) => e !== '');
  // --no-renames: a rename is its deletion and its addition, so both paths are committed.
  const tracked = list(['diff', '--name-only', '--no-renames', '-z', 'HEAD']);
  const untracked = list(['ls-files', '--others', '--exclude-standard', '-z']);
  return [...new Set([...tracked, ...untracked])];
}

const blobAt = (wt, rev, file) => {
  try {
    return git(wt, ['rev-parse', '--verify', '--quiet', `${rev}:${file}`]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
};

const refExists = (wt, ref) => {
  try {
    git(wt, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
};

// The first frozen test (not unfrozen) that differs from the red commit, and how: hidden from git by
// skip-worktree or assume-unchanged, different bytes or missing on disk (an edit through Bash never
// meets the pre-edit hook), or different in the index or a commit since (a mode change, a removal).
function frozenProblem(wt, current) {
  for (const t of current.frozenTests) {
    if (current.unfrozen.includes(t)) continue;
    const flag = git(wt, ['--literal-pathspecs', 'ls-files', '-v', '--', t]).slice(0, 1);
    if (flag === 'S' || (flag !== '' && flag !== flag.toUpperCase())) {
      return `frozen test ${t} is marked skip-worktree or assume-unchanged, so git cannot see its changes; clear the mark`;
    }
    const red = blobAt(wt, current.redCommit, t);
    const onDisk = fs.existsSync(path.join(wt, ...t.split('/'))) ? git(wt, ['hash-object', '--', t]) : null;
    const elsewhere = ['--cached', 'HEAD'].some(
      (where) => git(wt, ['--literal-pathspecs', 'diff', '--name-only', ...(where === 'HEAD' ? [current.redCommit, 'HEAD'] : [where, current.redCommit]), '--', t]) !== '',
    );
    if (onDisk !== red || elsewhere) {
      return `frozen test ${t} changed since ${short(current.redCommit)}; amend the slice file to change the evaluation set`;
    }
  }
  return null;
}

const REVIEWS = '.slicekit/reviews/';

// The kit's own commits on the slice branch, recognised by subject, trailer and paths; a hand commit
// that imitates all three passes. The test command is read from the MAIN checkout's
// .slicekit/config.json, so someone writing outside the worktree could change commands.test and make
// --require-green meaningless; CI, which runs the committed config, is the backstop.
// `changes` are the commit's { status, file }, POSIX paths.
function kitCommit(id, subject, trailers, changes, stateRel, buildRel, sliceRel) {
  if (trailers.Slice !== id) return false;
  const files = changes.map((c) => c.file);
  if (subject.startsWith(`chore(slicekit): ${id} `)) {
    const pattern = verdictFilePattern(id);
    const round = (f) => (f.startsWith(REVIEWS) ? pattern.exec(f.slice(REVIEWS.length))?.[2] : undefined);
    if (!files.some((f) => round(f) !== undefined)) return files.every((f) => f === stateRel || f === buildRel);
    // build verdict's commit: one verdict file, added, of the round its subject names, and nothing else.
    // A change or removal of a recorded verdict, or a second one, is never the kit's.
    if (changes.length !== 1 || changes[0].status !== 'A') return false;
    return subject === `chore(slicekit): ${id} verdict r${round(files[0])}`;
  }
  if (subject === `docs(${id}): amend evaluation set`) return files.length === 1 && files[0] === sliceRel;
  return false;
}

// A kit path changed since the red commit in a commit the kit did not make: a hand commit could
// otherwise unfreeze a test or rewrite the evaluation set.
function forgedKitChange(wt, cfg, id, current, slice) {
  const paths = kitPaths(wt, cfg);
  const stateRel = posixRel(wt, path.join(paths.state, stateFileName(id)));
  const buildRel = posixRel(wt, paths.build);
  const sliceRel = posixRel(wt, slice.path);
  // A commit the default branch holds came in with a merge of it: it is that branch's, not the slice's.
  const theirs = [`refs/remotes/origin/${cfg.defaultBranch}`, `refs/heads/${cfg.defaultBranch}`].filter((r) => refExists(wt, r));
  for (const sha of lines(git(wt, ['rev-list', '--no-merges', 'HEAD', `^${current.redCommit}`, ...theirs.map((r) => `^${r}`)]))) {
    const changes = lines(git(wt, ['diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', sha])).map((l) => {
      const [status, ...rest] = l.split('\t');
      return { status, file: rest.join('\t') };
    });
    const kit = changes.map((c) => c.file).find((f) => isKitFile(wt, cfg, slice, f));
    if (!kit) continue;
    const subject = git(wt, ['log', '-1', '--format=%s', sha]);
    const trailers = parseTrailers(git(wt, ['log', '-1', '--format=%B', sha]));
    // build render's commit: accepted only when it is exactly a fresh render of its parent (D-43).
    if (subject === renderSubject(id) && trailers.Slice === id) {
      if (isFreshRender(wt, sha)) continue;
      return `${kit} was changed in ${short(sha)} outside the kit; a render commit holds only a fresh render of slicekit update`;
    }
    if (!kitCommit(id, subject, trailers, changes, stateRel, buildRel, sliceRel)) {
      return `${kit} was changed in ${short(sha)} outside the kit; only build commands write it`;
    }
  }
  return null;
}

export function commitWork(root, cfg, id, { message, requireGreen = false, worktree } = {}) {
  if (typeof message !== 'string' || message.trim() === '') throw new BuildError('--message is required', 2);
  const wt = findWorktree(root, id, { worktree }).path;
  const current = building(wt, cfg, id, 'commit', COMMIT_FROM);
  const slice = sliceIn(wt, cfg, id);
  const forged = forgedKitChange(wt, cfg, id, current, slice);
  if (forged) throw new BuildError(forged);
  const frozen = frozenProblem(wt, current);
  if (frozen) throw new BuildError(frozen);
  const paths = changedPaths(wt);
  const kit = paths.find((p) => isKitFile(wt, cfg, slice, p));
  if (kit) throw new BuildError(`${kit} is a kit file; build commit does not commit it`);
  const { command, local } = buildTestCommand(root, cfg);
  if (command.trim() === '') throw new BuildError('commands.test is not declared in .slicekit/config.json');
  const ranLocal = local ? command : null;

  const run = runCommand(wt, command);
  const unusable = unusableRun(command, run);
  if (unusable) throw unusable;
  if (requireGreen && run.exit !== 0) throw new BuildError(`tests fail (exit ${run.exit}): ${run.summary}`);
  if (paths.length === 0) return { sha: null, exit: run.exit, local: ranLocal };
  // Only the paths the status named: the developer's work, never the kit's files.
  const sha = commitPaths(wt, paths, `${message.trim()}\n\nran: ${command} → exit ${run.exit}\n\nSlice: ${id}`);
  return { sha, exit: run.exit, local: ranLocal };
}

// HEAD is this slice's amendment commit: the subject, the trailer, and the slice file alone.
function headIsAmendment(wt, id, sliceRel) {
  const subject = git(wt, ['log', '-1', '--format=%s', 'HEAD']);
  const trailers = parseTrailers(git(wt, ['log', '-1', '--format=%B', 'HEAD']));
  const files = lines(git(wt, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']));
  return subject === `docs(${id}): amend evaluation set` && trailers.Slice === id && files.length === 1 && files[0] === sliceRel;
}

// A frozen test is amended while the slice is built or in review (D-43): a finding inside a frozen
// test is fixed during review. From review the amendment takes the slice back to building.
const AMEND_FROM = ['building', 'draft-pr', 'in-review', 'changes-requested'];

// The state file on disk differs from HEAD's copy only by this unfreeze (and its move to building):
// its bookkeeping commit did not land.
function pendingUnfreeze(wt, stateRel, file) {
  let committed;
  try {
    committed = JSON.parse(git(wt, ['show', `HEAD:${stateRel}`]));
  } catch {
    return false;
  }
  const now = JSON.parse(fs.readFileSync(path.join(wt, ...stateRel.split('/')), 'utf8'));
  const added = now.history.at(-1);
  const strip = (s) => JSON.stringify({ ...s, unfrozen: null, history: null, state: null, handoff: null });
  return (
    strip(now) === strip(committed) &&
    (now.state === committed.state || now.state === 'building') &&
    JSON.stringify(now.unfrozen) === JSON.stringify([...committed.unfrozen, file]) &&
    now.history.length === committed.history.length + 1 &&
    JSON.stringify(now.history.slice(0, -1)) === JSON.stringify(committed.history) &&
    added?.evidence?.unfreeze === file
  );
}

// -> { sha, test }: the slice file's amendment commit, and the test as stored. A run that stopped part
// way (the slice file committed, or the state written but not committed) is finished, not refused.
export function amend(root, cfg, id, { test, reason, worktree } = {}) {
  if (typeof reason !== 'string' || reason.trim() === '') throw new BuildError('--reason is required', 2);
  if (typeof test !== 'string' || test.trim() === '') throw new BuildError('--test is required', 2);
  const wt = findWorktree(root, id, { worktree }).path;
  const current = building(wt, cfg, id, 'amend', AMEND_FROM);
  const file = toWorktreePath(wt, test);
  // Checked before the slice file is committed; the words are unfreeze's own TransitionError reason.
  if (!current.frozenTests.includes(file)) throw new BuildError(`${file} is not a frozen test of ${id}`);
  const stateRel = posixRel(wt, path.join(kitPaths(wt, cfg).state, stateFileName(id)));
  const sliceRel = posixRel(wt, sliceIn(wt, cfg, id).path);
  const lastAmendment = () => git(wt, ['log', '-1', '--format=%H', `--grep=^docs(${id}): amend evaluation set$`, '--', sliceRel]);
  if (current.unfrozen.includes(file)) {
    if (!pendingUnfreeze(wt, stateRel, file)) throw new BuildError(`${file} is already unfrozen`);
    commitState(wt, cfg, id, `unfreeze ${file}`);
    return { sha: lastAmendment(), test: file };
  }
  let sha;
  if (git(wt, ['--literal-pathspecs', 'status', '--porcelain', '--', sliceRel]) !== '') {
    sha = commitPaths(wt, [sliceRel], `docs(${id}): amend evaluation set\n\n${reason.trim()}\n\nSlice: ${id}`);
  } else if (headIsAmendment(wt, id, sliceRel)) {
    sha = git(wt, ['rev-parse', 'HEAD']);
  } else {
    throw new BuildError('amend the slice file first; it has no change');
  }
  try {
    unfreeze(wt, cfg, id, file, { amendCommit: sha, reason: reason.trim() }, { to: 'building' });
  } catch (e) {
    if (e instanceof TransitionError) throw new BuildError(e.reason);
    throw e;
  }
  commitState(wt, cfg, id, `unfreeze ${file}`);
  return { sha, test: file };
}
