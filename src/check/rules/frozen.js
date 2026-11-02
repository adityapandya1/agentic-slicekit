// frozen (03 REQ-3.15, D-10): on a slice branch, a test of the slice's evaluation set stays as it was at
// the red commit recorded in the slice's state file, unless the slice file was changed in a commit
// after the red commit (as `build amend` does). The state file, the red commit, the slice file and
// the tests are all read from git objects of the tip judged, never the working tree: a file hidden
// with `assume-unchanged` or `skip-worktree` is judged by its committed content (issue #71).
//
// The tip is HEAD, or under --ci on a pull request the pull request's head (branchTip). No branch, a
// branch that is not a slice branch, no state file at the tip, no red commit recorded in any version
// of it (a slice before tests-red), or freezeTests set to false in the config (D-10): nothing to judge.
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
  if (text === null) return [];
  if (parse(text) === undefined) {
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
  if (!/^[0-9a-f]{7,40}$/.test(red) || !resolveCommit(root, red)) {
    return [{ file: stateRel, line: 0, message: `red commit ${red} of ${slice} is not in this repository` }];
  }

  const tests = [...new Set(listed)];
  const bad = tests.filter((t) => !validTest(t));
  if (bad.length > 0) return [{ file: stateRel, line: 0, message: `frozen tests of ${slice} name a path that is not a repository path: ${bad.map(String).join(', ')}` }];
  if (tests.length === 0) return [];

  // An amendment of the slice file after the red commit lifts the freeze (REQ-3.3). Only the slice
  // branch's own commits count: --first-parent --no-merges leaves out a change to the slice file made on
  // the default branch and merged into the slice branch.
  const sliceFiles = sliceFilesAt(root, tip, posixRel(root, paths.phases), addr);
  if (sliceFiles.length > 0) {
    const amended = git(root, ['--literal-pathspecs', 'log', '--first-parent', '--no-merges', '--format=%H', `${red}..${tip}`, '--', ...sliceFiles]);
    if (amended !== '') return [];
  }

  const changed = new Set(lines(git(root, ['--literal-pathspecs', 'diff', '--name-only', '--no-renames', red, tip, '--', ...tests])));
  return tests.filter((t) => changed.has(t)).map((t) => ({ file: t, line: 0, message: `frozen test changed after red: ${t}` }));
}

export default { id, blocking, ratchet, run };
