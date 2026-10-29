import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../src/init.js';
import { git } from '../src/git.js';
import { which } from '../src/which.js';
import { makeRepo } from './helpers/tmp-repo.js';

const noSh = which('sh', process.env) === null ? 'sh not found on PATH; git hooks cannot run' : false;

// S-27, D-42: what the hooks cost a commit, printed and not asserted, since machines differ.
test('a hooked commit and a plain commit are timed and printed', { skip: noSh }, (t) => {
  const repo = makeRepo({ branch: 'slice/P1-S-01-x', commits: 1 });
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-nohooks-'));
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    git(repo.root, ['reset', '-q']);
    const median = (env) => {
      const runs = [];
      for (let i = 0; i < 5; i++) {
        const start = process.hrtime.bigint();
        const r = spawnSync('git', ['commit', '-q', '--allow-empty', '-m', `t${i}`], { cwd: repo.root, encoding: 'utf8', env: { ...process.env, ...env } });
        assert.equal(r.status, 0, r.stderr);
        runs.push(Number(process.hrtime.bigint() - start) / 1e6);
      }
      return Math.round(runs.sort((a, b) => a - b)[2]);
    };
    const hooked = median({});
    const plain = median({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: empty });
    t.diagnostic(`hooked ${hooked} ms, plain ${plain} ms`);
    assert.ok(hooked > 0 && plain > 0);
  } finally {
    repo.cleanup();
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
