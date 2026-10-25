import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli/index.js';
import { init } from '../src/init.js';
import { makeRepo } from './helpers/tmp-repo.js';

const INTAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stage', 'after-intake');

async function cli(root, args) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

// An initialised repository; `intake` copies in a snapshot with a valid sidecar.
async function withInit(fn, { intake = false } = {}) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend', env: {} });
    if (intake) fs.cpSync(INTAKE, repo.root, { recursive: true });
    return await fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

test('require names the first incomplete stage and its command', async () => {
  await withInit(async (root) => {
    const r = await cli(root, ['stage', 'require', 'clarify']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^intake not done: no snapshot under docs\/intake\/; run \/slicekit intake$/m);
    assert.equal(r.stdout, '');
  });
  await withInit(
    async (root) => {
      const r = await cli(root, ['stage', 'require', 'clarify']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, 'ready: clarify\n');
    },
    { intake: true },
  );
});

test('require prints each pending row on its own line after the ready line', async () => {
  await withInit(
    async (root) => {
      const add = await cli(root, ['decide', 'add', '--open', '--type', 'Action', '--question', 'Who signs?', '--why', 'w', '--recommendation', 'r']);
      assert.equal(add.code, 0, add.stderr);
      const id = add.stdout.trim();
      fs.mkdirSync(path.join(root, 'docs/spec'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs/spec/01-x.md'), `# Spec\n\nWaits on ${id}.\n`);
      const r = await cli(root, ['stage', 'require', 'clarify']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, `ready: clarify\n${id} is Open (Action) and cited by the spec; it does not block\n`);
    },
    { intake: true },
  );
});

test('require refuses an unknown stage and a bad usage with exit 2', async () => {
  await withInit(async (root) => {
    const r = await cli(root, ['stage', 'require', 'launch']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown stage 'launch'; one of intake, clarify, specify, spec-review, gap-scan, stack, plan, build, release/);
    assert.equal((await cli(root, ['stage', 'show', 'intake'])).code, 2);
    assert.equal((await cli(root, ['stage', 'require'])).code, 2);
  });
});
