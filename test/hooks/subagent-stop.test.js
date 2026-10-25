// REQ-3.5, REQ-2.11, REQ-2.12: SubagentStop clears the subagent marker and blocks the subagent once
// when its output lacks its role's shape. Fails closed through io.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from '../../src/hooks/subagent-stop.js';
import { shapeProblems } from '../../src/hooks/shapes.js';
import { enter, markerPath, retryPath, subagentActive } from '../../src/hooks/subagent-marker.js';
import { defaultConfig } from '../../src/config.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
const SESSION = 'sess-stop-1';
const AGENT = 'agent-1';
const TAIL = '\nSkipped: none\nNot checked: performance\n';
const DEV_OK = `Built the parser.\nran: npm test → exit 0${TAIL}`;
const VERDICT_TAIL = '\n## Checklists run\n\n- correctness\n\n## Not checked\n\n- security\n';
const TABLE = '| ID | File:line | What is wrong | Why it matters | How verified |\n|---|---|---|---|---|\n';

const stop = (root, input = {}) => handle(
  { session_id: SESSION, agent_id: AGENT, agent_type: 'developer', cwd: root, ...input },
  { root, cfg, env: {} },
);
const isBlock = (r) => r.decision === 'block' && typeof r.reason === 'string';

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

function repoWithMarker() {
  const repo = makeRepo({ commits: 1 });
  enter(repo.root, SESSION);
  return repo;
}

// ---- evaluation set ----

// REQ-3.5
test('hooks/subagent-stop.test.js » reviewer without verdict file blocks naming it', async () => {
  const { root, cleanup } = repoWithMarker();
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
  const { root, cleanup } = repoWithMarker();
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
  const { root, cleanup } = repoWithMarker();
  try {
    const first = await stop(root, { last_assistant_message: 'Built it.\nran: npm test → exit 0\n' });
    assert.ok(isBlock(first), JSON.stringify(first));
    assert.match(first.reason, /no "Skipped:" line/);
    assert.match(first.reason, /no "Not checked:" line/);
    assert.ok(fs.existsSync(retryPath(root, SESSION, AGENT)), 'retry state written');
    const second = await stop(root, { last_assistant_message: DEV_OK });
    assert.deepEqual(second, {});
    assert.equal(subagentActive(root, SESSION), false);
    assert.equal(fs.existsSync(retryPath(root, SESSION, AGENT)), false, 'retry state removed on pass');
  } finally {
    cleanup();
  }
});

// REQ-3.5
test('hooks/subagent-stop.test.js » well-formed output clears the marker and allows', async () => {
  const { root, cleanup } = repoWithMarker();
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

test('subagent-stop » the last assistant text is read from the transcript when the message is absent', async () => {
  const { root, cleanup } = repoWithMarker();
  try {
    const file = path.join(root, 'agent.jsonl');
    const entries = [
      { type: 'user', message: { role: 'user', content: 'go' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'early text' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.\nran: npm test -> exit 0' }, { type: 'tool_use', name: 'x' }, { type: 'text', text: TAIL }] } },
    ];
    fs.writeFileSync(file, `${'{"pad":"' + 'p'.repeat(300 * 1024) + '"}\n'}${entries.map((e) => JSON.stringify(e)).join('\n')}\nnot json\n`);
    assert.deepEqual(await stop(root, { agent_transcript_path: file, transcript_path: path.join(root, 'none.jsonl') }), {});
    // transcript_path is the fallback when agent_transcript_path is absent.
    enter(root, SESSION);
    assert.deepEqual(await stop(root, { transcript_path: file }), {});
    assert.equal(subagentActive(root, SESSION), false);
  } finally {
    cleanup();
  }
});

test('subagent-stop » no output at all reports no output to check', async () => {
  const { root, cleanup } = repoWithMarker();
  try {
    const r = await stop(root, { transcript_path: path.join(root, 'missing.jsonl') });
    assert.ok(isBlock(r));
    assert.equal(r.reason, 'output shape: no output to check. Add the missing parts and finish.');
    assert.deepEqual(shapeProblems('developer', '', { root }), ['no output to check']);
  } finally {
    cleanup();
  }
});

test('subagent-stop » stop_hook_active allows without blocking again and clears the marker', async () => {
  const { root, cleanup } = repoWithMarker();
  try {
    const first = await stop(root, { last_assistant_message: 'nothing' });
    assert.ok(isBlock(first));
    const r = await stop(root, { last_assistant_message: 'nothing', stop_hook_active: true });
    assert.deepEqual(r, {});
    assert.equal(subagentActive(root, SESSION), false);
    assert.equal(fs.existsSync(retryPath(root, SESSION, AGENT)), false);
  } finally {
    cleanup();
  }
});

test('subagent-stop » unknown role has no shape check and clears the marker', async () => {
  const { root, cleanup } = repoWithMarker();
  try {
    assert.deepEqual(await stop(root, { agent_type: 'general-purpose', last_assistant_message: 'anything' }), {});
    assert.equal(subagentActive(root, SESSION), false);
  } finally {
    cleanup();
  }
});

test('subagent-stop » second failure clears the marker and blocks with stopping:', async () => {
  const { root, cleanup } = repoWithMarker();
  try {
    enter(root, SESSION); // a second subagent is open in the same session
    assert.ok(isBlock(await stop(root, { last_assistant_message: 'nothing' })));
    assert.equal(fs.readFileSync(markerPath(root, SESSION), 'utf8').trim(), '2');
    const second = await stop(root, { last_assistant_message: 'still nothing' });
    assert.ok(isBlock(second));
    assert.match(second.reason, /^stopping: shape still wrong after retry: /);
    assert.match(second.reason, /no "Skipped:" line/);
    assert.equal(fs.readFileSync(markerPath(root, SESSION), 'utf8').trim(), '1', 'this subagent left');
    // The stop that follows the "stopping:" block allows and does not leave a second time.
    assert.deepEqual(await stop(root, { last_assistant_message: 'still nothing', stop_hook_active: true }), {});
    assert.equal(fs.readFileSync(markerPath(root, SESSION), 'utf8').trim(), '1', 'the other subagent still counts');
    assert.equal(fs.existsSync(retryPath(root, SESSION, AGENT)), false);
  } finally {
    cleanup();
  }
});

test('subagent-stop » retry state is kept per agent', async () => {
  const { root, cleanup } = repoWithMarker();
  try {
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
    writeReview(root, 'old.md', 'not a verdict', 31 * 60 * 1000);
    assert.deepEqual(shapeProblems('reviewer', TAIL, { root }), ['no verdict file in .slicekit/reviews/ from this run']);
    writeReview(root, 'r1.md', 'not a verdict', 60 * 1000);
    writeReview(root, 'r2.md', `Verdict: APPROVE\n${VERDICT_TAIL}`);
    assert.deepEqual(shapeProblems('reviewer', TAIL, { root }), []);
  } finally {
    cleanup();
  }
});
