// REQ-3.4: SubagentStart marks that a subagent is running and injects its role brief, the writing
// rules and the no-git rule. Fails open through io.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handle, roleOf, BRIEF_MAX, NO_GIT } from '../../src/hooks/subagent-start.js';
import { markerPath, subagentActive } from '../../src/hooks/subagent-marker.js';
import { defaultConfig } from '../../src/config.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
const SESSION = 'sess-start-1';
const text = (r) => r.hookSpecificOutput?.additionalContext;
const start = (root, input = {}, opts = {}) => handle(
  { session_id: SESSION, agent_type: 'developer', agent_id: 'a1', cwd: root, ...input },
  { root, cfg, env: {}, commands: {}, ...opts },
);

// ---- evaluation set ----

// REQ-3.4
test('hooks/subagent-start.test.js » sets marker and injects brief and no-git rule', async () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    const r = await start(root);
    assert.equal(r.hookSpecificOutput?.hookEventName, 'SubagentStart');
    assert.equal(subagentActive(root, SESSION), true);
    assert.equal(fs.readFileSync(markerPath(root, SESSION), 'utf8').trim(), '1');
    const t = text(r);
    assert.ok(t.startsWith('Brief: role developer.\n'), t);
    assert.match(t, /# Writing rules/);
    assert.doesNotMatch(t, /^name: slicekit-writing/m, 'front matter stripped');
    assert.ok(t.endsWith(`\n${NO_GIT}`), t);
    assert.equal(NO_GIT, 'You never run git; report and the command commits.');
  } finally {
    cleanup();
  }
});

// ---- further cases ----

test('subagent-start » role mapping: known names, namespaced names, unknown is other', () => {
  for (const r of ['developer', 'reviewer', 'fixer', 'auditor', 'ops', 'designer']) assert.equal(roleOf(r), r);
  assert.equal(roleOf('Reviewer'), 'reviewer');
  assert.equal(roleOf('plugin:fixer'), 'fixer');
  assert.equal(roleOf('general-purpose'), 'other');
  assert.equal(roleOf(undefined), 'other');
  assert.equal(roleOf(7), 'other');
});

test('subagent-start » unknown role gets the placeholder for other', async () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    const t = text(await start(root, { agent_type: 'Explore' }));
    assert.ok(t.startsWith('Brief: role other.\n'), t);
  } finally {
    cleanup();
  }
});

test('subagent-start » two starts count two', async () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    await start(root);
    await start(root, { agent_id: 'a2' });
    assert.equal(fs.readFileSync(markerPath(root, SESSION), 'utf8').trim(), '2');
  } finally {
    cleanup();
  }
});

test('subagent-start » the project-rendered writing skill wins over the kit template', async () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    const file = path.join(root, '.claude', 'skills', 'slicekit-writing', 'SKILL.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '---\nname: slicekit-writing\ndescription: x\n---\n# Project rules\r\n\r\n- one\n');
    const t = text(await start(root));
    assert.match(t, /# Project rules/);
    assert.doesNotMatch(t, /# Writing rules/);
    assert.doesNotMatch(t, /description: x/);
  } finally {
    cleanup();
  }
});

test('subagent-start » the brief is capped at 8000 characters and keeps the no-git rule', async () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    const file = path.join(root, '.claude', 'skills', 'slicekit-writing', 'SKILL.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `# Rules\n${'x'.repeat(20000)}\n`);
    const t = text(await start(root));
    assert.equal(BRIEF_MAX, 8000);
    assert.ok(t.length <= 8000, String(t.length));
    assert.ok(t.endsWith(`\n${NO_GIT}`));
  } finally {
    cleanup();
  }
});

// M-3: a cut brief says so and names where the full text is; the no-git sentence stays last.
test('subagent-start » a truncated brief names the full text and keeps the no-git rule last', async () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    const file = path.join(root, '.claude', 'skills', 'slicekit-writing', 'SKILL.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `# Rules\n${'x'.repeat(20000)}\n`);
    const t = text(await start(root));
    assert.ok(t.length <= 8000, String(t.length));
    assert.ok(t.endsWith(`\n(brief truncated; full text in .claude/skills/slicekit-writing/SKILL.md)\n\n${NO_GIT}`), t.slice(-200));
    // An uncut brief carries no such line.
    fs.writeFileSync(file, '# Rules\n- short\n');
    assert.doesNotMatch(text(await start(root, { agent_id: 'a2' })), /brief truncated/);
  } finally {
    cleanup();
  }
});

test('subagent-start » uses `slicekit instructions <role>` when that command exists', async () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    const seen = [];
    const commands = {
      instructions: {
        usage: 'instructions <role>',
        run: async (args, io) => {
          seen.push(args);
          io.stdout('Role brief for reviewer.\n');
          return 0;
        },
      },
    };
    const t = text(await start(root, { agent_type: 'reviewer' }, { commands }));
    assert.deepEqual(seen, [['reviewer']]);
    assert.ok(t.startsWith('Role brief for reviewer.\n'), t);
    // A failing command falls back to the placeholder.
    const failing = { instructions: { run: async () => 1 } };
    const t2 = text(await start(root, { agent_type: 'reviewer' }, { commands: failing }));
    assert.ok(t2.startsWith('Brief: role reviewer.\n'), t2);
  } finally {
    cleanup();
  }
});

test('subagent-start » outside a git repository the marker is under .slicekit', async () => {
  const { root, cleanup } = makeRepo();
  try {
    fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
    await start(root);
    assert.ok(fs.existsSync(path.join(root, '.slicekit', `.subagent-${SESSION}`)));
  } finally {
    cleanup();
  }
});
