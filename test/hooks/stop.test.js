// REQ-3.7: Stop runs `slicekit check` when the main session tries to stop and blocks the stop with the
// first ten failing finding lines when the gate is red. Fails closed through io.js.
//
// Payloads follow Claude Code's hook documentation: Stop carries session_id, transcript_path, cwd,
// permission_mode and stop_hook_active (true when Claude is already continuing because of a stop hook).
// A block makes Claude continue with the reason as its next instruction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handle, MAX_LINES } from '../../src/hooks/stop.js';
import { runHook, block, HOOK_NAMES } from '../../src/hooks/io.js';
import { check } from '../../src/check/index.js';
import { defaultConfig } from '../../src/config.js';

const SENTENCE = 'Fix them; do not raise a baseline.';

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-stop-'));
  fs.mkdirSync(path.join(root, '.slicekit'));
  fs.writeFileSync(path.join(root, '.slicekit', 'config.json'), JSON.stringify(defaultConfig({ name: 'demo', shape: 'backend' })));
  return root;
}

// A blocking rule reporting n findings.
const ruleWith = (n) => ({
  id: 'fake',
  blocking: true,
  ratchet: false,
  run: () => Array.from({ length: n }, (_, i) => ({ file: `src/f${i + 1}.js`, line: i + 1, message: `problem ${i + 1}` })),
});
// The real check, restricted to the given rules.
const checkWith = (rules) => (root, opts) => check(root, { ...opts, rules });
const stop = (root, input = {}, runCheck = checkWith([ruleWith(0)])) => handle(
  { session_id: 's1', stop_hook_active: false, cwd: root, ...input },
  { root, env: {}, runCheck },
);

// ---- evaluation set ----

// REQ-3.7
test('hooks/stop.test.js » blocks when check fails, allows when green', async () => {
  const root = project();
  assert.deepEqual(await stop(root, {}, checkWith([ruleWith(0)])), {});
  const r = await stop(root, {}, checkWith([ruleWith(2)]));
  assert.deepEqual(r, block(`slicekit check failed:\nfake src/f1.js:1 problem 1\nfake src/f2.js:2 problem 2\n${SENTENCE}`));
});

// ---- the rest ----

test('stop_hook_active allows even when the gate is red (never loops)', async () => {
  const root = project();
  let ran = false;
  const r = await stop(root, { stop_hook_active: true }, (...a) => { ran = true; return checkWith([ruleWith(3)])(...a); });
  assert.deepEqual(r, {});
  assert.equal(ran, false);
});

test('more than ten findings lists the first ten and "…and <n> more"', async () => {
  const root = project();
  assert.equal(MAX_LINES, 10);
  const r = await stop(root, {}, checkWith([ruleWith(13)]));
  const lines = r.reason.split('\n');
  assert.equal(lines[0], 'slicekit check failed:');
  assert.deepEqual(lines.slice(1, 11), Array.from({ length: 10 }, (_, i) => `fake src/f${i + 1}.js:${i + 1} problem ${i + 1}`));
  assert.equal(lines[11], '…and 3 more');
  assert.equal(lines[12], SENTENCE);
  assert.equal(lines.length, 13);
});

test('exactly ten findings has no "more" line', async () => {
  const r = await stop(project(), {}, checkWith([ruleWith(10)]));
  assert.doesNotMatch(r.reason, /more/);
  assert.equal(r.reason.split('\n').length, 12);
});

test('the reason ends with the exact sentence', async () => {
  for (const n of [1, 10, 25]) {
    const r = await stop(project(), {}, checkWith([ruleWith(n)]));
    assert.ok(r.reason.endsWith(`\n${SENTENCE}`), n);
  }
});

test('findings held at baseline are not listed; the summary line is not listed', async () => {
  const root = project();
  const held = { id: 'held', ratchet: true, run: () => [{ file: 'a.js', line: 1, message: 'old' }] };
  fs.mkdirSync(path.join(root, '.slicekit', 'baselines'), { recursive: true });
  fs.writeFileSync(path.join(root, '.slicekit', 'baselines', 'held.json'), JSON.stringify({ 'a.js': 1 }));
  assert.deepEqual(await stop(root, {}, checkWith([held])), {});
  const r = await stop(root, {}, checkWith([held, ruleWith(1)]));
  assert.equal(r.reason, `slicekit check failed:\nfake src/f1.js:1 problem 1\n${SENTENCE}`);
});

test('a rule that crashes is a listed blocking finding', async () => {
  const crash = { id: 'crash', blocking: true, run: () => { throw new Error('kaboom'); } };
  const r = await stop(project(), {}, checkWith([crash]));
  assert.match(r.reason, /^slicekit check failed:\ncrash -:0 rule crash crashed: kaboom\n/);
});

test('a check that throws blocks with "slicekit check could not run" (fail closed)', async () => {
  const r = await stop(project(), {}, () => { throw new Error('disk gone'); });
  assert.deepEqual(r, block('slicekit check could not run: disk gone'));
});

test('through runHook: red blocks with newlines kept, green allows', async () => {
  const root = project();
  const load = (rules) => async () => ({ handle: (input, deps) => handle(input, { ...deps, runCheck: checkWith(rules) }) });
  const stdin = JSON.stringify({ session_id: 's1', stop_hook_active: false, cwd: root });
  const red = await runHook('stop', { stdin, root, env: {}, load: load([ruleWith(2)]) });
  assert.equal(red.code, 0);
  assert.deepEqual(JSON.parse(red.stdout), block(`slicekit check failed:\nfake src/f1.js:1 problem 1\nfake src/f2.js:2 problem 2\n${SENTENCE}`));
  const green = await runHook('stop', { stdin, root, env: {}, load: load([ruleWith(0)]) });
  assert.deepEqual(green, { stdout: '{}', code: 0, stderr: '' });
});

test('through runHook: not a slicekit project answers {}', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-noproj-'));
  const r = await runHook('stop', { stdin: JSON.stringify({ session_id: 's1', stop_hook_active: false, cwd: dir }), env: {} });
  assert.deepEqual(r, { stdout: '{}', code: 0, stderr: '' });
});

test('every one of C-3\'s eight hook names resolves to a module file with a handle export', async () => {
  assert.equal(HOOK_NAMES.size, 8);
  for (const name of HOOK_NAMES) {
    const url = new URL(`../../src/hooks/${name}.js`, import.meta.url);
    assert.ok(fs.existsSync(url), `src/hooks/${name}.js missing`);
    const mod = await import(url.href);
    assert.equal(typeof mod.handle, 'function', name);
  }
});
