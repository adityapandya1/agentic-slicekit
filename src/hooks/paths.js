// Path and slice helpers the hooks share: pre-bash, pre-edit and session-start read paths and the
// active slice the same way.
import fs from 'node:fs';
import path from 'node:path';
import { GitError, currentBranch } from '../git.js';
import { sliceFromBranch } from '../ids.js';
import { readSlice } from '../state/index.js';

export const toPosix = (p) => p.split(path.sep).join('/');

// The lines of a transcript's last `bytes` bytes, oldest first, without the cut first line when the
// read starts mid-file; null when file is not a regular file or cannot be read.
export function transcriptTail(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;
    const start = Math.max(0, st.size - bytes);
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Git Bash's `/c/...` spelling of a Windows path as `C:/...`; unchanged off win32.
export function fromGitBash(p) {
  if (process.platform !== 'win32') return p;
  const m = /^\/([A-Za-z])(\/.*)?$/.exec(p);
  return m ? `${m[1].toUpperCase()}:/${(m[2] ?? '').slice(1)}` : p;
}

// The deepest existing ancestor of abs (abs itself when it exists).
export function existingAncestor(abs) {
  let dir = abs;
  while (!fs.existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

// p with its deepest existing ancestor replaced by that ancestor's real path and the missing segments
// re-appended, so 8.3 short names and links resolve.
export function real(p) {
  const existing = existingAncestor(p);
  let resolved = existing;
  try {
    resolved = fs.realpathSync.native(existing);
  } catch {
    // keep the path as given
  }
  const rest = path.relative(existing, p);
  return rest === '' ? resolved : path.join(resolved, rest);
}

// Whether a path relative to a directory leaves it: `..` counts only as a whole component, so the
// file `..secret` is inside (issue #123).
export const leaves = (rel) => rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || path.isAbsolute(rel);

// The paths inside `root` (a canonical path) that abs names, as written: abs itself when it lies under
// root, and, for each leading directory of abs that resolves inside root, where that directory resolves
// with the rest of abs kept as written. A link or junction to the root, or to a directory in it, from
// outside the repository or from inside it, names the same files as the root does (issue #122). Empty
// when no part of abs leads into root.
export function namesUnder(root, abs) {
  const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const inside = (p) => key(p) === key(root) || key(p).startsWith(key(root) + path.sep);
  const full = path.resolve(abs);
  const out = inside(full) ? [full] : [];
  const top = path.parse(full).root;
  const segs = full.slice(top.length).split(path.sep).filter((x) => x !== '');
  let prefix = top;
  for (let k = 0; k < segs.length; k++) {
    prefix = path.join(prefix, segs[k]);
    let resolved;
    try {
      resolved = fs.realpathSync.native(prefix);
    } catch {
      break;
    }
    const mapped = path.join(resolved, ...segs.slice(k + 1));
    if (inside(resolved) && !out.some((p) => key(p) === key(mapped))) out.push(mapped);
  }
  return out;
}

// The slice the branch at root names: {id, state}, or {id, error} when its state file cannot be read,
// or null when the branch is not a slice branch, has no state file, or root is not a repository.
export function activeSlice(root, cfg) {
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
    return { id, error: e?.message ?? String(e) };
  }
}

// The slice states in which its frozen tests are guarded (REQ-3.3).
export const GUARDED_STATES = new Set(['tests-red', 'building']);

const stringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

// The tests frozen for root's active slice: {id, files: [POSIX path relative to root's real path]},
// with `unfrozen` ones left out; null when tests are not frozen, no slice is active, or the slice is
// not in a guarded state. Throws when the state file cannot be read or its lists are malformed, so a
// guard calling it fails closed.
export function frozenTests(root, cfg) {
  if (!cfg.freezeTests) return null;
  const active = activeSlice(root, cfg);
  if (!active) return null;
  if (active.error) throw new Error(active.error);
  for (const field of ['frozenTests', 'unfrozen']) {
    if (!stringList(active.state[field])) throw new Error(`${active.id} state: ${field} must be an array of strings`);
  }
  if (!GUARDED_STATES.has(active.state.state)) return null;
  const canon = real(path.resolve(root));
  const rel = (f) => toPosix(path.relative(canon, real(path.resolve(canon, fromGitBash(f.replace(/\\/g, '/'))))));
  const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const unfrozen = new Set(active.state.unfrozen.map((f) => key(rel(f))));
  const files = active.state.frozenTests.map(rel).filter((f) => !unfrozen.has(key(f)));
  return { id: active.id, files };
}

// ---- agents.denyPaths (REQ-3.13, D-72) ----

// The bracket expression that opens at p[i], as the source of a regular-expression class:
// {src, end}, `end` the index of its closing `]`; null when no `]` closes it, so the `[` is a literal
// character. A leading `!` or `^` negates; a `]` that comes first is a member, as are `[` and `^`
// elsewhere; `[:alpha:]` and the other POSIX class names are read. A reversed range (`[z-a]`) is kept
// as written, so the expression that holds it does not compile and the caller knows.
const POSIX_CLASS = {
  alpha: 'a-zA-Z',
  digit: '0-9',
  alnum: 'a-zA-Z0-9',
  upper: 'A-Z',
  lower: 'a-z',
  space: '\\s',
  blank: ' \\t',
  punct: '!-\\/:-@\\[-`{-~',
  xdigit: '0-9A-Fa-f',
  word: '\\w',
  cntrl: '\\x00-\\x1f\\x7f',
  print: '\\x20-\\x7e',
  graph: '\\x21-\\x7e',
};
export function bracketClass(p, i) {
  let j = i + 1;
  const negated = p[j] === '!' || p[j] === '^';
  if (negated) j += 1;
  let body = '';
  for (let first = true; ; first = false) {
    if (j >= p.length) return null;
    const c = p[j];
    if (c === ']' && !first) break;
    const named = c === '[' && p[j + 1] === ':' ? /^\[:([a-z]+):\]/.exec(p.slice(j)) : null;
    if (named && POSIX_CLASS[named[1]] !== undefined) {
      body += POSIX_CLASS[named[1]];
      j += named[0].length;
    } else {
      body += c === '\\' || c === ']' || c === '[' || c === '^' ? `\\${c}` : c;
      j += 1;
    }
  }
  return { src: `[${negated ? '^' : ''}${body}]`, end: j };
}

// One gitignore-style pattern over repository-relative POSIX paths as an anchored regular expression:
// `**` crosses segments, `*` and `?` stay in one, `[...]` is a class; a leading `/` or `./` anchors at
// the root, which a pattern with no inner `/` is not (it matches at any depth); a trailing `/` names a
// directory. Case-insensitive on win32.
function denyRe(pattern) {
  let p = pattern.replace(/\\/g, '/');
  p = p.replace(/^\.\//, '');
  let anchored = p.startsWith('/');
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (p.includes('/')) anchored = true;
  let src = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      const atStart = i === 0 || p[i - 1] === '/';
      const atEnd = i + 2 === p.length || p[i + 2] === '/';
      if (atStart && p[i + 2] === '/') {
        src += '(?:.*/)?';
        i += 2;
      } else if (atStart && atEnd) {
        src += '.*';
        i += 1;
      } else {
        src += '[^/]*';
        i += 1;
      }
    } else if (c === '*') src += '[^/]*';
    else if (c === '?') src += '[^/]';
    else if (c === '[' && bracketClass(p, i) !== null) {
      const cls = bracketClass(p, i);
      src += cls.src;
      i = cls.end;
    } else src += c.replace(/[.+^${}()|\\[\]]/g, '\\$&');
  }
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${src}$`, process.platform === 'win32' ? 'i' : '');
}

// -> why the guards cannot compile `pattern`, or null when they can. validateConfig refuses a pattern
// with a reason (issue #120), so a guard does not meet one when it matches.
export function denyPatternError(pattern) {
  try {
    denyRe(pattern);
    return null;
  } catch (e) {
    const why = String(e?.message ?? e).split(': ').pop();
    return `${pattern} does not compile as a glob (${why.charAt(0).toLowerCase()}${why.slice(1)})`;
  }
}

// -> the first pattern of `patterns` that matches the repository-relative POSIX path `rel` or one of
// its parent directories, or null. Shared by pre-edit and pre-bash.
export function matchesDeny(rel, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0 || typeof rel !== 'string' || rel === '') return null;
  const segs = rel.replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter((s) => s !== '' && s !== '.');
  if (segs.length === 0) return null;
  const prefixes = segs.map((_, k) => segs.slice(0, k + 1).join('/'));
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern === '') continue;
    const re = denyRe(pattern);
    if (prefixes.some((pre) => re.test(pre))) return pattern;
  }
  return null;
}

// -> the first pattern anchored at the root whose literal leading directories, up to its first glob
// segment, are exactly the repository-relative directory `rel` (`data` for `data/**` or
// `data/*.xml`), or null. A command naming that directory reads what the pattern covers.
export function denyDir(rel, patterns) {
  if (!Array.isArray(patterns) || typeof rel !== 'string' || rel === '') return null;
  const key = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const want = key(rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''));
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern === '') continue;
    const p = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!p.includes('/')) continue;
    const segs = p.split('/');
    const first = segs.findIndex((s) => /[*?[]/.test(s));
    if (first <= 0) continue;
    if (key(segs.slice(0, first).join('/')) === want) return pattern;
  }
  return null;
}

// The config's deny list, the empty list when absent.
export const denyPaths = (cfg) => (Array.isArray(cfg?.agents?.denyPaths) ? cfg.agents.denyPaths : []);
