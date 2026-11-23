// frozen (03 REQ-3.15, D-10, D-102): on a slice branch, a test of the slice's evaluation set, found by
// its name in its file, stays as it was at the red commit recorded in the slice's state file, unless
// `build amend` unfroze that test after the red commit: the tip's state file lists it in `unfrozen`
// and the slice file was changed in a commit after red. Other tests of the same file are not
// compared. A path entry of a state file written before P8/S-60 is every evaluation test of that file
// by name in the slice file at the red commit, or the whole file when that evaluation set names none
// in it. The state file, the red commit, the slice file and the tests are all read from git objects
// (of the tip judged, or of the red commit), never the working tree: a file hidden with
// `assume-unchanged` or `skip-worktree` is judged by its committed content (issue #71).
//
// The tip is HEAD, or under --ci on a pull request the pull request's head (branchTip). No branch, a
// branch that is not a slice branch, no red commit recorded in any version of the state file (a slice
// before tests-red, or one that never had a state file), or freezeTests set to false in the config
// (D-10): nothing to judge.
//
// A tip that has no state file is judged by the versions of the file in its history (issue #100):
// when one of them recorded a red commit, the removal is one finding naming the state file, and the
// frozen tests are judged as before. Removing the file does not lift the freeze.
//
// The red commit and the frozen list are those of the first version of the state file, in the history
// of the tip, that records a red commit; frozen paths of later versions are added to that list. A later
// commit that sets redCommit to null or a new sha, or empties frozenTests, does not change what is
// judged: tests-red is entered once, from todo, and only the CLI writes the state file.
import path from 'node:path';
import { GitError, git, resolveCommit } from '../../git.js';
import { branchTip } from '../ci-event.js';
import { parseSliceAddr, sliceFromBranch, stateFileName } from '../../ids.js';
import { kitPaths } from '../../paths.js';
import { SliceFileError, parseSliceFile, phaseOfDir } from '../../slicefile.js';
import { TestNameError, entryFile, entryLabel, evaluationRows, findTest, frozenEntries, isEntry, isUnfrozen } from '../../testnames.js';

export const id = 'frozen';
export const blocking = true;
export const ratchet = false;

const posixRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const lines = (out) => out.split('\n').filter((l) => l !== '');

// The file's content at `rev`, or null when the commit has no such file.
function showAt(root, rev, rel) {
  try {
    return git(root, ['show', `${rev}:${rel}`]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

// The slice's file(s) at `rev`: `<phases>/P<n>[-name]/S-<nn>*.md`, matched as findSliceFiles does.
function sliceFilesAt(root, rev, phasesRel, addr) {
  let listed;
  try {
    listed = git(root, ['--literal-pathspecs', 'ls-tree', '-r', '--name-only', rev, '--', phasesRel]);
  } catch (e) {
    if (e instanceof GitError) return [];
    throw e;
  }
  const prefix = phasesRel === '' || phasesRel === '.' ? '' : `${phasesRel}/`;
  return lines(listed).filter((f) => {
    if (!f.startsWith(prefix)) return false;
    const parts = f.slice(prefix.length).split('/');
    if (parts.length !== 2) return false;
    const phase = phaseOfDir(parts[0]);
    const m = /^S-(\d+).*\.md$/.exec(parts[1]);
    return phase !== null && m !== null && phase.n === addr.phase && Number(m[1]) === addr.slice;
  });
}

const validTest = (t) => typeof t === 'string' && t !== '' && !t.startsWith('-') && !t.startsWith('/') && !t.split('/').includes('..');

// Each version of the state file in the history of `tip`, oldest first: [{sha, text}].
function stateVersions(root, tip, stateRel) {
  const shas = lines(git(root, ['--literal-pathspecs', 'log', '--full-history', '--topo-order', '--reverse', '--format=%H', tip, '--', stateRel]));
  return shas.map((sha) => ({ sha, text: showAt(root, sha, stateRel) })).filter((v) => v.text !== null);
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export function run(ctx) {
  const { root, cfg } = ctx;
  if (cfg?.freezeTests === false) return [];
  const at = branchTip(ctx);
  if (!at) return [];
  const { tip } = at;
  const slice = sliceFromBranch(at.branch);
  if (!slice) return [];
  const addr = parseSliceAddr(slice);

  const paths = kitPaths(root, cfg);
  const stateRel = `${posixRel(root, paths.state)}/${stateFileName(slice)}`;
  const text = showAt(root, tip, stateRel);
  if (text !== null && parse(text) === undefined) {
    return [{ file: stateRel, line: 0, message: `state file ${stateRel} is not valid JSON at ${tip}` }];
  }
  // The first recorded red commit; every frozen path listed from then on.
  let red = null;
  const listed = [];
  for (const v of stateVersions(root, tip, stateRel)) {
    const state = parse(v.text);
    if (red === null) {
      const r = state?.redCommit;
      if (typeof r !== 'string' || r === '') continue;
      red = r;
    }
    if (Array.isArray(state?.frozenTests)) listed.push(...state.frozenTests);
  }
  if (red === null) return [];
  // The tip holds no state file, and an earlier version of it recorded a red commit.
  const removed =
    text === null
      ? [{ file: stateRel, line: 0, message: `state file ${stateRel} was removed after it recorded the red commit ${red.slice(0, 7)}; only the CLI writes it, and removing it does not lift the freeze` }]
      : [];
  if (!/^[0-9a-f]{7,40}$/.test(red) || !resolveCommit(root, red)) {
    return [...removed, { file: stateRel, line: 0, message: `red commit ${red} of ${slice} is not in this repository` }];
  }

  const bad = listed.filter((t) => !isEntry(t) || !validTest(entryFile(t)));
  if (bad.length > 0) return [...removed, { file: stateRel, line: 0, message: `frozen tests of ${slice} name a path that is not a repository path: ${bad.map((t) => (isEntry(t) ? entryLabel(t) : JSON.stringify(t))).join(', ')}` }];
  if (listed.length === 0) return removed;

  // The slice file at the red commit: its evaluation set reads a path entry, the form of a state file
  // written before P8/S-60, as every evaluation test of that file by name (D-102). A later change to
  // the slice file does not change what is frozen; with no slice file at red that parses, a path
  // entry is the whole file.
  const phasesRel = posixRel(root, paths.phases);
  const sliceFiles = sliceFilesAt(root, tip, phasesRel, addr);
  const redSliceFiles = sliceFilesAt(root, red, phasesRel, addr);
  let rows = [];
  if (redSliceFiles.length === 1) {
    try {
      rows = evaluationRows(parseSliceFile(showAt(root, red, redSliceFiles[0]) ?? '', redSliceFiles[0]));
    } catch (e) {
      if (!(e instanceof SliceFileError)) throw e;
    }
  }
  const entries = frozenEntries(listed, rows);

  // A test `build amend` unfroze after the red commit is not judged (REQ-3.15): the tip's state file
  // lists it in `unfrozen`, and the slice file was amended after red. An amendment of the slice file
  // alone unfreezes nothing (D-102). Only the slice branch's own commits count: --first-parent
  // --no-merges leaves out a change to the slice file made on the default branch and merged in.
  const amended = sliceFiles.length > 0
    && git(root, ['--literal-pathspecs', 'log', '--first-parent', '--no-merges', '--format=%H', `${red}..${tip}`, '--', ...sliceFiles]) !== '';
  const tipState = text === null ? null : parse(text);
  const unfrozen = amended && Array.isArray(tipState?.unfrozen) ? tipState.unfrozen.filter(isEntry) : [];
  const judged = entries.filter((e) => !isUnfrozen(e, unfrozen));
  if (judged.length === 0) return removed;

  const files = [...new Set(judged.map((e) => e.file))];
  const changed = new Set(lines(git(root, ['--literal-pathspecs', 'diff', '--name-only', '--no-renames', red, tip, '--', ...files])));
  const findings = [];
  for (const e of judged) {
    if (!changed.has(e.file)) continue;
    if (e.name === null) {
      findings.push({ file: e.file, line: 0, message: `frozen test changed after red: ${e.file}` });
      continue;
    }
    // A test frozen by name: its text at the tip against its text at red; another test of the file,
    // or any other line of it, is not compared. A file that cannot be read by name is a change.
    const before = bodyOf(showAt(root, red, e.file), e.name);
    const after = bodyOf(showAt(root, tip, e.file), e.name);
    if (after === null || after === undefined || before === undefined || after !== before) {
      findings.push({ file: e.file, line: 0, message: `frozen test changed after red: ${entryLabel(e)}` });
    }
  }
  return [...removed, ...findings];
}

// The text of the test named `name` in `text`: null when the file or the test is missing; undefined
// when the file cannot be read by name (unparseable, or the name given twice).
function bodyOf(text, name) {
  if (text === null) return null;
  try {
    return findTest(text, name)?.text ?? null;
  } catch (e) {
    if (e instanceof TestNameError) return undefined;
    throw e;
  }
}

export default { id, blocking, ratchet, run };
