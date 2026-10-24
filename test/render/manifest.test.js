import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadManifest, entriesForShape } from '../../src/render/manifest.js';

const root = fileURLToPath(new URL('../../templates/claude-code/', import.meta.url));

test('every manifest src exists', () => {
  const entries = loadManifest();
  assert.equal(entries.length, 18);
  for (const e of entries) assert.ok(fs.existsSync(root + e.src), e.src);
});

test('entriesForShape backend excludes designer', () => {
  const srcs = entriesForShape('backend').map((e) => e.src);
  assert.ok(!srcs.includes('agents/designer.md'));
  assert.equal(srcs.length, 17);
});

test('entriesForShape fullstack includes designer', () => {
  const srcs = entriesForShape('fullstack').map((e) => e.src);
  assert.ok(srcs.includes('agents/designer.md'));
  assert.equal(srcs.length, 18);
});

test('every dest is relative and under .claude', () => {
  for (const e of loadManifest()) assert.match(e.dest, /^\.claude\/[^\\]+$/);
});

test('hooks.json names every event in the contract table', () => {
  const hooks = JSON.parse(fs.readFileSync(root + 'hooks.json', 'utf8'));
  assert.deepEqual(
    Object.keys(hooks).sort(),
    ['PreCompact', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop'],
  );
  assert.equal(hooks.PreToolUse.length, 2);
  assert.equal(hooks.Stop[0].hooks[0].timeout, 120);
  assert.equal(hooks.SessionEnd[0].hooks[0].command, '{{cli}} hook session-end');
});

test('templates carry no banned filler phrase', () => {
  const banned = JSON.parse(fs.readFileSync(root + '../style.json', 'utf8')).banned;
  for (const e of loadManifest()) {
    const text = fs.readFileSync(root + e.src, 'utf8');
    if (e.src === 'skills/slicekit-writing/SKILL.md') continue; // quotes the list on purpose
    for (const b of banned) assert.ok(!text.toLowerCase().includes(b), `${e.src}: ${b}`);
  }
});
