// frozen (03 REQ-3.15, D-10): on a slice branch, a test of the slice's evaluation set stays as it was at
// the red commit recorded in the slice's state file, unless the slice file was changed in a commit
// after the red commit (as `build amend` does). The state file, the red commit, the slice file and
// the tests are all read from git objects of the tip judged, never the working tree: a file hidden
// with `assume-unchanged` or `skip-worktree` is judged by its committed content (issue #71).
//
// The tip is HEAD, or under --ci on a pull request the pull request's head (branchTip). No branch, a
// branch that is not a slice branch, no state file at the tip, or no red commit in it (a slice before
// tests-red): nothing to judge.
import path from 'node:path';
import { GitError, git, resolveCommit } from '../../git.js';
import { branchTip } from '../ci-event.js';
import { parseSliceAddr, sliceFromBranch, stateFileName } from '../../ids.js';
import { kitPaths } from '../../paths.js';
import { phaseOfDir } from '../../slicefile.js';

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

export function run(ctx) {
  const { root, cfg } = ctx;
  const at = branchTip(ctx);
  if (!at) return [];
  const { tip } = at;
  const slice = sliceFromBranch(at.branch);
  if (!slice) return [];
  const addr = parseSliceAddr(slice);

  const paths = kitPaths(root, cfg);
  const stateRel = `${posixRel(root, paths.state)}/${stateFileName(slice)}`;
  const text = showAt(root, tip, stateRel);
  if (text === null) return [];
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    return [{ file: stateRel, line: 0, message: `state file ${stateRel} is not valid JSON at ${tip}` }];
  }
  const red = state?.redCommit;
  if (typeof red !== 'string' || red === '') return [];
  if (!/^[0-9a-f]{7,40}$/.test(red) || !resolveCommit(root, red)) {
    return [{ file: stateRel, line: 0, message: `red commit ${red} of ${slice} is not in this repository` }];
  }

  const tests = Array.isArray(state.frozenTests) ? state.frozenTests : [];
  const bad = tests.filter((t) => !validTest(t));
  if (bad.length > 0) return [{ file: stateRel, line: 0, message: `frozen tests of ${slice} name a path that is not a repository path: ${bad.map(String).join(', ')}` }];
  if (tests.length === 0) return [];

  // An amendment of the slice file after the red commit lifts the freeze (REQ-3.3).
  const sliceFiles = sliceFilesAt(root, tip, posixRel(root, paths.phases), addr);
  if (sliceFiles.length > 0) {
    const amended = git(root, ['--literal-pathspecs', 'log', '--format=%H', `${red}..${tip}`, '--', ...sliceFiles]);
    if (amended !== '') return [];
  }

  const changed = new Set(lines(git(root, ['--literal-pathspecs', 'diff', '--name-only', '--no-renames', red, tip, '--', ...tests])));
  return tests.filter((t) => changed.has(t)).map((t) => ({ file: t, line: 0, message: `frozen test changed after red: ${t}` }));
}

export default { id, blocking, ratchet, run };
