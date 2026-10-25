// REQ-3.5, REQ-2.11, REQ-2.12: SubagentStop clears the subagent marker and blocks the subagent once
// when its output lacks its role's shape. Fails closed through io.js.
//
// Payloads follow Claude Code's hook documentation: SubagentStop carries session_id, agent_id,
// agent_type, agent_transcript_path, last_assistant_message and stop_hook_active; transcript_path is the
// main session's transcript. After a block the subagent keeps running and its next stop arrives with
// stop_hook_active: true. Internal agents stop without ever starting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { handle } from '../../src/hooks/subagent-stop.js';
import { handle as startHook } from '../../src/hooks/subagent-start.js';
import { shapeProblems } from '../../src/hooks/shapes.js';
import { markerPath, retryPath, subagentActive } from '../../src/hooks/subagent-marker.js';
import { defaultConfig } from '../../src/config.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
const SESSION = 'sess-stop-1';
const AGENT = 'agent-1';
const TAIL = '\nSkipped: none\nNot checked: performance\n';
const DEV_OK = `Built the parser.\nran: npm test → exit 0${TAIL}`;
const VERDICT_TAIL = '\n## Checklists run\n\n- correctness\n\n## Not checked\n\n- security\n';
const GOOD_VERDICT = `Verdict: APPROVE\n${VERDICT_TAIL}`;
const TABLE = '| ID | File:line | What is wrong | Why it matters | How verified |\n|---|---|---|---|---|\n';

const stop = (root, input = {}) => handle(
  { session_id: SESSION, agent_id: AGENT, agent_type: 'developer', stop_hook_active: false, cwd: root, ...input },
  { root, cfg, env: {} },
);
const start = (root, input = {}) => startHook(
  { session_id: SESSION, agent_id: AGENT, agent_type: 'developer', cwd: root, ...input },
  { root, cfg, env: {}, commands: {} },
);
const isBlock = (r) => r.decision === 'block' && typeof r.reason === 'string';
const count = (root) => {
  try {
    return fs.readFileSync(markerPath(root, SESSION), 'utf8').trim();
  } catch {
    return 'none';
  }
};

function writeReview(root, name, body, ageMs = 0) {
  const file = path.join(root, '.slicekit', 'reviews', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  if (ageMs) {
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(file, t, t);
  }
  return file;
}

// A repo with agent AGENT started (of agent_type `type`) in SESSION.
async function started({ type = 'developer', branch = 'main' } = {}) {
  const repo = makeRepo({ commits: 1, branch });
  await start(repo.root, { agent_type: type });
  return repo;
}

// ---- evaluation set ----

// REQ-3.5
test('hooks/subagent-stop.test.js » reviewer without verdict file blocks naming it', async () => {
  const { root, cleanup } = await started({ type: 'reviewer' });
  try {
    const r = await stop(root, { agent_type: 'reviewer', last_assistant_message: `Reviewed.${TAIL}` });
    assert.ok(isBlock(r), JSON.stringify(r));
    assert.match(r.reason, /^output shape: /);
    assert.match(r.reason, /no verdict file in \.slicekit\/reviews\/ from this run/);
    assert.match(r.reason, /\. Add the missing parts and finish\.$/);
    // First failure: the subagent goes on, so the marker stays.
    assert.equal(subagentActive(root, SESSION), true);
  } finally {
    cleanup();
  }
});

// REQ-2.11
test('hooks/subagent-stop.test.js » verdict finding without how-verified blocks', async () => {
  const { root, cleanup } = await started({ type: 'reviewer' });
  try {
    writeReview(root, 'P1-S-07-r1.md', `Verdict: BLOCK\n\n${TABLE}| B-1 | src/a.js:1 | wrong | matters |  |\n${VERDICT_TAIL}`);
    const r = await stop(root, { agent_type: 'reviewer', last_assistant_message: `Reviewed.${TAIL}` });
    assert.ok(isBlock(r), JSON.stringify(r));
    assert.match(r.reason, /finding B-1 has no "how verified"/);
    assert.match(r.reason, /\.slicekit\/reviews\/P1-S-07-r1\.md/);
  } finally {
    cleanup();
  }
});

// REQ-2.12
test('hooks/subagent-stop.test.js » developer without Skipped/Not checked blocks once, then passes', async () => {
  const { root, cleanup } = await started();
  try {
    const first = await stop(root, { last_assistant_message: 'Built it.\nran: npm test → exit 0\n' });
    assert.ok(isBlock(first), JSON.stringify(first));
    assert.match(first.reason, /no "Skipped:" line/);
    assert.match(first.reason, /no "Not checked:" line/);
    assert.ok(fs.existsSync(retryPath(root, SESSION, AGENT)), 'retry state written');
    const second = await stop(root, { last_assistant_message: DEV_OK, stop_hook_active: true });
    assert.deepEqual(second, {});
    assert.equal(subagentActive(root, SESSION), false);
    assert.equal(fs.existsSync(retryPath(root, SESSION, AGENT)), false, 'retry state removed on pass');
  } finally {
    cleanup();
  }
});

// REQ-3.5
test('hooks/subagent-stop.test.js » well-formed output clears the marker and allows', async () => {
  const { root, cleanup } = await started();
  try {
    assert.equal(subagentActive(root, SESSION), true);
    const r = await stop(root, { last_assistant_message: DEV_OK });
    assert.deepEqual(r, {});
    assert.equal(subagentActive(root, SESSION), false);
    assert.equal(fs.existsSync(markerPath(root, SESSION)), false);
  } finally {
    cleanup();
  }
});

// ---- further cases ----

test('subagent-stop » the last assistant text is read from agent_transcript_path when the message is absent', async () => {
  const { root, cleanup } = await started();
  try {
    const file = path.join(root, 'agent.jsonl');
    const entries = [
      { type: 'user', message: { role: 'user', content: 'go' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'early text' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.\nran: npm test -> exit 0' }, { type: 'tool_use', name: 'x' }, { type: 'text', text: TAIL }] } },
    ];
    fs.writeFileSync(file, `${'{"pad":"' + 'p'.repeat(300 * 1024) + '"}\n'}${entries.map((e) => JSON.stringify(e)).join('\n')}\nnot json\n`);
    assert.deepEqual(await stop(root, { agent_transcript_path: file }), {});
    assert.equal(subagentActive(root, SESSION), false);
  } finally {
    cleanup();
  }
});

// I-3: transcript_path is the main session's transcript, never the subagent's output.
test('subagent-stop » transcript_path (the main session) is not read as the subagent output', async () => {
  const { root, cleanup } = await started();
  try {
    const main = path.join(root, 'main.jsonl');
    fs.writeFileSync(main, `${JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: DEV_OK }] } })}\n`);
    const r = await stop(root, { transcript_path: main, agent_transcript_path: path.join(root, 'missing.jsonl') });
    assert.ok(isBlock(r), JSON.stringify(r));
    assert.equal(r.reason, 'output shape: no output to check. Add the missing parts and finish.');
  } finally {
    cleanup();
  }
});

test('subagent-stop » no output at all reports no output to check', async () => {
  const { root, cleanup } = await started();
  try {
    const r = await stop(root, { agent_transcript_path: path.join(root, 'missing.jsonl') });
    assert.ok(isBlock(r));
    assert.equal(r.reason, 'output shape: no output to check. Add the missing parts and finish.');
    assert.deepEqual(shapeProblems('developer', '', { root }), ['no output to check']);
  } finally {
    cleanup();
  }
});

test('subagent-stop » stop_hook_active with no retry state allows and clears the marker', async () => {
  const { root, cleanup } = await started();
  try {
    const r = await stop(root, { last_assistant_message: 'nothing', stop_hook_active: true });
    assert.deepEqual(r, {});
    assert.equal(subagentActive(root, SESSION), false);
    assert.equal(fs.existsSync(retryPath(root, SESSION, AGENT)), false);
  } finally {
    cleanup();
  }
});

test('subagent-stop » unknown role has no shape check and clears the marker', async () => {
  const { root, cleanup } = await started({ type: 'general-purpose' });
  try {
    assert.deepEqual(await stop(root, { agent_type: 'general-purpose', last_assistant_message: 'anything' }), {});
    assert.equal(subagentActive(root, SESSION), false);
  } finally {
    cleanup();
  }
});

// C-1: Claude Code sends stops two and three with stop_hook_active: true.
test('subagent-stop » second failure clears the marker and blocks with stopping:', async () => {
  const { root, cleanup } = await started();
  try {
    await start(root, { agent_id: 'agent-2' }); // a second subagent is open in the same session
    assert.ok(isBlock(await stop(root, { last_assistant_message: 'nothing' })));
    assert.equal(count(root), '2');
    const second = await stop(root, { last_assistant_message: 'still nothing', stop_hook_active: true });
    assert.ok(isBlock(second), JSON.stringify(second));
    assert.match(second.reason, /^stopping: shape still wrong after retry: /);
    assert.match(second.reason, /no "Skipped:" line/);
    assert.match(second.reason, /End your report with the line: stopping: no "Skipped:" line/);
    assert.equal(count(root), '1', 'this subagent left');
    // The stop that follows the "stopping:" block allows and does not leave a second time.
    assert.deepEqual(await stop(root, { last_assistant_message: 'stopping: …', stop_hook_active: true }), {});
    assert.equal(count(root), '1', 'the other subagent still counts');
    assert.equal(fs.existsSync(retryPath(root, SESSION, AGENT)), false);
  } finally {
    cleanup();
  }
});

// I-1: internal agents (prompt suggestions, /btw) stop without a SubagentStart.
test('subagent-stop » a stop for an agent that never started is ignored', async () => {
  const { root, cleanup } = await started();
  try {
    assert.deepEqual(await stop(root, { agent_type: '', agent_id: 'int1', last_assistant_message: 'x' }), {});
    assert.equal(subagentActive(root, SESSION), true, "the started developer's marker is still active");
    assert.deepEqual(await stop(root, { agent_type: 'developer', agent_id: 'int2', last_assistant_message: 'x' }), {});
    assert.equal(count(root), '1');
    assert.equal(fs.existsSync(retryPath(root, SESSION, 'int2')), false, 'no shape check, no retry state');
  } finally {
    cleanup();
  }
});

test('subagent-stop » an agent stops once: a repeated stop after it passed is ignored', async () => {
  const { root, cleanup } = await started();
  try {
    await start(root, { agent_id: 'agent-2' });
    assert.deepEqual(await stop(root, { last_assistant_message: DEV_OK }), {});
    assert.equal(count(root), '1');
    assert.deepEqual(await stop(root, { last_assistant_message: DEV_OK }), {});
    assert.equal(count(root), '1', 'agent-2 still counts');
  } finally {
    cleanup();
  }
});

test('subagent-stop » retry state is kept per agent', async () => {
  const { root, cleanup } = await started();
  try {
    await start(root, { agent_id: 'agent-2' });
    assert.ok(isBlock(await stop(root, { last_assistant_message: 'nothing' })));
    const other = await stop(root, { agent_id: 'agent-2', last_assistant_message: 'nothing' });
    assert.match(other.reason, /^output shape: /);
  } finally {
    cleanup();
  }
});

test('subagent-stop » retry path is sanitised and sits next to the marker', () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    const file = retryPath(root, 'a/../b', '../x');
    assert.equal(path.dirname(file), path.dirname(markerPath(root, 'a/../b')));
    assert.equal(path.basename(file), 'retry-a____b-___x');
  } finally {
    cleanup();
  }
});

test('shapes » developer needs a ran line; ASCII arrow accepted', () => {
  const root = '/nowhere';
  assert.deepEqual(shapeProblems('developer', `ok${TAIL}`, { root }), ['no "ran: <command> → exit <code>" line']);
  assert.deepEqual(shapeProblems('developer', `ran: npm test -> exit 1${TAIL}`, { root }), []);
  assert.deepEqual(shapeProblems('developer', `ran: npm test → exit 0${TAIL}`, { root }), []);
});

// M-1
test('shapes » lines inside a fenced code block do not count', () => {
  const root = '/nowhere';
  const fenced = 'text\n```\nSkipped: none\nNot checked: none\nran: x -> exit 0\nB-1\n```\n';
  assert.deepEqual(shapeProblems('developer', fenced, { root }),
    ['no "Skipped:" line', 'no "Not checked:" line', 'no "ran: <command> → exit <code>" line']);
  assert.deepEqual(shapeProblems('fixer', `${fenced.replace('B-1', 'H-2')}${TAIL}`, { root }), ['no finding id (B-<n> or H-<n>) named']);
  assert.deepEqual(shapeProblems('developer', `~~~\ncode\n~~~\nran: x -> exit 0${TAIL}`, { root }), []);
});

test('shapes » fixer needs a finding id named', () => {
  const root = '/nowhere';
  assert.deepEqual(shapeProblems('fixer', `fixed it${TAIL}`, { root }), ['no finding id (B-<n> or H-<n>) named']);
  assert.deepEqual(shapeProblems('fixer', `fixed B-2 and H-1${TAIL}`, { root }), []);
});

test('shapes » other roles need only Skipped and Not checked', () => {
  for (const role of ['auditor', 'ops', 'designer']) {
    assert.deepEqual(shapeProblems(role, TAIL, { root: '/nowhere' }), [], role);
    assert.deepEqual(shapeProblems(role, 'Skipped: x\n', { root: '/nowhere' }), ['no "Not checked:" line'], role);
  }
});

test('shapes » reviewer reads only the newest recent verdict file', () => {
  const { root, cleanup } = makeRepo();
  try {
    writeReview(root, 'P1-S-07-r1.md', 'not a verdict', 31 * 60 * 1000);
    assert.deepEqual(shapeProblems('reviewer', TAIL, { root }), ['no verdict file in .slicekit/reviews/ from this run']);
    writeReview(root, 'P1-S-07-r2.md', 'not a verdict', 60 * 1000);
    writeReview(root, 'P1-S-07-r3.md', GOOD_VERDICT);
    assert.deepEqual(shapeProblems('reviewer', TAIL, { root }), []);
  } finally {
    cleanup();
  }
});

// I-4
test('shapes » reviewer ignores another slice\'s verdict and files that are not verdicts', () => {
  const { root, cleanup } = makeRepo({ commits: 1, branch: 'slice/P1-S-07-hooks' });
  try {
    writeReview(root, 'P9-S-99-r3.md', GOOD_VERDICT);
    assert.deepEqual(shapeProblems('reviewer', TAIL, { root }), ['no verdict file in .slicekit/reviews/ from this run']);
    writeReview(root, 'P1-S-07-r1.md', 'not a verdict', 60 * 1000);
    writeReview(root, 'P1-S-07-r2.md', GOOD_VERDICT, 30 * 1000);
    writeReview(root, 'notes.txt', 'scratch');
    assert.deepEqual(shapeProblems('reviewer', TAIL, { root }), []);
    // With no active slice any well-named verdict is accepted, a non-verdict name never is.
    execFileSync('git', ['checkout', '--quiet', '-b', 'scratch'], { cwd: root });
    fs.rmSync(path.join(root, '.slicekit', 'reviews', 'P1-S-07-r2.md'));
    fs.rmSync(path.join(root, '.slicekit', 'reviews', 'P1-S-07-r1.md'));
    assert.deepEqual(shapeProblems('reviewer', TAIL, { root }), []);
    fs.rmSync(path.join(root, '.slicekit', 'reviews', 'P9-S-99-r3.md'));
    assert.deepEqual(shapeProblems('reviewer', TAIL, { root }), ['no verdict file in .slicekit/reviews/ from this run']);
  } finally {
    cleanup();
  }
});

// I-4, through the hook.
test('subagent-stop » a fresh verdict from another slice does not satisfy the reviewer', async () => {
  const { root, cleanup } = await started({ type: 'reviewer', branch: 'slice/P1-S-07-hooks' });
  try {
    writeReview(root, 'P9-S-99-r3.md', GOOD_VERDICT);
    const r = await stop(root, { agent_type: 'reviewer', last_assistant_message: `Reviewed.${TAIL}` });
    assert.ok(isBlock(r), JSON.stringify(r));
    assert.match(r.reason, /no verdict file in \.slicekit\/reviews\/ from this run/);
  } finally {
    cleanup();
  }
});
