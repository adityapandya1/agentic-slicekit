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
// `python -c`, `perl -e`, `ruby -e`) that names git or gh; a git command with a word that is a
// prefix of a long option one of these rules reads and is not that option in full (`--forc`, `--har`,
// `--f`), since git takes an unambiguous prefix as the option and the guard does not hold every option
// of git to tell which prefix is one; (0b) a change to the host rules from the
// agent's shell: `slicekit init --protect`; a `gh api` write (a method other than GET, or a field or
// input flag without `-X GET`) to rulesets, rules or branch protection, the endpoint given as a path, as
// a full URL or under a GitHub Enterprise Server host's `api/v3` prefix, the path ending at a `?` or a
// `#`; a write to an endpoint that holds a `.` or `..` segment, which cannot be judged; a
// `gh api graphql` call whose query declares a mutation and names branch protection or a ruleset
// outside a string or a comment, and one whose query is not in the command text (`--input`,
// `-F query=@file`, no query field) or is not a document the guard reads to its end, which cannot be
// judged; (0c) a write to
// a test frozen for the active slice (REQ-3.3): by a redirection (`>`, `>>`, `>|`, `>&`, `&>`, with a
// file descriptor or without, apart from the preceding word or against it); by `tee`, `sed -i`,
// `perl -i` and `ruby -i` in their spellings (`-pi`, `-i.bak`, `-p -i`), `gawk -i inplace`, `dd of=`,
// `truncate`; by `cp`, `mv`, `install`, `rsync` and `ln` with the test as the destination or the
// link name, or as a name under a destination directory; by `rm`, `unlink` and `mv` of the test or
// of a directory holding it; by `git checkout`, `git restore`, `git rm` and `git mv` naming the
// test, a directory holding it or a pathspec that matches it, and by one of those whose paths the
// text does not name (`--pathspec-from-file`, `--patch`, a `:(...)` pathspec); by a git command that
// rewrites the work tree and names no path, which reaches every frozen test: `git checkout -f`,
// `git switch -f` or `--discard-changes`, `git reset --hard`, `git stash` other than `list`, `show`,
// `drop`, `clear`, `create` and `store`, and `git clean` other than a dry run (`git stash push --`
// and `git clean` with pathspecs are judged by those); (0d) a command naming a
// path that matches a pattern of `agents.denyPaths` (REQ-3.13): any
// argument, redirection target, option value or `<rev>:<path>` path, resolved against the shell's
// directory, a glob or brace expression by what it expands to and as the literal word (a bracket
// expression as Bash 5 reads it: quoted and escaped members, the backslash among them, `]` first, `!`
// and `^`, ranges, a range that runs backwards left out, named classes, and a collating symbol or an
// equivalence class of one character; a word with an expression the guard does not read to its end,
// such as `[[.hyphen.]]` or an unknown class name, is refused as one it cannot judge), and the
// directory a pattern starts with
// (`data` for `data/**`); a path named through a link or junction that leads into the repository is
// judged where the link leads too; the directory each command runs in and each `cd`/`pushd` target
// are judged too, a `cd` to a directory that does not exist yet is followed by its name, and while
// the list is set a `cd` it cannot resolve from the text is refused: a variable, a substitution, `-`,
// a glob or brace expression, and a `cd` in a pipeline or in the background. A `cd` inside a brace
// group that is piped on or put in the background ends at the closing brace, whatever redirections
// follow the brace (`} 2>&1 |`) and whatever word the group follows (`time`, `!`, `coproc`).
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
// `bash -c "..."`. A directory it cannot resolve makes a commit or push refuse rather than pass, and
// so does a `cd` in a pipeline or in the background before it, with or without a deny list; the
// reason names that `cd`.
// It does not expand variables, aliases, functions or encoded payloads; where git or gh is named in
// what it cannot expand, rule (0a) refuses the command. Deliberate obfuscation still gets through
// (`$G push`, a script file that runs git); the host rules are the control.
// Known gaps: `--git-dir` / `GIT_DIR` pointing at another repository are not followed (the branch is
// read from the shell's directory); a command substitution inside double quotes (`echo "$(git ...)"`)
// is not split out; `echo '...' | bash` (a piped string, not a here-document) and a shell function
// (`function f { ...; }; f`) are not followed; the default destructive list misses `rm -fr /`
// spellings and absolute paths inside the worktree; SQL read from a file (`psql -f f.sql`,
// `cat f.sql | psql`) is not matched against the destructive list.
// Known gaps of rule 0b: a host-rule write by a client other than `gh api` (`curl`, a script, an
// extension or alias of gh); a GraphQL mutation of the host's rules whose name holds neither
// `BranchProtection` nor `Ruleset`; a path with a percent-encoded character other than `%2e`
// (`rule%73ets`), which is matched as written.
// Known gaps of rule 0c, each a write to a frozen test the guard does not see: a program that names
// the test only inside its own code (`node -e "fs.writeFileSync(...)"`, `python -c`, a script file,
// an editor run with commands such as `ed`, `ex` or `vim -c`); a command given the name by another
// (`find ... -delete`, `find -exec`, `ls | xargs rm`); a writer not in the list above (`curl -o`,
// `wget -O`, `sort -o`, `patch`, `tar -x`, `unzip`, `git apply`, `git reset --merge` or `--keep`,
// `git checkout <branch>` or `git switch` without `-f` to a revision where the test differs,
// `git merge`, `git pull`, `git rebase`, `git cherry-pick`, `git revert`, `git am`, and a forced
// checkout or a stash run through a git alias); a write through a symbolic link the same
// command makes first (`ln -s test/a.test.js l && echo x > l`; a link that exists when the command is
// judged is resolved) or through a hard link; `perl -i` switched on by `PERL5OPT` or by the script's
// `#!` line; a name built from a variable, of which only the last segment is compared.
// Known gaps of rule 0d: a `cd` inside an `if`, `while`, `until`, `for` or `case` command that is
// piped or put in the background (`while read f; do cd src; done | cat`) is taken to last, as is
// one in a shell function's body; `CDPATH` is not read; a link to a listed directory that the
// same command makes under a name built from a variable is not seen; a glob read under a shell option
// the command text does not show (`extglob`, `nocaseglob`, `globasciiranges` turned off in a profile)
// or by a shell that orders a range by the locale (a Bash older than 5); a named class and an
// equivalence class in a word are read as their ASCII members and every character outside ASCII, so
// they can refuse a word that names no listed path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileDestructive } from '../config.js';
import { git, GitError, currentBranch } from '../git.js';
import { kitPaths } from '../paths.js';
import { allow, deny } from './io.js';
import { BACKSLASH_MEMBER, classSrc, denyDir, denyPaths, frozenTests, fromGitBash, leaves, matchesDeny, namesUnder, real, readBracket, toPosix } from './paths.js';

// ---- tokenising ----

// Unquoted, each of these ends a command: && || ; | & newline, subshell parens and backticks.
const SEPARATORS = new Set([';', '\n', '|', '&', '(', ')', '`']);
const DELIM_END = /[\s;&|()<>`]/;

// -> [{toks: [{v, b, x}], heredocs: [string], stdin?, subst?}]: one entry per simple command. `v` is the
// word with quotes removed; `b` is only its unquoted characters; `x` is the characters the shell expands
// (`v` without single-quoted or backslash-escaped text). Here-document bodies are data, attached to the
// command that opened them; `stdin` is the command piped into this one; `subst` marks a command that
// an unquoted backtick substitution interrupts (its output becomes this command's next argument);
// `depth` counts the subshell parentheses a command sits in and `tick` says it sits in a backtick
// substitution; `piped` marks a command whose output is piped on and `background` one ended by `&`;
// `of` is the command a segment continues, when the `&` of a redirection (`2>&1`, `&>f`) split it off.
function lex(command) {
  const s = String(command);
  const out = [];
  // `depth` counts the unquoted subshell parentheses a segment sits in.
  let depth = 0;
  let cur = { toks: [], heredocs: [], depth, tick: false };
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
    cur = { toks: [], heredocs: [], depth, tick: tickOpen };
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
      // The `&` of `>&`, `<&` and `&>` is part of a redirection, not the end of the command: the
      // words after it still belong to the command the redirection is on, so that command, `of`,
      // is the one a later `|` pipes on or a later `&` puts in the background (verdict P6-S-52-r2 H-2).
      const redirects = c === '&' && ((word !== null && word === bare && !mask.includes('1') && /^\d*[<>]$/.test(word))
        || (s[i + 1] === '>' && s[i - 1] !== '&'));
      const ended = endSegment();
      if (redirects) cur.of = ended.of ?? ended;
      // `|&` pipes as `|` does: the command after it reads the one before it.
      if (c === '&' && s[i - 1] === '|' && !ended.toks.length && ended.stdin !== undefined) cur.stdin = ended.stdin;
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
      else if (c === '|') {
        cur.stdin = ended;
        ended.piped = true;
        if (ended.of) ended.of.piped = true;
      } else if (c === '&' && s[i + 1] !== '&' && s[i + 1] !== '>' && !'&|<>'.includes(s[i - 1] ?? ' ')) {
        // A lone `&` puts the command in the background; `&&`, `|&`, `&>` and `>&` are not that.
        ended.background = true;
        if (ended.of) ended.of.background = true;
      }
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
    } else if (c === '>' && s[i + 1] === '|') {
      // `>|` is one redirection operator (it overwrites under noclobber), not a redirect and a pipe:
      // `x>|f` is the word `x` and the redirect `>|f`; `1>|f` stays one word.
      if (word !== null && !(word === bare && /^\d*$/.test(word))) endWord();
      add('>|', false);
      i += 2;
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
    const m = /^\d*(<<<|>\||>>?|<|>&|<&|&>)(.*)$/.exec(toks[k].b === toks[k].v ? toks[k].v : '');
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
// With `byName`, a target that does not exist yet is the path its name gives, since the command may
// create it first (`mkdir x && cd x`, issue #118); git is still not asked about such a directory
// (`dirExists`), so a commit or push from it refuses as before.
function resolveDir(from, target, byName = false) {
  if (/[$`]/.test(target)) return null;
  let t = target;
  if (t === '~' || t.startsWith('~/')) t = path.join(os.homedir(), t.slice(1));
  else if (t.startsWith('~')) return null;
  t = fromGitBash(t);
  if (from === null && !path.isAbsolute(t)) return null;
  const abs = path.resolve(from ?? '', t);
  try {
    return fs.statSync(abs).isDirectory() ? abs : null;
  } catch (e) {
    return byName && e?.code === 'ENOENT' ? abs : null;
  }
}

const dirExists = (dir) => {
  try {
    return dir !== null && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

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

// The long options this guard reads, per git subcommand: `flags` stand alone, `valued` take a value
// (the next word, or after `=`), and `short` holds the short options whose value is the next word.
// A rule that compares an option's name compares it whole, and git accepts any unambiguous prefix of
// a long option (`--forc`, `--har`), so `cutOption` reads each long option against this list.
const GIT_LONG = {
  push: {
    flags: ['--force', '--force-with-lease', '--force-if-includes', '--all', '--mirror', '--branches', '--delete'],
    valued: ['--push-option', '--repo', '--receive-pack', '--exec'],
    short: 'o',
  },
  commit: {
    flags: ['--all', '--include'],
    valued: ['--message', '--file', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--author', '--date', '--cleanup',
      '--template', '--trailer', '--pathspec-from-file'],
    short: 'mFcCt',
  },
  add: { flags: ['--all', '--update'], valued: ['--pathspec-from-file'], short: '' },
  rm: { flags: ['--cached'], valued: ['--pathspec-from-file'], short: '' },
  checkout: {
    flags: ['--force', '--patch', '--ours', '--theirs', '--merge', '--track', '--detach'],
    valued: ['--pathspec-from-file', '--orphan', '--conflict', '--unified', '--inter-hunk-context'],
    short: 'bBU',
  },
  switch: {
    flags: ['--force', '--discard-changes', '--track', '--detach', '--merge'],
    valued: ['--create', '--force-create', '--orphan', '--conflict'],
    short: 'cC',
  },
  restore: {
    flags: ['--staged', '--worktree', '--patch', '--ours', '--theirs', '--merge'],
    valued: ['--source', '--pathspec-from-file', '--conflict', '--unified', '--inter-hunk-context'],
    short: 'sU',
  },
  reset: { flags: ['--hard'], valued: [], short: '' },
  clean: { flags: ['--dry-run'], valued: ['--exclude'], short: 'e' },
  tag: { flags: ['--list'], valued: ['--message', '--file', '--local-user'], short: 'mFu' },
};
GIT_LONG.stage = GIT_LONG.add;

// -> {cut, full} for the first long option of `git <sub>` that is not one of the list in full and is
// a prefix of one of them (`--forc` of `--force`), or null. Git would read such a word as that option
// when no other option of the subcommand starts the same way, which this list cannot tell; the guard
// does not guess, and the caller refuses the command as one it cannot judge (verdict P6-S-52-r2 H-8).
// A prefix of several options (`--f`) is refused the same way, naming the first: git itself refuses
// an ambiguous one, so nothing git would run is lost. A word after `--`, and the value of an option
// that takes one, is not an option.
function cutOption(sub, args) {
  const spec = Object.hasOwn(GIT_LONG, sub ?? '') ? GIT_LONG[sub] : null;
  if (spec === null) return null;
  const all = [...spec.flags, ...spec.valued];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--') return null;
    if (a.startsWith('--')) {
      const name = a.split('=')[0];
      if (all.includes(name)) {
        if (spec.valued.includes(name) && !a.includes('=')) k += 1;
        continue;
      }
      const full = all.find((o) => o.startsWith(name));
      if (full !== undefined) return { cut: name, full };
    } else if (/^-[A-Za-z]+$/.test(a) && spec.short.includes(a.at(-1))) {
      k += 1;
    }
  }
  return null;
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
// `fields` holds each body flag with its value, `{flag, value}`: `-f query=...`, `--input body.json`.
function parseGhApi(w, k) {
  let method = null;
  let endpoint = null;
  const fields = [];
  for (let j = k; j < w.length; j++) {
    const a = w[j];
    const name = a.startsWith('--') ? a.split('=')[0] : a.slice(0, 2);
    if (a === '-X' || a === '--method') {
      if (w[j + 1] !== undefined) method = w[j + 1];
      j += 1;
    } else if (a.startsWith('--method=')) {
      method = a.slice('--method='.length);
    } else if (/^-X./.test(a)) {
      method = a.slice(2);
    } else if (GH_API_BODY.has(a)) {
      fields.push({ flag: a, value: w[j + 1] ?? '' });
      j += 1;
    } else if (GH_API_BODY.has(name)) {
      fields.push({ flag: name, value: a.slice(name.length).replace(/^=/, '') });
    } else if (GH_API_VALUE.has(a)) {
      j += 1;
    } else if (!a.startsWith('-') && endpoint === null) {
      endpoint = a;
    }
  }
  return { method: (method ?? (fields.length ? 'POST' : 'GET')).toUpperCase(), endpoint, fields };
}

// A repository's (or organisation's) rulesets and rules, or a branch's protection.
const HOST_RULES_PATH = /^\/?(?:(?:repos\/[^/]+\/[^/]+|orgs\/[^/]+|enterprises\/[^/]+)\/(?:rulesets|rules)|repos\/[^/]+\/[^/]+\/branches\/.+\/protection)(?:[/?]|$)/;

// The path of a `gh api` endpoint: a full URL without its scheme and host, a GitHub Enterprise Server
// path without its `api/v3` prefix, repeated slashes as one. `gh api` takes a URL where it takes a
// path, so both name the same resource (issue #104). A query string and a fragment are not part of
// the path the request names, so the path ends at the first `?` or `#` (verdict P6-S-52-r1 H-3).
function apiPath(endpoint) {
  return endpoint
    .replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/, '')
    .replace(/[?#].*$/s, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/?api\/v3(?=\/|$)/i, '')
    .replace(/^\//, '');
}

// Whether a path holds a `.` or `..` segment, written out or with `%2e`. Whether gh or the host
// resolves one is not known from the text, so `issues/../rulesets/1` may name a ruleset or not.
const dotSegment = (p) => p.replace(/%2e/gi, '.').split('/').some((s) => s === '.' || s === '..');
// The same path with each `.` segment dropped and each `..` segment taking the one before it.
function withoutDots(p) {
  const out = [];
  for (const s of p.replace(/%2e/gi, '.').split('/')) {
    if (s === '..') out.pop();
    else if (s !== '.') out.push(s);
  }
  return out.join('/');
}

// The GraphQL endpoint: `graphql`, or `api/graphql` on a GitHub Enterprise Server host.
const GRAPHQL_PATH = /^(?:api\/)?graphql\/?$/i;
// A GraphQL name that belongs to branch protection or to a ruleset: `deleteBranchProtectionRule`,
// `updateRepositoryRuleset`, and any later mutation named the same way.
const RULE_NAME = /[A-Za-z0-9_]*(?:BranchProtection|Ruleset)[A-Za-z0-9_]*/i;

// A GraphQL document -> {ops, plain}: the kind of each definition it declares (`query`, `mutation`,
// `subscription`, `fragment`; a bare selection set is a query) and its text with strings and comments
// taken out, so a name is read only where it is a name. Null when the text is not a document this
// reads to its end: a string or a selection set left open, a definition that starts with another
// word, or no definition (verdict P6-S-52-r1 H-4).
function graphqlDoc(text) {
  let plain = '';
  for (let i = 0; i < text.length;) {
    if (text.startsWith('"""', i)) {
      let e = text.indexOf('"""', i + 3);
      while (e !== -1 && text[e - 1] === '\\') e = text.indexOf('"""', e + 3);
      if (e === -1) return null;
      plain += ' ';
      i = e + 3;
    } else if (text[i] === '"') {
      let e = i + 1;
      // A line terminator ends a string that is not a block string, closed or not.
      while (e < text.length && text[e] !== '"' && text[e] !== '\n' && text[e] !== '\r') e += text[e] === '\\' ? 2 : 1;
      if (text[e] !== '"') return null;
      plain += ' ';
      i = e + 1;
    } else if (text[i] === '#') {
      // A comment ends at a line terminator, which the GraphQL specification gives as a line feed, a
      // carriage return, or a carriage return and a line feed (verdict P6-S-52-r2 H-7).
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i += 1;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  const ops = [];
  let k = 0;
  for (;;) {
    while (k < plain.length && /[\s,﻿]/.test(plain[k])) k += 1;
    if (k >= plain.length) break;
    let kind = 'query';
    if (plain[k] !== '{') {
      const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(plain.slice(k));
      if (!word || !['query', 'mutation', 'subscription', 'fragment'].includes(word[0])) return null;
      kind = word[0];
      k += kind.length;
      // The name, the variables and the directives, up to the selection set.
      for (let paren = 0; k < plain.length && !(plain[k] === '{' && paren === 0); k++) {
        if (plain[k] === '(') paren += 1;
        else if (plain[k] === ')') paren -= 1;
        else if (plain[k] === '}' && paren === 0) return null;
      }
      if (k >= plain.length) return null;
    }
    let depth = 0;
    for (; k < plain.length; k++) {
      if (plain[k] === '{') depth += 1;
      else if (plain[k] === '}' && --depth === 0) break;
    }
    if (k >= plain.length) return null;
    k += 1;
    ops.push(kind);
  }
  return ops.length ? { ops, plain } : null;
}

// A `gh api graphql` call (issue #103) -> {change} when its query declares a mutation and names branch
// protection or a ruleset outside a string or a comment; {unjudged} when the query is not in the
// command text (`--input`, a typed field read from a file, or no query field) or is not a document
// `graphqlDoc` reads; null when every query it holds is free of both.
function graphqlRules(fields) {
  const input = fields.find((f) => f.flag === '--input');
  if (input) return { unjudged: `gh api graphql reads its request from ${input.value || 'its input'}` };
  const queries = fields.filter((f) => /^query=/.test(f.value));
  if (!queries.length) return { unjudged: 'gh api graphql names no query' };
  for (const q of queries) {
    const text = q.value.slice('query='.length);
    // Only a typed field (`-F`, `--field`) reads `@file`; a raw field sends the text as it is.
    if ((q.flag === '-F' || q.flag === '--field') && text.startsWith('@')) {
      return { unjudged: `gh api graphql reads its query from ${text.slice(1) === '-' ? 'standard input' : text.slice(1)}` };
    }
    const doc = graphqlDoc(text);
    if (doc === null) return { unjudged: 'the query of gh api graphql is not a GraphQL document the guard can read to its end' };
    // A document that declares a mutation may run it; the name may stand in a fragment it spreads.
    const name = doc.ops.includes('mutation') ? RULE_NAME.exec(doc.plain) : null;
    if (name) return { change: `gh api graphql mutation ${name[0]}` };
  }
  return null;
}

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

// -> {change}, a description of a write to the host's rules (REQ-3.14); {unjudged}, why a call that
// may be one cannot be judged; or null.
function hostRulesChange(w) {
  const head = base(w[0]);
  if (head === 'gh') {
    const { group, k } = ghGroup(w);
    if (group !== 'api') return null;
    const { method, endpoint, fields } = parseGhApi(w, k);
    if (endpoint === null) return null;
    const p = apiPath(endpoint);
    // A write, or a call that may be a GraphQL one, to a path with a dot segment is not judged.
    if (dotSegment(p) && (method !== 'GET' || GRAPHQL_PATH.test(withoutDots(p)) || GRAPHQL_PATH.test(p.split('/').pop()))) {
      return {
        unjudged: `the endpoint ${endpoint} holds a . or .. segment`,
        fix: 'write the endpoint without it',
      };
    }
    // A GraphQL call is judged by its query, whatever method it names.
    if (GRAPHQL_PATH.test(p)) return graphqlRules(fields);
    return method !== 'GET' && HOST_RULES_PATH.test(p) ? { change: `gh api ${method} ${endpoint}` } : null;
  }
  const i = w.findIndex((x, idx) => idx <= 3 && /^slicekit(\.[cm]?js)?$/.test(base(x)));
  if (i === -1) return null;
  const rest = w.slice(i + 1);
  return rest.includes('init') && rest.some((a) => a === '--protect' || a.startsWith('--protect='))
    ? { change: 'slicekit init --protect' }
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

// Commands that copy or link their leading arguments to the last one, as `cp` does, with the options
// of each that take a separate value.
const COPIERS = {
  cp: ['-t', '--target-directory', '-S', '--suffix'],
  mv: ['-t', '--target-directory', '-S', '--suffix'],
  install: ['-t', '--target-directory', '-S', '--suffix', '-m', '--mode', '-o', '--owner', '-g', '--group', '--strip-program'],
  ln: ['-t', '--target-directory', '-S', '--suffix'],
  rsync: ['-e', '--rsh', '-f', '--filter', '-B', '--block-size', '-T', '--temp-dir', '-M', '--remote-option'],
};

// Whether perl or ruby edits its file arguments in place: `-i`, `-i.bak`, `-pi`, `-ni`, in any option
// before the code or the script. An option letter that takes the rest of its word as a value ends the
// word (`-Mi` loads module `i`), and `-e` and `-E` take the next word when nothing follows them.
// -> the file arguments, or null when the command does not edit in place.
function inPlaceFiles(args) {
  let inPlace = false;
  let k = 0;
  for (; k < args.length; k++) {
    const a = args[k];
    if (a === '--') {
      k += 1;
      break;
    }
    if (!a.startsWith('-') || a === '-') break;
    if (a.startsWith('--')) continue;
    for (let j = 1; j < a.length; j++) {
      const c = a[j];
      if (c === 'i') {
        inPlace = true;
        break;
      }
      if ('eEIr'.includes(c)) {
        if (j === a.length - 1) k += 1;
        break;
      }
      // `-0[digits]` and `-l[digits]` take only digits; more option letters may follow them.
      if (c === '0' || c === 'l') {
        while (/[0-7]/.test(a[j + 1] ?? '') || (c === '0' && /[0-9A-Fa-fx]/.test(a[j + 1] ?? ''))) j += 1;
        continue;
      }
      if ('MmFxCdDV'.includes(c)) break;
    }
  }
  if (!inPlace) return null;
  // Without `-e` the first argument is the script; it is counted too, which can only refuse more.
  return args.slice(k).filter((a) => !a.startsWith('-') || a === '-');
}

// `git checkout`, `git restore`, `git rm` and `git mv` (issue #105) -> the paths the command writes in
// the work tree, each resolved in the directory `-C` names. A path covers what lies under it, and git
// matches `*` across directories. A pathspec the text does not settle (`:(glob)...`, `:/`,
// `--pathspec-from-file`, `--patch`) is `any`: it may reach every file.
function gitWrites(w, cwd) {
  let dir = cwd;
  let k = 1;
  while (k < w.length && w[k].startsWith('-')) {
    if (w[k] === '-C' && w[k + 1] !== undefined) dir = resolveDir(dir, w[k + 1]);
    k += w[k] === '-C' || GIT_GLOBAL_VALUE.has(w[k]) ? 2 : 1;
  }
  const sub = w[k];
  const args = w.slice(k + 1);
  const has = (...names) => args.some((a) => names.includes(a.split('=')[0]));
  const short = (letter) => args.some((a) => /^-[A-Za-z]+$/.test(a) && a.includes(letter));
  // A `--no-<option>` may take back the option that spares the work tree (`--staged --no-staged`,
  // `--dry-run --no-dry-run`); with one in the command, no option is read as sparing it.
  const negates = args.some((a) => a.startsWith('--no-'));
  // The forms that rewrite the work tree and name no path reach every file (verdict P6-S-52-r1 H-6):
  // a forced checkout or switch throws away each local change, `git reset --hard` does too, `git stash`
  // takes the changes away or puts them back, and `git clean` removes what is not tracked.
  const every = [{ word: `${sub}`, any: true, dir }];
  const specs = (words) => words.map((word) => (word.startsWith(':') ? { word, any: true, dir } : { word, removes: true, pathspec: true, dir }));
  if (sub === 'switch') return has('--force', '--discard-changes') || short('f') ? every : [];
  if (sub === 'reset') return has('--hard') ? every : [];
  if (sub === 'stash') {
    const sep = args.indexOf('--');
    const verb = (sep === -1 ? args : args.slice(0, sep)).find((a) => !a.startsWith('-'));
    if (['list', 'show', 'drop', 'clear', 'create', 'store'].includes(verb)) return [];
    // `git stash [push] -- <pathspec>` takes away only what the pathspec names.
    return (verb === 'push' || verb === undefined) && sep !== -1 && args.length > sep + 1 ? specs(args.slice(sep + 1)) : every;
  }
  if (sub === 'clean') {
    // A dry run removes nothing, with `-f` or without.
    if ((has('--dry-run') || short('n')) && !negates) return [];
    const named = positionals(args, new Set(['-e', '--exclude']));
    return named.length ? specs(named) : every;
  }
  if (sub === 'checkout' && (has('--force') || short('f'))) return every;
  if (!['checkout', 'restore', 'rm', 'mv'].includes(sub)) return [];
  // `git restore --staged` alone writes the index, and `git rm --cached` only that.
  if (sub === 'restore' && (has('--staged') || short('S')) && !negates && !(has('--worktree') || short('W'))) return [];
  if (sub === 'rm' && has('--cached') && !negates) return [];
  const VALUED = {
    checkout: ['-b', '-B', '--orphan', '--conflict', '-U', '--unified', '--inter-hunk-context', '--pathspec-from-file'],
    restore: ['-s', '--source', '--conflict', '-U', '--unified', '--inter-hunk-context', '--pathspec-from-file'],
    rm: ['--pathspec-from-file'],
    mv: [],
  };
  const out = [];
  if (has('--pathspec-from-file') || (sub !== 'mv' && sub !== 'rm' && (has('--patch') || short('p')))) out.push({ word: sub, any: true, dir });
  const pos = positionals(args, new Set(VALUED[sub]));
  if (sub === 'mv') {
    if (pos.length > 1) out.push({ word: pos.at(-1), into: pos.slice(0, -1), dir });
    for (const word of pos.slice(0, -1)) out.push({ word, removes: true, dir });
    return out;
  }
  for (const word of pos) {
    if (word.startsWith(':')) out.push({ word, any: true, dir });
    else out.push({ word, removes: true, pathspec: true, dir });
  }
  return out;
}

// What the shell expands a write's word to when a member of a bracket expression in it was quoted or
// escaped (`rm test/[a\]].test.js`): {pattern}, the word as `literalMembers` writes it, or {any} when
// an expression in it is not read. The word is the end of one of the command's tokens, whose mask
// says what was quoted. A git pathspec is not read here: git, not the shell, matches it, as written.
function writePattern(toks, wr) {
  if (wr.any || wr.pathspec || typeof wr.word !== 'string' || !GLOB.test(wr.word)) return {};
  for (const t of toks) {
    if (typeof t.m !== 'string' || !t.m.includes('1') || !t.v.endsWith(wr.word)) continue;
    const [pattern, , unread] = literalMembers(wr.word, t.m.slice(t.v.length - wr.word.length));
    if (unread) return { any: true };
    if (pattern !== wr.word) return { pattern };
  }
  return {};
}

// -> [{word, removes?, into?, any?, pathspec?, dir?}]: the paths a simple command writes. `removes`
// also covers a directory holding the file; `into` lists source names for a destination that may be a
// directory; `any` is a write whose paths the text does not name; `pathspec` is a git pathspec; `dir`
// is the directory the path is named in when it is not the shell's (`cwd`).
function writeTargets(seg, w, head, cwd) {
  const out = redirectTargets(seg.toks).map((word) => ({ word }));
  const args = w.slice(1);
  if (head === 'tee') {
    for (const word of positionals(args)) out.push({ word });
  } else if (head === 'sed' && args.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith('--in-place'))) {
    for (const word of positionals(args, new Set(['-e', '-f', '--expression', '--file', '-l', '--line-length']))) out.push({ word });
  } else if (head === 'perl' || head === 'ruby') {
    for (const word of inPlaceFiles(args) ?? []) out.push({ word });
  } else if (/^g?awk$/.test(head) && args.some((a, k) => /^(-i|--include)$/.test(a) ? args[k + 1] === 'inplace' : /^(-i|--include=)inplace$/.test(a))) {
    for (const word of positionals(args, new Set(['-i', '--include', '-f', '--file', '-v', '--assign', '-F', '--field-separator']))) out.push({ word });
  } else if (head === 'dd') {
    for (const a of args) if (a.startsWith('of=')) out.push({ word: a.slice('of='.length) });
  } else if (COPIERS[head]) {
    let target = args.find((a, k) => args[k - 1] === '-t' || args[k - 1] === '--target-directory');
    const long = args.find((a) => a.startsWith('--target-directory='));
    if (long) target = long.slice('--target-directory='.length);
    const pos = positionals(args, new Set(COPIERS[head]));
    // `ln <target>` with one name makes the link in the shell's directory under the target's name.
    const single = head === 'ln' && target === undefined && pos.length === 1;
    const sources = target === undefined && !single ? pos.slice(0, -1) : pos;
    const dest = single ? '.' : target ?? pos.at(-1);
    if (dest !== undefined) out.push({ word: dest, into: sources });
    if (head === 'mv') for (const word of sources) out.push({ word, removes: true });
  } else if (head === 'rm' || head === 'unlink') {
    for (const word of positionals(args)) out.push({ word, removes: true });
  } else if (head === 'truncate') {
    for (const word of positionals(args, new Set(['-s', '--size', '-r', '--reference']))) out.push({ word });
  } else if (head === 'git') {
    out.push(...gitWrites(w, cwd));
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
  for (const n of namedWords(seg.toks, toks[0])) acc.named.push({ ...n, dir: state.cwd, globstar: !!state.globstar });
  if (!toks.length) {
    for (const word of redirectTargets(seg.toks)) acc.writes.push({ dir: state.cwd, word, ...writePattern(seg.toks, { word }) });
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
  for (const t of writeTargets(seg, w, head, state.cwd)) acc.writes.push({ ...t, ...writePattern(seg.toks, t), dir: t.dir === undefined ? state.cwd : t.dir });
  const ownCommit = head === 'git' && w[gitSubIndex(w)] === 'commit';
  if (state.cwd !== null && !MENTION_READERS.has(head) && !ownCommit) {
    for (const x of w.slice(1)) if (!x.startsWith('-') && !/[$`]/.test(x)) acc.mentions.push({ dir: state.cwd, word: x });
  }
  const b = base(w[0]);
  // `shopt -s globstar` makes a later `**` recursive, `shopt -u globstar` ends it; a subshell's
  // setting ends with it.
  if (b === 'shopt') {
    const flags = w.slice(1).filter((x) => /^-[a-z]+$/.test(x)).join('');
    const set = flags.includes('s') ? true : flags.includes('u') ? false : null;
    if (set !== null && w.slice(1).includes('globstar')) state.globstar = set;
    return;
  }
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
    // A command of a pipeline, and one put in the background, runs in a subshell in Bash, so its cd
    // ends there; zsh runs a pipeline's last command in the shell itself. The text does not say which
    // shell reads it, so where the later commands run cannot be told.
    const detached = seg.piped === true || seg.stdin !== undefined || seg.background === true;
    // The shell expands an unquoted glob or brace expression before cd sees it: what the directory
    // is depends on the files there (issue #118).
    const expands = target !== undefined && (GLOB.test(toks[at].b)
      || (toks[at].b.includes('{') && (expandBraces(target, toks[at].m ?? '0'.repeat(target.length)) ?? []).join(' ') !== target));
    const shown = `${b}${target === undefined ? '' : ` ${target}`}`;
    if (detached) unknown(`${shown} in a pipeline or in the background`);
    if (target === undefined) {
      if (b === 'cd') acc.named.push({ word: os.homedir(), dir: null, isDir: true });
      else unknown('pushd');
    } else if (expands || target === '-' || /[$`]/.test(toks[at].x ?? target) || (target.startsWith('~') && !/^~(\/|$)/.test(target))) {
      unknown(`${b} ${target}`);
    } else {
      const t = fromGitBash((target === '~' || target.startsWith('~/') ? os.homedir() + target.slice(1) : target).replace(/\\/g, '/'));
      if (state.cwd === null && !path.isAbsolute(t)) unknown(`${b} ${target}`);
      else acc.named.push({ word: path.resolve(state.cwd ?? '', t), dir: null, isDir: true });
    }
    if (b === 'pushd') state.stack.push({ cwd: state.cwd, label: state.label, why: state.why });
    state.why = undefined;
    if (target === undefined) {
      state.cwd = b === 'cd' ? os.homedir() : null;
      state.label = b === 'cd' ? '~' : 'pushd';
    } else if (target === '-' || expands) {
      state.cwd = null;
      state.label = target;
    } else {
      state.cwd = resolveDir(state.cwd, target, true);
      state.label = target;
    }
    if (detached) {
      state.cwd = null;
      // The reason a later commit or push is refused names the cause (verdict P6-S-52-r1 H-5).
      state.why = seg.background === true
        ? `${shown} is put in the background with &, so the guard does not follow it`
        : `${shown} is part of a pipeline, so the guard does not follow it`;
    }
    return;
  }
  if (b === 'popd') {
    const prev = state.stack.pop();
    if (!prev && acc.cdUnknown === null) acc.cdUnknown = 'popd';
    state.cwd = prev ? prev.cwd : null;
    state.label = prev ? prev.label : 'popd';
    state.why = prev ? prev.why : undefined;
    return;
  }
  if (SHELLS.has(b)) {
    const k = w.findIndex((x, idx) => idx > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
    let bodies;
    if (k !== -1 && w[k + 1] !== undefined) bodies = [w[k + 1]];
    else if (seg.heredocs.length) bodies = seg.heredocs;
    else bodies = seg.stdin ? seg.stdin.heredocs : [];
    // A new shell starts with globstar off, unless its own options turn it on: `-O globstar`,
    // `-Oglobstar`; `+O globstar` turns it off; the last one before the body wins.
    let globstar = false;
    for (let j = 1; j < (k === -1 ? w.length : k); j++) {
      const opt = /^([-+])O(.*)$/.exec(w[j]);
      if (!opt) continue;
      const name = opt[2] === '' ? w[++j] : opt[2];
      if (name === 'globstar') globstar = opt[1] === '-';
    }
    for (const body of bodies) walkAll(lex(body), { cwd: state.cwd, label: state.label, stack: [], globstar }, acc);
    return;
  }
  if (b === 'gh') {
    const kind = classifyGh(w);
    if (kind) acc.invs.push({ kind, dir: state.cwd, label: state.label });
    return;
  }
  if (b !== 'git') return;
  let dir = dirExists(state.cwd) ? state.cwd : null;
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
  const cut = cutOption(sub, args);
  if (cut && acc.unjudgeable === null) {
    acc.unjudgeable = `git ${sub} ${cut.cut} may be ${cut.full} cut short, which git accepts when no other option starts the same way`;
    acc.fix = `write ${cut.full} in full`;
  }
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
  acc.invs.push({ ...inv, dir, label: dir === null ? label : (label ?? dir), why: dir === null ? state.why : undefined });
}

// -> {invs, texts, mentions, writes, unjudgeable, hostRules}: every git/gh invocation in order, each
// command's text for rule 6, the paths written (rule 0c), and the first reason for rules 0a and 0b.
// cwd null means unknown.
function parse(command, cwd) {
  const acc = { invs: [], texts: [], mentions: [], writes: [], named: [], unjudgeable: null, fix: undefined, hostRules: null, cdUnknown: null };
  walkAll(lex(command), { cwd, label: cwd, stack: [] }, acc);
  return acc;
}

// Walks segments in order; a `cd` inside a subshell `( ... )` or a backtick substitution ends with
// it, so the directory is put back when the segments leave the parentheses or pass the closing
// backtick (issue #121). A brace group `{ ...; }` that is piped on or put in the background runs in a
// subshell too, so its `cd` ends at the closing brace (verdict P6-S-52-r1 H-2); one that ends a
// pipeline runs in a subshell in Bash and in the shell itself in zsh, so after a `cd` in it the
// directory is unknown, as it is after a `cd` that ends a pipeline.
//
// Where a group opens and ends is read from the shell grammar (verdict P6-S-52-r2 H-2). `{` opens a
// group where a command may start: first in a command, or after the words that may come before one
// there (`!`, `time` and its `-p`, `if`, `then`, `elif`, `else`, `do`, `while`, `until`, another `{`,
// `coproc` and its name, `function` and its name). `}` first in a command closes the group, and the
// command it ends runs on through the redirections after the brace to the operator that ends it: the
// lexer marks that command `piped` or `background` whatever redirections stand between (`} 2>&1 |`,
// `} &>f &`). A `coproc` group always runs in a subshell. A `}` that closes no group read here means
// the text was not read as the shell reads it, so where a `cd` before it lasts is not known.
function walkAll(segs, state, acc) {
  const snapshot = () => ({ cwd: state.cwd, label: state.label, why: state.why, stack: [...state.stack], globstar: state.globstar });
  const plain = (t) => t !== undefined && t.v === t.b && !t.m?.includes('1');
  const bare = (t, word) => plain(t) && t.v === word;
  const saved = [];
  const groups = [];
  for (const seg of segs) {
    const depth = (seg.depth ?? 0) + (seg.tick ? 1 : 0);
    while (saved.length < depth) saved.push(snapshot());
    while (saved.length > depth) Object.assign(state, saved.pop());
    let coproc = false;
    for (let k = 0; k < seg.toks.length; k++) {
      const t = seg.toks[k];
      if (!plain(t)) break;
      if (t.v === '{') {
        groups.push({ ...snapshot(), tail: seg.stdin !== undefined, detached: coproc });
        coproc = false;
      } else if (t.v === 'time') {
        while (bare(seg.toks[k + 1], '-p') || bare(seg.toks[k + 1], '--')) k += 1;
      } else if (t.v === 'coproc') {
        coproc = true;
        if (!bare(seg.toks[k + 1], '{') && bare(seg.toks[k + 2], '{')) k += 1;
      } else if (t.v === 'function') {
        k += 1;
      } else if (!KEYWORDS.has(t.v)) break;
    }
    const closes = bare(seg.toks[0], '}');
    const group = closes ? groups.pop() : undefined;
    if (closes && !group && acc.cdUnknown === null) acc.cdUnknown = 'a cd in a brace group whose opening brace the guard did not read';
    const detached = seg.piped === true || seg.background === true || group?.detached === true;
    // A redirection on the closing brace of such a group is judged from the directory outside it.
    if (group && detached) {
      const { tail, detached: always, ...before } = group;
      Object.assign(state, before);
    }
    walk(seg, state, acc);
    if (group?.tail && !detached && state.cwd !== group.cwd) {
      if (acc.cdUnknown === null) acc.cdUnknown = 'a cd in a brace group that ends a pipeline';
      state.cwd = null;
      state.why = 'a cd in a brace group that ends a pipeline lasts in zsh and not in Bash, so the guard does not follow it';
    }
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
    return rel === '' || !leaves(rel);
  });
}

function frozenIntake(root, cfg, invs, mentions) {
  const intakeAbs = kitPaths(real(root), cfg).intake;
  for (const c of invs.filter((i) => i.kind === 'commit' && !i.replay && i.dir !== null)) {
    const top = topOf(c.dir);
    if (!top) continue;
    if (!quiet(() => (git(top, ['rev-parse', '--verify', 'HEAD']), true), false)) continue;
    const intake = toPosix(path.relative(top, intakeAbs));
    if (leaves(intake)) continue;
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
// `[!...]` and `[^...]` are both a negated class, as Bash reads them; a `[` nothing closes is itself).
// Each bracket expression is read by `readBracket`, as Bash reads one. A range that runs backwards
// (`[z-a]`) is left out of its expression, as Bash leaves it out: alone it matches nothing, so Bash
// passes the word on as it is and the caller judges the literal word too (issue #119). Null only when
// the expression built here does not compile. `star` is what `*` matches: within one segment for the
// shell, across them for a git pathspec. The expression carries `unsure` when a bracket expression in
// it is one the reader does not read to its end as Bash would: the caller then takes the word to be
// one it cannot judge (verdict P6-S-52-r1 H-1, verdict P6-S-52-r2 B-1).
function globRe(pattern, star = '[^/]*') {
  let src = '';
  let unsure = false;
  // A character that is not syntax. On Windows a letter stands for both of its cases, since a name
  // that is not a glob is looked up there without regard to case; the expression carries no `i` flag,
  // so that a negated bracket expression leaves out only the characters it names, as Bash does.
  const literal = (c) => {
    const lower = c.toLowerCase();
    const upper = c.toUpperCase();
    const forms = WIN && lower !== upper && lower.length === 1 && upper.length === 1 ? [lower, upper] : [c];
    const esc = forms.map((x) => `\\u${x.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
    return forms.length > 1 ? `[${esc}]` : esc;
  };
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    const cls = c === '[' ? readBracket(pattern, i) : null;
    if (cls?.unsure) {
      unsure = true;
      src += '[^/]*';
      i = cls.end;
    } else if (cls) {
      src += `(?!/)${classSrc(cls, WIN)}`;
      i = cls.end;
    } else if (c === '*') src += star;
    else if (c === '?') src += '[^/]';
    else src += literal(c);
  }
  try {
    const re = new RegExp(`^${src}$`);
    if (unsure) re.unsure = true;
    return re;
  } catch {
    return null;
  }
}

// Whether a write {dir, word, removes?, into?} reaches the frozen file at absolute POSIX path `frozen`.
function reaches(wr, frozen) {
  if (wr.any) return true;
  const word = fromGitBash(String(wr.word).replace(/\\/g, '/'));
  if (word === '') return false;
  const star = wr.pathspec ? '.*' : '[^/]*';
  // The word is read as a glob as it stands and, when a member of a bracket expression in it was
  // quoted, as the pattern that keeps the quoting (`writePattern`): either reading may reach the test.
  const globs = [word, ...(wr.pattern === undefined ? [] : [fromGitBash(wr.pattern.replace(/\\/g, '/'))])].filter((g) => GLOB.test(g));
  if (/[$`]/.test(word) || (wr.dir === null && !path.isAbsolute(word))) {
    // The directory or the name is unknown: judge by the last segment.
    const last = word.split('/').pop();
    if (/[$`]/.test(last)) return false;
    for (const g of globs) {
      const lastRe = GLOB.test(g.split('/').pop()) ? globRe(g.split('/').pop(), star) : null;
      // A bracket expression the reader cannot read as Bash would may match the frozen test.
      if (lastRe?.unsure || lastRe?.test(path.posix.basename(frozen))) return true;
    }
    return fkey(last) === fkey(path.posix.basename(frozen));
  }
  const from = wr.dir === null ? '' : real(wr.dir);
  const target = toPosix(path.resolve(from, word));
  for (const g of globs) {
    const re = globRe(toPosix(path.resolve(from, g)), star);
    if (re?.unsure) return true;
    if (re && (re.test(frozen) || (wr.removes === true && frozen.split('/').some((_, k, all) => re.test(all.slice(0, k).join('/')))))) return true;
  }
  // A glob that matches nothing is passed on as the literal word, which is judged as one below.
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
    const cuts = [];
    const op = /^\d*(<<<|>>|>\||>&|<&|&>|>|<)/.exec(t.v);
    if (op && t.b.startsWith(op[0])) cuts.push(op[0].length);
    else if (/^(--[^=]+|[A-Za-z_][A-Za-z0-9_]*)=/.test(t.v)) cuts.push(t.v.indexOf('=') + 1);
    else if (/^-[^-]./.test(t.v)) {
      // Bundled short options (`tar -tfdata/x.tar`): the value may start after any option letter, so
      // the tail after each leading letter is judged.
      cuts.push(2);
      for (let k = 3; k < t.v.length && /[A-Za-z]/.test(t.v[k - 1]); k++) cuts.push(k);
    } else if (t.v.startsWith('-')) continue;
    else cuts.push(0);
    for (const cut of cuts) wordPaths(t, cut, out);
  }
  return out;
}

// A quoted or escaped character inside an unquoted bracket expression is a member of it and nothing
// else, as Bash reads `d[a\]]ta`: there the escaped `]` does not close the expression. The lexer has
// removed the quoting and kept it in the mask, so each bracket expression is read here with the mask
// by `readBracket`, the one reader of bracket expressions, and written again as a pattern string that
// reads the same with no mask: each quoted member becomes the collating symbol of its character
// (`[.].]`), and a quoted backslash that of `BACKSLASH_MEMBER`, since a backslash in the string would
// be taken for a path separator (verdict P6-S-52-r1 H-1, verdict P6-S-52-r2 B-1).
// -> [word, mask, unsure]: `unsure` when an expression of the word is one the reader does not read.
function literalMembers(v, m) {
  const quoted = (j) => m[j] === '1';
  let word = '';
  let mask = '';
  let i = 0;
  while (i < v.length) {
    const cls = v[i] === '[' && !quoted(i) ? readBracket(v, i, quoted) : null;
    if (cls?.unsure) return [v, m, true];
    if (cls === null) {
      // A `[` that was quoted, or that nothing closes, is that character: written as itself, it could
      // open an expression when the string is read again with no mask.
      const own = v[i] === '[';
      word += own ? `[[.${v[i]}.]]` : v[i];
      mask += own ? '0001000' : m[i];
      i += 1;
      continue;
    }
    for (let k = i; k <= cls.end; k++) {
      if (quoted(k)) {
        word += `[.${v[k] === '\\' ? BACKSLASH_MEMBER : v[k]}.]`;
        mask += '00100';
      } else {
        word += v[k];
        mask += m[k];
      }
    }
    i = cls.end + 1;
  }
  return [word, mask, false];
}

// Appends to `out` the paths word `t` names from character `cut` on: each word its braces expand to,
// with `~` as the home directory, and the path of a `<rev>:<path>` word.
function wordPaths(t, cut, out) {
  const v = t.v.slice(cut);
  if (v === '') return;
  const m = (t.m ?? '0'.repeat(t.v.length)).slice(cut);
  // An unquoted brace expression becomes each word it expands to; one too wide is refused.
  const variants = t.b.includes('{') && t.b.includes('}') ? expandBraces(v, m) : [v];
  if (variants === null) {
    out.push({ word: v, wide: true });
    return;
  }
  const glob = GLOB.test(t.b);
  // The same words with each quoted member of a bracket expression marked: what the shell expands.
  // The word as written stays the name that is judged and reported.
  const [pv, pm, unread] = glob ? literalMembers(v, m) : [v, m, false];
  const marked = pv === v ? null : t.b.includes('{') && t.b.includes('}') ? expandBraces(pv, pm) : [pv];
  // A word whose bracket expression is not read, before its braces expand or after, and one whose
  // marked form does not expand as the word does, is not judged by a guess: it is refused.
  const unsure = (w) => globRe(w.replace(/\\/g, '/'))?.unsure === true;
  if (unread || (marked !== null && marked?.length !== variants.length) || (glob && (marked ?? variants).some(unsure))) {
    out.push({ word: v, unsure: true });
    return;
  }
  const patterns = marked;
  const home = (w) => ((w === '~' || w.startsWith('~/')) && t.b.includes('~') ? os.homedir() + w.slice(1) : w);
  const REV = /^[^:]*:(?:[0-3]:)?(.+)$/;
  for (let k = 0; k < variants.length; k++) {
    // An unquoted `~` is the home directory; an unquoted glob character makes the word a glob.
    const w = home(variants[k]);
    const pattern = patterns ? home(patterns[k]) : undefined;
    out.push({ word: w, glob, pattern });
    // `<rev>:<path>`, `:<path>` and `:<stage>:<path>` (the index): git reads the path from the
    // repository's top, or from the shell's directory when it starts with `./` or `../`.
    const rev = REV.exec(w);
    if (rev && !/^[A-Za-z]:[\\/]/.test(w)) {
      const p = rev[1];
      out.push({ word: p, glob, fromTop: !/^\.\.?\//.test(p), pattern: pattern === undefined ? undefined : REV.exec(pattern)?.[1] });
    }
  }
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
// in one segment; `**` as `*`, as Bash reads it by default); a segment starting with `.` alone matches
// dot names. With `globstar` (the command ran `shopt -s globstar` first), a segment that is only `**`
// is the directory itself and everything under it, at any depth (dot names and symlinked directories
// aside). Null when a segment expands to more than `cap` entries, so the caller fails closed instead of
// judging a part; UNSURE when a segment holds a bracket expression the reader cannot read as Bash would.
const UNSURE = Symbol('unsure');
function expandGlob(base, word, globstar = false, cap = 20000) {
  const target = toPosix(path.resolve(base, word));
  const segs = target.split('/');
  let found = [segs[0] === '' ? '/' : `${segs[0]}/`];
  for (const seg of segs.slice(1)) {
    if (seg === '') continue;
    const next = [];
    if (globstar && /^\*\*+$/.test(seg)) {
      const stack = [...found];
      while (stack.length) {
        const d = stack.pop();
        next.push(d);
        if (next.length > cap) return null;
        let entries = [];
        try {
          entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const p = path.posix.join(d, e.name);
          if (e.isDirectory()) stack.push(p);
          else next.push(p);
          if (next.length + stack.length > cap) return null;
        }
      }
    } else if (!GLOB.test(seg)) {
      for (const d of found) next.push(path.posix.join(d, seg));
    } else {
      const re = globRe(seg.replace(/\*\*+/g, '*'));
      // A segment that does not compile matches nothing: the word stays as written.
      if (re === null) return [];
      if (re.unsure) return UNSURE;
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
  // The path is judged as written (`data/link`) and as resolved: a symlink under a listed directory
  // that points out of the repository resolves to a `..` path, and its listed name must still count.
  const judgeRel = (rel, abs, isDir) => {
    if (rel === '' || leaves(rel)) return null;
    const r = toPosix(rel);
    let pattern = matchesDeny(r, patterns);
    if (pattern === null && (isDir || (fs.existsSync(abs) && fs.statSync(abs).isDirectory()))) pattern = denyDir(r, patterns);
    return pattern === null ? null : { rel: r, pattern };
  };
  // A path named through a link or junction that leads to the repository, from outside it or from
  // inside, is judged where that link leads as well (issue #122).
  const judge = (abs, top, isDir) => {
    for (const p of [abs, real(abs), ...namesUnder(top, abs)]) {
      const hit = judgeRel(path.relative(top, p), abs, isDir);
      if (hit) return hit;
    }
    return null;
  };
  for (const { dir, word, fromTop, glob, wide, unsure, isDir, globstar, pattern } of named) {
    if (wide) return { wide: word };
    if (unsure) return { unsure: word };
    const once = JSON.stringify([dir, word, fromTop, glob, isDir, globstar, pattern]);
    if (seen.has(once)) continue;
    seen.add(once);
    const p = fromGitBash(word.replace(/\\/g, '/'));
    // What the shell expands: the word, with the quoted members of a bracket expression marked.
    const g = pattern === undefined ? p : fromGitBash(pattern.replace(/\\/g, '/'));
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
      if (glob && GLOB.test(g)) {
        const expanded = expandGlob(base ?? top, g, globstar);
        if (expanded === null) return { wide: p };
        if (expanded === UNSURE) return { unsure: p };
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

// `why` is the cause when the directory is unknown for a reason other than its name: a `cd` in a
// pipeline or in the background.
const unknownDir = (label, why) => deny(why
  ? `cannot tell which directory git runs in, and so which branch it is on: ${why}; give the cd its own place in an && chain`
  : `cannot tell which branch ${label} is on; run the command from inside the repository`);

export function handle(input, { root, cfg }) {
  const command = input?.tool_input?.command;
  if (typeof command !== 'string') throw new Error('tool_input.command is missing');
  const start = typeof input.cwd === 'string' && input.cwd !== '' ? resolveDir(null, input.cwd) : root;
  const { invs, texts, mentions, writes, named, cdUnknown, unjudgeable: why, fix, hostRules } = parse(command, start);
  const protectedSet = new Set(cfg.protectedBranches);

  // (0a), in every session and on every branch (D-83)
  if (why) return deny(`cannot judge this command (REQ-3.2): ${why}; ${fix ?? 'run git and gh with literal arguments'}`);
  // (0b)
  if (hostRules?.unjudged) {
    return deny(`cannot judge this command (REQ-3.14): ${hostRules.unjudged}, so it cannot be told from a write to the git host's rules; ${hostRules.fix ?? "give the query in the command as -f query='...'"}`);
  }
  if (hostRules) {
    return deny(`${hostRules.change} changes the git host's rules (REQ-3.14); a human runs it from their own terminal`);
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
  if (named0d?.unsure) {
    return deny(`cannot tell what ${named0d.unsure} expands to, so it may name a path of agents.denyPaths (REQ-3.13); name the path without the bracket expression`);
  }
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
    if (c.branch === UNKNOWN) return unknownDir(c.label, c.why);
    if (c.branch !== null && protectedSet.has(c.branch)) return deny(`commit on protected branch ${c.branch}; create a slice branch`);
  }
  // (2)
  const pushes = invs.filter((i) => i.kind === 'push' || i.kind === 'force-push');
  for (const p of pushes) {
    if (p.all && cfg.protectedBranches.length) return deny(`push to protected branch ${cfg.protectedBranches[0]}`);
    for (const t of p.targets) {
      if (t === null && p.branch === UNKNOWN) return unknownDir(p.label, p.why);
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
