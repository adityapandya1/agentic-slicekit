// REQ-4.6's Enforced by (D-47, D-48): the `workspace` check rule. A slice's `repo:` is `.` or a
// workspace entry; a contract names at least one producer and one consumer, as slices or in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../../src/init.js';
import { check } from '../../src/check/index.js';
import { makeRepo } from '../helpers/tmp-repo.js';
import { sliceFile, WORKSPACE_REL, writeJson } from '../helpers/workspace-fixture.js';

const load = async () => (await import('../../src/check/rules/workspace.js')).default;

function write(root, rel, text) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// An init'd repo with `files` on top -> the workspace rule's lines.
async function run(files = {}) {
  const rule = await load();
  const repo = makeRepo({ commits: 1 });
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js' });
    for (const [rel, text] of Object.entries(files)) {
      if (rel === WORKSPACE_REL) writeJson(repo.root, rel, text);
      else write(repo.root, rel, text);
    }
    return check(repo.root, { rules: [rule] });
  } finally {
    repo.cleanup();
  }
}

const SLICES = {
  'docs/phases/P1-x/P1.md': '# Phase 1 — X\n\n**Order:** A\n',
  'docs/phases/P1-x/S-01-a.md': sliceFile('P1/S-01', 'A', '.', ['REQ-1.1']),
  'docs/phases/P1-x/S-04-b.md': sliceFile('P1/S-04', 'B', 'orders', ['REQ-1.1']),
};
const ENTRY = (name) => ({ name, path: `../${name}`, defaultBranch: 'main' });

test('workspace is a blocking rule', async () => {
  const rule = await load();
  assert.equal(rule.id, 'workspace');
  assert.equal(rule.blocking, true);
  assert.equal(rule.ratchet, false);
});

test('a slice whose repo is not a workspace entry is a finding', async () => {
  const listed = await run({ ...SLICES, [WORKSPACE_REL]: { repos: [ENTRY('billing')] } });
  assert.deepEqual(listed.lines, [
    `workspace docs/phases/P1-x/S-04-b.md:4 slice P1/S-04 names repo orders, which ${WORKSPACE_REL} does not list`,
    'check: 1 findings, 0 over baseline, 1 blocking, 1 rules',
  ]);
  const r = await run(SLICES);
  assert.deepEqual(r.lines, [
    'workspace docs/phases/P1-x/S-04-b.md:4 slice P1/S-04 names repo orders; there is no workspace file',
    'check: 1 findings, 0 over baseline, 1 blocking, 1 rules',
  ]);
  assert.equal(r.exitCode, 1);
});

test('slices on . and on a listed repository, and contracts naming both sides, pass', async () => {
  const r = await run({
    ...SLICES,
    [WORKSPACE_REL]: { repos: [ENTRY('billing'), { name: 'orders', url: 'https://github.com/acme/orders', defaultBranch: 'main' }] },
    'docs/spec/contracts/C-2-order-created.md': '# C-2 order.created\n\n**Producer:** P1/S-04. **Consumers:** P1/S-01.\n',
  });
  assert.deepEqual(r.lines, ['check: 0 findings, 0 over baseline, 0 blocking, 1 rules']);
  assert.equal(r.exitCode, 0);
});

test('a workspace file that cannot be read is one finding', async () => {
  const r = await run({ ...SLICES, [WORKSPACE_REL]: '{ nope' });
  assert.equal(r.lines.length, 2, r.lines.join('\n'));
  assert.ok(r.lines[0].startsWith(`workspace ${WORKSPACE_REL}:1 ${WORKSPACE_REL}: not valid JSON: `), r.lines[0]);
  assert.equal(r.lines[1], 'check: 1 findings, 0 over baseline, 1 blocking, 1 rules');
});

const contract = (rel, text) => ({ [`docs/spec/contracts/${rel}`]: text });

test('a contract naming no consumer is a finding', async () => {
  const r = await run({
    ...contract('C-5-none.md', '# C-5 Nothing\n\nNo parties here.\n'),
    ...contract('C-6-empty.md', '# C-6 Empty\n\n**Producer:** P1/S-01. **Consumers:**\n\n**Version:** one.\n'),
    ...contract('C-7-blank.md', '# C-7 Blank\n\n**Producer:** .\n**Consumer:** the billing team.\n'),
  });
  assert.deepEqual(r.lines, [
    'workspace docs/spec/contracts/C-5-none.md:1 C-5 names no producer',
    'workspace docs/spec/contracts/C-5-none.md:1 C-5 names no consumer',
    'workspace docs/spec/contracts/C-6-empty.md:1 C-6 names no consumer',
    'workspace docs/spec/contracts/C-7-blank.md:1 C-7 names no producer',
    'check: 4 findings, 0 over baseline, 4 blocking, 1 rules',
  ]);
});

test('a party named in words, over several lines, or as slices is enough (D-48)', async () => {
  const r = await run({
    ...contract('C-1-words.md', '# C-1 Words\n\n**Producer:** the kit: the renderer in `src/render/`; the hook handlers\nin `src/hooks/`.\n**Consumer:** the agent tool the team uses.\n'),
    ...contract('C-2-slices.md', '# C-2 Slices\n\n**Producers:** P1/S-01. **Consumers:** P1/S-04, P1/S-09.\n'),
  });
  assert.deepEqual(r.lines, ['check: 0 findings, 0 over baseline, 0 blocking, 1 rules']);
});
