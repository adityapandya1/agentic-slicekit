// pre-edit (REQ-3.3, D-10): the PreToolUse guard on Edit, Write, MultiEdit and NotebookEdit. Fails
// closed through io.js.
//
// Rules, first deny wins: (3) a kit-owned file — `.slicekit/journal.log`, anything under
// `.slicekit/baselines/` or `.slicekit/state/`, a `.slicekit/.subagent-*` marker — always; then, only
// while a slice is active (a `slice/*` branch with a state file): (1) a frozen test of that slice while
// it is `tests-red` or `building`, unless `unfrozen` lists it; (2) a new file under the docs root from
// Write or NotebookEdit while the slice is `tests-red` or `building`, except the runbook and anything
// in the slice's own phase directory.
//
// Limits: the guard sees the path the tool names. A Bash command that writes the same file is
// pre-bash's business, and a symlink inside the repository pointing at a guarded file is not followed.
import fs from 'node:fs';
import path from 'node:path';
import { GitError, currentBranch } from '../git.js';
import { parseSliceAddr, sliceFromBranch } from '../ids.js';
import { kitPaths } from '../paths.js';
import { phaseOfDir } from '../slicefile.js';
import { readSlice } from '../state/index.js';
import { allow, deny } from './io.js';
import { fromGitBash } from './pre-bash.js';

const WIN = process.platform === 'win32';
const GUARDED_STATES = new Set(['tests-red', 'building']);
const CREATES = new Set(['Write', 'NotebookEdit']);

const toPosix = (p) => p.split(path.sep).join('/');
const key = (p) => (WIN ? p.toLowerCase() : p);
const same = (a, b) => key(a) === key(b);
const under = (p, dir) => same(p, dir) || key(p).startsWith(`${key(dir)}/`);

const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};

function relInside(root, abs) {
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

// -> the POSIX path relative to root, or null when it is outside root. Accepts absolute Windows paths
// with either slash, Git Bash `/c/...` on win32, and relative paths (against cwd, else root).
export function normalise(filePath, root, cwd) {
  const p = fromGitBash(String(filePath).replace(/\\/g, '/'));
  const base = typeof cwd === 'string' && cwd !== '' ? path.resolve(root, fromGitBash(cwd.replace(/\\/g, '/'))) : root;
  const abs = path.resolve(base, p);
  const rel = relInside(root, abs);
  if (rel !== null) return rel;
  // The tool may name the real path of a root reached through a link or a short name (or vice versa).
  const realRoot = real(root);
  return relInside(realRoot, real(abs)) ?? relInside(realRoot, abs);
}

// The active slice's id and state, or null when there is none.
function activeSlice(root, cfg) {
  let branch;
  try {
    branch = currentBranch(root);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
  const id = branch ? sliceFromBranch(branch) : null;
  if (!id) return null;
  try {
    return { id, state: readSlice(root, cfg, id) };
  } catch (e) {
    if (/^unknown slice /.test(e?.message ?? '')) return null;
    throw e;
  }
}

function kitOwned(rel, root, cfg) {
  const k = kitPaths(root, cfg);
  const r = (abs) => toPosix(path.relative(root, abs));
  if (same(rel, r(k.journal)) || under(rel, r(k.state)) || under(rel, r(k.baselines))) return true;
  const kit = r(k.kit);
  return same(path.posix.dirname(rel), kit) && key(path.posix.basename(rel)).startsWith('.subagent-');
}

// Whether rel lies in the slice's own phase directory, `<docs>/phases/P<n>[-name]/`.
function inOwnPhase(rel, phasesRel, sliceId) {
  if (!under(rel, phasesRel) || same(rel, phasesRel)) return false;
  const dir = rel.slice(phasesRel.length + 1).split('/')[0];
  const phase = phaseOfDir(dir);
  return phase !== null && phase.n === parseSliceAddr(sliceId).phase && rel.includes('/', phasesRel.length + 1);
}

export function handle(input, { root, cfg }) {
  const filePath = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  if (typeof filePath !== 'string' || filePath === '') throw new Error('tool_input.file_path is missing');
  const rel = normalise(filePath, root, input.cwd);
  if (rel === null) return allow();

  // (3)
  if (kitOwned(rel, root, cfg)) return deny(`${rel} is written only by the slicekit CLI`);

  const active = activeSlice(root, cfg);
  if (!active || !GUARDED_STATES.has(active.state.state)) return allow();
  const { id, state } = active;

  // (1)
  if (cfg.freezeTests) {
    const listed = (list) => (Array.isArray(list) ? list : []).some((f) => typeof f === 'string' && same(rel, normalise(f, root) ?? ''));
    if (listed(state.frozenTests) && !listed(state.unfrozen)) {
      return deny(`frozen for ${id}; amend the slice file to change the evaluation set`);
    }
  }

  // (2)
  if (CREATES.has(input.tool_name)) {
    const k = kitPaths(root, cfg);
    const docs = toPosix(path.relative(root, k.docs));
    const abs = path.join(root, ...rel.split('/'));
    if (under(rel, docs) && !same(rel, docs) && !fs.existsSync(abs)
      && !same(rel, toPosix(path.relative(root, k.runbook)))
      && !inOwnPhase(rel, toPosix(path.relative(root, k.phases)), id)) {
      return deny("no slice starts a document; a document changes only when this slice's code made it wrong");
    }
  }
  return allow();
}
