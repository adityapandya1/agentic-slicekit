// Path and slice helpers the hooks share: pre-bash, pre-edit and session-start read paths and the
// active slice the same way.
import fs from 'node:fs';
import path from 'node:path';
import { GitError, currentBranch } from '../git.js';
import { sliceFromBranch } from '../ids.js';
import { readSlice } from '../state/index.js';
import { entryFile, isEntry } from '../testnames.js';

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

// A state file's `frozenTests` and `unfrozen`: each entry a path (a whole file, the form written before
// P8/S-60) or { file, name } (a test frozen by its name, D-102). Throws on any other shape, so a guard
// reading them fails closed.
export function checkFrozenLists(active) {
  for (const field of ['frozenTests', 'unfrozen']) {
    const v = active.state[field];
    if (!Array.isArray(v) || !v.every(isEntry)) throw new Error(`${active.id} state: ${field} must be an array of strings (paths) or { file, name } entries`);
  }
}

// The files that hold a test frozen for root's active slice: {id, files: [POSIX path relative to root's
// real path]}. A file is left out once `unfrozen` lists it whole, or lists every test frozen in it by
// name; a path entry is the whole file. Null when tests are not frozen, no slice is active, or the slice
// is not in a guarded state. Throws when the state file cannot be read or its lists are malformed, so
// a guard calling it fails closed.
export function frozenTests(root, cfg) {
  if (!cfg.freezeTests) return null;
  const active = activeSlice(root, cfg);
  if (!active) return null;
  if (active.error) throw new Error(active.error);
  checkFrozenLists(active);
  if (!GUARDED_STATES.has(active.state.state)) return null;
  const canon = real(path.resolve(root));
  const rel = (f) => toPosix(path.relative(canon, real(path.resolve(canon, fromGitBash(f.replace(/\\/g, '/'))))));
  const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const norm = (e) => (typeof e === 'string' ? { file: key(rel(e)), name: null } : { file: key(rel(e.file)), name: e.name });
  const unfrozen = active.state.unfrozen.map(norm);
  const lifted = (e) => unfrozen.some((u) => u.file === e.file && (u.name === null || (e.name !== null && u.name === e.name)));
  const files = [];
  for (const e of active.state.frozenTests) {
    if (lifted(norm(e))) continue;
    const f = rel(entryFile(e));
    if (!files.some((g) => key(g) === key(f))) files.push(f);
  }
  return { id: active.id, files };
}

// ---- agents.denyPaths (REQ-3.13, D-72) ----

// The members within ASCII of each class name Bash knows, as [first, last] character codes.
const ALPHA = [[65, 90], [97, 122]];
const DIGIT = [[48, 57]];
const POSIX_CLASS = {
  alpha: ALPHA,
  digit: DIGIT,
  alnum: [...ALPHA, ...DIGIT],
  upper: [[65, 90]],
  lower: [[97, 122]],
  space: [[9, 13], [32, 32]],
  blank: [[9, 9], [32, 32]],
  punct: [[33, 47], [58, 64], [91, 96], [123, 126]],
  xdigit: [...DIGIT, [65, 70], [97, 102]],
  word: [...ALPHA, ...DIGIT, [95, 95]],
  cntrl: [[0, 31], [127, 127]],
  print: [[32, 126]],
  graph: [[33, 126]],
  ascii: [[0, 127]],
};
// The classes that hold no character outside ASCII in any locale.
const ASCII_ONLY = new Set(['digit', 'xdigit', 'ascii']);

// How a quoted backslash is written as a member of a bracket expression in a pattern string: the
// collating symbol of this private-use character. A backslash itself is a path separator to the code
// that carries the string, so it cannot stand there.
export const BACKSLASH_MEMBER = String.fromCharCode(0xe000);

// The bracket expression that opens at p[i], read as Bash 5 reads one in a file name pattern.
// -> null when no `]` closes it before the path segment ends, so the `[` is a literal character (a
//    bracket expression does not reach across a `/`);
// -> {end, unsure: true} when it holds a form this does not read to its end as Bash does; a caller
//    then takes the word to be one it cannot judge, never one that matches nothing;
// -> {end, negated, ranges, wide, reversed}: `end` is the index of the closing `]`, `ranges` the
//    members as [first, last] character codes, `wide` whether a member may also be any character
//    outside ASCII, `reversed` whether a range was left out for running backwards.
// `quoted(j)` says that the shell took p[j] quoted or escaped: such a character is a member and
// nothing else, so it does not negate, close, open a class or make a range. Without `quoted`, p is a
// pattern string and a backslash makes the next character a member.
// What is read: a leading `!` or `^` negates; a `]` that comes first is a member; `[`, `!` and `^`
// elsewhere are members; `a-c` is a range by character code, as Bash orders one with its default
// `globasciiranges`, a `-` that comes first or last is a member, and a range that runs backwards is
// left out while the other members stay (`[z-ab]` is `b`); `[:alpha:]` and the other class names are
// read, and may hold any character outside ASCII where a locale adds letters; a collating symbol of
// one character (`[.d.]`) is that character, as a member or as an end of a range; an equivalence
// class of one character (`[=d=]`) is that character and any character outside ASCII.
// What is not read, and so is `unsure`: a class name Bash does not know; a collating symbol or an
// equivalence class named by more than one character, or one nothing closes; an equivalence class in
// a negated expression; a class or an equivalence class as the end of a range; a quoted character
// inside a class, symbol or equivalence name; a character outside the Basic Multilingual Plane.
export function readBracket(p, i, quoted = null) {
  const q = (j) => quoted !== null && quoted(j);
  const is = (j, c) => p[j] === c && !q(j);
  let stop = p.indexOf('/', i);
  if (stop === -1) stop = p.length;
  const unsure = { end: stop - 1, unsure: true };
  // A surrogate is half of a character this does not compare, and the private-use character stands
  // for a backslash only inside a collating symbol.
  const odd = (code) => (code >= 0xd800 && code <= 0xdfff) || code === 0xe000 || Number.isNaN(code);
  // Whether any character from j up to k (k not included) was quoted.
  const anyQuoted = (j, k) => {
    for (let n = j; n < k; n++) if (q(n)) return true;
    return false;
  };
  // One character at j, written plainly, escaped or as a collating symbol -> {code, next}, or null.
  const single = (j) => {
    if (is(j, '[') && is(j + 1, '.')) {
      const close = p.indexOf('.]', j + 3);
      if (close === -1 || close + 1 >= stop || anyQuoted(j + 2, close + 2)) return null;
      const name = p.slice(j + 2, close);
      if (name.length !== 1) return null;
      if (name === BACKSLASH_MEMBER) return { code: 92, next: close + 2 };
      return odd(name.charCodeAt(0)) ? null : { code: name.charCodeAt(0), next: close + 2 };
    }
    const at = quoted === null && p[j] === '\\' && j + 1 < stop ? j + 1 : j;
    return odd(p.charCodeAt(at)) ? null : { code: p.charCodeAt(at), next: at + 1 };
  };
  let j = i + 1;
  const negated = is(j, '!') || is(j, '^');
  if (negated) j += 1;
  const ranges = [];
  let wide = false;
  let reversed = false;
  for (let first = true; ; first = false) {
    if (j >= stop) return null;
    if (is(j, ']') && !first) break;
    if (is(j, '[') && is(j + 1, ':')) {
      const close = p.indexOf(':]', j + 2);
      if (close !== -1 && close + 1 < stop) {
        if (anyQuoted(j + 2, close + 2)) return unsure;
        const name = p.slice(j + 2, close);
        if (!Object.hasOwn(POSIX_CLASS, name)) return unsure;
        ranges.push(...POSIX_CLASS[name]);
        if (!ASCII_ONLY.has(name)) wide = true;
        j = close + 2;
        continue;
      }
      // No `:]` follows: the `[` is a member, as Bash reads it.
    } else if (is(j, '[') && is(j + 1, '=')) {
      if (j + 4 < stop && is(j + 3, '=') && is(j + 4, ']')) {
        const code = p.charCodeAt(j + 2);
        // In a negated expression the characters a locale adds would be left out, and are not known.
        if (q(j + 2) || odd(code) || negated) return unsure;
        ranges.push([code, code]);
        wide = true;
        j += 5;
        continue;
      }
      const close = p.indexOf('=]', j + 2);
      if (close !== -1 && close + 1 < stop) return unsure;
      // No `=]` follows: the `[` is a member.
    }
    const lo = single(j);
    if (lo === null) return unsure;
    j = lo.next;
    if (is(j, '-') && j + 1 < stop && !is(j + 1, ']')) {
      if (is(j + 1, '[') && (is(j + 2, ':') || is(j + 2, '='))) return unsure;
      const hi = single(j + 1);
      if (hi === null) return unsure;
      j = hi.next;
      if (lo.code > hi.code) reversed = true;
      else ranges.push([lo.code, hi.code]);
    } else {
      ranges.push([lo.code, lo.code]);
    }
  }
  return { end: j, negated, ranges, wide, reversed };
}

// A bracket expression `readBracket` read, as the source of a regular-expression class. Each member is
// written as an escape, so no member is syntax. In a negated expression the characters outside ASCII
// that a class may hold are not left out: the class then matches more, never less, than Bash's.
// With `fold` (Windows, in a regular expression with no `i` flag), an expression that is not negated
// takes each letter in both cases, and a negated one leaves out only the characters it names, as Bash
// does: under an `i` flag `[!A]` would refuse `a`, which Bash matches.
export function classSrc({ ranges, negated, wide }, fold = false) {
  const u = (code) => `\\u${code.toString(16).padStart(4, '0')}`;
  const all = [...ranges];
  let any = wide && !negated;
  if (fold && !negated) {
    for (const [lo, hi] of ranges) {
      if (hi - lo > 1024) {
        any = true;
        all.push(...ALPHA);
        continue;
      }
      for (let c = lo; c <= hi; c++) {
        const s = String.fromCharCode(c);
        for (const v of [s.toLowerCase(), s.toUpperCase()]) {
          if (v.length === 1 && v !== s) all.push([v.charCodeAt(0), v.charCodeAt(0)]);
        }
      }
    }
  }
  const body = all.map(([lo, hi]) => (lo === hi ? u(lo) : `${u(lo)}-${u(hi)}`)).join('') + (any ? '\\u0080-\\uffff' : '');
  return `[${negated ? '^' : ''}${body}]`;
}

// The bracket expression that opens at p[i] of a pattern string, as the source of a
// regular-expression class: {src, end}; null when the `[` is a literal character. `unsure` marks one
// `readBracket` does not read, whose `src` is not to be relied on, and `reversed` one that holds a
// range running backwards (`[z-a]`).
export function bracketClass(p, i) {
  const b = readBracket(p, i);
  if (b === null) return null;
  if (b.unsure) return { src: '[^]', end: b.end, unsure: true };
  return b.reversed ? { src: classSrc(b), end: b.end, reversed: true } : { src: classSrc(b), end: b.end };
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
      // A pattern is not matched by a guess: validateConfig refuses it by name.
      if (cls.unsure) throw new Error(`bracket expression ${p.slice(i, cls.end + 1)} holds a class name, a collating symbol or an equivalence class the guards cannot read`);
      if (cls.reversed) throw new Error('Range out of order in character class');
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
