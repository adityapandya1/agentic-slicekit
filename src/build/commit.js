// `build commit` and `build amend` (REQ-2.6 step 4, D-10): the developer's work is committed with the
// test run that went with it, never touching a frozen test; a frozen test changes only after the
// human has amended the slice file, and then only that one test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTestCommand } from '../config.js';
import { GitError, assertRef, commitPaths, commitStaged, git, hasRemote, parseTrailers, stagedChanges } from '../git.js';
import { configSubject, namesConfigAt } from './config.js';
import { freshAt, renderPathsOnly, renderSubject } from './render.js';
import { stateFileName, verdictFilePattern } from '../ids.js';
import { kitPaths } from '../paths.js';
import { TransitionError, frozenOf, isFrozen, readSlice, unfreeze } from '../state/index.js';
import { SEP, TestNameError, entryLabel, findTest, isUnfrozen } from '../testnames.js';
import { isKitFile, posixRel, runCommand, sliceIn, toWorktreePath, unusableRun } from './red.js';
import { commitState, recordAmendment } from './record.js';
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

// The slice's own state file, judged before any test runs (issue #71): what is frozen and what is
// unfrozen is read from it, so a copy git cannot see, or one that is not the committed one, decides
// nothing. -> the refusal, saying which of the three it found, or null.
// `held`: the state file is among the paths the commit would hold, so the line is the kit file refusal too.
function stateFileProblem(wt, stateRel, held) {
  const flag = git(wt, ['--literal-pathspecs', 'ls-files', '-v', '--', stateRel]).slice(0, 1);
  const hidden = 'so git cannot see its changes; clear the mark and restore the file from the last commit';
  // `ls-files -v`: S is skip-worktree, a lower-case letter is assume-unchanged (s is both).
  if (flag === 'S' || flag === 's') return `state file ${stateRel} is marked skip-worktree, ${hidden}`;
  if (flag !== '' && flag !== flag.toUpperCase()) return `state file ${stateRel} is marked assume-unchanged, ${hidden}`;
  const atHead = blobAt(wt, 'HEAD', stateRel);
  const onDisk = fs.existsSync(path.join(wt, ...stateRel.split('/'))) ? git(wt, ['--literal-pathspecs', 'hash-object', '--', stateRel]) : null;
  if (onDisk !== atHead) {
    const why = 'differs on disk from the file at HEAD; only build commands write it, and each commits what it wrote';
    return held ? `${stateRel} is a kit file; build commit does not commit it: the state file ${why}` : `state file ${stateRel} ${why}`;
  }
  return null;
}

// The file's text at `rev` (`''` for the index), or null when it has no such file.
const textAt = (wt, rev, file) => {
  try {
    return git(wt, ['show', `${rev}:${file}`]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
};

// The text of the test named `name` in `text`: null when the file or the test is missing; undefined
// when the file cannot be read by name (unparseable, or the name given twice), which never matches.
function bodyOf(text, name) {
  if (text === null) return null;
  try {
    return findTest(text, name)?.text ?? null;
  } catch (e) {
    if (e instanceof TestNameError) return undefined;
    throw e;
  }
}

// The first frozen test (not unfrozen) that differs from the red commit, and how: hidden from git by
// skip-worktree or assume-unchanged, different or missing on disk (an edit through Bash never meets
// the pre-edit hook), or different in the index or a commit since (a mode change, a removal). A test
// frozen by name (D-102) is compared by its text on disk, in the index and at HEAD; a file frozen
// whole (a state file written before P8/S-60 whose evaluation set names no test in it), by its bytes.
function frozenProblem(wt, current, slice) {
  const entries = frozenOf(current, slice).filter((e) => !isUnfrozen(e, current.unfrozen));
  const changed = (t, what = t) => `frozen test ${what} changed since ${short(current.redCommit)}; amend the slice file to change the evaluation set`;
  for (const t of [...new Set(entries.map((e) => e.file))]) {
    const flag = git(wt, ['--literal-pathspecs', 'ls-files', '-v', '--', t]).slice(0, 1);
    if (flag === 'S' || (flag !== '' && flag !== flag.toUpperCase())) {
      return `frozen test ${t} is marked skip-worktree or assume-unchanged, so git cannot see its changes; clear the mark`;
    }
    const exists = fs.existsSync(path.join(wt, ...t.split('/')));
    const names = entries.filter((e) => e.file === t).map((e) => e.name);
    if (names.includes(null)) {
      const red = blobAt(wt, current.redCommit, t);
      const onDisk = exists ? git(wt, ['hash-object', '--', t]) : null;
      const elsewhere = ['--cached', 'HEAD'].some(
        (where) => git(wt, ['--literal-pathspecs', 'diff', '--name-only', ...(where === 'HEAD' ? [current.redCommit, 'HEAD'] : [where, current.redCommit]), '--', t]) !== '',
      );
      if (onDisk !== red || elsewhere) return changed(t);
      continue;
    }
    // The file that holds the tests is gone: the file is named, as for a file frozen whole.
    if (!exists || textAt(wt, '', t) === null || textAt(wt, 'HEAD', t) === null) return changed(t);
    const versions = [fs.readFileSync(path.join(wt, ...t.split('/')), 'utf8'), textAt(wt, '', t), textAt(wt, 'HEAD', t)];
    const atRed = textAt(wt, current.redCommit, t);
    for (const name of names) {
      const red = bodyOf(atRed, name);
      if (versions.some((v) => { const b = bodyOf(v, name); return b === undefined || red === undefined || b !== red; })) return changed(t, entryLabel({ file: t, name }));
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

// The default branch's tip the guard reads (D-53): origin's when there is an origin, else the
// local branch; null when neither resolves.
function defaultBranchTip(wt, cfg) {
  let name;
  try {
    name = assertRef(cfg.defaultBranch);
  } catch {
    return null;
  }
  const ref = hasRemote(wt, 'origin') ? `refs/remotes/origin/${name}` : `refs/heads/${name}`;
  try {
    return git(wt, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

// The files merge `sha` changed against its first parent, the branch it was made on.
const mergeFiles = (wt, sha, first) =>
  git(wt, ['diff-tree', '-r', '--name-only', '--no-commit-id', '--no-renames', '-z', first, sha]).split('\0').filter((f) => f !== '');

function isAncestor(wt, a, b) {
  try {
    git(wt, ['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}

// `file` in merge `sha` is what one of its other parents holds, a parent the default branch's tip
// reaches: the merge took it from the default branch unchanged.
const fromDefault = (wt, sha, file, others, tip) =>
  tip !== null && others.some((p) => isAncestor(wt, p, tip) && blobAt(wt, sha, file) === blobAt(wt, p, file));

// A kit path changed since the red commit in a commit the kit did not make: a hand commit could
// otherwise unfreeze a test or rewrite the evaluation set (D-53, replacing D-50).
// - A commit the default branch's tip reaches was reviewed and merged there, so only this slice's
//   own state file and verdicts are judged in it: the default branch never carries them while the
//   slice is open, and its tip is a ref a clone can move or a fork's author can push to.
// - A merge is judged by its kit files against its first parent: each must equal what a parent on
//   the default branch holds. This slice's own state file and verdicts must equal what another parent
//   in the range holds, off the default branch: a line of the slice branch itself, as when the review
//   worktree and the build worktree both pushed (review r2 H-1), whose commits are judged one by one
//   here. So a hand edit made while merging, or a file taken whole from another branch, is caught.
// - A commit with no parent has every file it adds judged (--root).
function forgedKitChange(wt, cfg, id, current, slice) {
  const paths = kitPaths(wt, cfg);
  const stateRel = posixRel(wt, path.join(paths.state, stateFileName(id)));
  const buildRel = posixRel(wt, paths.build);
  const sliceRel = posixRel(wt, slice.path);
  const configRel = posixRel(wt, paths.config);
  // Kit files that are not this slice's business (D-43): another slice's state file or verdict, and
  // BUILD.md, the view of every state. A commit whose kit changes are all of them is skipped, whoever
  // made it and wherever it came from.
  const stateDir = posixRel(wt, paths.state);
  const mine = verdictFilePattern(id);
  const othersOnly = (f) =>
    f === buildRel ||
    (f.startsWith(`${stateDir}/`) && f.endsWith('.json') && !f.slice(stateDir.length + 1).includes('/') && f !== stateRel) ||
    (f.startsWith(REVIEWS) && !f.slice(REVIEWS.length).includes('/') && !mine.test(f.slice(REVIEWS.length)));
  const own = (f) => f === stateRel || (f.startsWith(REVIEWS) && !f.slice(REVIEWS.length).includes('/') && mine.test(f.slice(REVIEWS.length)));
  let rendered = false;
  const tip = defaultBranchTip(wt, cfg);
  const offDefault = tip === null ? null : new Set(lines(git(wt, ['rev-list', 'HEAD', `^${current.redCommit}`, `^${tip}`])));
  const range = lines(git(wt, ['rev-list', '--parents', 'HEAD', `^${current.redCommit}`]));
  // Commits whose own changes this loop judges: in the range, and off the default branch.
  const judged = offDefault ?? new Set(range.map((l) => l.split(' ')[0]));
  // `file` in merge `sha` is what another parent holds, a parent whose commits are judged here.
  const fromSlice = (sha, file, others) => others.some((p) => judged.has(p) && blobAt(wt, sha, file) === blobAt(wt, p, file));
  for (const line of range) {
    const [sha, ...parents] = line.split(' ');
    const onDefault = offDefault !== null && !offDefault.has(sha);
    if (parents.length > 1) {
      const kit = mergeFiles(wt, sha, parents[0]).filter((f) => isKitFile(wt, cfg, slice, f) && !othersOnly(f) && (!onDefault || own(f)));
      const bad = kit.find((f) => (own(f) ? !fromSlice(sha, f, parents.slice(1)) : !fromDefault(wt, sha, f, parents.slice(1), tip)));
      if (bad) return `${bad} was changed in ${short(sha)}, a merge, outside the kit; only build commands write it`;
      continue;
    }
    const changes = lines(git(wt, ['diff-tree', '--root', '--no-commit-id', '--name-status', '--no-renames', '-r', sha])).map((l) => {
      const [status, ...rest] = l.split('\t');
      return { status, file: rest.join('\t') };
    });
    const kitFiles = changes.map((c) => c.file).filter((f) => isKitFile(wt, cfg, slice, f) && (!onDefault || own(f)));
    if (kitFiles.length === 0 || kitFiles.every(othersOnly)) continue;
    const kit = kitFiles.find((f) => !othersOnly(f));
    const subject = git(wt, ['log', '-1', '--format=%s', sha]);
    const trailers = parseTrailers(git(wt, ['log', '-1', '--format=%B', sha]));
    // build render's commits hold only the files update writes; what they wrote is judged at HEAD.
    if (subject === renderSubject(id) && trailers.Slice === id) {
      if (!renderPathsOnly(wt, sha)) return `${kit} was changed in ${short(sha)} outside the kit; a render commit holds only the files slicekit update writes`;
      rendered = true;
      continue;
    }
    // build config's commit: the config alone, under its subject, for a slice whose file at that
    // commit names the config in its Expected changes.
    if (subject === configSubject(id) && trailers.Slice === id && changes.length === 1 && changes[0].file === configRel && namesConfigAt(wt, sha, sliceRel)) continue;
    if (!kitCommit(id, subject, trailers, changes, stateRel, buildRel, sliceRel)) {
      return `${kit} was changed in ${short(sha)} outside the kit; only build commands write it`;
    }
  }
  // With a render in the range, the files update writes must, at HEAD, be what a fresh render from
  // this kit writes: an `update --check` of HEAD (D-43).
  if (rendered) {
    const stale = freshAt(wt, 'HEAD');
    if (stale) return `${stale} at HEAD is not what slicekit update renders: changed outside the kit or by another kit; run slicekit build render ${id} again`;
  }
  return null;
}

// Makes the worktree's files the index does not hold readable in the run directory at the same
// relative path (issue #107): the files git ignores or does not track, such as `.slice-tests` or
// `node_modules`. A directory git holds nothing of is linked whole; a file is hard-linked, or copied
// when a hard link cannot be made (another volume). -> the directory links made.
function bringUntracked(wt, dir) {
  const links = [];
  // --directory: a directory with no tracked file is one entry, `name/`, and is not walked.
  const others = git(wt, ['ls-files', '--others', '--directory', '-z']).split('\0').filter((e) => e !== '');
  for (const entry of others) {
    const rel = entry.replace(/\/$/, '');
    if (rel === '' || rel.split('/').includes('.git')) continue;
    const from = path.join(wt, ...rel.split('/'));
    const to = path.join(dir, ...rel.split('/'));
    if (fs.existsSync(to)) continue;
    try {
      const stat = fs.lstatSync(from);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (stat.isDirectory()) {
        fs.symlinkSync(from, to, 'junction');
        links.push(to);
      } else if (stat.isFile()) {
        try {
          fs.linkSync(from, to);
        } catch {
          fs.copyFileSync(from, to);
        }
      }
    } catch {
      // A file that went away or cannot be read is left out of the run.
    }
  }
  return links;
}

// Makes git usable in the run directory (issue #107): a `.git` directory of its own that holds a
// copy of the worktree's index and HEAD and names the repository's common directory for everything
// else. A git command there sees every tracked file as staged and no unstaged change, and writes at
// most that copy of the index. Nothing is registered in the repository, so removing the directory
// leaves no trace of it.
function gitIn(wt, dir) {
  const own = path.join(dir, '.git');
  if (fs.existsSync(own)) return;
  const abs = (p) => path.resolve(wt, p);
  const common = abs(git(wt, ['rev-parse', '--git-common-dir']));
  const index = abs(git(wt, ['rev-parse', '--git-path', 'index']));
  let head;
  try {
    head = `ref: ${git(wt, ['symbolic-ref', '-q', 'HEAD'])}`;
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    head = git(wt, ['rev-parse', 'HEAD']);
  }
  fs.mkdirSync(own);
  fs.writeFileSync(path.join(own, 'HEAD'), `${head}\n`);
  fs.writeFileSync(path.join(own, 'commondir'), `${common.split(path.sep).join('/')}\n`);
  if (fs.existsSync(index)) fs.copyFileSync(index, path.join(own, 'index'));
}

// The test command run in a temporary directory holding the index as staged (git checkout-index),
// never the worktree. The files of the worktree that git ignores or does not track are linked or
// copied in, so the run finds the installed packages and a file such as `.slice-tests`, and git
// answers there (issue #107). The directory is removed whether the run passes or fails.
function runOnIndex(wt, command) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-index-'));
  const links = [];
  try {
    // The staged bytes as the index holds them: no line-ending conversion from this machine's git
    // config, so the run reads what the commit will hold.
    const prefix = `${path.resolve(dir).split(path.sep).join('/')}/`;
    git(wt, ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'checkout-index', '-a', '-f', `--prefix=${prefix}`]);
    links.push(...bringUntracked(wt, dir));
    const modules = path.join(dir, 'node_modules');
    const installed = path.join(wt, 'node_modules');
    if (fs.existsSync(installed) && !fs.existsSync(modules)) {
      fs.symlinkSync(installed, modules, 'junction');
      links.push(modules);
    }
    gitIn(wt, dir);
    return runCommand(dir, command);
  } finally {
    // The links first, so removing the directory never walks into the worktree.
    for (const link of links) {
      try {
        if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
      } catch {
        // the link is gone
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function commitWork(root, cfg, id, { message, requireGreen = false, worktree, env = process.env } = {}) {
  if (typeof message !== 'string' || message.trim() === '') throw new BuildError('--message is required', 2);
  const wt = findWorktree(root, id, { worktree }).path;
  const current = building(wt, cfg, id, 'commit', COMMIT_FROM);
  const slice = sliceIn(wt, cfg, id);
  const forged = forgedKitChange(wt, cfg, id, current, slice);
  if (forged) throw new BuildError(forged);
  const stateRel = posixRel(wt, path.join(kitPaths(wt, cfg).state, stateFileName(id)));
  // Paths staged: those alone are committed, as staged. Nothing staged: every changed path.
  const staged = stagedChanges(wt).map((c) => c.file);
  const paths = staged.length > 0 ? staged : changedPaths(wt);
  const hidden = stateFileProblem(wt, stateRel, paths.includes(stateRel));
  if (hidden) throw new BuildError(hidden);
  const frozen = frozenProblem(wt, current, slice);
  if (frozen) throw new BuildError(frozen);
  const kit = paths.find((p) => isKitFile(wt, cfg, slice, p));
  if (kit) {
    const config = kit === posixRel(wt, kitPaths(wt, cfg).config) ? `; run slicekit build config ${id}` : '';
    throw new BuildError(`${kit} is a kit file; build commit does not commit it${config}`);
  }
  const { command, local } = buildTestCommand(root, cfg, env);
  if (command.trim() === '') throw new BuildError('commands.test is not declared in .slicekit/config.json');
  const ranLocal = local ? command : null;
  // With paths staged the commit holds the index, so the tests run on the index (issue #69): a
  // tracked path changed but not staged stays in the worktree, out of the run and out of the commit.
  const run = staged.length > 0 ? runOnIndex(wt, command) : runCommand(wt, command);
  const unusable = unusableRun(command, run);
  if (unusable) throw unusable;
  if (requireGreen && run.exit !== 0) throw new BuildError(`tests fail (exit ${run.exit}): ${run.summary}`);
  if (paths.length === 0) return { sha: null, exit: run.exit, local: ranLocal };
  // Only the paths the status named: the developer's work, never the kit's files.
  const body = `${message.trim()}\n\nran: ${command} → exit ${run.exit}\n\nSlice: ${id}`;
  const sha = staged.length > 0 ? commitStaged(wt, body) : commitPaths(wt, paths, body);
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

// The state file as HEAD holds it, or null: a hand edit of the file on disk never decides a step.
function committedState(wt, stateRel) {
  try {
    return JSON.parse(git(wt, ['show', `HEAD:${stateRel}`]));
  } catch {
    return null;
  }
}

// `sha` is this slice's amendment commit, on HEAD's history: the subject, the trailer, the slice file alone.
function isAmendment(wt, id, sliceRel, sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(sha)) return false;
  try {
    git(wt, ['merge-base', '--is-ancestor', sha, 'HEAD']);
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
  const subject = git(wt, ['log', '-1', '--format=%s', sha]);
  const trailers = parseTrailers(git(wt, ['log', '-1', '--format=%B', sha]));
  const files = lines(git(wt, ['diff-tree', '--no-commit-id', '--name-only', '-r', sha]));
  return subject === `docs(${id}): amend evaluation set` && trailers.Slice === id && files.length === 1 && files[0] === sliceRel;
}

// The state file on disk differs from HEAD's copy only by this unfreeze (and its move to building),
// its amendment commit is on HEAD's history, and HEAD's state is one amend runs from: its bookkeeping
// commit did not land.
// `test` is the entry as unfreeze stores it: a path, or { file, name }.
function pendingUnfreeze(wt, id, stateRel, sliceRel, test) {
  const committed = committedState(wt, stateRel);
  if (!committed || !AMEND_FROM.includes(committed.state)) return false;
  const now = JSON.parse(fs.readFileSync(path.join(wt, ...stateRel.split('/')), 'utf8'));
  const added = now.history.at(-1);
  const strip = (s) => JSON.stringify({ ...s, unfrozen: null, history: null, state: null, handoff: null });
  return (
    strip(now) === strip(committed) &&
    (now.state === committed.state || now.state === 'building') &&
    JSON.stringify(now.unfrozen) === JSON.stringify([...committed.unfrozen, test]) &&
    now.history.length === committed.history.length + 1 &&
    JSON.stringify(now.history.slice(0, -1)) === JSON.stringify(committed.history) &&
    added?.evidence?.unfreeze === entryLabel(test) &&
    isAmendment(wt, id, sliceRel, added?.evidence?.amendCommit)
  );
}

// The state file on disk differs from HEAD's copy only by one history entry that records an
// amendment commit on HEAD's history and leaves the state where it was, and HEAD's history does not
// hold that commit yet: a slice-file-only amend wrote its record and stopped before committing it.
// -> the amendment commit's SHA, or null.
function pendingAmendment(wt, id, stateRel, sliceRel) {
  const committed = committedState(wt, stateRel);
  if (!committed || !AMEND_FROM.includes(committed.state)) return null;
  const now = JSON.parse(fs.readFileSync(path.join(wt, ...stateRel.split('/')), 'utf8'));
  const added = now.history.at(-1);
  const sha = added?.evidence?.amendCommit;
  const strip = (s) => JSON.stringify({ ...s, history: null, handoff: null });
  const pending =
    strip(now) === strip(committed) &&
    now.history.length === committed.history.length + 1 &&
    JSON.stringify(now.history.slice(0, -1)) === JSON.stringify(committed.history) &&
    added?.evidence?.unfreeze === undefined &&
    !committed.history.some((h) => h.evidence?.amendCommit === sha) &&
    isAmendment(wt, id, sliceRel, sha);
  return pending ? sha : null;
}

// An amendment of the slice file that unfreezes nothing (issue #72, issue #187, D-102): the slice file
// alone is committed and the reason recorded in the state file; every frozen test stays frozen, and
// the state stays where it is. `again`, the label of a test already unfrozen that the call named, joins
// the record as `test`: a second amendment of that test. A run that stopped after the slice file's
// commit, or after the record was written but before it was committed, is finished. `none` is the
// refusal when the slice file has no change.
function amendSliceFile(wt, cfg, id, current, reason, stateRel, sliceRel, { again, none = 'amend the slice file first; it has no change' } = {}) {
  const sliceChanged = git(wt, ['--literal-pathspecs', 'status', '--porcelain', '--', sliceRel]) !== '';
  const recorded = sliceChanged ? null : pendingAmendment(wt, id, stateRel, sliceRel);
  if (recorded) {
    // The record is written; only its bookkeeping commit is left.
    commitState(wt, cfg, id, 'amend');
    return { sha: recorded, test: again ?? null, again: again !== undefined };
  }
  let sha;
  if (sliceChanged) {
    sha = commitPaths(wt, [sliceRel], `docs(${id}): amend evaluation set\n\n${reason}\n\nSlice: ${id}`);
  } else if (headIsAmendment(wt, id, sliceRel) && !current.history.some((h) => h.evidence?.amendCommit === git(wt, ['rev-parse', 'HEAD']))) {
    // A run that committed the slice file and stopped before its record is finished.
    sha = git(wt, ['rev-parse', 'HEAD']);
  } else {
    throw new BuildError(none);
  }
  recordAmendment(wt, cfg, id, { amendCommit: sha, reason, ...(again === undefined ? {} : { test: again }) });
  return { sha, test: again ?? null, again: again !== undefined };
}

// The test `--test` names: `<file> » <name>` as { file, name } (D-102), or a bare path, the whole file.
function namedTest(wt, given) {
  const text = String(given).trim();
  const at = text.indexOf(SEP.trim());
  if (at === -1) return toWorktreePath(wt, text);
  const name = text.slice(at + SEP.trim().length).trim();
  if (name === '') throw new BuildError(`--test ${text} names no test after »`, 2);
  return { file: toWorktreePath(wt, text.slice(0, at).trim()), name };
}

// Whether `current.unfrozen` already lifts the freeze on `test`.
const alreadyUnfrozen = (current, test) =>
  typeof test === 'string' ? current.unfrozen.includes(test) : isUnfrozen(test, current.unfrozen);

// -> { sha, test }: the slice file's amendment commit, and the test as stored. A run that stopped part
// way (the slice file committed, or the state written but not committed) is finished, not refused.
export function amend(root, cfg, id, { test, reason, worktree } = {}) {
  if (typeof reason !== 'string' || reason.trim() === '') throw new BuildError('--reason is required', 2);
  const wt = findWorktree(root, id, { worktree }).path;
  const current = readSlice(wt, cfg, id);
  const stateRel = posixRel(wt, path.join(kitPaths(wt, cfg).state, stateFileName(id)));
  // Where amend runs from is read from HEAD's state file, never the copy on disk.
  const committed = committedState(wt, stateRel) ?? current;
  if (!AMEND_FROM.includes(committed.state)) throw new BuildError(`${id} is ${committed.state}; amend runs from ${AMEND_FROM.join(', ')}`);
  const slice = sliceIn(wt, cfg, id);
  const sliceRel = posixRel(wt, slice.path);
  // No test named: the slice file alone, whatever is frozen; every frozen test stays frozen (D-102).
  if (test === undefined || (typeof test === 'string' && test.trim() === '')) return amendSliceFile(wt, cfg, id, current, reason.trim(), stateRel, sliceRel);
  const target = namedTest(wt, test);
  const label = entryLabel(target);
  // Checked before the slice file is committed; the words are unfreeze's own TransitionError reason.
  if (!isFrozen(current, target, slice)) throw new BuildError(`${label} is not a frozen test of ${id}`);
  const lastAmendment = () => git(wt, ['log', '-1', '--format=%H', `--grep=^docs(${id}): amend evaluation set$`, '--', sliceRel]);
  if (alreadyUnfrozen(current, target)) {
    if (pendingUnfreeze(wt, id, stateRel, sliceRel, target)) {
      commitState(wt, cfg, id, `unfreeze ${label}`);
      return { sha: lastAmendment(), test: label };
    }
    // A second amendment of a test already unfrozen: the slice file and the reason are recorded.
    return amendSliceFile(wt, cfg, id, current, reason.trim(), stateRel, sliceRel, {
      again: label,
      none: `${label} is already unfrozen; a second amendment needs a change to the slice file`,
    });
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
    unfreeze(wt, cfg, id, target, { amendCommit: sha, reason: reason.trim() }, { to: 'building', slice });
  } catch (e) {
    if (e instanceof TransitionError) throw new BuildError(e.reason);
    throw e;
  }
  commitState(wt, cfg, id, `unfreeze ${label}`);
  return { sha, test: label };
}
