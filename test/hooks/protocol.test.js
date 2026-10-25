import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HOOK_NAMES, FAIL_OPEN, HookInputError, readHookInput, deny, allow, context, block, runHook, findRoot,
} from '../../src/hooks/io.js';
import { defaultConfig } from '../../src/config.js';
import { runCli } from '../helpers/run-cli.js';

// C-3's table: these eight names are the full set.
const C3 = ['session-start', 'pre-bash', 'pre-edit', 'subagent-start', 'subagent-stop', 'pre-compact', 'stop', 'session-end'];
const DENY = new Set(['pre-bash', 'pre-edit']);
const BLOCK = new Set(['subagent-stop', 'stop']);

function tmpRoot({ config = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-hooks-'));
  if (config) {
    fs.mkdirSync(path.join(root, '.slicekit'));
    const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
    fs.writeFileSync(path.join(root, '.slicekit', 'config.json'), JSON.stringify(cfg));
  }
  return root;
}

test('the hook names are exactly C-3\'s eight', () => {
  assert.deepEqual([...HOOK_NAMES].sort(), [...C3].sort());
  assert.deepEqual([...FAIL_OPEN].sort(), ['pre-compact', 'session-end', 'session-start', 'subagent-start']);
});

test('readHookInput parses JSON and throws HookInputError on empty or invalid input', () => {
  assert.deepEqual(readHookInput('{"a":1}'), { a: 1 });
  assert.throws(() => readHookInput(''), HookInputError);
  assert.throws(() => readHookInput('   \n'), HookInputError);
  assert.throws(() => readHookInput('{not json'), HookInputError);
  assert.throws(() => readHookInput('[1,2]'), HookInputError);
  assert.throws(() => readHookInput('null'), HookInputError);
});

test('decision shapes', () => {
  assert.deepEqual(deny('no'), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' },
  });
  assert.deepEqual(allow(), {});
  assert.deepEqual(context('SessionStart', 'hi'), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'hi' },
  });
  assert.deepEqual(block('why'), { decision: 'block', reason: 'why' });
});

// REQ-3.2 (and REQ-3.3, 3.5, 3.7 fail closed; 3.1, 3.4, 3.6, 3.8 fail open).
test('each hook with empty stdin', async () => {
  const root = tmpRoot();
  for (const name of C3) {
    const r = await runHook(name, { stdin: '', root, env: {} });
    if (FAIL_OPEN.has(name)) {
      assert.equal(r.code, 0, name);
      assert.deepEqual(r.stdout, {}, name);
    } else if (DENY.has(name)) {
      assert.equal(r.code, 0, name);
      assert.equal(r.stdout.hookSpecificOutput.permissionDecision, 'deny', name);
      assert.match(r.stdout.hookSpecificOutput.permissionDecisionReason, /could not read hook input/, name);
    } else {
      assert.ok(BLOCK.has(name), name);
      assert.equal(r.stdout.decision, 'block', name);
      assert.match(r.stdout.reason, /could not read hook input/, name);
    }
  }
});

test('each hook with empty stdin through the CLI', () => {
  const root = tmpRoot();
  for (const name of C3) {
    const r = runCli(['hook', name], { cwd: root, stdin: '' });
    assert.equal(r.code, 0, name);
    const out = JSON.parse(r.stdout);
    if (FAIL_OPEN.has(name)) assert.deepEqual(out, {}, name);
    else assert.match(JSON.stringify(out), /could not read hook input/, name);
  }
});

test('a hook whose module is not built yet answers {} on valid input', async () => {
  const root = tmpRoot();
  const load = async () => null;
  for (const name of C3) {
    const r = await runHook(name, { stdin: JSON.stringify({ cwd: root }), root, env: {}, load });
    assert.deepEqual(r, { stdout: {}, code: 0, stderr: '' }, name);
  }
});

test('an unknown hook name exits 2', async () => {
  const r = await runHook('nope', { stdin: '{}', root: tmpRoot(), env: {} });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown hook nope/);
  const c = runCli(['hook', 'nope'], { cwd: os.tmpdir(), stdin: '{}' });
  assert.equal(c.code, 2);
  assert.match(c.stderr, /unknown hook nope/);
});

test('an exception in a fail-open hook answers {} and reports on stderr', async () => {
  const root = tmpRoot();
  const load = async () => ({ handle: () => { throw new Error('boom'); } });
  const r = await runHook('session-start', { stdin: '{}', root, env: {}, load });
  assert.deepEqual(r.stdout, {});
  assert.equal(r.code, 0);
  assert.match(r.stderr, /boom/);
});

test('an exception in a fail-closed hook denies or blocks with the generic failure', async () => {
  const root = tmpRoot();
  const load = async () => ({ handle: async () => { throw new Error('boom'); } });
  const bash = await runHook('pre-bash', { stdin: '{}', root, env: {}, load });
  assert.deepEqual(bash.stdout, deny('slicekit hook pre-bash failed: boom'));
  const stop = await runHook('stop', { stdin: '{}', root, env: {}, load });
  assert.deepEqual(stop.stdout, block('slicekit hook stop failed: boom'));
});

test('a handler receives the input, root, cfg, env and git', async () => {
  const root = tmpRoot();
  let seen;
  const load = async () => ({ handle: (input, ctx) => { seen = { input, ...ctx }; return context('SessionStart', 'ok'); } });
  const r = await runHook('session-start', { stdin: JSON.stringify({ cwd: root, x: 1 }), root, env: { A: '1' }, load });
  assert.deepEqual(r.stdout, context('SessionStart', 'ok'));
  assert.equal(seen.input.x, 1);
  assert.equal(seen.root, root);
  assert.equal(seen.cfg.name, 'demo');
  assert.deepEqual(seen.env, { A: '1' });
  assert.equal(typeof seen.git, 'function');
});

test('a config that cannot be loaded: fail-open answers {}, fail-closed denies or blocks', async () => {
  const root = tmpRoot({ config: false });
  const load = async () => ({ handle: () => allow() });
  const open = await runHook('pre-compact', { stdin: '{}', root, env: {}, load });
  assert.deepEqual(open.stdout, {});
  assert.equal(open.code, 0);
  const bash = await runHook('pre-edit', { stdin: '{}', root, env: {}, load });
  assert.match(bash.stdout.hookSpecificOutput.permissionDecisionReason, /^slicekit hook pre-edit failed: config: cannot read/);
  const sub = await runHook('subagent-stop', { stdin: '{}', root, env: {}, load });
  assert.match(sub.stdout.reason, /^slicekit hook subagent-stop failed: config: cannot read/);
});

test('findRoot walks up from cwd to the directory holding .slicekit/config.json', () => {
  const root = tmpRoot();
  const deep = path.join(root, 'a', 'b');
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(findRoot(deep), root);
  const bare = tmpRoot({ config: false });
  assert.equal(findRoot(bare), process.cwd());
  assert.equal(findRoot(undefined), process.cwd());
});

test('runHook finds root from the input cwd when none is given', async () => {
  const root = tmpRoot();
  let seen;
  const load = async () => ({ handle: (input, ctx) => { seen = ctx.root; return {}; } });
  await runHook('session-end', { stdin: JSON.stringify({ cwd: path.join(root) }), env: {}, load });
  assert.equal(seen, root);
});
