import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { main } from '../../src/cli/index.js';
import { init } from '../../src/init.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const STAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'stage');

async function cli(root, args) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

// An initialised repository with a pinned intake, settled decisions and a spec; each test commits
// it, which puts it past spec review.
async function withProgram(fn) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend', env: {} });
    fs.cpSync(path.join(STAGE, 'after-intake'), repo.root, { recursive: true });
    fs.cpSync(path.join(STAGE, 'after-plan', 'docs', 'spec'), path.join(repo.root, 'docs', 'spec'), { recursive: true });
    fs.cpSync(path.join(STAGE, 'after-plan', 'docs', 'decisions.md'), path.join(repo.root, 'docs', 'decisions.md'));
    return await fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

const write = (root, rel, text) => fs.writeFileSync(path.join(root, rel), text);
// init installs the kit's git hooks, which refuse a commit on main; the fixture states its exception.
const env = { ...process.env, ALLOW_PROTECTED_COMMIT: '1' };
const record = (root, message) => {
  for (const args of [['add', '-A'], ['commit', '-m', message]]) execFileSync('git', args, { cwd: root, env, stdio: 'ignore' });
};

const MARKER = '[NEEDS CLARIFICATION: which thing?]';
const spec = (claim) =>
  `# A\n\n### REQ-1.1 The thing works\n\nThe thing SHALL work ${claim}.\n\nScenario: GIVEN a thing WHEN it runs THEN it works.\n\nCites: intake/2026-01-01-brief.md, D-01.\n\nEnforced by: advisory\n`;
const gaps = (closedBy) =>
  `# Gaps\n\n| # | Class | Where | What | Closed by |\n|---|-------|-------|------|-----------|\n| G-1 | vague | REQ-1.1 | which thing | ${closedBy} |\n`;

test('refuses while a clarification marker or an open gap exists', async () => {
  await withProgram(async (root) => {
    write(root, 'docs/spec/a.md', spec(MARKER));
    write(root, 'docs/spec/gaps.md', gaps(''));
    record(root, 'spec with a marker and an open gap');
    const bad = await cli(root, ['plan', 'check']);
    assert.equal(bad.code, 1, bad.stdout + bad.stderr);
    const out = bad.stdout.trim().split('\n');
    assert.equal(out.length, 2, out.join('\n'));
    assert.equal(out[0], `docs/spec/a.md:5 clarification marker: ${MARKER}`);
    assert.equal(out[1], 'gap scan not done: G-1 is not closed; run /slicekit gaps');

    write(root, 'docs/spec/a.md', spec('everywhere'));
    write(root, 'docs/spec/gaps.md', gaps('D-01'));
    record(root, 'marker resolved, gap closed');
    const ok = await cli(root, ['plan', 'check']);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.equal(ok.stdout, 'ready to plan\n');

    fs.rmSync(path.join(root, 'docs/spec/gaps.md'));
    record(root, 'no gap scan');
    const none = await cli(root, ['plan', 'check']);
    assert.equal(none.code, 1, none.stdout + none.stderr);
    assert.equal(none.stdout, 'gap scan not done: docs/spec/gaps.md is missing; run /slicekit gaps\n');
  });
});

test('a marker in a contract or in stack.md also blocks the plan', async () => {
  await withProgram(async (root) => {
    fs.mkdirSync(path.join(root, 'docs/spec/contracts'), { recursive: true });
    write(root, 'docs/spec/contracts/api.md', `# API\n\nReturns ${MARKER}\n`);
    write(root, 'docs/spec/stack.md', `# Stack\n\nNode 22. \`${MARKER}\` in a code span is not a marker.\n\n${MARKER}\n`);
    record(root, 'markers outside the spec files');
    const r = await cli(root, ['plan', 'check']);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'), [
      `docs/spec/contracts/api.md:3 clarification marker: ${MARKER}`,
      `docs/spec/stack.md:5 clarification marker: ${MARKER}`,
    ]);
  });
});

test('plan check refuses a bad usage with exit 2', async () => {
  await withProgram(async (root) => {
    assert.equal((await cli(root, ['plan'])).code, 2);
    assert.equal((await cli(root, ['plan', 'check', 'extra'])).code, 2);
    assert.equal((await cli(root, ['plan', 'write'])).code, 2);
  });
});
