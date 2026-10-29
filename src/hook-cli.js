import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { which } from './which.js';

const LOCAL = 'node_modules/slicekit/bin/slicekit.js';
const CHECK_TIMEOUT_MS = 10_000;

// True when `name` resolves on env's PATH (with PATHEXT on Windows).
export function onPath(name, env) {
  return which(name, env) !== null;
}

// The install advice of D-30: the kit is on npm from 0.1.1 (D-41).
export const NOT_INSTALLED =
  'slicekit is not installed locally or on PATH; hooks will fail until it is (npm i -D slicekit, or set cli in .slicekit/config.json)';

// The command the hooks call, D-30: a local install, else slicekit on PATH, else the PATH form with
// NOT_INSTALLED. Never a registry fetch: the npm name is unclaimed (D-26), so a hook must not install it.
export function probeCli(root, { env = process.env } = {}) {
  if (fs.existsSync(path.join(root, LOCAL))) return { cli: `node ${LOCAL}`, warning: null };
  if (onPath('slicekit', env)) return { cli: 'slicekit', warning: null };
  return { cli: 'slicekit', warning: NOT_INSTALLED };
}

// Runs `<cli> --version` once. null when it prints `version`; otherwise the warning to show.
// Through a shell, as Claude Code runs a hook command: a quoted path stays one argument, and the
// npm .cmd shims on Windows cannot be spawned without one.
export function checkCli(cli, { version, cwd, platform = process.platform }) {
  let out;
  try {
    out = execSync(`${cli} --version`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CHECK_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch {
    out = null;
  }
  if (out !== null && out.trim() === version) return null;
  const base = `hook command "${cli}" did not answer; hooks will report errors on every tool call until .slicekit/config.json cli is fixed`;
  const causes = cliCauses(cli, platform);
  return causes.length === 0 ? base : `${base}. Likely cause: ${causes.join('; ')}`;
}

// What a command that did not answer most likely got wrong, as far as its text shows: an unquoted
// path with spaces, which the shell splits into several arguments; and on Windows a Git Bash path
// such as /c/... or /tmp/..., which Node there cannot read.
export function cliCauses(cli, platform = process.platform) {
  const causes = [];
  const words = cli.trim().split(/\s+/);
  const quoted = /["']/.test(cli);
  if (!quoted && words.length > 2 && words.slice(1).some((w) => /[/\\]/.test(w))) {
    causes.push('a path with spaces is split by the shell; quote a path that has spaces, as --cli "node \\"<path>\\""');
  }
  if (platform === 'win32' && words.some((w) => /^["']?\/[^/]/.test(w))) {
    causes.push('on Windows, Node cannot read a Git Bash path such as /c/...; use C:/..., which pwd -W prints');
  }
  return causes;
}
