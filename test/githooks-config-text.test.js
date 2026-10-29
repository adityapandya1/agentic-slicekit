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
// A `byte` written in place of the text BYTE puts one raw byte, not its UTF-8 form, in the file.
function tryOn(branch, protectedJson, { byte } = {}) {
  const repo = makeRepo({ branch: 'main' });
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    const file = path.join(repo.root, '.slicekit', 'config.json');
    const text = fs.readFileSync(file, 'utf8').replace(/"protectedBranches":\s*\[[^\]]*\]/, `"protectedBranches": ${protectedJson}`);
    assert.match(text, /"protectedBranches": /);
    const [head, tail] = byte === undefined ? [text, null] : text.split('BYTE');
    fs.writeFileSync(file, tail === null ? head : Buffer.concat([Buffer.from(head), Buffer.from([byte]), Buffer.from(tail)]));
    git(repo.root, ['checkout', '-q', '-b', branch]);
    const r = spawnSync('git', ['commit', '--allow-empty', '-m', 'try'], { cwd: repo.root, encoding: 'utf8', env: { ...process.env, ALLOW_PROTECTED_COMMIT: '' } });
    const body = r.status === 0 ? git(repo.root, ['log', '-1', '--format=%B']) : '';
    return { code: r.status, stderr: r.stderr ?? '', body };
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

// S-27 independent review r2, B-3 and B-4: node prints values the file's text never spells.
test('a protected name node prints from a number or a nested array is refused', { skip: noSh }, () => {
  for (const [branch, json] of [['1000', '["main", 1e3]'], ['main,release', '[["main", "release"]]']]) {
    const r = tryOn(branch, json);
    assert.notEqual(r.code, 0, `${branch} under ${json}`);
    assert.match(r.stderr, /is protected/);
  }
});

test('a protected name node decodes from bytes that are not UTF-8 is refused', { skip: noSh }, () => {
  const r = tryOn('�', '["main", "BYTE"]', { byte: 0xff });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /is protected/);
});

// S-27 independent review r2, H-1: only ASCII digits make a slice branch, in any locale.
test('a slice branch spelled with a digit outside ASCII gets no stamp', { skip: noSh }, () => {
  const r = tryOn('slice/P١-S-01-x', '["main"]');
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.body, /^Slice:/m);
});
