// S-25: the README's walkthrough, read from its sh blocks and run as one bash session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBash, runWalkthrough, walkthroughCommands, walkthroughScript } from './helpers/walkthrough.js';

const README = [
  '# Kit', // 1
  '', // 2
  '## Walkthrough', // 3
  '', // 4
  '```sh', // 5
  '# a comment, skipped', // 6
  'npm install', // 7
  '', // 8
  'node bin/slicekit.js init \\', // 9
  '  --shape backend', // 10
  '```', // 11
  '', // 12
  '```js', // 13
  'console.log(1);', // 14
  '```', // 15
  '', // 16
  '### Then', // 17
  '', // 18
  '```sh', // 19
  'cd demo', // 20
  '```', // 21
  '', // 22
  '## After', // 23
  '', // 24
  '```sh', // 25
  'not-read', // 26
  '```', // 27
  '',
].join('\n');

test("the walkthrough's commands are read from its sh blocks in README order", () => {
  assert.deepEqual(walkthroughCommands(README), [
    { line: 7, command: 'npm install' },
    { line: 9, command: 'node bin/slicekit.js init --shape backend' },
    { line: 20, command: 'cd demo' },
  ]);
  // CRLF line ends read the same.
  assert.deepEqual(walkthroughCommands(README.replace(/\n/g, '\r\n')), walkthroughCommands(README));
});

test('a README with no walkthrough section or no sh block in it is refused', () => {
  assert.throws(() => walkthroughCommands('# Kit\n\n## Install\n\n```sh\nnpm i\n```\n'), { message: 'README.md has no "## Walkthrough" section' });
  assert.throws(() => walkthroughCommands('# Kit\n\n## Walkthrough\n\n```js\nx\n```\n\n## Next\n\n```sh\nnpm i\n```\n'), { message: 'the walkthrough holds no sh block' });
});

test('the script carries cd and variables from one command to the next', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-walk-'));
  try {
    const script = walkthroughScript([{ line: 1, command: 'true' }]);
    assert.match(script, /^set -u$/m);
    assert.doesNotMatch(script, /set -e/);
    const r = runWalkthrough(
      [
        { line: 1, command: 'mkdir d' },
        { line: 2, command: 'cd d' },
        { line: 3, command: "v='it''s here'" },
        { line: 4, command: 'echo "$v" > f' },
      ],
      { cwd: dir },
    );
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'd', 'f'), 'utf8'), "its here\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a walkthrough command that fails stops the run, naming the command and its README line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-walk-'));
  try {
    const r = runWalkthrough(
      [
        { line: 12, command: 'true' },
        { line: 14, command: 'false' },
        { line: 15, command: 'touch after' },
      ],
      { cwd: dir },
    );
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'walkthrough failed at README.md:14: false\n');
    assert.equal(fs.existsSync(path.join(dir, 'after')), false);
    // A quote in the command is printed as written.
    const q = runWalkthrough([{ line: 3, command: "test 'a' = \"b\"" }], { cwd: dir });
    assert.equal(q.stderr, 'walkthrough failed at README.md:3: test \'a\' = "b"\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bash is SLICEKIT_BASH, else Git for Windows bash on Windows, never the WSL one', () => {
  const gitBash = 'C:/Program Files/Git/bin/bash.exe';
  const has = (...files) => (f) => files.includes(f.replace(/\\/g, '/'));
  const execPath = () => 'C:/Program Files/Git/mingw64/libexec/git-core\n';
  assert.equal(resolveBash({ env: { SLICEKIT_BASH: '/opt/bash' }, platform: 'win32', execPath, exists: has() }), '/opt/bash');
  assert.equal(resolveBash({ env: {}, platform: 'linux', execPath, exists: has() }), 'bash');
  assert.equal(resolveBash({ env: {}, platform: 'win32', execPath, exists: has(gitBash, 'C:/Windows/System32/bash.exe') }).replace(/\\/g, '/'), gitBash);
  // No Git bash found: refused, never the bare `bash` that PATH resolves to System32's WSL launcher.
  assert.throws(() => resolveBash({ env: {}, platform: 'win32', execPath, exists: has('C:/Windows/System32/bash.exe') }), /Git for Windows bash/);
  assert.throws(
    () => resolveBash({ env: {}, platform: 'win32', execPath: () => { throw new Error('git not found'); }, exists: has() }),
    /Git for Windows bash/,
  );
  // An exec path under the Windows folder never yields its bash.
  assert.throws(
    () => resolveBash({ env: {}, platform: 'win32', execPath: () => 'C:/Windows/System32/git-core', exists: has('C:/Windows/System32/bin/bash.exe', 'C:/Windows/bin/bash.exe') }),
    /Git for Windows bash/,
  );
  // On this machine (the tests above ran it) the resolved bash is not the WSL launcher.
  const real = resolveBash();
  assert.doesNotMatch(real.replace(/\\/g, '/').toLowerCase(), /windows\/system32/);
});

// Run from inside `node --test`, the session must not inherit NODE_TEST_CONTEXT: under it the
// walkthrough's own `node --test` reports to this runner and exits 0 whatever its tests do.
test('the walkthrough runs as a reader runs it, outside the test runner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-walk-'));
  try {
    const r = runWalkthrough([{ line: 1, command: 'printf %s "${NODE_TEST_CONTEXT-unset}"' }], { cwd: dir, env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'unset');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
