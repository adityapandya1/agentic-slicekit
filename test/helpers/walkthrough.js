// S-25: the README's walkthrough as a test runs it. The commands are read from the `sh` blocks under
// `## Walkthrough` and run as one bash session, so `cd` and variables carry from one command to the
// next as they do for a reader typing them.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FENCE = /^\s*```\s*([\w-]*)/;
// A heading that ends the walkthrough: level 1 or 2. A `###` inside it is a step, not the end.
const SECTION = /^#{1,2}\s/;

// The commands of every `sh` block under `## Walkthrough`, up to the next `#` or `##` heading, in
// file order: [{line, command}], `line` the 1-based README line of the command's first line. Blank
// lines and `#` comments are skipped; a line ending in `\` joins the next.
export function walkthroughCommands(text) {
  const all = String(text).split(/\r?\n/);
  const start = all.findIndex((l) => /^##\s+Walkthrough\s*$/.test(l));
  if (start === -1) throw new Error('README.md has no "## Walkthrough" section');
  const out = [];
  let blocks = 0;
  let fence = null; // the open block's language, or null outside a block
  let pending = null; // a command continued with `\`
  for (let i = start + 1; i < all.length; i++) {
    const line = all[i];
    const m = FENCE.exec(line);
    if (fence === null) {
      if (m) {
        fence = m[1];
        if (fence === 'sh') blocks++;
      } else if (SECTION.test(line)) {
        break;
      }
      continue;
    }
    if (m && m[1] === '') {
      if (pending) throw new Error(`README.md:${pending.line}: a walkthrough command ends its block with a backslash`);
      fence = null;
      continue;
    }
    if (fence !== 'sh') continue;
    const s = line.trim();
    if (!pending && (s === '' || s.startsWith('#'))) continue;
    const cont = s.endsWith('\\');
    const part = cont ? s.slice(0, -1).trimEnd() : s;
    pending = pending ? { line: pending.line, command: `${pending.command} ${part}`.trim() } : { line: i + 1, command: part };
    if (!cont) {
      out.push(pending);
      pending = null;
    }
  }
  if (blocks === 0) throw new Error('the walkthrough holds no sh block');
  return out;
}

const quote = (s) => `'${s.replace(/'/g, "'\\''")}'`;

// One bash script: `set -u`, no `set -e`, each command followed by a stop that names it and its line.
export function walkthroughScript(commands) {
  const body = commands.map(({ line, command }) => {
    const msg = quote(`walkthrough failed at README.md:${line}: ${command}`);
    return `${command} || { printf '%s\\n' ${msg} >&2; exit 1; }`;
  });
  return ['set -u', ...body, ''].join('\n');
}

// Under the Windows folder, where System32's bash.exe is the WSL launcher.
const inWindowsDir = (p) => /^[a-z]:[\\/]windows([\\/]|$)/i.test(p);

// The bash to run the walkthrough with: SLICEKIT_BASH when set; on Windows the Git for Windows bash,
// `<prefix>/bin/bash.exe`, found by walking up from `git --exec-path`; elsewhere `bash`. On Windows
// a bare `bash` is never used, since PATH can resolve it to the WSL launcher in System32.
export function resolveBash({
  env = process.env,
  platform = process.platform,
  execPath = () => execFileSync('git', ['--exec-path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
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

// Runs the commands as one bash session with `cwd` the kit checkout. -> {code, stdout, stderr}.
// NODE_TEST_CONTEXT is dropped, as a reader's shell has none: inherited from a `node --test`
// parent, it makes a `node --test` in the walkthrough report to that parent and exit 0.
export function runWalkthrough(commands, { cwd, env: given = process.env } = {}) {
  const env = { ...given };
  delete env.NODE_TEST_CONTEXT;
  const bash = resolveBash({ env });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-walkthrough-'));
  try {
    const file = path.join(dir, 'walkthrough.sh');
    fs.writeFileSync(file, walkthroughScript(commands));
    const r = spawnSync(bash, [file.split(path.sep).join('/')], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.error) throw r.error;
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
