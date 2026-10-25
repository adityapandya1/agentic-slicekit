// The hook protocol (C-3): every hook reads one JSON object on stdin and answers one JSON decision.
// Each hook module lives at src/hooks/<name>.js and exports handle(input, {root, cfg, env, git}).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG_PATH, loadConfig } from '../config.js';
import { git as runGit } from '../git.js';

// C-3's table: these eight names are the full set.
export const HOOK_NAMES = new Set([
  'session-start', 'pre-bash', 'pre-edit', 'subagent-start', 'subagent-stop', 'pre-compact', 'stop', 'session-end',
]);
// REQ-3.1, 3.4, 3.6, 3.8 fail open; every other hook fails closed (REQ-3.2, 3.3, 3.5, 3.7).
export const FAIL_OPEN = new Set(['session-start', 'subagent-start', 'pre-compact', 'session-end']);
// A fail-closed PreToolUse hook denies; a fail-closed stop hook blocks.
const DENIES = new Set(['pre-bash', 'pre-edit']);

export class HookInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HookInputError';
  }
}

export function readHookInput(stdin) {
  const text = String(stdin ?? '').trim();
  if (text === '') throw new HookInputError('could not read hook input: stdin was empty');
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    throw new HookInputError('could not read hook input: stdin is not valid JSON');
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new HookInputError('could not read hook input: stdin is not a JSON object');
  }
  return input;
}

export const allow = () => ({});
export const deny = (reason) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
});
export const context = (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
export const block = (reason) => ({ decision: 'block', reason });

// The directory holding .slicekit/config.json, walking up from cwd; process.cwd() when there is none.
export function findRoot(cwd) {
  if (typeof cwd === 'string' && cwd !== '') {
    let dir = path.resolve(cwd);
    for (;;) {
      if (fs.existsSync(path.join(dir, CONFIG_PATH))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

// null when the hook's module does not exist yet.
async function loadModule(name) {
  const file = fileURLToPath(new URL(`./${name}.js`, import.meta.url));
  if (!fs.existsSync(file)) return null;
  return import(pathToFileURL(file).href);
}

function refuse(name, reason) {
  return DENIES.has(name) ? deny(reason) : block(reason);
}

// -> {stdout: object, code: number, stderr: string}. `load` is injectable for tests.
export async function runHook(name, { stdin, root, env = process.env, load = loadModule } = {}) {
  if (!HOOK_NAMES.has(name)) return { stdout: {}, code: 2, stderr: `unknown hook ${name}\n` };
  const open = FAIL_OPEN.has(name);
  const fail = (message) => (open
    ? { stdout: allow(), code: 0, stderr: `slicekit hook ${name} failed: ${message}\n` }
    : { stdout: refuse(name, `slicekit hook ${name} failed: ${message}`), code: 0, stderr: '' });

  let input;
  try {
    input = readHookInput(stdin);
  } catch (err) {
    if (open) return { stdout: allow(), code: 0, stderr: `slicekit hook ${name}: ${err.message}\n` };
    return { stdout: refuse(name, err.message), code: 0, stderr: '' };
  }

  try {
    const mod = await load(name);
    // Not built yet: answer {} even for a fail-closed name once its input parsed, so installing the
    // kit never blocks a team before the guard exists. The guard takes over when its module lands.
    if (!mod) return { stdout: allow(), code: 0, stderr: '' };
    const hookRoot = root ?? findRoot(input.cwd);
    const cfg = loadConfig(hookRoot);
    const git = (args) => runGit(hookRoot, args);
    const out = await mod.handle(input, { root: hookRoot, cfg, env, git });
    return { stdout: out ?? allow(), code: 0, stderr: '' };
  } catch (err) {
    return fail(err?.message ?? String(err));
  }
}
