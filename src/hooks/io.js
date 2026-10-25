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

const REASON_MAX = 300;
// One line, at most 300 characters: a reason is read in the agent's transcript, not a log.
export function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
}

function refuse(name, reason) {
  return DENIES.has(name) ? deny(oneLine(reason)) : block(oneLine(reason));
}

// The serialised answer for a hook that failed: the refusal for a fail-closed name, {} for a fail-open one.
export function failureOutput(name, message) {
  if (FAIL_OPEN.has(name) || !HOOK_NAMES.has(name)) return '{}';
  return JSON.stringify(refuse(name, `slicekit hook ${name} failed: ${message}`));
}

const DEFAULT_DEADLINE = 8000;
const DEADLINE_MARGIN = 2000;
let renderedHooks;
function templateHooks() {
  if (renderedHooks === undefined) {
    try {
      const file = fileURLToPath(new URL('../../templates/claude-code/hooks.json', import.meta.url));
      renderedHooks = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      renderedHooks = {};
    }
  }
  return renderedHooks;
}

// The handler's deadline: the timeout the renderer writes for this hook into .claude/settings.json
// (from templates/claude-code/hooks.json) minus 2 s, so the kit answers before the agent tool gives up.
export function hookDeadline(name, hooks = templateHooks()) {
  const suffix = ` hook ${name}`;
  for (const groups of Object.values(hooks ?? {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const h of Array.isArray(group?.hooks) ? group.hooks : []) {
        if (typeof h?.command !== 'string' || !h.command.endsWith(suffix)) continue;
        if (typeof h.timeout === 'number' && h.timeout * 1000 > DEADLINE_MARGIN) return h.timeout * 1000 - DEADLINE_MARGIN;
        return DEFAULT_DEADLINE;
      }
    }
  }
  return DEFAULT_DEADLINE;
}

class HookTimeout extends Error {}

// The timer is unref'd so it never holds the process open on its own.
function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new HookTimeout(`timed out after ${ms} ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const PERMISSION = new Set(['allow', 'deny', 'ask']);

// null when the result is a decision this hook may give; otherwise why not.
function shapeError(name, result) {
  const kind = kindOf(result);
  if (kind !== 'object') return `handler returned ${kind}`;
  if (FAIL_OPEN.has(name) || Object.keys(result).length === 0) return null;
  if (DENIES.has(name)) {
    return PERMISSION.has(result.hookSpecificOutput?.permissionDecision)
      ? null : 'handler returned a result with no permissionDecision';
  }
  return result.decision === 'block' && typeof result.reason === 'string'
    ? null : 'handler returned a result that is neither {} nor a block with a reason';
}

// -> {stdout: string (one JSON object; '' for an unknown name), code: number, stderr: string}.
// `load` and `deadline` are injectable for tests.
export async function runHook(name, { stdin, root, env = process.env, load = loadModule, deadline } = {}) {
  if (!HOOK_NAMES.has(name)) return { stdout: '', code: 2, stderr: `unknown hook ${name}\n` };
  const open = FAIL_OPEN.has(name);
  const fail = (message) => (open
    ? { stdout: '{}', code: 0, stderr: `slicekit hook ${name} failed: ${oneLine(message)}\n` }
    : { stdout: failureOutput(name, message), code: 0, stderr: '' });

  let input;
  try {
    input = readHookInput(stdin);
  } catch (err) {
    if (open) return { stdout: '{}', code: 0, stderr: `slicekit hook ${name}: ${err.message}\n` };
    return { stdout: JSON.stringify(refuse(name, err.message)), code: 0, stderr: '' };
  }

  try {
    const mod = await load(name);
    // Not built yet: answer {} even for a fail-closed name once its input parsed, so installing the
    // kit never blocks a team before the guard exists. The guard takes over when its module lands.
    if (!mod) return { stdout: '{}', code: 0, stderr: '' };
    const hookRoot = root ?? findRoot(input.cwd);
    const cfg = loadConfig(hookRoot);
    const git = (args) => runGit(hookRoot, args);
    const ms = deadline ?? hookDeadline(name);
    const result = await withDeadline(Promise.resolve().then(() => mod.handle(input, { root: hookRoot, cfg, env, git })), ms);
    // Serialised here so a circular or BigInt result is a failure of this hook, not of the CLI; the
    // shape check runs on what is written (a Date, a Map or a toJSON can make the two disagree).
    const raw = kindOf(result);
    if (raw !== 'object') return fail(`handler returned ${raw}`);
    // Only a plain object: a Map serialises to {} and would read as an answer it never gave.
    const proto = Object.getPrototypeOf(result);
    if (proto !== Object.prototype && proto !== null) return fail(`handler returned a ${proto?.constructor?.name ?? 'non-plain object'}`);
    const text = JSON.stringify(result);
    if (typeof text !== 'string') return fail('handler result did not serialise');
    const problem = shapeError(name, JSON.parse(text));
    if (problem) return fail(problem);
    return { stdout: text, code: 0, stderr: '' };
  } catch (err) {
    return fail(err?.message ?? String(err));
  }
}
