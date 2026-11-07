// pre-bash (REQ-3.2, REQ-2.1, REQ-1.2, REQ-3.14): the PreToolUse guard on Bash. Fails closed through io.js.
//
// This guard is a check on the developer's machine, not a control: an agent with a shell can reach git
// by a route it does not parse, so it can be bypassed. The control is the git host's rules on the
// default branch (REQ-3.14), which `slicekit check` verifies, and the agent login's lack of admin
// rights on the repository (D-88).
//
// Before the rules below, in every session and on every branch (D-83): (0a) a command it cannot judge:
// a git or gh command whose arguments hold a variable or a command substitution; `eval`, a shell's
// `-c` (`sh`, `bash`, `zsh`, `pwsh`, `cmd /c`, ...) or an interpreter's inline code (`node -e`,
// `python -c`, `perl -e`, `ruby -e`) that names git or gh; (0b) a change to the host rules from the
// agent's shell: `slicekit init --protect`, or a `gh api` write (a method other than GET, or a field or
// input flag without `-X GET`) to rulesets, rules or branch protection; (0c) a write to a test frozen
// for the active slice (REQ-3.3) by redirection, `tee`, `sed -i`, `cp`, `mv`, `rm`, `unlink` or
// `truncate`; (0d) a command naming a path that matches a pattern of `agents.denyPaths` (REQ-3.13): any
// argument, redirection target, option value or `<rev>:<path>` path, resolved against the shell's
// directory, a glob or brace expression by what it expands to, and the directory a pattern starts with
// (`data` for `data/**`); the directory each command runs in and each `cd`/`pushd` target are judged
// too, and while the list is set a `cd` it cannot resolve from the text is refused.
//
// Rules in order, first deny wins: (1) commit on a protected branch; (2) push to a protected branch;
// (3) any force push; (4) a commit that changes a frozen intake snapshot; (5) from a subagent: commit,
// push, merge, pull, rebase, cherry-pick, revert, am, tag (other than listing), `gh pr` writes or a
// non-GET `gh api`; (6) a command matching cfg.destructive.
//
// "From a subagent" means the input carries a non-empty `agent_id`: Claude Code sets it on every tool
// call made inside a subagent and never in the main session (an `--agent` session has `agent_type`
// alone). The subagent marker is not read here: it is per session, so it cannot tell the main session's
// own commit from its subagent's.
//
// Limits: this reads the command as a shell would on its surface. It splits on operators outside
// quotes, treats here-document bodies as data, strips shell keywords, env prefixes and wrappers
// (command/exec/sudo/env/timeout/nice/xargs/...), follows `cd`, `pushd`, `git -C`, `git checkout` and
// `bash -c "..."`. A directory it cannot resolve makes a commit or push refuse rather than pass.
// It does not expand variables, aliases, functions or encoded payloads; where git or gh is named in
// what it cannot expand, rule (0a) refuses the command. Deliberate obfuscation still gets through
// (`$G push`, a script file that runs git); the host rules are the control.
// Known gaps: `--git-dir` / `GIT_DIR` pointing at another repository are not followed (the branch is
// read from the shell's directory); a command substitution inside double quotes (`echo "$(git ...)"`)
// is not split out; `echo '...' | bash` (a piped string, not a here-document) and a shell function
// (`function f { ...; }; f`) are not followed; the default destructive list misses `rm -fr /`
// spellings and absolute paths inside the worktree; SQL read from a file (`psql -f f.sql`,
// `cat f.sql | psql`) is not matched against the destructive list; a frozen test written by a program
// that names it only inside its own code (`node -e "fs.writeFileSync(...)"`) is not seen.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileDestructive } from '../config.js';
import { git, GitError, currentBranch } from '../git.js';
import { kitPaths } from '../paths.js';
import { allow, deny } from './io.js';
import { denyDir, denyPaths, frozenTests, fromGitBash, matchesDeny, real, toPosix } from './paths.js';

// ---- tokenising ----

// Unquoted, each of these ends a command: && || ; | & newline, subshell parens and backticks.
const SEPARATORS = new Set([';', '\n', '|', '&', '(', ')', '`']);
const DELIM_END = /[\s;&|()<>`]/;

// -> [{toks: [{v, b, x}], heredocs: [string], stdin?, subst?}]: one entry per simple command. `v` is the
// word with quotes removed; `b` is only its unquoted characters; `x` is the characters the shell expands
// (`v` without single-quoted or backslash-escaped text). Here-document bodies are data, attached to the
// command that opened them; `stdin` is the command piped into this one; `subst` marks a command that
// an unquoted backtick substitution interrupts (its output becomes this command's next argument).
function lex(command) {
  const s = String(command);
  const out = [];
  // `depth` counts the unquoted subshell parentheses a segment sits in.
  let depth = 0;
  let cur = { toks: [], heredocs: [], depth };
  let word = null;
  let bare = '';
  let expand = '';
  let pending = [];
  let tickOpen = false;
  // `m` is one character per character of the word: `1` where it was quoted or escaped, `0` where
  // the shell reads it as syntax (a brace expression's braces and commas count only there).
  let mask = '';
  // Open `case` commands: in each, whether the next `)` ends a pattern rather than a subshell.
  const cases = [];
  const add = (text, quoted, expands = !quoted) => {
    word = (word ?? '') + text;
    if (!quoted) bare += text;
    if (expands) expand += text;
    mask += (quoted || !expands ? '1' : '0').repeat(text.length);
  };
  const endWord = () => {
    if (word !== null) {
      const plain = word === bare && !mask.includes('1');
      // A command starts at a segment's first word or after the reserved words that open a
      // construct: `then case ...`, `do case ...`, `{ case ...`, `! case ...`.
      const atStart = cur.toks.every((t) => t.v === t.b && !t.m?.includes('1') && KEYWORDS.has(t.v));
      if (plain && atStart && word === 'case') cases.push({ pattern: false, awaitIn: true });
      else if (plain && atStart && word === 'esac' && cases.length) cases.pop();
      else if (plain && word === 'in' && cases.at(-1)?.awaitIn) Object.assign(cases.at(-1), { awaitIn: false, pattern: true });
      cur.toks.push({ v: word, b: bare, x: expand, m: mask });
    }
    word = null;
    bare = '';
    expand = '';
    mask = '';
  };
  const endSegment = () => {
    endWord();
    const ended = cur;
    if (cur.toks.length) out.push(cur);
    cur = { toks: [], heredocs: [], depth };
    return ended;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      const end = j === -1 ? s.length : j;
      add(s.slice(i + 1, end), true, false);
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
      add(buf, true, true);
      i = j + 1;
    } else if (c === '\\') {
      if (i + 1 < s.length && s[i + 1] !== '\n') add(s[i + 1], false, false);
      i += 2;
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] === '<') {
      // A here-string: a redirect, its operand is the next word.
      endWord();
      cur.toks.push({ v: '<<<', b: '<<<' });
      i += 3;
    } else if (c === '(' && s[i + 1] === '(') {
      // Arithmetic, `((...))` or `$((...))`: one word, never a here-document or a subshell.
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === '(') depth += 1;
        else if (s[j] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      add(s.slice(i, j + 1), false);
      i = j + 1;
    } else if (c === '<' && s[i + 1] === '<') {
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
      if (c === '`') {
        if (!tickOpen) cur.subst = true;
        tickOpen = !tickOpen;
      }
      const ended = endSegment();
      const open = cases.at(-1);
      if (open?.pattern && (c === '(' || c === ')')) {
        // A case pattern's parentheses: `a)` and the optional `(a)`; no subshell starts or ends.
        if (c === ')') open.pattern = false;
      } else if (c === '(' || c === ')') {
        depth = c === '(' ? depth + 1 : Math.max(0, depth - 1);
        cur.depth = depth;
      }
      // `;;` (and `;&`, `;;&`) ends a case arm: the next `)` ends a pattern again.
      if (c === ';' && open && (s[i + 1] === ';' || s[i + 1] === '&')) {
        open.pattern = true;
        i += s[i + 2] === '&' ? 2 : 1;
      }
      if (c === '|' && s[i + 1] === '|') i += 1;
      else if (c === '|') cur.stdin = ended;
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
    } else if (c === '>' && word !== null && !(word === bare && /^\d*>?$/.test(word))) {
      // `x>f` is the word `x` and the redirect `>f`, as the shell reads it; `2>f` and `>>f` stay one word.
      endWord();
      add(c, false);
      i += 1;
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
  t = fromGitBash(t);
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
// `created` is true when the name is certainly the new branch; otherwise the evaluator carries the name
// only when it is protected or names an existing local branch (else it was a path or a commit).
function parseSwitch(sub, args) {
  const NEW = sub === 'switch'
    ? new Set(['-c', '-C', '--create', '--force-create', '--orphan'])
    : new Set(['-b', '-B', '--orphan']);
  const NOT_SWITCH = new Set(['-p', '--patch', '--ours', '--theirs', '-m', '--merge', '--pathspec-from-file']);
  let track = false;
  const positionals = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--') return { kind: 'other' };
    if (NOT_SWITCH.has(a.split('=')[0])) return { kind: 'other' };
    if (NEW.has(a)) return args[k + 1] === undefined ? { kind: 'other' } : { kind: 'switch', to: args[k + 1], created: true };
    const eq = a.indexOf('=');
    if (eq > 0 && NEW.has(a.slice(0, eq))) return { kind: 'switch', to: a.slice(eq + 1), created: true };
    if (a === '--track' || a.startsWith('--track=') || a === '-t') track = true;
    else if (a === '--detach' || a === '-d') return { kind: 'switch', to: null, created: true };
    else if (!a.startsWith('-') || a === '-') positionals.push(a);
  }
  // `git checkout <b> <paths>` restores files and stays put.
  if (positionals.length !== 1) return { kind: 'other' };
  const p = positionals[0];
  if (p === '-') return { kind: 'switch', to: UNKNOWN, created: true };
  // --track origin/main creates main.
  if (track) return { kind: 'switch', to: p.includes('/') ? p.slice(p.indexOf('/') + 1) : p, created: true };
  return { kind: 'switch', to: p, created: false };
}

// From a subagent, every gh pr subcommand but these is a write.
const PR_READS = new Set(['view', 'list', 'status', 'checks', 'diff']);

// gh api flags that send a request body: without an explicit method they make the request a POST.
const GH_API_BODY = new Set(['-f', '-F', '--field', '--raw-field', '--input']);
// gh api flags that take a separate value.
const GH_API_VALUE = new Set(['-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '--cache', '-p', '--preview']);

// `gh api` from index k: {method, endpoint}. The method is the explicit one, else POST when a field or
// input flag is given, else GET.
function parseGhApi(w, k) {
  let method = null;
  let body = false;
  let endpoint = null;
  for (let j = k; j < w.length; j++) {
    const a = w[j];
    if (a === '-X' || a === '--method') {
      if (w[j + 1] !== undefined) method = w[j + 1];
      j += 1;
    } else if (a.startsWith('--method=')) {
      method = a.slice('--method='.length);
    } else if (/^-X./.test(a)) {
      method = a.slice(2);
    } else if (GH_API_BODY.has(a)) {
      body = true;
      j += 1;
    } else if (GH_API_BODY.has(a.startsWith('--') ? a.split('=')[0] : a.slice(0, 2))) {
      body = true;
    } else if (GH_API_VALUE.has(a)) {
      j += 1;
    } else if (!a.startsWith('-') && endpoint === null) {
      endpoint = a;
    }
  }
  return { method: (method ?? (body ? 'POST' : 'GET')).toUpperCase(), endpoint };
}

// A repository's (or organisation's) rulesets and rules, or a branch's protection.
const HOST_RULES_PATH = /^\/?(?:(?:repos\/[^/]+\/[^/]+|orgs\/[^/]+|enterprises\/[^/]+)\/(?:rulesets|rules)|repos\/[^/]+\/[^/]+\/branches\/.+\/protection)(?:[/?]|$)/;

// gh's command group and the index after it.
function ghGroup(w) {
  let k = 1;
  while (k < w.length && w[k].startsWith('-')) k += w[k] === '-R' || w[k] === '--repo' ? 2 : 1;
  return { group: w[k], k: k + 1 };
}

// gh pr <sub> that writes -> 'pr'; gh api with a method other than GET -> 'api-write'; else null.
function classifyGh(w) {
  const { group, k: after } = ghGroup(w);
  let k = after;
  if (group === 'pr') {
    while (k < w.length && w[k].startsWith('-')) k += w[k] === '-R' || w[k] === '--repo' ? 2 : 1;
    return w[k] !== undefined && !PR_READS.has(w[k]) ? 'pr' : null;
  }
  if (group === 'api') return parseGhApi(w, k).method === 'GET' ? null : 'api-write';
  return null;
}

// -> a description of a write to the host's rules (REQ-3.14), or null.
function hostRulesChange(w) {
  const head = base(w[0]);
  if (head === 'gh') {
    const { group, k } = ghGroup(w);
    if (group !== 'api') return null;
    const { method, endpoint } = parseGhApi(w, k);
    return method !== 'GET' && endpoint !== null && HOST_RULES_PATH.test(endpoint) ? `gh api ${method} ${endpoint}` : null;
  }
  const i = w.findIndex((x, idx) => idx <= 3 && /^slicekit(\.[cm]?js)?$/.test(base(x)));
  if (i === -1) return null;
  const rest = w.slice(i + 1);
  return rest.includes('init') && rest.some((a) => a === '--protect' || a.startsWith('--protect='))
    ? 'slicekit init --protect'
    : null;
}

// ---- rule 0a: commands the guard cannot judge ----

// A git or gh word in code or a command string; `.git`, `github` and `git-lfs` are not.
const NAMES_GIT = /(?:^|[^A-Za-z0-9_.-])(?:git|gh)(?:[^A-Za-z0-9_-]|$)/;
const OTHER_SHELLS = new Set(['pwsh', 'powershell', 'cmd']);

// The inline code an interpreter runs, or undefined.
function inlineCode(head, w) {
  let flag;
  if (head === 'node' || head === 'nodejs' || head === 'bun') flag = (a) => /^-[ep]+$/.test(a) || a === '--eval' || a === '--print';
  else if (/^python[0-9.]*$/.test(head) || head === 'py') flag = (a) => /^-[A-Za-z]*c$/.test(a);
  else if (head === 'perl' || head === 'ruby') flag = (a) => /^-[A-Za-z]*[eE]$/.test(a);
  else return undefined;
  for (let k = 1; k < w.length; k++) {
    if (/^--(eval|print)=/.test(w[k]) && (head === 'node' || head === 'nodejs' || head === 'bun')) return w[k].slice(w[k].indexOf('=') + 1);
    if (flag(w[k])) return w[k + 1];
  }
  return undefined;
}

// -> why the command cannot be judged, or null. `toks` has prefixes stripped.
function unjudgeable(seg, toks, w, head) {
  if (head === 'git' || head === 'gh') {
    if (seg.subst || toks.slice(1).some((t) => /[$`]/.test(t.x ?? ''))) {
      return `${head} takes an argument from a variable or a command substitution`;
    }
    return null;
  }
  if (head === 'eval') return NAMES_GIT.test(w.slice(1).join(' ')) ? 'eval runs a command that names git or gh' : null;
  if (SHELLS.has(head)) {
    const k = w.findIndex((x, idx) => idx > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
    return k !== -1 && NAMES_GIT.test(w[k + 1] ?? '') ? `${head} -c runs a command string that names git or gh` : null;
  }
  if (OTHER_SHELLS.has(head)) {
    const k = w.findIndex((x, idx) => idx > 0 && /^[-/](c|k|command|encodedcommand|ec)$/i.test(x));
    if (k === -1) return null;
    if (/^[-/](encodedcommand|ec)$/i.test(w[k])) return `${head} runs an encoded command`;
    return NAMES_GIT.test(w.slice(k + 1).join(' ')) ? `${head} ${w[k]} runs a command string that names git or gh` : null;
  }
  const code = inlineCode(head, w);
  return code !== undefined && NAMES_GIT.test(code) ? `${head}'s inline code names git or gh` : null;
}

// ---- rule 0c: what a command writes ----

// Redirection targets in the raw tokens: `> f`, `>>f`, `2> f`, `>| f`; not `>&2`.
function redirectTargets(toks) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const m = /^\d*(>>|>\||>&|>)/.exec(toks[k].v);
    if (!m || !toks[k].b.startsWith(m[0])) continue;
    const target = toks[k].v === m[0] ? toks[k + 1]?.v : toks[k].v.slice(m[0].length);
    if (toks[k].v === m[0]) k += 1;
    if (target === undefined || (m[1] === '>&' && /^(\d+-?|-)$/.test(target))) continue;
    out.push(target);
  }
  return out;
}

// Non-option arguments, skipping the values of the options in `valued`.
function positionals(args, valued = new Set()) {
  const out = [];
  let endOpts = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (!endOpts && a === '--') endOpts = true;
    else if (!endOpts && a.startsWith('-') && a !== '-') {
      if (valued.has(a)) k += 1;
    } else out.push(a);
  }
  return out;
}

// -> [{word, removes?, into?}]: the paths a simple command writes. `removes` also covers a directory
// holding the file; `into` lists source names for a destination that may be a directory.
function writeTargets(seg, w, head) {
  const out = redirectTargets(seg.toks).map((word) => ({ word }));
  const args = w.slice(1);
  if (head === 'tee') {
    for (const word of positionals(args)) out.push({ word });
  } else if (head === 'sed' && args.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith('--in-place'))) {
    for (const word of positionals(args, new Set(['-e', '-f', '--expression', '--file', '-l', '--line-length']))) out.push({ word });
  } else if (head === 'cp' || head === 'mv') {
    let target = args.find((a, k) => args[k - 1] === '-t' || args[k - 1] === '--target-directory');
    const long = args.find((a) => a.startsWith('--target-directory='));
    if (long) target = long.slice('--target-directory='.length);
    const pos = positionals(args, new Set(['-t', '--target-directory', '-S', '--suffix']));
    const sources = target === undefined ? pos.slice(0, -1) : pos;
    const dest = target ?? pos.at(-1);
    if (dest !== undefined) out.push({ word: dest, into: sources });
    if (head === 'mv') for (const word of sources) out.push({ word, removes: true });
  } else if (head === 'rm' || head === 'unlink') {
    for (const word of positionals(args)) out.push({ word, removes: true });
  } else if (head === 'truncate') {
    for (const word of positionals(args, new Set(['-s', '--size', '-r', '--reference']))) out.push({ word });
  }
  return out;
}

// ---- rule 6: the text a destructive pattern is matched against ----

// Commands that only read or print their arguments.
const READERS = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg']);
// Database clients: their here-documents are the statements they run.
const DB_CLIENTS = new Set(['psql', 'mysql', 'sqlite3', 'sqlcmd']);
// Commands that read a path without changing it: naming intake there is not changing it.
const MENTION_READERS = new Set(['cat', 'ls', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'find', 'stat', 'wc']);
const MESSAGE_OPTS = new Set(['-m', '-F', '--message', '--file']);

// Index of git's subcommand, past its global options.
function gitSubIndex(w) {
  let k = 1;
  while (k < w.length && w[k].startsWith('-')) k += w[k] === '-C' || GIT_GLOBAL_VALUE.has(w[k]) ? 2 : 1;
  return k;
}

// -> the segment's command text (quotes removed, their content kept) without commit messages; null to
// skip a command that only reads or prints its arguments.
function destructiveText(toks, heredocs) {
  const b = base(toks[0].v);
  if (READERS.has(b)) return null;
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
  const words = keep.map((t) => t.v);
  return (DB_CLIENTS.has(b) ? [...words, ...heredocs] : words).join(' ');
}

// `git tag` with no arguments, or in list mode, only reads.
const tagLists = (args) => args.length === 0 || args.some((a) => a === '-l' || a === '--list' || a.startsWith('--list='));

// One simple command -> invocations {kind, dir, label, ...}; `state` carries cd/pushd forward.
function walk(seg, state, acc) {
  const toks = stripPrefixes(seg.toks);
  // The directory a command runs in is judged too (rule 0d): `cd data && ls` reads data.
  if (toks.length && state.cwd !== null) acc.named.push({ word: state.cwd, dir: null, isDir: true });
  for (const n of namedWords(seg.toks, toks[0])) acc.named.push({ ...n, dir: state.cwd });
  if (!toks.length) {
    for (const word of redirectTargets(seg.toks)) acc.writes.push({ dir: state.cwd, word });
    return;
  }
  const w = toks.map((t) => t.v);
  const text = destructiveText(toks, seg.heredocs);
  if (text !== null) acc.texts.push(text);
  const head = base(w[0]);
  const why = unjudgeable(seg, toks, w, head);
  if (why && acc.unjudgeable === null) acc.unjudgeable = why;
  const host = hostRulesChange(w);
  if (host && acc.hostRules === null) acc.hostRules = host;
  for (const t of writeTargets(seg, w, head)) acc.writes.push({ ...t, dir: state.cwd });
  const ownCommit = head === 'git' && w[gitSubIndex(w)] === 'commit';
  if (state.cwd !== null && !MENTION_READERS.has(head) && !ownCommit) {
    for (const x of w.slice(1)) if (!x.startsWith('-') && !/[$`]/.test(x)) acc.mentions.push({ dir: state.cwd, word: x });
  }
  const b = base(w[0]);
  if (b === 'cd' || b === 'pushd') {
    const at = toks.findIndex((t, k) => k > 0 && (!t.v.startsWith('-') || t.v === '-'));
    const target = at === -1 ? undefined : toks[at].v;
    // Rule 0d judges where the cd goes, whether or not the directory exists yet; a target it
    // cannot resolve from the text is recorded, and refused while agents.denyPaths is set.
    const unknown = (label) => {
      if (acc.cdUnknown === null) acc.cdUnknown = label;
    };
    // An unquoted backtick ends the segment in the lexer, so the real target, the substitution's
    // output, is not among `toks`: `cd `echo data`` would otherwise read as a cd with no target.
    if (seg.subst) unknown(`${b} \`...\``);
    if (target === undefined) {
      if (b === 'cd') acc.named.push({ word: os.homedir(), dir: null, isDir: true });
      else unknown('pushd');
    } else if (target === '-' || /[$`]/.test(toks[at].x ?? target) || (target.startsWith('~') && !/^~(\/|$)/.test(target))) {
      unknown(`${b} ${target}`);
    } else {
      const t = fromGitBash((target === '~' || target.startsWith('~/') ? os.homedir() + target.slice(1) : target).replace(/\\/g, '/'));
      if (state.cwd === null && !path.isAbsolute(t)) unknown(`${b} ${target}`);
      else acc.named.push({ word: path.resolve(state.cwd ?? '', t), dir: null, isDir: true });
    }
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
    if (!prev && acc.cdUnknown === null) acc.cdUnknown = 'popd';
    state.cwd = prev ? prev.cwd : null;
    state.label = prev ? prev.label : 'popd';
    return;
  }
  if (SHELLS.has(b)) {
    const k = w.findIndex((x, idx) => idx > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
    let bodies;
    if (k !== -1 && w[k + 1] !== undefined) bodies = [w[k + 1]];
    else if (seg.heredocs.length) bodies = seg.heredocs;
    else bodies = seg.stdin ? seg.stdin.heredocs : [];
    for (const body of bodies) walkAll(lex(body), { cwd: state.cwd, label: state.label, stack: [] }, acc);
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
  // These change history without a commit of their own: only a subagent is refused them (rule 5).
  else if (sub === 'merge' || sub === 'pull' || sub === 'rebase') inv = { kind: 'history' };
  else if (sub === 'tag') inv = tagLists(args) ? { kind: 'other' } : { kind: 'history' };
  else inv = { kind: 'other' };
  acc.invs.push({ ...inv, dir, label: dir === null ? label : (label ?? dir) });
}

// -> {invs, texts, mentions, writes, unjudgeable, hostRules}: every git/gh invocation in order, each
// command's text for rule 6, the paths written (rule 0c), and the first reason for rules 0a and 0b.
// cwd null means unknown.
function parse(command, cwd) {
  const acc = { invs: [], texts: [], mentions: [], writes: [], named: [], unjudgeable: null, hostRules: null, cdUnknown: null };
  walkAll(lex(command), { cwd, label: cwd, stack: [] }, acc);
  return acc;
}

// Walks segments in order; a `cd` inside a subshell `( ... )` ends with it, so the directory is put
// back when the segments leave the parentheses.
function walkAll(segs, state, acc) {
  const saved = [];
  for (const seg of segs) {
    const depth = seg.depth ?? 0;
    while (saved.length < depth) saved.push({ cwd: state.cwd, label: state.label, stack: [...state.stack] });
    while (saved.length > depth) Object.assign(state, saved.pop());
    walk(seg, state, acc);
  }
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
const localBranch = (dir, name) => quiet(() => (git(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]), true), false);
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

// ---- rule 0c: writes to frozen tests ----

const WIN = process.platform === 'win32';
const fkey = (p) => (WIN ? p.toLowerCase() : p);
const GLOB = /[*?[]/;

// A shell glob over POSIX paths as an anchored regular expression (`*` and `?` stay in one segment;
// `[!...]` and `[^...]` are both a negated class, as Bash reads them).
function globRe(pattern) {
  const src = pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\[(?:!|\\\^)/g, '[^').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${src}$`, WIN ? 'i' : '');
}

// Whether a write {dir, word, removes?, into?} reaches the frozen file at absolute POSIX path `frozen`.
function reaches(wr, frozen) {
  const word = fromGitBash(String(wr.word).replace(/\\/g, '/'));
  if (word === '') return false;
  if (/[$`]/.test(word) || (wr.dir === null && !path.isAbsolute(word))) {
    // The directory or the name is unknown: judge by the last segment.
    const last = word.split('/').pop();
    return !/[$`]/.test(last) && (GLOB.test(last) ? globRe(last).test(path.posix.basename(frozen))
      : fkey(last) === fkey(path.posix.basename(frozen)));
  }
  const target = toPosix(path.resolve(wr.dir === null ? '' : real(wr.dir), word));
  if (GLOB.test(word)) {
    const re = globRe(target);
    return re.test(frozen) || (wr.removes === true && frozen.split('/').some((_, k, all) => re.test(all.slice(0, k).join('/'))));
  }
  const canon = toPosix(real(target));
  if (fkey(canon) === fkey(frozen)) return true;
  if (wr.removes && fkey(frozen).startsWith(`${fkey(canon)}/`)) return true;
  if (wr.into?.length && fs.existsSync(canon) && fs.statSync(canon).isDirectory()) {
    return wr.into.some((s) => fkey(`${canon}/${path.posix.basename(s.replace(/\\/g, '/'))}`) === fkey(frozen));
  }
  return false;
}

// -> {rel, id} for the first write that reaches a test frozen for the active slice of the hook's root
// or of the repository the write runs in; null for none.
function frozenWrite(root, cfg, writes) {
  if (!writes.length) return null;
  const hookTop = real(path.resolve(root));
  const frozenAt = new Map();
  const topAt = new Map();
  for (const wr of writes) {
    const tops = [hookTop];
    if (wr.dir !== null) {
      if (!topAt.has(wr.dir)) topAt.set(wr.dir, topOf(wr.dir));
      const t = topAt.get(wr.dir);
      if (t && !tops.some((x) => fkey(toPosix(x)) === fkey(toPosix(t)))) tops.push(t);
    }
    for (const top of tops) {
      if (!frozenAt.has(top)) frozenAt.set(top, frozenTests(top, cfg));
      const f = frozenAt.get(top);
      if (!f) continue;
      for (const rel of f.files) {
        if (reaches(wr, toPosix(path.join(top, rel)))) return { rel, id: f.id };
      }
    }
  }
  return null;
}

// ---- rule 0d: paths agents may not touch (REQ-3.13) ----

// Every word of a simple command that may name a path, as {word, fromTop?}: the command and its
// arguments, a redirection's target with the operator cut off, the value of `--opt=value` or
// `NAME=value`, the value a short option carries attached (`-fFILE`), and the path of a
// `<rev>:<path>` word (`fromTop` when git reads it from the repository's top); `glob` marks a word
// the shell would expand. A word holding a
// variable or a command substitution is not judged, nor the command's name when it holds no `/` (the
// shell looks that up on PATH).
function namedWords(toks, head) {
  const out = [];
  // `cd` and `pushd` read nothing; the commands after them are judged from the new directory.
  if (head && (base(head.v) === 'cd' || base(head.v) === 'pushd')) return out;
  for (const t of toks) {
    if (t === head && !/[/\\]/.test(t.v)) continue;
    if (/[$`]/.test(t.x ?? '')) continue;
    let v = t.v;
    let cut = 0;
    const op = /^\d*(<<<|>>|>\||>&|<&|&>|>|<)/.exec(v);
    if (op && t.b.startsWith(op[0])) cut = op[0].length;
    else if (/^(--[^=]+|[A-Za-z_][A-Za-z0-9_]*)=/.test(v)) cut = v.indexOf('=') + 1;
    else if (/^-[^-]./.test(v)) cut = 2;
    else if (v.startsWith('-')) continue;
    v = v.slice(cut);
    if (v === '') continue;
    const m = (t.m ?? '0'.repeat(t.v.length)).slice(cut);
    // An unquoted brace expression becomes each word it expands to; one too wide is refused.
    const variants = t.b.includes('{') && t.b.includes('}') ? expandBraces(v, m) : [v];
    if (variants === null) {
      out.push({ word: v, wide: true });
      continue;
    }
    const glob = GLOB.test(t.b);
    for (let w of variants) {
      // An unquoted `~` is the home directory; an unquoted glob character makes the word a glob.
      if ((w === '~' || w.startsWith('~/')) && t.b.includes('~')) w = os.homedir() + w.slice(1);
      out.push({ word: w, glob });
      // `<rev>:<path>`, `:<path>` and `:<stage>:<path>` (the index): git reads the path from the
      // repository's top, or from the shell's directory when it starts with `./` or `../`.
      const rev = /^[^:]*:(?:[0-3]:)?(.+)$/.exec(w);
      if (rev && !/^[A-Za-z]:[\\/]/.test(w)) {
        const p = rev[1];
        out.push({ word: p, glob, fromTop: !/^\.\.?\//.test(p) });
      }
    }
  }
  return out;
}

// The words a Bash brace expression expands to: `{a,b}` lists (nested too) and `{1..3}` or `{a..c}`
// sequences, left to right; a `{` with no top-level `,` or `..` stays literal. `mask` marks each
// character of `word` that was quoted or escaped (`1`): such a brace or comma is text, not syntax, as
// Bash reads it (brace expansion runs before quotes are removed). Null when the expansion passes `cap`
// words, so the caller refuses rather than judges a part.
export function expandBraces(word, mask = '0'.repeat(word.length), cap = 1000) {
  const out = [];
  const stack = [[word, mask]];
  while (stack.length) {
    const [w, m] = stack.pop();
    const found = firstBrace(w, m);
    if (!found) {
      out.push(w);
      if (out.length > cap) return null;
      continue;
    }
    const { start, end, parts } = found;
    for (let k = parts.length - 1; k >= 0; k--) {
      stack.push([w.slice(0, start) + parts[k][0] + w.slice(end + 1), m.slice(0, start) + parts[k][1] + m.slice(end + 1)]);
    }
    if (stack.length + out.length > cap) return null;
  }
  return out;
}

// -> {start, end, parts: [[text, mask]]} for the first brace pair in w that expands, or null. Only
// characters the mask leaves unquoted count as `{`, `,` and `}`; an unclosed `{` is skipped and a
// later one tried.
function firstBrace(w, m) {
  const syntax = (j, c) => w[j] === c && m[j] !== '1';
  for (let i = 0; i < w.length; i++) {
    if (!syntax(i, '{')) continue;
    let depth = 0;
    const commas = [];
    let end = -1;
    for (let j = i; j < w.length; j++) {
      if (syntax(j, '{')) depth += 1;
      else if (syntax(j, '}')) {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      } else if (syntax(j, ',') && depth === 1) commas.push(j);
    }
    if (end === -1) continue;
    if (commas.length) {
      const parts = [];
      let from = i + 1;
      for (const c of [...commas, end]) {
        parts.push([w.slice(from, c), m.slice(from, c)]);
        from = c + 1;
      }
      return { start: i, end, parts };
    }
    const body = w.slice(i + 1, end);
    const seq = m.slice(i + 1, end).includes('1') ? null : /^(-?\d+|[A-Za-z])\.\.(-?\d+|[A-Za-z])$/.exec(body);
    if (seq) {
      const num = /^-?\d+$/.test(seq[1]) && /^-?\d+$/.test(seq[2]);
      if (num || (!/\d/.test(seq[1]) && !/\d/.test(seq[2]))) {
        const a = num ? Number(seq[1]) : seq[1].charCodeAt(0);
        const b = num ? Number(seq[2]) : seq[2].charCodeAt(0);
        if (Math.abs(b - a) > 100000) return { start: i, end, parts: new Array(100001).fill(['', '']) };
        const parts = [];
        for (let n = a; a <= b ? n <= b : n >= b; n += a <= b ? 1 : -1) {
          const text = num ? String(n) : String.fromCharCode(n);
          parts.push([text, '0'.repeat(text.length)]);
        }
        return { start: i, end, parts };
      }
    }
    // Not an expansion: look for a later `{`, past this one.
  }
  return null;
}

// The existing paths a shell glob word expands to, segment by segment from `base` (`*`, `?` and `[...]`
// in one segment; `**` as `*`); a segment starting with `.` alone matches dot names. Null when a
// segment expands to more than `cap` entries, so the caller fails closed instead of judging a part.
function expandGlob(base, word, cap = 20000) {
  const target = toPosix(path.resolve(base, word));
  const segs = target.split('/');
  let found = [segs[0] === '' ? '/' : `${segs[0]}/`];
  for (const seg of segs.slice(1)) {
    if (seg === '') continue;
    const next = [];
    if (!GLOB.test(seg)) {
      for (const d of found) next.push(path.posix.join(d, seg));
    } else {
      const re = globRe(seg.replace(/\*\*+/g, '*'));
      for (const d of found) {
        let names = [];
        try {
          names = fs.readdirSync(d);
        } catch {
          continue;
        }
        for (const n of names) {
          if (n.startsWith('.') && !seg.startsWith('.')) continue;
          if (re.test(n)) next.push(path.posix.join(d, n));
          if (next.length > cap) return null;
        }
      }
    }
    found = next;
    if (!found.length) return [];
  }
  return found.filter((p) => fs.existsSync(p));
}

// -> {rel, pattern} for the first named word that resolves, inside the hook's root or the repository
// the word is named in, to a path matching agents.denyPaths, or to the directory a pattern names
// (`data` for `data/**`); a glob word is judged by what it expands to. Null for none.
function deniedPath(root, cfg, named) {
  const patterns = denyPaths(cfg);
  if (!patterns.length || !named.length) return null;
  const hookTop = real(path.resolve(root));
  const topAt = new Map();
  const seen = new Set();
  let dirHit = null;
  const judge = (abs, top, isDir) => {
    const rel = path.relative(top, real(abs));
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const r = toPosix(rel);
    let pattern = matchesDeny(r, patterns);
    if (pattern === null && (isDir || (fs.existsSync(abs) && fs.statSync(abs).isDirectory()))) pattern = denyDir(r, patterns);
    return pattern === null ? null : { rel: r, pattern };
  };
  for (const { dir, word, fromTop, glob, wide, isDir } of named) {
    if (wide) return { wide: word };
    const once = JSON.stringify([dir, word, fromTop, glob, isDir]);
    if (seen.has(once)) continue;
    seen.add(once);
    const p = fromGitBash(word.replace(/\\/g, '/'));
    const tops = [hookTop];
    if (dir !== null) {
      if (!topAt.has(dir)) topAt.set(dir, topOf(dir));
      const t = topAt.get(dir);
      if (t && !tops.includes(t)) tops.push(t);
    }
    for (const top of tops) {
      const base = fromTop ? top : dir === null ? null : real(dir);
      if (base === null && !path.isAbsolute(p)) continue;
      const candidates = [path.resolve(base ?? top, p)];
      if (glob && GLOB.test(p)) {
        const expanded = expandGlob(base ?? top, p);
        if (expanded === null) return { wide: p };
        candidates.push(...expanded);
      }
      for (const abs of candidates) {
        const hit = judge(abs, top, isDir);
        // A path the command names is reported before the directory it runs in.
        if (hit && !isDir) return hit;
        if (hit && dirHit === null) dirHit = hit;
      }
    }
  }
  return dirHit;
}

// ---- the hook ----

const unknownDir = (label) => deny(`cannot tell which branch ${label} is on; run the command from inside the repository`);

export function handle(input, { root, cfg }) {
  const command = input?.tool_input?.command;
  if (typeof command !== 'string') throw new Error('tool_input.command is missing');
  const start = typeof input.cwd === 'string' && input.cwd !== '' ? resolveDir(null, input.cwd) : root;
  const { invs, texts, mentions, writes, named, cdUnknown, unjudgeable: why, hostRules } = parse(command, start);
  const protectedSet = new Set(cfg.protectedBranches);

  // (0a), in every session and on every branch (D-83)
  if (why) return deny(`cannot judge this command (REQ-3.2): ${why}; run git and gh with literal arguments`);
  // (0b)
  if (hostRules) {
    return deny(`${hostRules} changes the git host's rules (REQ-3.14); a human runs it from their own terminal`);
  }
  // (0c)
  const hit = frozenWrite(root, cfg, writes);
  if (hit) {
    return deny(`${hit.rel} is frozen for ${hit.id}; a Bash command may not write it (REQ-3.3); amend the slice file to change the evaluation set`);
  }
  // (0d)
  if (cdUnknown !== null && denyPaths(cfg).length) {
    return deny(`cannot tell where ${cdUnknown} goes, so its paths cannot be judged against agents.denyPaths (REQ-3.13); cd to a literal directory`);
  }
  const named0d = deniedPath(root, cfg, named);
  if (named0d?.wide) {
    return deny(`${named0d.wide} expands too wide to judge against agents.denyPaths (REQ-3.13); name the paths or narrow the expression`);
  }
  if (named0d) {
    return deny(`the command names ${named0d.rel}, which matches agents.denyPaths pattern ${named0d.pattern}; agents may not read or change it (REQ-3.13)`);
  }

  // The branch each commit and push runs on, following checkouts earlier in the same command.
  const switched = new Map();
  for (const inv of invs) {
    if (inv.dir === null) {
      inv.branch = UNKNOWN;
      continue;
    }
    const key = topOf(inv.dir) ?? inv.dir;
    if (inv.kind === 'switch') {
      const named = inv.created || protectedSet.has(inv.to) || localBranch(inv.dir, inv.to);
      if (named) switched.set(key, inv.to);
    }
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
  if (invs.some((i) => ['commit', 'history', 'push', 'force-push', 'pr', 'api-write'].includes(i.kind))) {
    if (typeof input.agent_id === 'string' && input.agent_id !== '') {
      return deny('agents do not run git; report and let the command commit');
    }
  }
  // (6)
  const patterns = compileDestructive(cfg);
  for (let k = 0; k < patterns.length; k++) {
    if (texts.some((t) => patterns[k].test(t))) return deny(`destructive command refused by rule ${cfg.destructive[k]}`);
  }
  return allow();
}
