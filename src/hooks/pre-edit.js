// pre-edit (REQ-3.3, D-10): the PreToolUse guard on Edit, Write, MultiEdit and NotebookEdit. Fails
// closed through io.js.
//
// Every path the tool names (`file_path`, `notebook_path`) is judged; any deny wins. Rules, first deny
// wins: (3) a kit-owned file — a path with a `.slicekit/journal.log`, `.slicekit/state/`,
// `.slicekit/baselines/` or `.slicekit/.subagent-*` segment, under any root — always; then, only while
// the file's own root has an active slice (a `slice/*` branch with a state file) in `tests-red` or
// `building`: (1) a frozen test of that slice, unless `unfrozen` lists it; (2) a file under the docs root
// that does not exist yet (only a create can name a missing file), except the runbook and anything in
// the slice's own phase directory.
//
// The file's own root is the nearest directory above it holding `.slicekit/config.json`, else its git
// top level, else the session's root: a session in the main checkout editing a nested worktree is
// judged by the worktree's branch, state and config. Paths are canonicalised through the real path of
// their deepest existing ancestor, so 8.3 short names and links resolve; on win32 a `:` after the drive
// (an NTFS stream name) is refused outright.
//
// Limits: a Bash command that writes the same file is pre-bash's business.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_PATH, loadConfig } from '../config.js';
import { GitError, git } from '../git.js';
import { parseSliceAddr } from '../ids.js';
import { kitPaths } from '../paths.js';
import { phaseOfDir } from '../slicefile.js';
import { allow, deny } from './io.js';
import { activeSlice, existingAncestor, fromGitBash, real, toPosix } from './paths.js';

const WIN = process.platform === 'win32';
const GUARDED_STATES = new Set(['tests-red', 'building']);
const PATH_KEYS = ['file_path', 'notebook_path'];

const key = (p) => (WIN ? p.toLowerCase() : p);
const same = (a, b) => key(a) === key(b);
const under = (p, dir) => same(p, dir) || key(p).startsWith(`${key(dir)}/`);

function relInside(root, abs) {
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

// -> the canonical absolute path. Accepts absolute Windows paths with either slash, Git Bash `/c/...`
// on win32, and relative paths (against cwd, else root). Throws on a win32 stream name.
function absolute(filePath, root, cwd) {
  const p = fromGitBash(String(filePath).replace(/\\/g, '/'));
  if (WIN && p.replace(/^[A-Za-z]:/, '').includes(':')) {
    throw new Error(`${filePath}: a stream name is not a file path`);
  }
  const base = typeof cwd === 'string' && cwd !== '' ? path.resolve(root, fromGitBash(cwd.replace(/\\/g, '/'))) : root;
  return real(path.resolve(base, p));
}

// -> the POSIX path relative to root, or null when it is outside root.
export function normalise(filePath, root, cwd) {
  return relInside(real(path.resolve(root)), absolute(filePath, root, cwd));
}

// A kit-owned segment anywhere in the path, whatever root it belongs to.
function kitOwned(abs) {
  const segs = toPosix(abs).split('/').map(key);
  return segs.some((s, i) => {
    if (s !== '.slicekit' || i + 1 >= segs.length) return false;
    const next = segs[i + 1];
    return next === 'journal.log' || next === 'state' || next === 'baselines' || next.startsWith('.subagent-');
  });
}

// The file's own root: the deeper of the nearest `.slicekit/config.json` above it and its git top
// level (a config in the main checkout never stands in for a nested worktree); null for neither.
function ownRoot(abs) {
  let start = existingAncestor(abs);
  if (!fs.statSync(start).isDirectory()) start = path.dirname(start);
  let configured = null;
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, CONFIG_PATH))) {
      configured = real(dir);
      break;
    }
    if (path.dirname(dir) === dir) break;
  }
  let top = null;
  try {
    top = real(path.resolve(git(start, ['rev-parse', '--show-toplevel'])));
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
  }
  if (configured && (!top || under(toPosix(configured), toPosix(top)))) return { root: configured, config: true };
  return top ? { root: top, config: false } : null;
}

const stringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

// Whether rel lies inside the slice's own phase directory, `<docs>/phases/P<n>[-name]/`.
function inOwnPhase(rel, phasesRel, sliceId) {
  if (!under(rel, phasesRel) || same(rel, phasesRel)) return false;
  const [dir, ...inside] = rel.slice(phasesRel.length + 1).split('/');
  const phase = phaseOfDir(dir);
  return inside.length > 0 && phase !== null && phase.n === parseSliceAddr(sliceId).phase;
}

function judge(filePath, input, hookRoot, hookCfg) {
  const abs = absolute(filePath, hookRoot, input.cwd);
  const hookCanon = real(path.resolve(hookRoot));
  const own = ownRoot(abs);
  let root = hookCanon;
  let cfg = hookCfg;
  if (own && !same(toPosix(own.root), toPosix(hookCanon))) {
    root = own.root;
    if (own.config) cfg = loadConfig(root);
  }
  const rel = relInside(root, abs);

  // (3)
  if (kitOwned(abs)) return deny(`${rel ?? toPosix(abs)} is written only by the slicekit CLI`);
  if (rel === null) return allow();

  const active = activeSlice(root, cfg);
  if (active?.error) throw new Error(active.error);
  if (active) {
    for (const field of ['frozenTests', 'unfrozen']) {
      if (!stringList(active.state[field])) throw new Error(`${active.id} state: ${field} must be an array of strings`);
    }
  }
  if (!active || !GUARDED_STATES.has(active.state.state)) return allow();
  const { id, state } = active;

  // (1)
  if (cfg.freezeTests) {
    const listed = (list) => list.some((f) => same(rel, normalise(f, root) ?? ''));
    if (listed(state.frozenTests) && !listed(state.unfrozen)) {
      return deny(`frozen for ${id}; amend the slice file to change the evaluation set`);
    }
  }

  // (2)
  const k = kitPaths(root, cfg);
  const docs = toPosix(path.relative(root, k.docs));
  if (under(rel, docs) && !same(rel, docs) && !fs.existsSync(abs)
    && !same(rel, toPosix(path.relative(root, k.runbook)))
    && !inOwnPhase(rel, toPosix(path.relative(root, k.phases)), id)) {
    return deny("no slice starts a document; a document changes only when this slice's code made it wrong");
  }
  return allow();
}

export function handle(input, { root, cfg }) {
  const given = PATH_KEYS.filter((k) => input?.tool_input?.[k] !== undefined);
  if (!given.length) throw new Error('tool_input.file_path is missing');
  for (const k of given) {
    const p = input.tool_input[k];
    if (typeof p !== 'string' || p === '') throw new Error(`tool_input.${k} is not a path`);
    const r = judge(p, input, root, cfg);
    if (r.hookSpecificOutput?.permissionDecision === 'deny') return r;
  }
  return allow();
}
