import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../src/init.js';
import { git } from '../src/git.js';
import { which } from '../src/which.js';
import { makeRepo } from './helpers/tmp-repo.js';

// S-27 review r1, B-1 and B-2: the hooks' fast path must refuse every branch the node path refuses.
const noSh = which('sh', process.env) === null ? 'sh not found on PATH; git hooks cannot run' : false;

// The protectedBranches part of the config written as raw JSON text, the commit tried on `branch`.
function tryOn(branch, protectedJson) {
  const repo = makeRepo({ branch: 'main' });
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    const file = path.join(repo.root, '.slicekit', 'config.json');
    const text = fs.readFileSync(file, 'utf8').replace(/"protectedBranches":\s*\[[^\]]*\]/, `"protectedBranches": ${protectedJson}`);
    assert.match(text, /"protectedBranches": /);
    fs.writeFileSync(file, text);
    git(repo.root, ['checkout', '-q', '-b', branch]);
    const r = spawnSync('git', ['commit', '--allow-empty', '-m', 'try'], { cwd: repo.root, encoding: 'utf8', env: { ...process.env, ALLOW_PROTECTED_COMMIT: '' } });
    return { code: r.status, stderr: r.stderr ?? '' };
  } finally {
    repo.cleanup();
  }
}

test('a protected branch written with the JSON escape \\/ is refused', { skip: noSh }, () => {
  const r = tryOn('release/x', '["main", "release\\/x"]');
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /release\/x is protected/);
});

test('a word inside a protectedBranches entry with whitespace is refused, as node splits it', { skip: noSh }, () => {
  for (const [branch, json] of [['dev', '["main", " dev"]'], ['release', '["main", "release x"]'], ['x', '["main", "release x"]'], ['b', '["main", "a\\tb"]']]) {
    const r = tryOn(branch, json);
    assert.notEqual(r.code, 0, `${branch} under ${json}`);
    assert.match(r.stderr, new RegExp(`${branch} is protected`));
  }
});

test('a slice branch the config never names is still allowed', { skip: noSh }, () => {
  assert.equal(tryOn('slice/P1-S-02-y', '["main", "release\\/x", "dev"]').code, 0);
});
