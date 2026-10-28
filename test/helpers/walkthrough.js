// S-25: the README's walkthrough as a test runs it. The commands are read from the `sh` blocks under
// `## Walkthrough` and run as one bash session, so `cd` and variables carry from one command to the
// next as they do for a reader typing them.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CI_PULL_REQUEST } from './run-cli.js';

// A fence line: its run of backticks or tildes, and the info string after it.
const FENCE = /^\s*(`{3,}|~{3,})\s*(.*)$/;
const CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
// A heading that ends the walkthrough: level 1 or 2. A `###` inside it is a step, not the end.
const SECTION = /^#{1,2}\s/;
const HEADING = /^##\s+Walkthrough\s*$/;
// Shell blocks a reader would run that are not `sh`: refused, so the test never covers less than
// the reader runs.
const SHELLS = new Set(['bash', 'shell', 'console', 'zsh', 'sh-session', 'shellsession', 'terminal']);

const closes = (open, line) => {
  const m = CLOSE.exec(line);
  return m !== null && m[1][0] === open[0] && m[1].length >= open.length;
};

// The line index of the `## Walkthrough` heading, read outside code blocks; -1 when there is none.
function sectionStart(all) {
  let open = null;
  for (let i = 0; i < all.length; i++) {
    if (open) {
      if (closes(open, all[i])) open = null;
      continue;
    }
    const m = FENCE.exec(all[i]);
    if (m) open = m[1];
    else if (HEADING.test(all[i])) return i;
  }
  return -1;
}

// Why bash cannot run `command` as one guarded step, or null. Read outside quotes and before a
// comment, so a quoted or escaped `;`, `<<` or `&` is the command's own text:
// - a `;` list's status is its last command's, so an earlier failure would pass;
// - a heredoc's lines cannot be guarded one by one;
// - a command sent to the background with `&` is never waited for.
export function shellProblem(command) {
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === '\\') {
      i++;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(command[i - 1]))) break;
    else if (ch === ';') return 'a walkthrough command may not hold ";": write one command per line, or join them with &&';
    else if (ch === '<' && command[i + 1] === '<') return 'a heredoc cannot run in the walkthrough: write the file another way';
    else if (ch === '&') {
      if (command[i + 1] === '&') i++;
      else if (command[i + 1] !== '>' && command[i - 1] !== '>' && command[i - 1] !== '<') return 'a walkthrough command may not run in the background with "&"';
    }
  }
  return null;
}

const refuse = (line, why) => new Error(`README.md:${line}: ${why}`);

// The commands of every `sh` block under `## Walkthrough`, up to the next `#` or `##` heading, in
// file order: [{line, command}], `line` the 1-based README line of the command's first line. Blank
// lines and `#` comments are skipped; a line ending in `\` joins the next. Inside the section a
// block in another shell (```bash, ```console …), a `~~~` or longer fence, a block never closed and
// a command bash cannot guard (see shellProblem) are refused with their README line.
export function walkthroughCommands(text) {
  const all = String(text).split(/\r?\n/);
  const start = sectionStart(all);
  if (start === -1) throw new Error('README.md has no "## Walkthrough" section');
  const out = [];
  let blocks = 0;
  let fence = null; // the open block: { lang, line }, or null outside a block
  let pending = null; // a command continued with `\`
  for (let i = start + 1; i < all.length; i++) {
    const line = all[i];
    if (fence === null) {
      const m = FENCE.exec(line);
      if (m) {
        const lang = /^[\w-]*/.exec(m[2])[0].toLowerCase();
        if (m[1] !== '```') throw refuse(i + 1, `only \`\`\` fences are read in the walkthrough, and this ${m[1]} block would not run`);
        if (SHELLS.has(lang)) throw refuse(i + 1, `a \`\`\`${lang} block in the walkthrough is not run; use \`\`\`sh`);
        fence = { lang, line: i + 1 };
        if (lang === 'sh') blocks++;
      } else if (SECTION.test(line)) {
        break;
      }
      continue;
    }
    if (closes('```', line)) {
      if (pending) throw refuse(pending.line, 'a walkthrough command ends its block with a backslash');
      fence = null;
      continue;
    }
    if (fence.lang !== 'sh') continue;
    const s = line.trim();
    if (!pending && (s === '' || s.startsWith('#'))) continue;
    const cont = s.endsWith('\\');
    const part = cont ? s.slice(0, -1).trimEnd() : s;
    pending = pending ? { line: pending.line, command: `${pending.command} ${part}`.trim() } : { line: i + 1, command: part };
    if (!cont) {
      const problem = shellProblem(pending.command);
      if (problem) throw refuse(pending.line, problem);
      out.push(pending);
      pending = null;
    }
  }
  if (fence) throw refuse(fence.line, 'a block in the walkthrough is never closed');
  if (blocks === 0) throw new Error('the walkthrough holds no sh block');
  return out;
}

const quote = (s) => `'${s.replace(/'/g, "'\\''")}'`;

// One bash script: `set -u` and `pipefail`, no `set -e`. Each command runs in a `{ … }` group whose
// `}` is on its own line, so a trailing comment cannot swallow the stop after it, and the group is
// followed by a stop that names the command and its line. A command bash cannot guard is refused.
export function walkthroughScript(commands) {
  const body = commands.map(({ line, command }) => {
    const problem = shellProblem(command);
    if (problem) throw refuse(line, problem);
    const msg = quote(`walkthrough failed at README.md:${line}: ${command}`);
    return `{ ${command}\n} || { printf '%s\\n' ${msg} >&2; exit 1; }`;
  });
  return ['set -u', 'set -o pipefail', ...body, ''].join('\n');
}

// Under the Windows folder, where System32's bash.exe is the WSL launcher.
const inWindowsDir = (p) => /^[a-z]:[\\/]windows([\\/]|$)/i.test(p);

// The bash to run the walkthrough with: SLICEKIT_BASH when set; on Windows the Git for Windows bash,
// `<prefix>/bin/bash.exe`, found by walking up from `git --exec-path` (git found on the PATH of
// `env`); elsewhere `bash`. On Windows a bare `bash` is never used, since PATH can resolve it to the
// WSL launcher in System32.
export function resolveBash({
  env = process.env,
  platform = process.platform,
  execPath = () => execFileSync('git', ['--exec-path'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  exists = (f) => fs.existsSync(f),
} = {}) {
  if (env.SLICEKIT_BASH) return env.SLICEKIT_BASH;
  if (platform !== 'win32') return 'bash';
  let dir;
  try {
    dir = String(execPath()).trim();
  } catch {
    dir = '';
  }
  while (dir !== '' && !inWindowsDir(dir)) {
    const candidate = path.win32.join(dir, 'bin', 'bash.exe');
    if (exists(candidate)) return candidate;
    const up = path.win32.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('cannot find the Git for Windows bash next to `git --exec-path`; set SLICEKIT_BASH to a bash');
}

// The parent's environment as a reader's shell would have it: no GIT_* (a hook's GIT_DIR would send
// every git command to another repository), no CI pull request variables, no SLICEKIT_* but
// SLICEKIT_BASH, and no NODE_TEST_CONTEXT (under it a `node --test` in the walkthrough reports to the
// test runner and exits 0).
function readerEnv(parent) {
  const out = {};
  for (const [k, v] of Object.entries(parent)) {
    const K = k.toUpperCase();
    if (K.startsWith('GIT_') || CI_PULL_REQUEST.includes(K) || K === 'NODE_TEST_CONTEXT') continue;
    if (K.startsWith('SLICEKIT_') && K !== 'SLICEKIT_BASH') continue;
    out[k] = v;
  }
  return out;
}

// The git config a reader has, and nothing of this machine's: an identity, no signing, main.
const GITCONFIG = '[user]\n\tname = Walkthrough\n\temail = walkthrough@example.test\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n';

// Runs the commands as one bash session with `cwd` the kit checkout, in the reader's environment
// (readerEnv of this process's) with its own global git config and no system one; `env` entries go
// on top. -> {code, stdout, stderr}. Past `timeoutMs` (600 s by default) it throws.
export function runWalkthrough(commands, { cwd, env = {}, timeoutMs = 600_000 } = {}) {
  const script = walkthroughScript(commands);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-walkthrough-'));
  try {
    const gitconfig = path.join(dir, 'gitconfig');
    fs.writeFileSync(gitconfig, GITCONFIG);
    const full = { ...readerEnv(process.env), GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', ...env };
    const bash = resolveBash({ env: full });
    const file = path.join(dir, 'walkthrough.sh');
    fs.writeFileSync(file, script);
    const r = spawnSync(bash, [file.split(path.sep).join('/')], {
      cwd,
      env: full,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
    });
    if (r.error?.code === 'ETIMEDOUT') throw new Error(`walkthrough timed out after ${timeoutMs / 1000} s`);
    if (r.error) throw r.error;
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
