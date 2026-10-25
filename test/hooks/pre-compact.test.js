// REQ-3.6: PreCompact writes a handoff (stage, open findings, last command, next step) into the active
// slice's state file, fails open, and session-start re-injects it after compaction (REQ-3.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { handle, lastRanLine, TRANSCRIPT_TAIL } from '../../src/hooks/pre-compact.js';
import { handle as sessionStart } from '../../src/hooks/session-start.js';
import { runHook } from '../../src/hooks/io.js';
import { CONFIG_PATH, defaultConfig } from '../../src/config.js';
import { makeRepo } from '../helpers/tmp-repo.js';
import { writeSliceFixture } from '../helpers/slice-fixture.js';
import { setState } from '../../src/state/index.js';

const SLICE = 'P1/S-07';
const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const stateFile = (root) => path.join(root, '.slicekit', 'state', 'P1-S-07.json');
const HISTORY = [{ from: 'todo', to: 'tests-red', at: '2026-10-25T00:00:00.000Z', by: 'cli', evidence: { commit: 'abc' } }];

function repo({ branch = 'slice/P1-S-07-hooks', state = 'building', extra = {}, writeState = true } = {}) {
  const r = makeRepo({ commits: 1 });
  git(r.root, ['checkout', '--quiet', '-b', branch]);
  const conf = path.join(r.root, CONFIG_PATH);
  fs.mkdirSync(path.dirname(conf), { recursive: true });
  fs.writeFileSync(conf, JSON.stringify(cfg));
  if (writeState) {
    fs.mkdirSync(path.dirname(stateFile(r.root)), { recursive: true });
    fs.writeFileSync(stateFile(r.root), JSON.stringify({ slice: SLICE, state, history: HISTORY, ...extra }, null, 2));
  }
  return r;
}

const readState = (root) => JSON.parse(fs.readFileSync(stateFile(root), 'utf8'));

function transcript(root, entries, name = 'transcript.jsonl') {
  const file = path.join(root, name);
  fs.writeFileSync(file, `${entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n')}\n`);
  return file;
}
const assistant = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolResult = (content) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content }] } });
const userSays = (text) => ({ type: 'user', message: { role: 'user', content: text } });

function verdict(root, k, body) {
  const dir = path.join(root, '.slicekit', 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `P1-S-07-r${k}.md`), body);
}
const TABLE = '| ID | file:line | what is wrong | why it matters | how verified |\n|---|---|---|---|---|\n';
const BLOCK_VERDICT = `Verdict: BLOCK\n\n${TABLE}| B-1 | src/a.js:3 | wrong | matters | ran it |\n| H-1 | src/b.js:4 | meh | minor | read |\n| B-2 | src/c.js:5 | bad | breaks | ran it |\n`;
const APPROVE_VERDICT = `Verdict: APPROVE\n\n${TABLE}| H-1 | src/b.js:4 | meh | minor | read |\n`;

const run = (root, input = {}) => handle({ session_id: 's', trigger: 'auto', cwd: root, ...input }, { root, cfg, env: process.env });
const runVia = (root, input = {}) => runHook('pre-compact', { stdin: JSON.stringify({ session_id: 's', trigger: 'auto', cwd: root, ...input }), root });

// ---- evaluation set ----

// REQ-3.6
test('writes handoff with stage, findings, last command, next step', async () => {
  const r = repo({ state: 'building' });
  try {
    verdict(r.root, 1, BLOCK_VERDICT);
    const t = transcript(r.root, [assistant('ran: npm test → exit 1'), assistant('thinking'), toolResult('ok')]);
    const out = await run(r.root, { transcript_path: t });
    assert.deepEqual(out, {});
    const s = readState(r.root);
    assert.equal(s.state, 'building');
    assert.equal(s.handoff.state, 'building');
    assert.equal(s.handoff.openFindings, 'B-1, B-2');
    assert.equal(s.handoff.lastCommand, 'ran: npm test → exit 1');
    assert.equal(s.handoff.nextStep, 'run the test command; when green run slicekit check and push');
    assert.ok(!Number.isNaN(Date.parse(s.handoff.at)));
    assert.deepEqual(Object.keys(s.handoff), ['at', 'state', 'openFindings', 'lastCommand', 'nextStep']);
  } finally {
    r.cleanup();
  }
});

// ---- no slice, unreadable state ----

test('no active slice answers {} and writes nothing', async () => {
  const r = repo({ branch: 'feature/x', writeState: false });
  try {
    assert.deepEqual(await run(r.root), {});
    assert.equal(fs.existsSync(path.join(r.root, '.slicekit', 'state')), false);
  } finally {
    r.cleanup();
  }
});

test('a slice branch with no state file and no slice file answers {}', async () => {
  const r = repo({ writeState: false });
  try {
    assert.deepEqual(await run(r.root), {});
    assert.equal(fs.existsSync(stateFile(r.root)), false);
  } finally {
    r.cleanup();
  }
});

test('an unreadable state file answers {} with a stderr note and is left untouched', async () => {
  const r = repo({ writeState: false });
  try {
    fs.mkdirSync(path.dirname(stateFile(r.root)), { recursive: true });
    fs.writeFileSync(stateFile(r.root), '{ not json');
    const res = await runVia(r.root);
    assert.equal(res.stdout, '{}');
    assert.equal(res.code, 0);
    assert.match(res.stderr, /slicekit hook pre-compact failed: .*not valid JSON/);
    assert.equal(fs.readFileSync(stateFile(r.root), 'utf8'), '{ not json');
  } finally {
    r.cleanup();
  }
});

// ---- next step ----

const NEXT = [
  ['tests-red', {}, 'build until the frozen tests pass'],
  ['building', {}, 'run the test command; when green run slicekit check and push'],
  ['draft-pr', { verdict: [1, APPROVE_VERDICT] }, 'address verdict .slicekit/reviews/P1-S-07-r1.md'],
  ['in-review', { verdict: [2, BLOCK_VERDICT] }, 'address verdict .slicekit/reviews/P1-S-07-r2.md'],
  ['in-review', {}, 'run slicekit status'],
  ['changes-requested', { verdict: [1, BLOCK_VERDICT] }, 'fix blockers B-1, B-2'],
  ['changes-requested', { verdict: [1, APPROVE_VERDICT] }, 'address verdict .slicekit/reviews/P1-S-07-r1.md'],
  ['changes-requested', {}, 'run slicekit status'],
  ['ready', {}, 'run slicekit status'],
  ['todo', {}, 'run slicekit status'],
];
for (const [state, opts, expected] of NEXT) {
  test(`next step at ${state}${opts.verdict ? ` with verdict r${opts.verdict[0]}` : ''}: ${expected}`, async () => {
    const r = repo({ state });
    try {
      if (opts.verdict) verdict(r.root, ...opts.verdict);
      await run(r.root);
      assert.equal(readState(r.root).handoff.nextStep, expected);
    } finally {
      r.cleanup();
    }
  });
}

// ---- verdicts ----

test('a BLOCK verdict lists its blockers, not its should-haves', async () => {
  const r = repo();
  try {
    verdict(r.root, 1, BLOCK_VERDICT);
    await run(r.root);
    assert.equal(readState(r.root).handoff.openFindings, 'B-1, B-2');
  } finally {
    r.cleanup();
  }
});

test('the latest verdict decides: an APPROVE after a BLOCK gives none', async () => {
  const r = repo();
  try {
    verdict(r.root, 1, BLOCK_VERDICT);
    verdict(r.root, 2, APPROVE_VERDICT);
    await run(r.root);
    assert.equal(readState(r.root).handoff.openFindings, 'none');
  } finally {
    r.cleanup();
  }
});

test('the latest round is compared as a number: r10 is later than r9', async () => {
  const r = repo();
  try {
    verdict(r.root, 9, APPROVE_VERDICT);
    verdict(r.root, 10, BLOCK_VERDICT);
    await run(r.root);
    assert.equal(readState(r.root).handoff.openFindings, 'B-1, B-2');
  } finally {
    r.cleanup();
  }
});

test('a verdict of another slice is not read', async () => {
  const r = repo();
  try {
    const dir = path.join(r.root, '.slicekit', 'reviews');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'P1-S-08-r1.md'), BLOCK_VERDICT);
    await run(r.root);
    assert.equal(readState(r.root).handoff.openFindings, 'none');
  } finally {
    r.cleanup();
  }
});

test('no verdict at all gives none', async () => {
  const r = repo();
  try {
    await run(r.root);
    assert.equal(readState(r.root).handoff.openFindings, 'none');
  } finally {
    r.cleanup();
  }
});

// ---- transcript ----

test('no transcript_path gives lastCommand none', async () => {
  const r = repo();
  try {
    await run(r.root);
    assert.equal(readState(r.root).handoff.lastCommand, 'none');
  } finally {
    r.cleanup();
  }
});

test('a missing transcript gives none', async () => {
  const r = repo();
  try {
    await run(r.root, { transcript_path: path.join(r.root, 'nope.jsonl') });
    assert.equal(readState(r.root).handoff.lastCommand, 'none');
  } finally {
    r.cleanup();
  }
});

test('a transcript path that is a directory gives none', async () => {
  const r = repo();
  try {
    await run(r.root, { transcript_path: r.root });
    assert.equal(readState(r.root).handoff.lastCommand, 'none');
  } finally {
    r.cleanup();
  }
});

test('invalid JSON lines are skipped; the last valid ran: line wins', async () => {
  const r = repo();
  try {
    const t = transcript(r.root, [
      toolResult('ran: npm run lint → exit 0'), '{broken', 'not json at all',
      toolResult('ran: node bin/slicekit.js check → exit 0\nmore output'), '{"x":',
    ]);
    await run(r.root, { transcript_path: t });
    assert.equal(readState(r.root).handoff.lastCommand, 'ran: node bin/slicekit.js check → exit 0');
  } finally {
    r.cleanup();
  }
});

test('text the user typed is not a command run', async () => {
  const r = repo();
  try {
    const t = transcript(r.root, [assistant('ran: npm test → exit 0'), userSays('ran: something else → exit 0')]);
    await run(r.root, { transcript_path: t });
    assert.equal(readState(r.root).handoff.lastCommand, 'ran: npm test → exit 0');
  } finally {
    r.cleanup();
  }
});

// Whole-branch M4: the same ran: shape as the developer check (shapes.js); a line with no result is
// not a command run.
test('a ran: line without its exit code is skipped', async () => {
  const r = repo();
  try {
    const t = transcript(r.root, [assistant('ran: npm test -> exit 2'), assistant('ran: next I will lint')]);
    await run(r.root, { transcript_path: t });
    assert.equal(readState(r.root).handoff.lastCommand, 'ran: npm test -> exit 2');
  } finally {
    r.cleanup();
  }
});

test('a huge transcript is read only in its tail', async () => {
  const r = repo();
  try {
    const filler = assistant('x'.repeat(1000));
    const lines = [assistant('ran: early → exit 0'), ...Array.from({ length: Math.ceil((TRANSCRIPT_TAIL * 2) / 1000) }, () => filler)];
    const t = transcript(r.root, lines);
    assert.ok(fs.statSync(t).size > TRANSCRIPT_TAIL * 2);
    assert.equal(lastRanLine(t), null);
    fs.appendFileSync(t, `${JSON.stringify(toolResult([{ type: 'text', text: 'ran: late → exit 3' }]))}\n`);
    await run(r.root, { transcript_path: t });
    assert.equal(readState(r.root).handoff.lastCommand, 'ran: late → exit 3');
  } finally {
    r.cleanup();
  }
});

test('a long ran: line is cut to 200 characters on one line', async () => {
  const r = repo();
  try {
    const t = transcript(r.root, [assistant(`ran: ${'a'.repeat(400)} → exit 0`)]);
    await run(r.root, { transcript_path: t });
    const got = readState(r.root).handoff.lastCommand;
    assert.equal(got.length, 200);
    assert.ok(got.startsWith('ran: aaa'));
  } finally {
    r.cleanup();
  }
});

// ---- the lock and the state ----

test('the slice lock held: no write, {} with a stderr note, within the 2 s budget', async () => {
  const r = repo();
  try {
    const before = fs.readFileSync(stateFile(r.root), 'utf8');
    fs.writeFileSync(`${stateFile(r.root)}.lock`, '');
    const t0 = Date.now();
    const res = await runVia(r.root);
    const took = Date.now() - t0;
    assert.equal(res.stdout, '{}');
    assert.match(res.stderr, /slicekit hook pre-compact failed: could not lock P1\/S-07/);
    assert.ok(took < 4000, `took ${took} ms`);
    assert.equal(fs.readFileSync(stateFile(r.root), 'utf8'), before);
    assert.ok(fs.existsSync(`${stateFile(r.root)}.lock`), 'the lock of its holder is not removed');
  } finally {
    r.cleanup();
  }
});

test('writing the handoff leaves the state and history unchanged', async () => {
  const r = repo({ state: 'in-review', extra: { pr: { number: 7, headSha: 'abc' } } });
  try {
    const before = readState(r.root);
    await run(r.root);
    const after = readState(r.root);
    assert.equal(after.state, 'in-review');
    assert.deepEqual(after.history, HISTORY);
    for (const [k, v] of Object.entries(before)) assert.deepEqual(after[k], v, k);
    assert.equal(fs.existsSync(`${stateFile(r.root)}.lock`), false);
  } finally {
    r.cleanup();
  }
});

test('a second compaction replaces the handoff', async () => {
  const r = repo({ extra: { handoff: { at: 'old', state: 'old' } } });
  try {
    await run(r.root);
    assert.equal(readState(r.root).handoff.state, 'building');
  } finally {
    r.cleanup();
  }
});

// ---- end to end ----

test('round trip: pre-compact through runHook, then session-start on compact prints the handoff', async () => {
  const r = repo({ state: 'changes-requested' });
  try {
    verdict(r.root, 1, BLOCK_VERDICT);
    const t = transcript(r.root, [assistant('ran: npm test → exit 1')]);
    const res = await runVia(r.root, { transcript_path: t, trigger: 'manual' });
    assert.equal(res.stdout, '{}');
    assert.equal(res.stderr, '');
    const out = await sessionStart({ session_id: 's', source: 'compact', cwd: r.root }, { root: r.root, cfg, env: process.env });
    const lines = out.hookSpecificOutput.additionalContext.split('\n');
    const handoff = lines.filter((l) => l.startsWith('handoff: '));
    assert.equal(handoff.length, 5);
    assert.match(handoff[0], /^handoff: at: \d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(handoff.slice(1), [
      'handoff: state: changes-requested',
      'handoff: openFindings: B-1, B-2',
      'handoff: lastCommand: ran: npm test → exit 1',
      'handoff: nextStep: fix blockers B-1, B-2',
    ]);
    assert.ok(lines.includes('active slice: P1/S-07 (changes-requested)'));
    assert.ok(lines.includes('Brief: run slicekit instructions developer P1/S-07'));
  } finally {
    r.cleanup();
  }
});

// ---- fix round 1 ----

test('a secret in the last command is masked before the 200-character cut', async () => {
  const r = repo();
  try {
    const token = `ghp_${'A'.repeat(36)}`;
    const cmd = `ran: ${'x'.repeat(190)} ${token} → exit 0`;
    assert.ok(cmd.indexOf(token) < 200 && cmd.indexOf(token) + token.length > 200);
    const t = transcript(r.root, [assistant(cmd)]);
    await run(r.root, { transcript_path: t });
    const got = readState(r.root).handoff.lastCommand;
    assert.ok(!got.includes('ghp_'), got);
    assert.ok(got.includes('***'), got);
    assert.ok(got.length <= 200);
    assert.ok(!fs.readFileSync(stateFile(r.root), 'utf8').includes('AAAAAAAAAA'));
  } finally {
    r.cleanup();
  }
});

test('a Bearer token in the last command is masked in the state file', async () => {
  const r = repo();
  try {
    const t = transcript(r.root, [assistant('ran: curl -H "Authorization: Bearer abcdef123456" https://api → exit 0')]);
    await run(r.root, { transcript_path: t });
    assert.equal(readState(r.root).handoff.lastCommand, 'ran: curl -H "Authorization: Bearer ***" https://api → exit 0');
  } finally {
    r.cleanup();
  }
});

test('an assistant ran: line wins over a later tool result that echoes one', async () => {
  const r = repo();
  try {
    const t = transcript(r.root, [
      assistant('ran: npm test → exit 0'),
      toolResult('old report:\nran: rm -rf build → exit 0'),
    ]);
    await run(r.root, { transcript_path: t });
    assert.equal(readState(r.root).handoff.lastCommand, 'ran: npm test → exit 0');
  } finally {
    r.cleanup();
  }
});

test('a slice file but no state file: nothing is created and the hook answers {}', async () => {
  const r = repo({ writeState: false });
  try {
    writeSliceFixture(r.root, { n: 7 });
    assert.deepEqual(await run(r.root), {});
    assert.equal(fs.existsSync(stateFile(r.root)), false);
  } finally {
    r.cleanup();
  }
});

test('a transition clears the handoff, so session-start on compact prints none', async () => {
  const r = repo({ state: 'tests-red', extra: { frozenTests: ['a.test.js'] } });
  try {
    const head = git(r.root, ['rev-parse', 'HEAD']);
    const s = readState(r.root);
    fs.writeFileSync(stateFile(r.root), JSON.stringify({ ...s, redCommit: head }));
    fs.writeFileSync(path.join(r.root, 'a.test.js'), '');
    await run(r.root);
    assert.equal(readState(r.root).handoff.state, 'tests-red');
    const next = setState(r.root, cfg, SLICE, 'building');
    assert.equal(next.handoff, null);
    assert.equal(readState(r.root).handoff, null);
    const out = await sessionStart({ session_id: 's', source: 'compact', cwd: r.root }, { root: r.root, cfg, env: process.env });
    const lines = out.hookSpecificOutput.additionalContext.split('\n');
    assert.deepEqual(lines.filter((l) => l.startsWith('handoff: ')), []);
    assert.ok(lines.includes('active slice: P1/S-07 (building)'));
  } finally {
    r.cleanup();
  }
});
