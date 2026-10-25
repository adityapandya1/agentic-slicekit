// pre-bash (REQ-3.2, REQ-2.1, REQ-1.2): the PreToolUse guard on Bash. Fails closed through io.js.
//
// Rules in order, first deny wins: (1) commit on a protected branch; (2) push to a protected branch;
// (3) any force push; (4) a commit that changes a frozen intake snapshot; (5) commit, push or `gh pr`
// writes from a subagent; (6) a command matching cfg.destructive.
//
// Limits: this reads the command as a shell would on its surface. It splits on operators outside
// quotes, strips env prefixes and command/exec/sudo/env, follows `cd`, `git -C` and `bash -c "..."`.
// It does not expand variables, aliases, eval, functions or encoded payloads: deliberate obfuscation
// gets through, and the git hooks (S-06's .githooks) are the backstop for commits and pushes.
import fs from 'node:fs';
import path from 'node:path';
import { compileDestructive } from '../config.js';
import { git, GitError, currentBranch } from '../git.js';
import { kitPaths } from '../paths.js';
import { allow, deny } from './io.js';
import { subagentActive } from './subagent-marker.js';

// ---- tokenising ----

// Unquoted, each of these ends a command: && || ; | & newline, subshell parens and backticks.
const SEPARATORS = new Set([';', '\n', '|', '&', '(', ')', '`']);

// -> string[][]: one array of words (quotes removed) per simple command.
export function segments(command) {
  const s = String(command);
  const out = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      const end = j === -1 ? s.length : j;
      word = (word ?? '') + s.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      let j = i + 1;
      let buf = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && j + 1 < s.length && '"\\$`\n'.includes(s[j + 1])) {
          buf += s[j + 1];
          j += 2;
        } else {
          buf += s[j];
          j += 1;
        }
      }
      word = (word ?? '') + buf;
      i = j + 1;
    } else if (c === '\\') {
      if (i + 1 < s.length && s[i + 1] !== '\n') word = (word ?? '') + s[i + 1];
      i += 2;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i += 1;
    } else if (SEPARATORS.has(c)) {
      endSegment();
      i += 1;
    } else if (c === '#' && word === null) {
      while (i < s.length && s[i] !== '\n') i += 1;
    } else {
      word = (word ?? '') + c;
      i += 1;
    }
  }
  endSegment();
  return out;
}

const base = (word) => path.posix.basename(word.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');

// Redirections are not arguments: `> file`, `2>file`, `<in`.
function dropRedirects(words) {
  const out = [];
  for (let k = 0; k < words.length; k++) {
    const m = /^\d*(>>?|<<?|>&|<&|&>)(.*)$/.exec(words[k]);
    if (!m) out.push(words[k]);
    else if (m[2] === '') k += 1;
  }
  return out;
}

const SKIP_WORDS = new Set(['command', 'exec', 'nohup', 'time', 'builtin']);
// Strip env assignments and the wrappers that run the next word as the command.
function stripPrefixes(words) {
  let w = dropRedirects(words);
  for (;;) {
    if (!w.length) return w;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) {
      w = w.slice(1);
      continue;
    }
    const b = base(w[0]);
    if (SKIP_WORDS.has(b) || b === 'sudo' || b === 'env') {
      w = w.slice(1);
      while (w.length && w[0].startsWith('-')) {
        const opt = w.shift();
        if (b === 'sudo' && /^-[ugChpDrt]$/.test(opt)) w.shift();
        if (b === 'env' && /^-[uCS]$/.test(opt)) w.shift();
      }
      continue;
    }
    return w;
  }
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

// ---- git argument parsing ----

const GIT_GLOBAL_VALUE = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix']);

function parsePush(args) {
  const VALUE = new Set(['--push-option', '--repo', '--receive-pack', '--exec']);
  let force = false;
  let all = false;
  let del = false;
  let endOpts = false;
  const positionals = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (!endOpts && a === '--') {
      endOpts = true;
    } else if (!endOpts && a.startsWith('--')) {
      const name = a.split('=')[0];
      if (name === '--force' || name === '--force-with-lease' || name === '--force-if-includes') force = true;
      else if (name === '--all' || name === '--mirror' || name === '--branches') all = true;
      else if (name === '--delete') del = true;
      else if (VALUE.has(name) && !a.includes('=')) k += 1;
    } else if (!endOpts && a.startsWith('-') && a.length > 1) {
      if (a === '-o') {
        k += 1;
        continue;
      }
      if (a.includes('f')) force = true;
      if (a.includes('d')) del = true;
    } else {
      positionals.push(a);
    }
  }
  // null in targets means the current branch.
  const targets = [];
  const refspecs = positionals.slice(1);
  for (const spec of refspecs) {
    let r = spec;
    if (r.startsWith('+')) {
      force = true;
      r = r.slice(1);
    }
    if (r === ':') {
      all = true;
      continue;
    }
    let target;
    if (del) target = r;
    else if (r.includes(':')) target = r.slice(r.indexOf(':') + 1) || r.slice(0, r.indexOf(':'));
    else target = r;
    if (target === 'HEAD') target = null;
    targets.push(target === null ? null : target.replace(/^refs\/heads\//, ''));
  }
  if (!refspecs.length && !all) targets.push(null);
  return { kind: force ? 'force-push' : 'push', force, all, targets };
}

function parseCommit(args) {
  const VALUE_SHORT = 'mFcCt';
  const VALUE_LONG = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--fixup', '--squash',
    '--author', '--date', '--cleanup', '--template', '--trailer']);
  let all = false;
  let whole = false;
  let endOpts = false;
  const paths = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (!endOpts && a === '--') {
      endOpts = true;
    } else if (!endOpts && a.startsWith('--')) {
      const name = a.split('=')[0];
      if (name === '--all') all = true;
      else if (name === '--pathspec-from-file') whole = true;
      if ((VALUE_LONG.has(name) || name === '--pathspec-from-file') && !a.includes('=')) k += 1;
    } else if (!endOpts && a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        if (a[j] === 'a') all = true;
        if (VALUE_SHORT.includes(a[j])) {
          if (j === a.length - 1) k += 1;
          break;
        }
      }
    } else {
      paths.push(a);
    }
  }
  return { kind: 'commit', all, whole: whole || all, paths };
}

// git add / rm / mv: what the command stages before a commit in the same line.
function parseStage(op, args) {
  let whole = false;
  let endOpts = false;
  const paths = [];
  for (const a of args) {
    if (!endOpts && a === '--') endOpts = true;
    else if (!endOpts && a.startsWith('--')) {
      const name = a.split('=')[0];
      if (name === '--all' || name === '--update' || name === '--pathspec-from-file') whole = true;
    } else if (!endOpts && a.startsWith('-') && a.length > 1) {
      if (op === 'add' && /[Au]/.test(a)) whole = true;
    } else paths.push(a);
  }
  return { kind: 'stage', op, whole: whole && !paths.length, paths };
}

const PR_WRITES = new Set(['create', 'merge', 'edit', 'ready', 'close', 'comment']);

// One simple command -> an invocation {kind, dir, ...}; `state.cwd` carries `cd` forward.
function invocationsOf(words, state, out) {
  const w = stripPrefixes(words);
  if (!w.length) return;
  const b = base(w[0]);
  if (b === 'cd') {
    if (w[1] && w[1] !== '-') state.cwd = path.resolve(state.cwd, w[1]);
    return;
  }
  if (SHELLS.has(b)) {
    const k = w.findIndex((x, idx) => idx > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
    if (k !== -1 && w[k + 1] !== undefined) {
      const inner = { cwd: state.cwd };
      for (const seg of segments(w[k + 1])) invocationsOf(seg, inner, out);
    }
    return;
  }
  if (b === 'gh') {
    if (w[1] === 'pr' && PR_WRITES.has(w[2])) out.push({ kind: 'pr', dir: state.cwd });
    return;
  }
  if (b !== 'git') return;
  let dir = state.cwd;
  let k = 1;
  while (k < w.length && w[k].startsWith('-')) {
    if (w[k] === '-C') {
      if (w[k + 1] !== undefined) dir = path.resolve(dir, w[k + 1]);
      k += 2;
    } else if (GIT_GLOBAL_VALUE.has(w[k])) {
      k += 2;
    } else {
      k += 1;
    }
  }
  const sub = w[k];
  const args = w.slice(k + 1);
  let inv;
  if (sub === 'commit') inv = parseCommit(args);
  else if (sub === 'push') inv = parsePush(args);
  else if (sub === 'add' || sub === 'rm' || sub === 'mv' || sub === 'stage') inv = parseStage(sub === 'stage' ? 'add' : sub, args);
  else inv = { kind: 'other' };
  out.push({ ...inv, dir });
}

// -> every git/gh invocation the command makes, in order.
export function invocations(command, cwd = process.cwd()) {
  const out = [];
  const state = { cwd };
  for (const seg of segments(command)) invocationsOf(seg, state, out);
  return out;
}

// -> {kind: 'commit'|'push'|'force-push'|'pr'|'other', branchArg?} for the first such invocation.
export function classifyGit(command) {
  for (const inv of invocations(command)) {
    if (inv.kind === 'commit' || inv.kind === 'pr') return { kind: inv.kind };
    if (inv.kind === 'push' || inv.kind === 'force-push') {
      const branchArg = inv.targets.find((t) => t !== null);
      return branchArg === undefined ? { kind: inv.kind } : { kind: inv.kind, branchArg };
    }
  }
  return { kind: 'other' };
}

// ---- repository facts, each safe outside a repository ----

function quiet(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GitError) return fallback;
    throw e;
  }
}

const branchIn = (dir) => quiet(() => currentBranch(dir), null);
const lines = (text) => (text === '' ? [] : text.split('\n'));
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};
const toPosix = (p) => p.split(path.sep).join('/');

// ---- rule 4: frozen intake ----

function covers(stager, file, top) {
  if (stager.whole) return true;
  for (const p of stager.paths) {
    if (/[*?[]/.test(p) || p.startsWith(':')) return true;
    const rel = toPosix(path.relative(top, path.resolve(real(stager.dir), p)));
    if (rel === '' || rel === '.') return true;
    if (file === rel || file.startsWith(`${rel}/`)) return true;
  }
  return false;
}

function frozenIntake(root, cfg, invs) {
  const intakeAbs = kitPaths(real(root), cfg).intake;
  for (const c of invs.filter((i) => i.kind === 'commit')) {
    const top = quiet(() => real(git(c.dir, ['rev-parse', '--show-toplevel'])), null);
    if (!top) continue;
    if (!quiet(() => (git(top, ['rev-parse', '--verify', 'HEAD']), true), false)) continue;
    const intake = toPosix(path.relative(top, intakeAbs));
    if (intake.startsWith('..') || path.isAbsolute(intake)) continue;
    const inHead = (f) => quiet(() => (git(top, ['cat-file', '-e', `HEAD:${f}`]), true), false);
    const staged = lines(git(top, ['diff', '--cached', '--name-only', '--', intake]));
    const hit = staged.find(inHead);
    if (hit) return hit;
    const sameRepo = (i) => quiet(() => real(git(i.dir, ['rev-parse', '--show-toplevel'])), null) === top;
    const stagers = invs.filter((i) => i.kind === 'stage' && sameRepo(i));
    if (c.whole || c.paths.length) stagers.push(c);
    if (!stagers.length) continue;
    const changed = lines(git(top, ['diff', '--name-only', 'HEAD', '--', intake]));
    const tracked = lines(git(top, ['ls-tree', '-r', '--name-only', 'HEAD', '--', intake]));
    for (const s of stagers) {
      const candidates = s.op === 'rm' || s.op === 'mv' ? tracked : changed;
      const f = candidates.find((file) => covers(s, file, top) && inHead(file));
      if (f) return f;
    }
  }
  return null;
}

// ---- the hook ----

export function handle(input, { root, cfg }) {
  const command = input?.tool_input?.command;
  if (typeof command !== 'string') throw new Error('tool_input.command is missing');
  const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : root;
  const invs = invocations(command, cwd);
  const protectedSet = new Set(cfg.protectedBranches);

  // (1)
  for (const c of invs.filter((i) => i.kind === 'commit')) {
    const b = branchIn(c.dir);
    if (b !== null && protectedSet.has(b)) return deny(`commit on protected branch ${b}; create a slice branch`);
  }
  // (2)
  const pushes = invs.filter((i) => i.kind === 'push' || i.kind === 'force-push');
  for (const p of pushes) {
    if (p.all && cfg.protectedBranches.length) return deny(`push to protected branch ${cfg.protectedBranches[0]}`);
    for (const t of p.targets) {
      const b = t === null ? branchIn(p.dir) : t;
      if (b !== null && protectedSet.has(b)) return deny(`push to protected branch ${b}`);
    }
  }
  // (3)
  if (pushes.some((p) => p.force)) return deny('force push refused');
  // (4)
  const frozen = frozenIntake(root, cfg, invs);
  if (frozen) return deny(`intake snapshot ${frozen} is frozen; add a new snapshot`);
  // (5)
  const writes = invs.some((i) => ['commit', 'push', 'force-push', 'pr'].includes(i.kind));
  if (writes && subagentActive(root, input.session_id)) return deny('agents do not run git; report and let the command commit');
  // (6)
  const patterns = compileDestructive(cfg);
  for (let k = 0; k < patterns.length; k++) {
    if (patterns[k].test(command)) return deny(`destructive command refused by rule ${cfg.destructive[k]}`);
  }
  return allow();
}
