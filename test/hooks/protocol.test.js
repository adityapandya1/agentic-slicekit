import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  HOOK_NAMES, FAIL_OPEN, HookInputError, readHookInput, deny, allow, context, block, runHook, findRoot, hookDeadline,
} from '../../src/hooks/io.js';
import { defaultConfig } from '../../src/config.js';
import { runCli } from '../helpers/run-cli.js';

// C-3's table: these eight names are the full set.
const C3 = ['session-start', 'pre-bash', 'pre-edit', 'subagent-start', 'subagent-stop', 'pre-compact', 'stop', 'session-end'];
const DENY = new Set(['pre-bash', 'pre-edit']);
const BLOCK = new Set(['subagent-stop', 'stop']);
const out = (r) => JSON.parse(r.stdout);

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
      assert.deepEqual(out(r), {}, name);
    } else if (DENY.has(name)) {
      assert.equal(r.code, 0, name);
      assert.equal(out(r).hookSpecificOutput.permissionDecision, 'deny', name);
      assert.match(out(r).hookSpecificOutput.permissionDecisionReason, /could not read hook input/, name);
    } else {
      assert.ok(BLOCK.has(name), name);
      assert.equal(out(r).decision, 'block', name);
      assert.match(out(r).reason, /could not read hook input/, name);
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
    assert.deepEqual(r, { stdout: '{}', code: 0, stderr: '' }, name);
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
  assert.deepEqual(out(r), {});
  assert.equal(r.code, 0);
  assert.match(r.stderr, /boom/);
});

test('an exception in a fail-closed hook denies or blocks with the generic failure', async () => {
  const root = tmpRoot();
  const load = async () => ({ handle: async () => { throw new Error('boom'); } });
  const bash = await runHook('pre-bash', { stdin: '{}', root, env: {}, load });
  assert.deepEqual(out(bash), deny('slicekit hook pre-bash failed: boom'));
  const stop = await runHook('stop', { stdin: '{}', root, env: {}, load });
  assert.deepEqual(out(stop), block('slicekit hook stop failed: boom'));
});

test('a handler receives the input, root, cfg, env and git', async () => {
  const root = tmpRoot();
  let seen;
  const load = async () => ({ handle: (input, ctx) => { seen = { input, ...ctx }; return context('SessionStart', 'ok'); } });
  const r = await runHook('session-start', { stdin: JSON.stringify({ cwd: root, x: 1 }), root, env: { A: '1' }, load });
  assert.deepEqual(out(r), context('SessionStart', 'ok'));
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
  assert.deepEqual(out(open), {});
  assert.equal(open.code, 0);
  const bash = await runHook('pre-edit', { stdin: '{}', root, env: {}, load });
  assert.match(out(bash).hookSpecificOutput.permissionDecisionReason, /^slicekit hook pre-edit failed: config: cannot read/);
  const sub = await runHook('subagent-stop', { stdin: '{}', root, env: {}, load });
  assert.match(out(sub).reason, /^slicekit hook subagent-stop failed: config: cannot read/);
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

// Fix round 1: a fail-closed hook trusts only a well-formed decision.
const loadReturning = (value) => async () => ({ handle: () => value });

test('a fail-closed hook that returns a non-object or a wrong shape refuses', async () => {
  const root = tmpRoot();
  const bad = [
    [undefined, 'undefined'], [null, 'null'], ['deny', 'string'], [false, 'boolean'], [3, 'number'], [[], 'array'],
  ];
  for (const [value, kind] of bad) {
    const bash = out(await runHook('pre-bash', { stdin: '{}', root, env: {}, load: loadReturning(value) }));
    assert.deepEqual(bash, deny(`slicekit hook pre-bash failed: handler returned ${kind}`), kind);
    const stop = out(await runHook('stop', { stdin: '{}', root, env: {}, load: loadReturning(value) }));
    assert.deepEqual(stop, block(`slicekit hook stop failed: handler returned ${kind}`), kind);
  }
  const wrongForPre = [block('x'), { hookSpecificOutput: {} }, { hookSpecificOutput: { permissionDecision: 'maybe' } }];
  for (const value of wrongForPre) {
    const r = out(await runHook('pre-bash', { stdin: '{}', root, env: {}, load: loadReturning(value) }));
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.hookSpecificOutput.permissionDecisionReason, /^slicekit hook pre-bash failed: handler returned/);
  }
  const wrongForStop = [deny('x'), { decision: 'block' }, { decision: 'approve', reason: 'x' }, { reason: 'x' }];
  for (const value of wrongForStop) {
    const r = out(await runHook('stop', { stdin: '{}', root, env: {}, load: loadReturning(value) }));
    assert.equal(r.decision, 'block');
    assert.match(r.reason, /^slicekit hook stop failed: handler returned/);
  }
  // Well-formed answers pass through.
  assert.deepEqual(out(await runHook('pre-edit', { stdin: '{}', root, env: {}, load: loadReturning(deny('no')) })), deny('no'));
  assert.deepEqual(out(await runHook('subagent-stop', { stdin: '{}', root, env: {}, load: loadReturning(block('why')) })), block('why'));
  assert.deepEqual(out(await runHook('stop', { stdin: '{}', root, env: {}, load: loadReturning({}) })), {});
});

test('a fail-open hook that returns a non-object answers {} with a note', async () => {
  const root = tmpRoot();
  const r = await runHook('session-start', { stdin: '{}', root, env: {}, load: loadReturning('hello') });
  assert.equal(r.stdout, '{}');
  assert.equal(r.code, 0);
  assert.match(r.stderr, /handler returned string/);
});

test('a result that cannot be serialised refuses (fail closed) or answers {} (fail open)', async () => {
  const root = tmpRoot();
  const circular = { hookSpecificOutput: { permissionDecision: 'allow' } };
  circular.self = circular;
  const bash = await runHook('pre-bash', { stdin: '{}', root, env: {}, load: loadReturning(circular) });
  assert.equal(typeof bash.stdout, 'string');
  assert.equal(out(bash).hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out(bash).hookSpecificOutput.permissionDecisionReason, /^slicekit hook pre-bash failed: /);
  const big = await runHook('stop', { stdin: '{}', root, env: {}, load: loadReturning({ decision: 'block', reason: 'x', n: 1n }) });
  assert.equal(out(big).decision, 'block');
  assert.match(out(big).reason, /^slicekit hook stop failed: /);
  const open = await runHook('pre-compact', { stdin: '{}', root, env: {}, load: loadReturning({ n: 1n }) });
  assert.equal(open.stdout, '{}');
});

test('every refusal reason is one line of at most 300 characters', async () => {
  const root = tmpRoot();
  const thrower = (msg) => async () => ({ handle: () => { throw new Error(msg); } });
  const r = out(await runHook('pre-bash', { stdin: '{}', root, env: {}, load: thrower('a\n\n   b\tc') }));
  assert.equal(r.hookSpecificOutput.permissionDecisionReason, 'slicekit hook pre-bash failed: a b c');
  const long = out(await runHook('stop', { stdin: '{}', root, env: {}, load: thrower('x'.repeat(1000)) }));
  assert.equal(long.reason.length, 300);
  assert.ok(long.reason.startsWith('slicekit hook stop failed: xxx'));
});

test('a handler that outlives the deadline: fail closed refuses, fail open answers {}', async (t) => {
  const root = tmpRoot();
  const hang = async () => ({ handle: () => new Promise(() => {}) });
  // The deadline timer is unref'd by design; hold the test's loop open while it runs.
  const keep = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keep));
  const bash = out(await runHook('pre-bash', { stdin: '{}', root, env: {}, load: hang, deadline: 30 }));
  assert.deepEqual(bash, deny('slicekit hook pre-bash failed: timed out after 30 ms'));
  const stop = out(await runHook('subagent-stop', { stdin: '{}', root, env: {}, load: hang, deadline: 30 }));
  assert.deepEqual(stop, block('slicekit hook subagent-stop failed: timed out after 30 ms'));
  const open = await runHook('session-end', { stdin: '{}', root, env: {}, load: hang, deadline: 30 });
  assert.equal(open.stdout, '{}');
  assert.match(open.stderr, /timed out after 30 ms/);
});

test('the deadline is the rendered hook timeout minus 2 seconds, 8 s when absent', () => {
  assert.equal(hookDeadline('pre-bash'), 18000);
  assert.equal(hookDeadline('stop'), 118000);
  assert.equal(hookDeadline('pre-bash', {}), 8000);
  assert.equal(hookDeadline('stop', { Stop: [{ hooks: [{ command: '{{cli}} hook stop' }] }] }), 8000);
  assert.equal(hookDeadline('stop', { Stop: [{ hooks: [{ command: '{{cli}} hook stop', timeout: 5 }] }] }), 3000);
});

// Through the real process entry: a driver imports runProcess with a test-only loader.
const processUrl = new URL('../../src/cli/process.js', import.meta.url).href;
function runDriver(body, { cwd } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-driver-'));
  const driver = path.join(dir, 'driver.mjs');
  fs.writeFileSync(driver, `import { runProcess } from ${JSON.stringify(processUrl)};\n${body}\n`);
  const r = spawnSync(process.execPath, [driver], { cwd: cwd ?? tmpRoot(), input: '{}', encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const driveHook = (name, handleSource) => runDriver(
  `const handle = ${handleSource};\nawait runProcess(['hook', ${JSON.stringify(name)}], { loadHook: async () => ({ handle }) });`,
);

test('CLI: a circular result prints one line of valid JSON, a deny, exit 0', () => {
  const r = driveHook('pre-bash', '() => { const o = { hookSpecificOutput: { permissionDecision: "allow" } }; o.o = o; return o; }');
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).hookSpecificOutput.permissionDecision, 'deny');
});

test('CLI: a late rejection or throw around the answer leaves exit 0 and the deny intact', () => {
  const answer = '{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "stop" } }';
  const lates = [
    'Promise.reject(new Error("late"))',
    'setTimeout(() => Promise.reject(new Error("late")), 0)',
    'setTimeout(() => { throw new Error("late throw"); }, 0)',
  ];
  for (const late of lates) {
    const r = driveHook('pre-bash', `async () => { ${late}; await new Promise((ok) => setTimeout(ok, 20)); return ${answer}; }`);
    assert.equal(r.code, 0, `${late}: ${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout), deny('stop'), late);
  }
  const after = driveHook('pre-bash', `() => { setTimeout(() => Promise.reject(new Error("later")), 50); return ${answer}; }`);
  assert.equal(after.code, 0, after.stderr);
  assert.deepEqual(JSON.parse(after.stdout), deny('stop'));
});

test('CLI: a handler that never settles and holds nothing still answers', () => {
  const r = driveHook('pre-bash', '() => new Promise(() => {})');
  assert.equal(r.code, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /^slicekit hook pre-bash failed: /);
  const open = driveHook('session-start', '() => new Promise(() => {})');
  assert.equal(open.code, 0, open.stderr);
  assert.deepEqual(JSON.parse(open.stdout), {});
});

test('CLI: a throw outside the dispatcher still answers', () => {
  const r = runDriver("await runProcess(['hook', 'stop'], { stdin: async () => { throw new Error('no stdin'); } });");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), block('slicekit hook stop failed: no stdin'));
  const open = runDriver("await runProcess(['hook', 'pre-compact'], { stdin: async () => { throw new Error('no stdin'); } });");
  assert.equal(open.code, 0, open.stderr);
  assert.deepEqual(JSON.parse(open.stdout), {});
});

// Fix round 2: the check runs on what is written, not on the object before serialisation.
test('a result whose JSON disagrees with its object refuses (fail closed) or answers {} (fail open)', async () => {
  const root = tmpRoot();
  const tricky = [
    ['Date', new Date(0)],
    ['Map', new Map([['a', 1]])],
    ['toJSON string', { toJSON: () => 'allow' }],
    ['toJSON undefined', { toJSON: () => undefined }],
  ];
  for (const [label, value] of tricky) {
    const r = await runHook('pre-bash', { stdin: '{}', root, env: {}, load: loadReturning(value) });
    assert.equal(r.code, 0, label);
    assert.equal(r.stdout.split('\n').length, 1, label);
    assert.equal(out(r).hookSpecificOutput.permissionDecision, 'deny', label);
    assert.match(out(r).hookSpecificOutput.permissionDecisionReason, /^slicekit hook pre-bash failed: handler /, label);
  }
  const stop = out(await runHook('stop', { stdin: '{}', root, env: {}, load: loadReturning({ toJSON: () => undefined }) }));
  assert.deepEqual(stop, block('slicekit hook stop failed: handler result did not serialise'));
  const open = await runHook('session-start', { stdin: '{}', root, env: {}, load: loadReturning({ toJSON: () => 'x' }) });
  assert.equal(open.stdout, '{}');
  assert.match(open.stderr, /handler returned string/);
  // A Map serialises to {} and is therefore an honest {} for a fail-open hook.
  const map = await runHook('pre-compact', { stdin: '{}', root, env: {}, load: loadReturning(new Map()) });
  assert.equal(map.stdout, '{}');
});

test('CLI: a toJSON returning undefined still prints a deny, exit 0', () => {
  const r = driveHook('pre-bash', '() => ({ toJSON: () => undefined })');
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), deny('slicekit hook pre-bash failed: handler result did not serialise'));
});

test('hookCommand never skips the write: an empty answer becomes the refusal or {}', async () => {
  const { hookCommand } = await import('../../src/cli/hook.js');
  const run = async (name) => {
    const written = [];
    const io = { stdin: async () => '{}', stdout: (s) => written.push(s), stderr: () => {}, env: {} };
    // io.runHook is a test-only seam: a dispatcher that, for whatever reason, produced no answer.
    io.runHook = async () => ({ stdout: '', code: 0, stderr: '' });
    const code = await hookCommand.run([name], io);
    return { code, written: written.join('') };
  };
  const bash = await run('pre-bash');
  assert.equal(bash.code, 0);
  assert.equal(JSON.parse(bash.written).hookSpecificOutput.permissionDecision, 'deny');
  const open = await run('session-end');
  assert.deepEqual(JSON.parse(open.written), {});
});

test('CLI: a fail-open handler that never settles notes it on stderr', () => {
  const open = driveHook('session-start', '() => new Promise(() => {})');
  assert.equal(open.code, 0);
  assert.match(open.stderr, /handler never settled/);
});

// ---- final fix wave ----

// M7
test('with no config above the cwd every hook answers {}: not a slicekit project', async () => {
  const bare = tmpRoot({ config: false });
  try {
    for (const name of C3) {
      const r = await runHook(name, { stdin: JSON.stringify({ cwd: bare, tool_input: {} }), env: {} });
      assert.equal(r.stdout, '{}', name);
    }
    const bash = await runHook('pre-bash', {
      stdin: JSON.stringify({ cwd: bare, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }), env: {},
    });
    assert.equal(bash.stdout, '{}');
    const edit = await runHook('pre-edit', {
      stdin: JSON.stringify({ cwd: bare, tool_name: 'Write', tool_input: { file_path: path.join(bare, 'a.js') } }), env: {},
    });
    assert.equal(edit.stdout, '{}');
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

// M7
test('a config that exists but is invalid still fails closed', async () => {
  const bare = tmpRoot({ config: false });
  const broken = tmpRoot({ config: false });
  try {
    fs.mkdirSync(path.join(broken, '.slicekit'));
    fs.writeFileSync(path.join(broken, '.slicekit', 'config.json'), '{not json');
    const bash = await runHook('pre-bash', {
      stdin: JSON.stringify({ cwd: broken, tool_name: 'Bash', tool_input: { command: 'ls' } }), env: {},
    });
    assert.equal(out(bash).hookSpecificOutput.permissionDecision, 'deny');
    const edit = await runHook('pre-edit', {
      stdin: JSON.stringify({ cwd: broken, tool_name: 'Edit', tool_input: { file_path: 'a.js' } }), env: {},
    });
    assert.equal(out(edit).hookSpecificOutput.permissionDecision, 'deny');
    // The session sits outside any project, the file inside a broken one: pre-edit judges the file's root.
    const across = await runHook('pre-edit', {
      stdin: JSON.stringify({ cwd: bare, tool_name: 'Edit', tool_input: { file_path: path.join(broken, 'src', 'a.js') } }), env: {},
    });
    assert.equal(out(across).hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(broken, { recursive: true, force: true });
  }
});
