// lane (03 REQ-3.7, REQ-1.5, D-103): a slice marked `lane: quick` changes no file under `src/`, `bin/`
// or `templates/`. Two findings, each naming the slice and the path:
//
// - a quick slice file whose `## Expected changes` names a path in one of those folders, at that
//   path's line of the slice file;
// - on the quick slice's own branch, a file in one of those folders that the branch changes against
//   the default branch. The changes are read from git objects (the merge base with the default branch
//   against the tip judged, as the frozen rule reads them), never the working tree, so a change merged
//   in from the default branch is not the slice's.
//
// A slice with no lane is never a finding. A slice file that does not parse is the citations rule's
// to report.
import path from 'node:path';
import { GitError, git } from '../../git.js';
import { readText } from '../../fs.js';
import { sliceFromBranch } from '../../ids.js';
import { lines } from '../../markdown.js';
import { mergeBase } from '../../runbook.js';
import { findSliceFiles, parseSliceFile } from '../../slicefile.js';
import { branchTip } from '../ci-event.js';

export const id = 'lane';
export const blocking = true;
export const ratchet = false;

export const CODE_FOLDERS = ['src', 'bin', 'templates'];

const posixRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

// True when `p`, a repository path, is one of the code folders or lies under one.
export function reachesCode(p) {
  const clean = String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const first = clean.split('/')[0];
  return CODE_FOLDERS.includes(first);
}

// Every quick slice file in the working tree: [{ rel, parsed, text }].
function quickSlices(root, cfg) {
  const out = [];
  for (const f of findSliceFiles(root, cfg)) {
    let text;
    let parsed;
    try {
      text = readText(f.path);
      parsed = parseSliceFile(text, f.path);
    } catch {
      continue;
    }
    if (parsed.lane === 'quick') out.push({ rel: posixRel(root, f.path), parsed, text });
  }
  return out;
}

// The paths the branch at `tip` changes against the default branch, or null when the merge base
// cannot be read.
function branchChanges(root, cfg, tip) {
  let base;
  try {
    base = mergeBase(root, cfg, tip);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
  const out = git(root, ['--literal-pathspecs', 'diff', '--name-only', '--no-renames', base, tip]);
  return out.split('\n').filter((l) => l !== '');
}

export function run(ctx) {
  const { root, cfg } = ctx;
  const quick = quickSlices(root, cfg);
  if (quick.length === 0) return [];
  const findings = [];
  for (const s of quick) {
    s.parsed.expectedChanges.forEach((p, i) => {
      if (!reachesCode(p)) return;
      findings.push({
        file: s.rel,
        line: s.parsed.expectedChangeLines[i] ?? 0,
        message: `${s.parsed.id} is marked lane: quick but its expected changes name ${p}, under ${CODE_FOLDERS.map((d) => `${d}/`).join(', ')} (D-103)`,
      });
    });
  }

  const at = branchTip(ctx);
  const slice = at ? sliceFromBranch(at.branch) : null;
  const mine = slice ? quick.find((s) => s.parsed.id === slice) : undefined;
  if (!mine) return findings;
  const laneLine = lines(mine.text).findIndex((l) => /^lane\s*:/.test(l)) + 1;
  const changed = branchChanges(root, cfg, at.tip);
  if (changed === null) {
    findings.push({ file: mine.rel, line: laneLine, message: `${slice} is marked lane: quick and the branch's changes against ${cfg.defaultBranch} cannot be read; fetch ${cfg.defaultBranch}` });
    return findings;
  }
  for (const p of changed.filter(reachesCode)) {
    findings.push({ file: mine.rel, line: laneLine, message: `${slice} is marked lane: quick but its branch changes ${p}, under ${CODE_FOLDERS.map((d) => `${d}/`).join(', ')} (D-103)` });
  }
  return findings;
}

export default { id, blocking, ratchet, run };
