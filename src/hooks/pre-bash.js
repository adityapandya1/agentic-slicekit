// pre-bash (REQ-3.2, REQ-2.1, REQ-1.2): the PreToolUse guard on Bash. Fails closed through io.js.
//
// Rules in order, first deny wins: (1) commit on a protected branch; (2) push to a protected branch;
// (3) any force push; (4) a commit that changes a frozen intake snapshot; (5) commit, push, cherry-pick/
// revert/am, `gh pr` writes or a non-GET `gh api` from a subagent; (6) a command matching cfg.destructive.
//
// Limits: this reads the command as a shell would on its surface. It splits on operators outside
// quotes, treats here-document bodies as data, strips shell keywords, env prefixes and wrappers
// (command/exec/sudo/env/timeout/nice/xargs/...), follows `cd`, `pushd`, `git -C`, `git checkout` and
// `bash -c "..."`. A directory it cannot resolve makes a commit or push refuse rather than pass.
// It does not expand variables, aliases, eval, functions or encoded payloads: deliberate obfuscation
// gets through, and the git hooks (S-06's .githooks) are the backstop for commits and pushes.
// Known gaps: `--git-dir` / `GIT_DIR` pointing at another repository are not followed (the branch is
// read from the shell's directory); a command substitution inside double quotes (`echo "$(git ...)"`)
// is not split out; the default destructive list misses `rm -fr /` spellings and absolute paths inside
// the worktree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileDestructive } from '../config.js';
import { git, GitError, currentBranch } from '../git.js';
import { kitPaths } from '../paths.js';
import { allow, deny } from './io.js';
import { activeMarker } from './subagent-marker.js';

// ---- tokenising ----

// Unquoted, each of these ends a command: && || ; | & newline, subshell parens and backticks.
const SEPARATORS = new Set([';', '\n', '|', '&', '(', ')', '`']);
const DELIM_END = /[\s;&|()<>`]/;

// -> [{toks: [{v, b}], heredocs: [string]}]: one entry per simple command. `v` is the word with quotes
// removed; `b` is only its unquoted characters. Here-document bodies are data, attached to the command
// that opened them.
function lex(command) {
  const s = String(command);
  const out = [];
  let cur = { toks: [], heredocs: [] };
  let word = null;
  let bare = '';
  let pending = [];
  const add = (text, quoted) => {
    word = (word ?? '') + text;
    if (!quoted) bare += text;
  };
  const endWord = () => {
    if (word !== null) cur.toks.push({ v: word, b: bare });
    word = null;
    bare = '';
  };
  const endSegment = () => {
    endWord();
    if (cur.toks.length) out.push(cur);
    cur = { toks: [], heredocs: [] };
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      const end = j === -1 ? s.length : j;
      add(s.slice(i + 1, end), true);
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
      add(buf, true);
      i = j + 1;
    } else if (c === '\\') {
      if (i + 1 < s.length && s[i + 1] !== '\n') add(s[i + 1], false);
      i += 2;
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      // A here-document: `<<WORD`, `<<-WORD`, `<<'WORD'`. Its body starts at the next newline.
      endWord();
      let j = i + 2;
      const dash = s[j] === '-';
      if (dash) j += 1;
      while (s[j] === ' ' || s[j] === '\t') j += 1;
      let delim = '';
      while (j < s.length && !DELIM_END.test(s[j])) {
        if (s[j] === "'" || s[j] === '"') {
          const k = s.indexOf(s[j], j + 1);
          const end = k === -1 ? s.length : k;
          delim += s.slice(j + 1, end);
          j = end + 1;
        } else if (s[j] === '\\') {
          delim += s[j + 1] ?? '';
          j += 2;
        } else {
          delim += s[j];
          j += 1;
        }
      }
      if (delim !== '') pending.push({ delim, dash, seg: cur });
      i = j;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i += 1;
    } else if (SEPARATORS.has(c)) {
      endSegment();
      i += 1;
      if (c === '\n' && pending.length) {
        for (const p of pending) {
          const body = [];
          while (i < s.length) {
            const nl = s.indexOf('\n', i);
            const e = nl === -1 ? s.length : nl;
            const line = s.slice(i, e).replace(/\r$/, '');
            i = e + 1;
            if ((p.dash ? line.replace(/^\t+/, '') : line) === p.delim) break;
            body.push(line);
          }
          p.seg.heredocs.push(body.join('\n'));
        }
        pending = [];
      }
    } else if (c === '#' && word === null) {
      while (i < s.length && s[i] !== '\n') i += 1;
    } else {
      add(c, false);
      i += 1;
    }
  }
  endSegment();
  return out;
}

// -> string[][]: one array of words (quotes removed) per simple command.
export function segments(command) {
  return lex(command).map((seg) => seg.toks.map((t) => t.v));
}

const base = (word) => path.posix.basename(word.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');

// Redirections are not arguments: `> file`, `2>file`, `<in`, `<<< word`.
function dropRedirects(toks) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const m = /^\d*(<<<|>>?|<|>&|<&|&>)(.*)$/.exec(toks[k].b === toks[k].v ? toks[k].v : '');
    if (!m) out.push(toks[k]);
    else if (m[2] === '') k += 1;
  }
  return out;
}

// Words that only open a construct; the command follows them.
const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{']);
// Wrappers that run the rest of the line as the command: short options that take a separate value,
// long options that do (without `=`), and how many positionals precede the command.
const WRAPPERS = {
  command: { short: '', long: [], skip: 0 },
  exec: { short: 'a', long: [], skip: 0 },
  builtin: { short: '', long: [], skip: 0 },
  nohup: { short: '', long: [], skip: 0 },
  time: { short: 'fo', long: ['--format', '--output'], skip: 0 },
  winpty: { short: '', long: [], skip: 0 },
  sudo: { short: 'ugChpDrtUg', long: ['--user', '--group', '--host', '--prompt', '--chdir'], skip: 0 },
  env: { short: 'uCS', long: ['--unset', '--chdir', '--split-string'], skip: 0 },
  timeout: { short: 'sk', long: ['--signal', '--kill-after'], skip: 1 },
  nice: { short: 'n', long: ['--adjustment'], skip: 0 },
  ionice: { short: 'cnpPu', long: ['--class', '--classdata', '--pid', '--pgid', '--uid'], skip: 0 },
  stdbuf: { short: 'ioe', long: ['--input', '--output', '--error'], skip: 0 },
  xargs: {
    short: 'IinPLlEesad',
    long: ['--replace', '--max-args', '--max-procs', '--max-lines', '--eof', '--max-chars', '--arg-file', '--delimiter'],
    skip: 0,
  },
};

// Strip keywords, env assignments and wrappers until the word that is the command.
function stripPrefixes(toks) {
  let w = dropRedirects(toks);
  for (;;) {
    if (!w.length) return w;
    if (KEYWORDS.has(w[0].v)) {
      w = w.slice(1);
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0].v)) {
      w = w.slice(1);
      continue;
    }
    const spec = WRAPPERS[base(w[0].v)];
    if (!spec) return w;
    w = w.slice(1);
    while (w.length && w[0].v.startsWith('-') && w[0].v !== '-') {
      const opt = w.shift().v;
      if (opt === '--') break;
      if (opt.startsWith('--')) {
        if (spec.long.includes(opt) && w.length) w.shift();
      } else if (opt.length === 2 && spec.short.includes(opt[1]) && w.length) {
        w.shift();
      }
    }
    w = w.slice(spec.skip);
  }
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

// ---- directories ----

// A directory the hook cannot resolve is null: commits and pushes there refuse rather than pass.
function resolveDir(from, target) {
  if (/[$`]/.test(target)) return null;
  let t = target;
  if (t === '~' || t.startsWith('~/')) t = path.join(os.homedir(), t.slice(1));
  else if (t.startsWith('~')) return null;
  if (process.platform === 'win32') {
    const m = /^\/([A-Za-z])(\/.*)?$/.exec(t);
    if (m) t = `${m[1].toUpperCase()}:/${(m[2] ?? '').slice(1)}`;
  }
  if (from === null && !path.isAbsolute(t)) return null;
  const abs = path.resolve(from ?? '', t);
  try {
    return fs.statSync(abs).isDirectory() ? abs : null;
  } catch {
    return null;
  }
}

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
    if (target === 'HEAD' || target === '@') target = null;
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
  let include = false;
  let endOpts = false;
  const paths = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (!endOpts && a === '--') {
      endOpts = true;
    } else if (!endOpts && a.startsWith('--')) {
      const name = a.split('=')[0];
      if (name === '--all') all = true;
      else if (name === '--include') include = true;
      else if (name === '--pathspec-from-file') whole = true;
      if ((VALUE_LONG.has(name) || name === '--pathspec-from-file') && !a.includes('=')) k += 1;
    } else if (!endOpts && a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        if (a[j] === 'a') all = true;
        if (a[j] === 'i') include = true;
        if (VALUE_SHORT.includes(a[j])) {
          if (j === a.length - 1) k += 1;
          break;
        }
      }
    } else {
      paths.push(a);
    }
  }
  return { kind: 'commit', all, include, whole: whole || all, paths };
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

// The branch a later commit in the same command will be on, if this changes it. UNKNOWN for `-`.
export const UNKNOWN = Symbol('unknown');
function parseSwitch(sub, args) {
  const NEW = sub === 'switch' ? new Set(['-c', '-C', '--create', '--force-create']) : new Set(['-b', '-B', '--orphan']);
  const positionals = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--') return { kind: 'other' };
    if (NEW.has(a)) return args[k + 1] === undefined ? { kind: 'other' } : { kind: 'switch', to: args[k + 1] };
    const eq = a.indexOf('=');
    if (eq > 0 && NEW.has(a.slice(0, eq))) return { kind: 'switch', to: a.slice(eq + 1) };
    if (a === '--detach' || a === '-d') return { kind: 'switch', to: null };
    if (!a.startsWith('-')) positionals.push(a);
    else if (a === '-') positionals.push(a);
  }
  // `git checkout <b> <paths>` restores files and stays put.
  if (positionals.length !== 1) return { kind: 'other' };
  return { kind: 'switch', to: positionals[0] === '-' ? UNKNOWN : positionals[0] };
}

// From a subagent, every gh pr subcommand but these is a write.
const PR_READS = new Set(['view', 'list', 'status', 'checks', 'diff']);

// gh pr <sub> that writes -> 'pr'; gh api with a method other than GET -> 'api-write'; else null.
function classifyGh(w) {
  let k = 1;
  const skipFlags = () => {
    while (k < w.length && w[k].startsWith('-')) k += w[k] === '-R' || w[k] === '--repo' ? 2 : 1;
  };
  skipFlags();
  const group = w[k];
  k += 1;
  if (group === 'pr') {
    skipFlags();
    return w[k] !== undefined && !PR_READS.has(w[k]) ? 'pr' : null;
  }
  if (group === 'api') {
    let method = 'GET';
    for (let j = k; j < w.length; j++) {
      if ((w[j] === '-X' || w[j] === '--method') && w[j + 1] !== undefined) method = w[j + 1];
      else if (w[j].startsWith('--method=')) method = w[j].slice('--method='.length);
      else if (/^-X./.test(w[j])) method = w[j].slice(2);
    }
    return method.toUpperCase() === 'GET' ? null : 'api-write';
  }
  return null;
}

// ---- rule 6: the text a destructive pattern is matched against ----

// Commands that only read or print their arguments.
const READERS = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg']);
// Database clients: their quoted arguments and here-documents are the statements they run.
const DB_CLIENTS = new Set(['psql', 'mysql', 'sqlite3', 'sqlcmd']);
const MESSAGE_OPTS = new Set(['-m', '-F', '--message', '--file']);

// Index of git's subcommand, past its global options.
function gitSubIndex(w) {
  let k = 1;
  while (k < w.length && w[k].startsWith('-')) k += w[k] === '-C' || GIT_GLOBAL_VALUE.has(w[k]) ? 2 : 1;
  return k;
}

// -> the segment's command text with quoted strings and commit messages removed; null to skip it.
function destructiveText(toks, heredocs) {
  const b = base(toks[0].v);
  if (READERS.has(b)) return null;
  if (DB_CLIENTS.has(b)) return [...toks.map((t) => t.v), ...heredocs].join(' ');
  let keep = toks;
  if (b === 'git') {
    const w = toks.map((t) => t.v);
    const k = gitSubIndex(w);
    if (w[k] === 'grep' || w[k] === 'log') return null;
    if (w[k] === 'commit') {
      keep = [];
      for (let j = 0; j < toks.length; j++) {
        const v = toks[j].v;
        if (j > k && (MESSAGE_OPTS.has(v) || /^-[^-]*[mF]$/.test(v))) j += 1;
        else if (j > k && (/^--(message|file)=/.test(v) || /^-[^-]*[mF]./.test(v))) continue;
        else keep.push(toks[j]);
      }
    }
  }
  return keep.map((t) => t.b).filter((x) => x !== '').join(' ');
}

// One simple command -> invocations {kind, dir, label, ...}; `state` carries cd/pushd forward.
function walk(seg, state, acc) {
  const toks = stripPrefixes(seg.toks);
  if (!toks.length) return;
  const w = toks.map((t) => t.v);
  const text = destructiveText(toks, seg.heredocs);
  if (text !== null) acc.texts.push(text);
  if (state.cwd !== null) {
    for (const x of w.slice(1)) if (!x.startsWith('-') && !/[$`]/.test(x)) acc.mentions.push({ dir: state.cwd, word: x });
  }
  const b = base(w[0]);
  if (b === 'cd' || b === 'pushd') {
    const target = w.slice(1).find((x) => !x.startsWith('-') || x === '-');
    if (b === 'pushd') state.stack.push({ cwd: state.cwd, label: state.label });
    if (target === undefined) {
      state.cwd = b === 'cd' ? os.homedir() : null;
      state.label = b === 'cd' ? '~' : 'pushd';
    } else if (target === '-') {
      state.cwd = null;
      state.label = '-';
    } else {
      state.cwd = resolveDir(state.cwd, target);
      state.label = target;
    }
    return;
  }
  if (b === 'popd') {
    const prev = state.stack.pop();
    state.cwd = prev ? prev.cwd : null;
    state.label = prev ? prev.label : 'popd';
    return;
  }
  if (SHELLS.has(b)) {
    const k = w.findIndex((x, idx) => idx > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
    const bodies = k !== -1 && w[k + 1] !== undefined ? [w[k + 1]] : seg.heredocs;
    for (const body of bodies) {
      const inner = { cwd: state.cwd, label: state.label, stack: [] };
      for (const s of lex(body)) walk(s, inner, acc);
    }
    return;
  }
  if (b === 'gh') {
    const kind = classifyGh(w);
    if (kind) acc.invs.push({ kind, dir: state.cwd, label: state.label });
    return;
  }
  if (b !== 'git') return;
  let dir = state.cwd;
  let label = state.label;
  let k = 1;
  while (k < w.length && w[k].startsWith('-')) {
    if (w[k] === '-C') {
      if (w[k + 1] !== undefined) {
        dir = resolveDir(dir, w[k + 1]);
        label = w[k + 1];
      }
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
  else if (sub === 'checkout' || sub === 'switch') inv = parseSwitch(sub, args);
  // These make commits too: rule 1 holds them to the protected branches; rule 4 does not apply.
  else if (sub === 'cherry-pick' || sub === 'revert' || sub === 'am') {
    inv = { kind: 'commit', replay: true, all: false, include: false, whole: false, paths: [] };
  }
  else inv = { kind: 'other' };
  acc.invs.push({ ...inv, dir, label: dir === null ? label : (label ?? dir) });
}

// -> {invs, texts, mentions}: every git/gh invocation in order, and each command's text for rule 6.
// cwd null means unknown.
function parse(command, cwd) {
  const acc = { invs: [], texts: [], mentions: [] };
  const state = { cwd, label: cwd, stack: [] };
  for (const seg of lex(command)) walk(seg, state, acc);
  return acc;
}

export const invocations = (command, cwd = process.cwd()) => parse(command, cwd).invs;

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

// -> branch name; null for no branch (detached HEAD, or not a repository); UNKNOWN when git failed otherwise.
function branchIn(dir) {
  try {
    return currentBranch(dir);
  } catch (e) {
    if (e instanceof GitError) return /not a git repository/i.test(e.stderr) ? null : UNKNOWN;
    throw e;
  }
}

const lines = (text) => (text === '' ? [] : text.split('\n'));
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};
const toPosix = (p) => p.split(path.sep).join('/');
const topOf = (dir) => (dir === null ? null : quiet(() => real(git(dir, ['rev-parse', '--show-toplevel'])), null));

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

// Whether a word some command in the line names resolves under the intake directory.
function namesIntake(mentions, intakeAbs) {
  return mentions.some(({ dir, word }) => {
    const rel = path.relative(intakeAbs, path.resolve(real(dir), word));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

function frozenIntake(root, cfg, invs, mentions) {
  const intakeAbs = kitPaths(real(root), cfg).intake;
  for (const c of invs.filter((i) => i.kind === 'commit' && !i.replay && i.dir !== null)) {
    const top = topOf(c.dir);
    if (!top) continue;
    if (!quiet(() => (git(top, ['rev-parse', '--verify', 'HEAD']), true), false)) continue;
    const intake = toPosix(path.relative(top, intakeAbs));
    if (intake.startsWith('..') || path.isAbsolute(intake)) continue;
    const inHead = (f) => quiet(() => (git(top, ['cat-file', '-e', `HEAD:${f}`]), true), false);
    // A commit naming paths commits only those; the index counts too only with -i.
    const onlyPaths = c.paths.length > 0 && !c.include;
    if (!onlyPaths) {
      const staged = lines(git(top, ['diff', '--cached', '--name-only', '--', intake]));
      const hit = staged.find(inHead);
      if (hit) return hit;
    }
    const stagers = onlyPaths ? [] : invs.filter((i) => i.kind === 'stage' && i.dir !== null && topOf(i.dir) === top);
    if (c.whole || c.paths.length) stagers.push(c);
    if (!stagers.length) continue;
    const changed = lines(git(top, ['diff', '--name-only', 'HEAD', '--', intake]));
    const tracked = lines(git(top, ['ls-tree', '-r', '--name-only', 'HEAD', '--', intake]));
    // Another command in the line may change intake before -a reads the tree: every intake file counts.
    const touched = c.all && namesIntake(mentions, intakeAbs);
    for (const s of stagers) {
      const candidates = s.op === 'rm' || s.op === 'mv' || (s === c && touched) ? tracked : changed;
      const f = candidates.find((file) => covers(s, file, top) && inHead(file));
      if (f) return f;
    }
  }
  return null;
}

// ---- the hook ----

const unknownDir = (label) => deny(`cannot tell which branch ${label} is on; run the command from inside the repository`);

export function handle(input, { root, cfg }) {
  const command = input?.tool_input?.command;
  if (typeof command !== 'string') throw new Error('tool_input.command is missing');
  const start = typeof input.cwd === 'string' && input.cwd !== '' ? resolveDir(null, input.cwd) : root;
  const { invs, texts, mentions } = parse(command, start);
  const protectedSet = new Set(cfg.protectedBranches);

  // The branch each commit and push runs on, following checkouts earlier in the same command.
  const switched = new Map();
  for (const inv of invs) {
    if (inv.dir === null) {
      inv.branch = UNKNOWN;
      continue;
    }
    const key = topOf(inv.dir) ?? inv.dir;
    if (inv.kind === 'switch') switched.set(key, inv.to);
    else inv.branch = switched.has(key) ? switched.get(key) : branchIn(inv.dir);
  }

  // (1)
  for (const c of invs.filter((i) => i.kind === 'commit')) {
    if (c.branch === UNKNOWN) return unknownDir(c.label);
    if (c.branch !== null && protectedSet.has(c.branch)) return deny(`commit on protected branch ${c.branch}; create a slice branch`);
  }
  // (2)
  const pushes = invs.filter((i) => i.kind === 'push' || i.kind === 'force-push');
  for (const p of pushes) {
    if (p.all && cfg.protectedBranches.length) return deny(`push to protected branch ${cfg.protectedBranches[0]}`);
    for (const t of p.targets) {
      if (t === null && p.branch === UNKNOWN) return unknownDir(p.label);
      const b = t === null ? p.branch : t;
      if (b !== null && protectedSet.has(b)) return deny(`push to protected branch ${b}`);
    }
  }
  // (3)
  if (pushes.some((p) => p.force)) return deny('force push refused');
  // (4)
  const frozen = frozenIntake(root, cfg, invs, mentions);
  if (frozen) return deny(`intake snapshot ${frozen} is frozen; add a new snapshot`);
  // (5)
  if (invs.some((i) => ['commit', 'push', 'force-push', 'pr', 'api-write'].includes(i.kind))) {
    const marker = activeMarker(root, input.session_id);
    if (marker) return deny(`agents do not run git; report and let the command commit (marker ${marker})`);
  }
  // (6)
  const patterns = compileDestructive(cfg);
  for (let k = 0; k < patterns.length; k++) {
    if (texts.some((t) => patterns[k].test(t))) return deny(`destructive command refused by rule ${cfg.destructive[k]}`);
  }
  return allow();
}
