import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const LOCAL = 'node_modules/slicekit/bin/slicekit.js';
const CHECK_TIMEOUT_MS = 10_000;

function runnable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (process.platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// True when `name` resolves on env's PATH (with PATHEXT on Windows).
export function onPath(name, env) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  const dirs = (key ? env[key] : '').split(path.delimiter).filter(Boolean);
  const extKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATHEXT');
  const exts = process.platform === 'win32' ? (extKey ? env[extKey] : '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  return dirs.some((dir) => exts.some((ext) => runnable(path.join(dir, `${name}${ext}`))));
}

// The command the hooks call, D-30: a local install, else slicekit on PATH, else npx pinned to this
// kit version (works with no install, at the cost of a registry fetch).
export function probeCli(root, { version, env = process.env }) {
  if (fs.existsSync(path.join(root, LOCAL))) return `node ${LOCAL}`;
  if (onPath('slicekit', env)) return 'slicekit';
  return `npx --yes slicekit@${version}`;
}

// Runs `<cli> --version` once. null when it prints `version`; otherwise the warning to show.
// Through a shell, as Claude Code runs a hook command: a quoted path stays one argument, and the
// npm .cmd shims on Windows cannot be spawned without one.
export function checkCli(cli, { version, cwd }) {
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
  return `hook command "${cli}" did not answer; hooks will report errors on every tool call until .slicekit/config.json cli is fixed`;
}
