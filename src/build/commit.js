// `build commit` and `build amend` (REQ-2.6 step 4, D-10): the developer's work is committed with the
// test run that went with it, never touching a frozen test; a frozen test changes only after the
// human has amended the slice file, and then only that one test.
import path from 'node:path';
import { commitPaths, git } from '../git.js';
import { stateFileName } from '../ids.js';
import { kitPaths } from '../paths.js';
import { TransitionError, readSlice, unfreeze } from '../state/index.js';
import { isKitFile, posixRel, runCommand, sliceIn, unusableRun } from './red.js';
import { commitBookkeeping } from './record.js';
import { BuildError, findWorktree } from './worktree.js';

const short = (sha) => sha.slice(0, 7);

function building(wt, cfg, id, step) {
  const current = readSlice(wt, cfg, id);
  if (current.state !== 'building') throw new BuildError(`${id} is ${current.state}; ${step} runs from building`);
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

// A frozen test that is not unfrozen and differs from the red commit, in a commit since or in the
// working tree (an edit through Bash never meets the pre-edit hook).
function changedFrozen(wt, current) {
  return current.frozenTests.find(
    (t) => !current.unfrozen.includes(t) && git(wt, ['--literal-pathspecs', 'diff', '--name-only', current.redCommit, '--', t]) !== '',
  );
}

export function commitWork(root, cfg, id, { message, requireGreen = false, worktree } = {}) {
  if (typeof message !== 'string' || message.trim() === '') throw new BuildError('--message is required', 2);
  const wt = findWorktree(root, id, { worktree }).path;
  const current = building(wt, cfg, id, 'commit');
  const frozen = changedFrozen(wt, current);
  if (frozen) {
    throw new BuildError(`frozen test ${frozen} changed since ${short(current.redCommit)}; amend the slice file to change the evaluation set`);
  }
  const slice = sliceIn(wt, cfg, id);
  const paths = changedPaths(wt);
  const kit = paths.find((p) => isKitFile(wt, cfg, slice, p));
  if (kit) throw new BuildError(`${kit} is a kit file; build commit does not commit it`);
  const command = cfg.commands?.test ?? '';
  if (command.trim() === '') throw new BuildError('commands.test is not declared in .slicekit/config.json');

  const run = runCommand(wt, command);
  const unusable = unusableRun(command, run);
  if (unusable) throw unusable;
  if (requireGreen && run.exit !== 0) throw new BuildError(`tests fail (exit ${run.exit}): ${run.summary}`);
  if (paths.length === 0) return { sha: null, exit: run.exit };
  // Only the paths the status named: the developer's work, never the kit's files.
  const sha = commitPaths(wt, paths, `${message.trim()}\n\nran: ${command} → exit ${run.exit}\n\nSlice: ${id}`);
  return { sha, exit: run.exit };
}

// The test as a POSIX path relative to the worktree; outside it is a usage error.
function testPath(wt, given) {
  if (typeof given !== 'string' || given.trim() === '') throw new BuildError('--test is required', 2);
  const rel = path.relative(path.resolve(wt), path.resolve(wt, given.trim().replace(/\\/g, '/')));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new BuildError(`${given} is outside the worktree`, 2);
  return rel.split(path.sep).join('/');
}

// -> { sha, test }: the slice file's amendment commit, and the test as stored.
export function amend(root, cfg, id, { test, reason, worktree } = {}) {
  if (typeof reason !== 'string' || reason.trim() === '') throw new BuildError('--reason is required', 2);
  const wt = findWorktree(root, id, { worktree }).path;
  const current = building(wt, cfg, id, 'amend');
  const file = testPath(wt, test);
  // Checked before the slice file is committed; the words are unfreeze's own TransitionError reason.
  if (!current.frozenTests.includes(file)) throw new BuildError(`${file} is not a frozen test of ${id}`);
  if (current.unfrozen.includes(file)) throw new BuildError(`${file} is already unfrozen`);
  const slicePath = posixRel(wt, sliceIn(wt, cfg, id).path);
  if (git(wt, ['--literal-pathspecs', 'status', '--porcelain', '--', slicePath]) === '') {
    throw new BuildError('amend the slice file first; it has no change');
  }
  const sha = commitPaths(wt, [slicePath], `docs(${id}): amend evaluation set\n\n${reason.trim()}\n\nSlice: ${id}`);
  try {
    unfreeze(wt, cfg, id, file);
  } catch (e) {
    if (e instanceof TransitionError) throw new BuildError(e.reason);
    throw e;
  }
  commitBookkeeping(wt, id, `unfreeze ${file}`, [posixRel(wt, path.join(kitPaths(wt, cfg).state, stateFileName(id)))]);
  return { sha, test: file };
}
