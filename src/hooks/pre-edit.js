// pre-edit (REQ-3.3, D-10): the PreToolUse guard on Edit, Write, MultiEdit and NotebookEdit. Fails
// closed through io.js.
//
// Every path the tool names (`file_path`, `notebook_path`) is judged; any deny wins. Rules, first deny
// wins: (3) a kit-owned file — a path with a `.slicekit/journal/`, `.slicekit/state/`,
// `.slicekit/baselines/`, `.slicekit/.subagent-*`, `.slicekit/.retry-*` or `.slicekit/.agents-*` segment
// under any root, or a `slicekit/subagent-*` marker, `slicekit/retry-*` retry state or `slicekit/agents-*`
// started-agents record in a git directory (`.git` or `*.git`), or the `slicekit/interview.json` intake
// session or the `slicekit/brief.json` brief session in one (a linked worktree's included)
// — always; (4) a path that matches a pattern of the root's `agents.denyPaths` (REQ-3.13) — always;
// then, only while
// the file's own root has an active slice (a `slice/*` branch with a state file) in `tests-red` or
// `building`: (1) a change to a frozen test of that slice, unless `unfrozen` lists it: a test frozen by
// name (D-102) is denied when the call changes its text against the red commit, removes it or renames
// it, and another test or line of the same file may change; a file frozen whole (a path entry of a
// state file written before P8/S-60 whose evaluation set names no test in it) is denied for any
// change; (2) a file under the docs root that does not exist yet (only a create can name a missing
// file), except the runbook, anything in the slice's own phase directory, and a path the slice file's
// Expected changes names (D-102).
//
// The file's own root is the nearest directory above it holding `.slicekit/config.json`, else its git
// top level, else the session's root: a session in the main checkout editing a nested worktree is
// judged by the worktree's branch, state and config. Paths are canonicalised through the real path of
// their deepest existing ancestor, so 8.3 short names and links resolve; for rule (4) the path is also
// judged as named, with a leading link or junction that reaches the root or a directory in it read as
// that directory, and a relative name against the working directory as given; on win32 a `:` after the drive
// (an NTFS stream name) is refused outright.
//
// Limits: a Bash command that writes the same file is pre-bash's business.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_PATH, loadConfig } from '../config.js';
import { GitError, git } from '../git.js';
import { parseSliceAddr } from '../ids.js';
import { kitPaths } from '../paths.js';
import { findSliceFiles, parseSliceFile, phaseOfDir } from '../slicefile.js';
import { TestNameError, entryFile, evaluationRows, findTest, frozenEntries, isUnfrozen } from '../testnames.js';
import { allow, deny } from './io.js';
import { activeSlice, checkFrozenLists, denyPaths, existingAncestor, fromGitBash, leaves, matchesDeny, namesUnder, real, toPosix } from './paths.js';

const WIN = process.platform === 'win32';
const GUARDED_STATES = new Set(['tests-red', 'building']);
const PATH_KEYS = ['file_path', 'notebook_path'];

const key = (p) => (WIN ? p.toLowerCase() : p);
const same = (a, b) => key(a) === key(b);
const under = (p, dir) => same(p, dir) || key(p).startsWith(`${key(dir)}/`);

function relInside(root, abs) {
  const rel = path.relative(root, abs);
  if (rel === '' || leaves(rel)) return null;
  return toPosix(rel);
}

// -> the canonical absolute path. Accepts absolute Windows paths with either slash, Git Bash `/c/...`
// on win32, and relative paths (against cwd, else root). Throws on a win32 stream name.
function absolute(filePath, root, cwd) {
  return real(written(filePath, root, cwd)[0]);
}

// -> the absolute paths as named, their symlinks not followed (`data/link.txt` stays under data even
// when it points outside): a relative name against the canonical directory it is named from and
// against that directory as given, which differ when the working directory is itself a link.
function written(filePath, root, cwd) {
  const p = fromGitBash(String(filePath).replace(/\\/g, '/'));
  if (WIN && p.replace(/^[A-Za-z]:/, '').includes(':')) {
    throw new Error(`${filePath}: a stream name is not a file path`);
  }
  const base = typeof cwd === 'string' && cwd !== '' ? path.resolve(root, fromGitBash(cwd.replace(/\\/g, '/'))) : root;
  if (path.isAbsolute(p)) return [path.resolve(p)];
  const canonical = path.resolve(real(base), p);
  const given = path.resolve(base, p);
  return given === canonical ? [canonical] : [canonical, given];
}

// -> the POSIX path relative to root, or null when it is outside root.
export function normalise(filePath, root, cwd) {
  return relInside(real(path.resolve(root)), absolute(filePath, root, cwd));
}

// A kit-owned segment anywhere in the path, whatever root it belongs to; the kit's files in a git
// directory (`<.git>/slicekit/`: `agents-*`, `retry-*`, `clone-id`, and the old `subagent-*` name)
// count too, though they lie outside every work tree.
function kitOwned(abs) {
  const segs = toPosix(abs).split('/').map(key);
  return segs.some((s, i) => {
    if (s !== '.slicekit' || i + 1 >= segs.length) return false;
    const next = segs[i + 1];
    return next === 'journal' || next === 'state' || next === 'baselines' || next.startsWith('.subagent-')
      || next.startsWith('.retry-') || next.startsWith('.agents-');
  }) || segs.some((s, i) => i > 0 && (segs[i - 1] === '.git' || segs[i - 1].endsWith('.git'))
    && s === 'slicekit' && (segs[i + 1] === 'clone-id'
      || ['subagent-', 'retry-', 'agents-'].some((p) => segs[i + 1]?.startsWith(p))))
    // The intake interview and brief sessions, also in a linked worktree's own git directory
    // (`<.git>/worktrees/<name>/slicekit/interview.json`, `.../slicekit/brief.json`).
    || segs.some((s, i) => s === 'slicekit' && (segs[i + 1] === 'interview.json' || segs[i + 1] === 'brief.json')
      && segs.slice(0, i).some((p) => p === '.git' || p.endsWith('.git')));
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

  // (4), the path as named: a symlink under a listed directory that points out of the repository
  // resolves outside it, and its listed name must still count.
  // A name that reaches the root, or a directory in it, by a link is read from there too (issue #122).
  for (const lex of written(filePath, hookRoot, input.cwd)) {
    for (const [r, c] of [[hookCanon, hookCfg], [root, cfg]]) {
      if (!denyPaths(c).length) continue;
      for (const p of namesUnder(r, lex)) {
        const named = relInside(r, p);
        const hit = named === null ? null : matchesDeny(named, denyPaths(c));
        if (hit !== null) return deny(`${named} matches agents.denyPaths pattern ${hit}; agents may not read or change it (REQ-3.13)`);
      }
    }
  }
  if (rel === null) return allow();

  // (4)
  const pattern = matchesDeny(rel, denyPaths(cfg));
  if (pattern !== null) return deny(`${rel} matches agents.denyPaths pattern ${pattern}; agents may not read or change it (REQ-3.13)`);

  const active = activeSlice(root, cfg);
  if (active?.error) throw new Error(active.error);
  if (active) checkFrozenLists(active);
  if (!active || !GUARDED_STATES.has(active.state.state)) return allow();
  const { id, state } = active;
  const slice = sliceOf(root, cfg, id);

  // (1)
  if (cfg.freezeTests && changesFrozen(root, rel, abs, state, slice, input)) {
    return deny(`frozen for ${id}; amend the slice file to change the evaluation set`);
  }

  // (2)
  const k = kitPaths(root, cfg);
  const docs = toPosix(path.relative(root, k.docs));
  if (under(rel, docs) && !same(rel, docs) && !fs.existsSync(abs)
    && !same(rel, toPosix(path.relative(root, k.runbook)))
    && !inOwnPhase(rel, toPosix(path.relative(root, k.phases)), id)
    && !namedInExpected(rel, slice)) {
    return deny("no slice starts a document; a document changes only when this slice's code made it wrong");
  }
  return allow();
}

// The active slice's parsed slice file under root, or null when none parses with that id.
function sliceOf(root, cfg, id) {
  for (const f of findSliceFiles(root, cfg)) {
    try {
      const s = parseSliceFile(fs.readFileSync(f.path, 'utf8'), f.path);
      if (s.id === id) return s;
    } catch {
      // A slice file that does not parse names nothing.
    }
  }
  return null;
}

// The slice file's Expected changes name `rel` (D-102): a new document the slice was planned to write.
const namedInExpected = (rel, slice) =>
  (slice?.expectedChanges ?? []).some((p) => same(rel, toPosix(path.posix.normalize(p.replace(/\\/g, '/'))).replace(/^\.\//, '')));

// The file's text after the tool call: Write's content, or Edit's and MultiEdit's replacements applied
// to the text on disk. Null when the call cannot be applied, so it cannot be judged (fails closed).
function textAfter(abs, input) {
  const tool = input?.tool_name;
  const ti = input?.tool_input ?? {};
  if (tool === 'Write') return typeof ti.content === 'string' ? ti.content : null;
  const edits = tool === 'Edit' ? [ti] : tool === 'MultiEdit' && Array.isArray(ti.edits) ? ti.edits : null;
  if (!edits || !fs.existsSync(abs)) return null;
  let text = fs.readFileSync(abs, 'utf8');
  for (const e of edits) {
    if (typeof e?.old_string !== 'string' || typeof e?.new_string !== 'string' || e.old_string === '') return null;
    let from = e.old_string;
    if (!text.includes(from)) {
      // The tool matches across line endings; so does the guard.
      text = text.replace(/\r\n/g, '\n');
      from = from.replace(/\r\n/g, '\n');
      if (!text.includes(from)) return null;
    }
    const to = e.new_string.replace(/\r\n/g, text.includes('\r\n') ? '\r\n' : '\n');
    text = e.replace_all === true ? text.split(from).join(to) : text.replace(from, () => to);
  }
  return text;
}

// The text of the test named `name`: null when missing; undefined when the file cannot be read by name.
function bodyOf(text, name) {
  if (text === null) return null;
  try {
    return findTest(text, name)?.text ?? null;
  } catch (e) {
    if (e instanceof TestNameError) return undefined;
    throw e;
  }
}

// The slice file as it was at the red commit, read from git (D-102): a path entry of a state file
// written before P8/S-60 is read with that evaluation set, never the working tree's, which this guard
// does not protect. Null when there is no red commit, no such file at it, or it does not parse: each
// path entry is then the whole file, frozen for any change (fails closed).
function sliceAtRed(root, state, slice) {
  if (!slice?.path || typeof state.redCommit !== 'string' || state.redCommit === '') return null;
  const rel = relInside(root, real(slice.path));
  if (rel === null) return null;
  let text;
  try {
    text = git(root, ['show', `${state.redCommit}:./${rel}`]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
  try {
    return parseSliceFile(text, slice.path);
  } catch {
    return null;
  }
}

// Whether the call changes, removes or renames a test frozen in `rel` (REQ-3.3, D-102). A file frozen
// whole (a path entry the evaluation set names no test in) is denied for any change; a test frozen by
// name, only when its text after the call differs from its text at the red commit. Another test of
// the file, or any other line, may change.
function changesFrozen(root, rel, abs, state, slice, input) {
  const at = (f) => normalise(f, root) ?? '';
  const mine = state.frozenTests.filter((e) => same(rel, at(entryFile(e))));
  if (mine.length === 0) return false;
  const local = (e) => (typeof e === 'string' ? rel : { file: rel, name: e.name });
  const unfrozen = state.unfrozen.filter((e) => same(rel, at(entryFile(e)))).map(local);
  const rows = mine.some((e) => typeof e === 'string') ? evaluationRows(sliceAtRed(root, state, slice)) : [];
  const entries = frozenEntries(mine.map(local), rows, same).filter((e) => !isUnfrozen(e, unfrozen, same));
  if (entries.length === 0) return false;
  if (entries.some((e) => e.name === null)) return true;
  const after = textAfter(abs, input);
  if (after === null) return true;
  let atRed = null;
  try {
    atRed = git(root, ['show', `${state.redCommit}:./${rel}`]);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
  }
  if (typeof state.redCommit !== 'string' || atRed === null) return true;
  return entries.some((e) => {
    const before = bodyOf(atRed, e.name);
    const now = bodyOf(after, e.name);
    return before === undefined || before === null || now === undefined || now === null || before !== now;
  });
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
