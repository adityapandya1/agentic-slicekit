// S-25: the README's walkthrough, read from its sh blocks and run as one bash session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveBash, runWalkthrough, walkthroughCommands, walkthroughScript } from './helpers/walkthrough.js';
import { makeRemote, makeRepo } from './helpers/tmp-repo.js';
import { parseVerdict, verdictProblems } from '../src/verdict.js';

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

// ---- Task 2: examples/walkthrough, what the walkthrough copies, and host.js ----

const KIT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const WALK = path.join(KIT_ROOT, 'examples', 'walkthrough');
const HOST = path.join(WALK, 'host.js');
const walkFile = (rel) => fs.readFileSync(path.join(WALK, ...rel.split('/')), 'utf8');
const gitIn = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hostCli = (args, { cwd, env }) => {
  const r = spawnSync(process.execPath, [HOST, ...args], { cwd, env, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

// Every file under `dir`, .git included, with a hash of its content: a write anywhere shows.
function listing(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(dir, abs).split(path.sep).join('/')] = createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

const BRANCH = 'slice/P1-S-01-greet';

// A repository on the slice branch with a bare origin holding main and the branch, and a fixture
// git host holding pull request 1 from the branch, its head not yet recorded.
function hosted() {
  const repo = makeRepo({ commits: 1 });
  const origin = makeRemote(repo.root);
  const fixture = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-host-')));
  gitIn(repo.root, ['push', '-q', 'origin', 'main']);
  gitIn(repo.root, ['checkout', '-q', '-b', BRANCH]);
  fs.writeFileSync(path.join(repo.root, 'greet.txt'), 'hello\n');
  gitIn(repo.root, ['add', 'greet.txt']);
  gitIn(repo.root, ['commit', '-q', '-m', 'feat(P1/S-01): greet']);
  gitIn(repo.root, ['push', '-q', 'origin', BRANCH]);
  const pr = { number: 1, url: 'https://example.test/pull/1', state: 'OPEN', isDraft: false, headRefName: BRANCH, baseRefName: 'main', title: '[P1/S-01] Greet a name', body: '', headRefOid: null, labels: [] };
  fs.writeFileSync(path.join(fixture, 'pr-1.json'), `${JSON.stringify(pr, null, 2)}\n`);
  return {
    root: repo.root,
    remote: origin.remote,
    fixture,
    head: gitIn(repo.root, ['rev-parse', 'HEAD']),
    env: { ...process.env, SLICEKIT_GITHOST_FIXTURE: fixture },
    pr: () => JSON.parse(fs.readFileSync(path.join(fixture, 'pr-1.json'), 'utf8')),
    cleanup() {
      fs.rmSync(fixture, { recursive: true, force: true });
      origin.cleanup();
      repo.cleanup();
    },
  };
}

test('the host helper records CI and a merge only inside the fixture directory', () => {
  const h = hosted();
  try {
    const before = listing(h.root);
    const ci = hostCli(['ci', '1', 'success'], { cwd: h.root, env: h.env });
    assert.equal(ci.code, 0, ci.stderr);
    assert.equal(ci.stdout, `ci #1 success ${h.head.slice(0, 7)}\n`);
    assert.equal(h.pr().headRefOid, h.head);
    const runs = JSON.parse(fs.readFileSync(path.join(h.fixture, `ci-${h.head}.json`), 'utf8'));
    assert.ok(Array.isArray(runs));
    assert.deepEqual(
      runs.map((r) => [r.status, r.conclusion, r.url]),
      [['completed', 'success', 'https://example.test/runs/1']],
    );

    // A second push moves the head; ci follows origin's tip and records a failure for it.
    fs.writeFileSync(path.join(h.root, 'greet.txt'), 'hello again\n');
    gitIn(h.root, ['commit', '-q', '-am', 'fix']);
    gitIn(h.root, ['push', '-q', 'origin', BRANCH]);
    const head2 = gitIn(h.root, ['rev-parse', 'HEAD']);
    const before2 = listing(h.root);
    const failed = hostCli(['ci', '1', 'failure'], { cwd: h.root, env: h.env });
    assert.equal(failed.code, 0, failed.stderr);
    assert.equal(failed.stdout, `ci #1 failure ${head2.slice(0, 7)}\n`);
    assert.equal(h.pr().headRefOid, head2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(h.fixture, `ci-${head2}.json`), 'utf8'))[0].conclusion, 'failure');

    const merged = hostCli(['merge', '1'], { cwd: h.root, env: h.env });
    assert.equal(merged.code, 0, merged.stderr);
    const tip = gitIn(h.remote, ['rev-parse', 'refs/heads/main']);
    assert.equal(merged.stdout, `merged #1 ${tip.slice(0, 7)}\n`);
    // A merge commit on origin's main whose second parent is the branch's head.
    assert.deepEqual(gitIn(h.remote, ['rev-list', '--parents', '-n', '1', 'main']).split(' ').slice(2), [head2]);
    const pr = h.pr();
    assert.equal(pr.state, 'MERGED');
    assert.ok(!Number.isNaN(Date.parse(pr.mergedAt)), pr.mergedAt);
    const since = JSON.parse(fs.readFileSync(path.join(h.fixture, 'merged-since.json'), 'utf8'));
    assert.deepEqual(since.map((p) => [p.number, p.headRefOid, p.mergedAt, p.title]), [[1, head2, pr.mergedAt, '[P1/S-01] Greet a name']]);

    // The reader's checkout is untouched, and the fixture holds only the host's files.
    assert.deepEqual(listing(h.root), before2);
    assert.notDeepEqual(before, before2);
    assert.deepEqual(fs.readdirSync(h.fixture).sort(), [`ci-${h.head}.json`, `ci-${head2}.json`, 'merged-since.json', 'pr-1.json'].sort());
  } finally {
    h.cleanup();
  }
});

test('the host helper refuses to run without SLICEKIT_GITHOST_FIXTURE', () => {
  const h = hosted();
  try {
    const env = { ...process.env };
    delete env.SLICEKIT_GITHOST_FIXTURE;
    const before = listing(h.root);
    for (const args of [['ci', '1', 'success'], ['merge', '1']]) {
      const r = hostCli(args, { cwd: h.root, env });
      assert.equal(r.code, 2);
      assert.equal(r.stderr, 'host.js stands in for GitHub only with SLICEKIT_GITHOST_FIXTURE set\n');
    }
    assert.deepEqual(listing(h.root), before);
    assert.equal(h.pr().headRefOid, null);
    // A wrong call is a usage error, and writes nothing.
    for (const args of [[], ['ci', '1', 'green'], ['ci', 'x', 'success'], ['merge'], ['close', '1']]) {
      const r = hostCli(args, { cwd: h.root, env: h.env });
      assert.equal(r.code, 2, args.join(' '));
      assert.match(r.stderr, /^usage: node examples\/walkthrough\/host\.js/, args.join(' '));
    }
    assert.deepEqual(fs.readdirSync(h.fixture), ['pr-1.json']);
  } finally {
    h.cleanup();
  }
});

const VERDICTS = { 'P1-S-01-r1.md': false, 'P1-S-01i-r2.md': true };

test('each verdict file passes verdictProblems and approves', () => {
  for (const [name, independent] of Object.entries(VERDICTS)) {
    const v = parseVerdict(walkFile(name), name);
    assert.deepEqual(verdictProblems(v), [], name);
    assert.equal(v.verdict, 'APPROVE', name);
    assert.equal(v.independent, independent, name);
  }
});

test("what the walkthrough copies is the e2e test's slice: its evaluation tests, its code, a notes file build pr takes", () => {
  // The evaluation set of examples/backend's P1/S-01 names these tests; each is in the walkthrough's files.
  const slice = fs.readFileSync(path.join(KIT_ROOT, 'examples', 'backend', 'docs', 'phases', 'P1-greeting', 'S-01-greet.md'), 'utf8');
  const rows = [...slice.matchAll(/^\| `([\w.-]+) » ([^`]+)` \|/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(rows, [['greet.test.js', 'greets a name'], ['greet-empty.test.js', 'refuses an empty name']]);
  for (const [file, name] of rows) assert.ok(walkFile(`test/${file}`).includes(`test('${name}'`), `${file} » ${name}`);
  // The tests pass on the code, and fail without it (the walkthrough's red step).
  // NODE_TEST_CONTEXT dropped: under it a child `node --test` reports to this runner and exits 0.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = (cwd) => spawnSync(process.execPath, ['--test', 'test/greet.test.js', 'test/greet-empty.test.js'], { cwd, env, encoding: 'utf8' });
  const green = run(WALK);
  assert.equal(green.status, 0, green.stdout + green.stderr);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-walk-'));
  try {
    fs.cpSync(path.join(WALK, 'test'), path.join(bare, 'test'), { recursive: true });
    fs.writeFileSync(path.join(bare, 'package.json'), '{ "type": "module" }\n');
    assert.notEqual(run(bare).status, 0);
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
  const notes = JSON.parse(walkFile('notes.json'));
  assert.equal(notes.tryIt.length, 3);
  assert.ok(notes.tryIt.every((s) => typeof s === 'string' && s.trim() !== ''));
  assert.equal(typeof notes.skipped, 'string');
  assert.ok(notes.skipped.trim() !== '');
  for (const k of Object.keys(notes)) assert.ok(['tryIt', 'skipped', 'decisions', 'runbook', 'infra'].includes(k), k);
});

test('examples/walkthrough uses no banned phrase and says it is not an example project', () => {
  const banned = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'templates', 'style.json'), 'utf8')).banned;
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else files.push(path.join(d, e.name));
    }
  };
  walk(WALK);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8').toLowerCase();
    for (const p of banned) assert.ok(!text.includes(p.toLowerCase()), `${path.relative(WALK, f)}: ${p}`);
    assert.ok(!text.includes('\r'), `${path.relative(WALK, f)} has CRLF`);
  }
  const readme = walkFile('README.md');
  assert.match(readme, /not an example project/);
  for (const who of ['developer agent', 'reviewer', 'GitHub']) assert.ok(readme.includes(who), who);
  // It is no project: no kit config, so nothing treats it as one.
  assert.equal(fs.existsSync(path.join(WALK, '.slicekit')), false);
});
