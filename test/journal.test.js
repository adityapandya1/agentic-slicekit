// REQ-3.8 (D-32, D-34): the hash-chained session journal, one file per branch under .slicekit/journal/.
// Each file is its own chain from `prev=genesis`; verify recomputes every hash and every link, reports
// the first break and never writes; session-end appends one line and fails open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import * as J from '../src/journal.js';
import journalRule from '../src/check/rules/journal.js';
import { handle as sessionEnd } from '../src/hooks/session-end.js';
import { runHook } from '../src/hooks/io.js';
import { buildContext } from '../src/check/context.js';
import { CONFIG_PATH, defaultConfig } from '../src/config.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';

const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const DIR = (root) => path.join(root, '.slicekit', 'journal');
const { GENESIS, appendJournal, hashLine, journalBranch, parseLine, readLast, verifyJournal } = J;
// The file this clone appends to for branch (D-34): <branch-part>--<clone-id>.log.
const fileOf = (root, branch) => J.journalFile(root, branch);
const relOf = (root, branch) => path.relative(root, fileOf(root, branch)).split(path.sep).join('/');
const NC = '--no-clone.log'; // outside git
const FIELDS = { actor: 'ada', slice: 'P1/S-07', stage: 'build', commits: ['abc1234'], verdicts: [], decisions: ['D-34'] };

function tmpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-journal-'));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function withConfig(root) {
  const conf = path.join(root, CONFIG_PATH);
  fs.mkdirSync(path.dirname(conf), { recursive: true });
  fs.writeFileSync(conf, JSON.stringify(cfg));
}

// ---- evaluation set ----

// REQ-3.8
test('append builds a chain from genesis', () => {
  const { root, cleanup } = tmpDir();
  try {
    const first = appendJournal(root, FIELDS, { branch: 'slice/P1-S-07-x', now: new Date('2026-10-25T10:00:00.000Z') });
    const second = appendJournal(root, { ...FIELDS, commits: ['def5678', 'abc1234'] }, { branch: 'slice/P1-S-07-x', now: new Date('2026-10-25T11:00:00.000Z') });
    const file = fileOf(root, 'slice/P1-S-07-x');
    assert.match(path.basename(file), /^slice__P1-S-07-x-[0-9a-f]{8}--no-clone\.log$/);
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text, `${first}\n${second}\n`);
    const a = parseLine(first);
    const b = parseLine(second);
    assert.equal(a.prev, GENESIS);
    assert.equal(b.prev, a.hash);
    assert.match(first, /^2026-10-25T10:00:00\.000Z actor=ada slice=P1\/S-07 stage=build commits=abc1234 verdicts=- decisions=D-34 prev=genesis hash=[0-9a-f]{64}$/);
    assert.match(second, / commits=abc1234,def5678 /);
    assert.equal(a.hash, hashLine(first.slice(0, first.indexOf(' hash='))));
    assert.deepEqual(verifyJournal(root), { ok: true, lines: 2, brokenAt: null, file: null, message: null, problems: [], files: [{ file: relOf(root, 'slice/P1-S-07-x'), lines: 2, brokenAt: null }] });
  } finally {
    cleanup();
  }
});

// REQ-3.8
test('an edited line breaks the chain at its number', () => {
  const { root, cleanup } = tmpDir();
  try {
    for (let i = 0; i < 3; i++) appendJournal(root, { ...FIELDS, stage: `s${i}` }, { branch: 'main' });
    const file = fileOf(root, 'main');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('stage=s1', 'stage=s9'));
    const r = verifyJournal(root);
    assert.equal(r.ok, false);
    assert.equal(r.brokenAt, 2);
    assert.equal(r.file, `.slicekit/journal/main${NC}`);
    assert.equal(r.message, `journal chain broken at line 2 of .slicekit/journal/main${NC}`);
    assert.match(r.message, /^journal chain broken at line 2/);
  } finally {
    cleanup();
  }
});

// REQ-3.8
test('verify never rewrites the file', () => {
  const { root, cleanup } = tmpDir();
  try {
    appendJournal(root, FIELDS, { branch: 'main' });
    appendJournal(root, FIELDS, { branch: 'main' });
    const file = fileOf(root, 'main');
    const tampered = fs.readFileSync(file, 'utf8').replace('actor=ada', 'actor=eve');
    fs.writeFileSync(file, tampered);
    const before = fs.statSync(file).mtimeMs;
    for (let i = 0; i < 3; i++) assert.equal(verifyJournal(root).ok, false);
    assert.equal(fs.readFileSync(file, 'utf8'), tampered);
    assert.equal(fs.statSync(file).mtimeMs, before);
    assert.deepEqual(fs.readdirSync(DIR(root)), [`main${NC}`]);
    const cli = runCli(['journal', 'verify'], { cwd: root });
    assert.equal(cli.code, 1);
    assert.match(cli.stdout, /journal chain broken at line 1 of \.slicekit\/journal\/main--no-clone\.log/);
    assert.equal(fs.readFileSync(file, 'utf8'), tampered);
  } finally {
    cleanup();
  }
});

// ---- the rest ----

// REQ-3.8, D-34
test('branch names map to one file name each', () => {
  const h = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8);
  assert.equal(J.branchPart('main'), 'main');
  assert.equal(J.branchPart('feature__a'), 'feature__a');
  assert.equal(J.branchPart('feature/a'), `feature__a-${h('feature/a')}`);
  assert.equal(J.branchPart('feature/a b:c'), `feature__a_b_c-${h('feature/a b:c')}`);
  const long = 'x'.repeat(81);
  assert.equal(J.branchPart(long), `${'x'.repeat(60)}-${h(long)}`);
});

// REQ-3.8, D-34
test('two branch files are verified independently', () => {
  const { root, cleanup } = tmpDir();
  try {
    appendJournal(root, FIELDS, { branch: 'slice/a' });
    appendJournal(root, FIELDS, { branch: 'slice/b' });
    appendJournal(root, FIELDS, { branch: 'slice/b' });
    assert.equal(parseLine(fs.readFileSync(fileOf(root, 'slice/b'), 'utf8').split('\n')[0]).prev, GENESIS);
    let r = verifyJournal(root);
    assert.equal(r.ok, true);
    assert.equal(r.lines, 3);
    assert.deepEqual(r.files.map((f) => [f.file, f.lines]), [[relOf(root, 'slice/a'), 1], [relOf(root, 'slice/b'), 2]].sort());
    fs.writeFileSync(fileOf(root, 'slice/b'), fs.readFileSync(fileOf(root, 'slice/b'), 'utf8').replace(/stage=build/, 'stage=plan'));
    r = verifyJournal(root);
    assert.equal(r.ok, false);
    assert.equal(r.message, `journal chain broken at line 1 of ${relOf(root, 'slice/b')}`);
    assert.deepEqual(r.files.map((f) => f.brokenAt), [null, 1]);
  } finally {
    cleanup();
  }
});

// REQ-3.8, D-34: the reason for one file per branch.
test('a merged history with both branch files present verifies', () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    git(root, ['checkout', '--quiet', '-b', 'slice/a']);
    appendJournal(root, FIELDS);
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'a']);
    git(root, ['checkout', '--quiet', 'main']);
    git(root, ['checkout', '--quiet', '-b', 'slice/b']);
    appendJournal(root, FIELDS);
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'b']);
    git(root, ['checkout', '--quiet', 'main']);
    git(root, ['merge', '--quiet', '--no-ff', '-m', 'merge a', 'slice/a']);
    git(root, ['merge', '--quiet', '--no-ff', '-m', 'merge b', 'slice/b']);
    assert.deepEqual(fs.readdirSync(DIR(root)).sort(), [path.basename(fileOf(root, 'slice/a')), path.basename(fileOf(root, 'slice/b'))].sort());
    const r = verifyJournal(root);
    assert.equal(r.ok, true);
    assert.equal(r.lines, 2);
    appendJournal(root, FIELDS);
    assert.equal(parseLine(fs.readFileSync(fileOf(root, 'main'), 'utf8').trim()).prev, GENESIS);
    assert.equal(verifyJournal(root).ok, true);
  } finally {
    cleanup();
  }
});

// REQ-3.8
test('a torn last line is a break, and append refuses it', () => {
  const { root, cleanup } = tmpDir();
  try {
    appendJournal(root, FIELDS, { branch: 'main' });
    const file = fileOf(root, 'main');
    fs.appendFileSync(file, '2026-10-25T12:00:00.000Z actor=ada slice=-');
    const r = verifyJournal(root);
    assert.equal(r.ok, false);
    assert.equal(r.brokenAt, 2);
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => appendJournal(root, FIELDS, { branch: 'main' }), /torn/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    cleanup();
  }
});

// REQ-3.8: a checkout that turned LF into CRLF is not a tamper.
test('CRLF line endings still verify', () => {
  const { root, cleanup } = tmpDir();
  try {
    appendJournal(root, FIELDS, { branch: 'main' });
    appendJournal(root, FIELDS, { branch: 'main' });
    const file = fileOf(root, 'main');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    assert.equal(verifyJournal(root).ok, true);
  } finally {
    cleanup();
  }
});

// REQ-3.8
test('concurrent appends from two processes in a fresh clone share one id and land with a valid chain', async () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    const mod = pathToFileURL(path.resolve('src/journal.js')).href;
    const script = `import { appendJournal } from ${JSON.stringify(mod)};
for (let i = 0; i < 15; i++) appendJournal(process.argv[1], { actor: process.argv[2], slice: '-', stage: 'build', commits: [], verdicts: [], decisions: [] }, { branch: 'main' });`;
    const one = (actor) => new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', script, root, actor], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err))));
    });
    await Promise.all([one('p1'), one('p2')]);
    const r = verifyJournal(root);
    assert.equal(r.ok, true, r.message);
    assert.equal(r.lines, 30);
    assert.equal(r.files.length, 1);
    const text = fs.readFileSync(fileOf(root, 'main'), 'utf8');
    assert.equal(text.match(/actor=p1/g).length, 15);
    assert.equal(text.match(/actor=p2/g).length, 15);
  } finally {
    cleanup();
  }
});

// REQ-3.8
test('a token in actor is redacted and field values never carry spaces or =', () => {
  const { root, cleanup } = tmpDir();
  try {
    const line = appendJournal(root, { ...FIELDS, actor: 'ada ghp_abcdefghijklmnopqrstuvwxyz0123 x=y', slice: '' }, { branch: 'main' });
    assert.ok(!line.includes('ghp_abcdefghijklmnopqrstuvwxyz0123'));
    const p = parseLine(line);
    assert.equal(p.actor, 'ada_***_x_y');
    assert.equal(p.slice, '-');
    assert.equal(verifyJournal(root).ok, true);
    assert.equal(readLast(root, 'main').actor, 'ada_***_x_y');
    assert.equal(readLast(root, 'other'), null);
  } finally {
    cleanup();
  }
});

// REQ-3.8
test('journal show prints the last lines of a branch file', () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    for (let i = 0; i < 4; i++) appendJournal(root, { ...FIELDS, stage: `s${i}` });
    appendJournal(root, { ...FIELDS, stage: 'other' }, { branch: 'slice/x' });
    let r = runCli(['journal', 'show', '-n', '2'], { cwd: root });
    assert.equal(r.code, 0);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /stage=s2/);
    assert.match(lines[1], /stage=s3/);
    r = runCli(['journal', 'show', '--branch', 'slice/x'], { cwd: root });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /stage=other/);
    r = runCli(['journal', 'show', '--branch', 'nope'], { cwd: root });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, 'journal: no entries\n');
    r = runCli(['journal', 'show', '-n', 'x'], { cwd: root });
    assert.equal(r.code, 2);
    r = runCli(['journal', 'verify'], { cwd: root });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^journal: 5 lines in 2 files verified$/m);
  } finally {
    cleanup();
  }
});

// REQ-3.8
test('journal verify with no journal says so and exits 0', () => {
  const { root, cleanup } = tmpDir();
  try {
    const r = runCli(['journal', 'verify'], { cwd: root });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, 'journal: no entries\n');
    assert.equal(fs.existsSync(DIR(root)), false);
    assert.equal(runCli(['journal', 'nope'], { cwd: root }).code, 2);
  } finally {
    cleanup();
  }
});

// REQ-3.7, REQ-3.8
test('the journal rule reports a broken chain and is silent without a journal', () => {
  const { root, cleanup } = tmpDir();
  try {
    withConfig(root);
    assert.equal(journalRule.id, 'journal');
    assert.equal(journalRule.blocking, true);
    assert.equal(journalRule.ratchet, false);
    const run = () => journalRule.run(buildContext(root, cfg));
    assert.deepEqual(run(), []);
    appendJournal(root, FIELDS, { branch: 'main' });
    appendJournal(root, FIELDS, { branch: 'main' });
    assert.deepEqual(run(), []);
    const file = fileOf(root, 'main');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/decisions=D-34 prev=genesis/, 'decisions=- prev=genesis'));
    assert.deepEqual(run(), [{ file: `.slicekit/journal/main${NC}`, line: 1, message: `journal chain broken at line 1 of .slicekit/journal/main${NC}` }]);
  } finally {
    cleanup();
  }
});

// REQ-3.8
test('journalBranch names detached HEAD and a non-repo', () => {
  const t = tmpDir();
  const r = makeRepo({ commits: 1 });
  try {
    assert.equal(journalBranch(t.root), 'no-branch');
    assert.equal(journalBranch(r.root), 'main');
    git(r.root, ['checkout', '--quiet', '--detach']);
    assert.equal(journalBranch(r.root), 'detached');
  } finally {
    t.cleanup();
    r.cleanup();
  }
});

// REQ-3.8: fail open outside a repository; the line is still written.
test('session-end in a non-repo appends with commits=-', async () => {
  const { root, cleanup } = tmpDir();
  try {
    withConfig(root);
    const out = await runHook('session-end', {
      stdin: JSON.stringify({ session_id: 's', transcript_path: '', cwd: root, reason: 'exit' }),
      root,
      env: { SLICEKIT_ACTOR: 'ada' },
    });
    assert.equal(out.code, 0);
    assert.equal(out.stdout, '{}');
    assert.equal(out.stderr, '');
    const p = readLast(root, 'no-branch');
    assert.equal(p.actor, 'ada');
    assert.equal(p.slice, '-');
    assert.deepEqual(p.commits, []);
    assert.match(fs.readFileSync(fileOf(root, 'no-branch'), 'utf8'), / commits=- verdicts=- decisions=- prev=genesis /);
  } finally {
    cleanup();
  }
});

// REQ-3.8
test('session-end records the branch commits, new verdicts and new decisions since the last line', async () => {
  const decisions = (rows) => `# Decisions\n\n## Settled\n\n| # | Type | Question | Answer | By |\n|---|---|---|---|---|\n${rows.map((d) => `| ${d} | Decision | q | a | b |\n`).join('')}`;
  const { root, cleanup } = makeRepo({ files: { 'docs/decisions.md': decisions(['D-01']) } });
  try {
    withConfig(root);
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'base']);
    git(root, ['checkout', '--quiet', '-b', 'slice/P1-S-07-x']);
    git(root, ['commit', '--quiet', '--allow-empty', '-m', 'one']);
    const one = git(root, ['rev-parse', 'HEAD']).slice(0, 7);
    const env = { USERNAME: 'win-user' };
    await sessionEnd({ session_id: 's', reason: 'exit', cwd: root }, { root, cfg, env });
    const first = readLast(root, 'slice/P1-S-07-x');
    assert.equal(first.actor, 'win-user');
    assert.deepEqual(first.commits, [one]);
    assert.deepEqual(first.decisions, []);
    assert.equal(first.prev, GENESIS);

    // Commit timestamps have one-second resolution: step past the first line's second.
    const later = new Date(Date.parse(first.at) + 2000).toISOString();
    fs.writeFileSync(path.join(root, 'docs/decisions.md'), decisions(['D-01', 'D-02', 'D-03']));
    fs.mkdirSync(path.join(root, '.slicekit/reviews'), { recursive: true });
    fs.writeFileSync(path.join(root, '.slicekit/reviews/P1-S-07-r1.md'), 'Verdict: APPROVE\n');
    const stamp = new Date(Date.parse(later) + 1000);
    fs.utimesSync(path.join(root, '.slicekit/reviews/P1-S-07-r1.md'), stamp, stamp);
    git(root, ['add', '-A']);
    execFileSync('git', ['commit', '--quiet', '-m', 'two'], {
      cwd: root, stdio: 'ignore', env: { ...process.env, GIT_COMMITTER_DATE: later, GIT_AUTHOR_DATE: later },
    });
    const two = git(root, ['rev-parse', 'HEAD']).slice(0, 7);
    await sessionEnd({ session_id: 's', reason: 'exit', cwd: root }, { root, cfg, env: { SLICEKIT_ACTOR: 'ada', USERNAME: 'x' } });
    const second = readLast(root, 'slice/P1-S-07-x');
    assert.equal(second.actor, 'ada');
    assert.deepEqual(second.commits, [two]);
    assert.deepEqual(second.verdicts, ['P1-S-07-r1']);
    assert.deepEqual(second.decisions, ['D-02', 'D-03']);
    assert.equal(second.prev, first.hash);
    assert.equal(verifyJournal(root).ok, true);
  } finally {
    cleanup();
  }
});

// REQ-3.8: fail open — a refused append is a stderr note, never a block.
test('session-end on a torn journal fails open and writes nothing', async () => {
  const { root, cleanup } = tmpDir();
  try {
    withConfig(root);
    fs.mkdirSync(DIR(root), { recursive: true });
    fs.writeFileSync(path.join(DIR(root), `no-branch${NC}`), 'torn');
    const out = await runHook('session-end', { stdin: JSON.stringify({ session_id: 's', cwd: root, reason: 'exit' }), root, env: {} });
    assert.equal(out.code, 0);
    assert.equal(out.stdout, '{}');
    assert.match(out.stderr, /slicekit hook session-end failed: .*torn/);
    assert.equal(fs.readFileSync(path.join(DIR(root), `no-branch${NC}`), 'utf8'), 'torn');
  } finally {
    cleanup();
  }
});

// ---- fix round 1 ----

function fourLines(root) {
  for (let i = 0; i < 4; i++) appendJournal(root, { ...FIELDS, stage: `s${i}` }, { branch: 'main' });
  const file = fileOf(root, 'main');
  return { file, lines: fs.readFileSync(file, 'utf8').trimEnd().split('\n') };
}
const write = (file, lines) => fs.writeFileSync(file, `${lines.join('\n')}\n`);

// REQ-3.8 (I1): the prev link is checked, not only each line's own hash.
test('a deleted middle line breaks the chain at its number', () => {
  const { root, cleanup } = tmpDir();
  try {
    const { file, lines } = fourLines(root);
    write(file, [lines[0], lines[2], lines[3]]);
    assert.equal(verifyJournal(root).brokenAt, 2);
  } finally {
    cleanup();
  }
});

// REQ-3.8 (I1)
test('an edited line with its hash recomputed breaks the chain at the next line', () => {
  const { root, cleanup } = tmpDir();
  try {
    const { file, lines } = fourLines(root);
    const p = parseLine(lines[1]);
    const body = p.body.replace('stage=s1', 'stage=s9');
    write(file, [lines[0], `${body} hash=${hashLine(body)}`, lines[2], lines[3]]);
    assert.equal(verifyJournal(root).brokenAt, 3);
  } finally {
    cleanup();
  }
});

// REQ-3.8 (I1)
test('a first line whose prev is not genesis breaks at line 1', () => {
  const { root, cleanup } = tmpDir();
  try {
    const { file, lines } = fourLines(root);
    write(file, lines.slice(1));
    assert.equal(verifyJournal(root).brokenAt, 1);
  } finally {
    cleanup();
  }
});

function cloneOf(origin, dir) {
  execFileSync('git', ['clone', '--quiet', '-b', 'main', origin, dir], { stdio: 'ignore' });
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

// REQ-3.8, D-34 (I2): two clones on one branch each get their own file, so merging both never conflicts.
test('two clones appending on main merge without conflict and verify', () => {
  const origin = makeRepo({ commits: 1 });
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-clones-'));
  try {
    const ids = [];
    for (const n of ['a', 'b']) {
      const dir = path.join(base, n);
      cloneOf(origin.root, dir);
      appendJournal(dir, FIELDS);
      ids.push(J.cloneId(dir));
      git(dir, ['checkout', '--quiet', '-b', `slice/${n}`]);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '--quiet', '-m', n]);
      git(dir, ['push', '--quiet', 'origin', `slice/${n}`]);
    }
    assert.match(ids[0], /^[0-9a-f]{8}$/);
    assert.notEqual(ids[0], ids[1]);
    git(origin.root, ['merge', '--quiet', '--no-ff', '-m', 'ma', 'slice/a']);
    git(origin.root, ['merge', '--quiet', '--no-ff', '-m', 'mb', 'slice/b']);
    assert.deepEqual(fs.readdirSync(DIR(origin.root)).sort(), ids.map((id) => `main--${id}.log`).sort());
    const r = verifyJournal(origin.root);
    assert.equal(r.ok, true, r.message);
    assert.equal(r.lines, 2);
  } finally {
    origin.cleanup();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// D-34 (I2): the clone id lives in the git common dir, so worktrees of one clone share it.
test('worktrees of one clone share its clone id', () => {
  const { root, cleanup } = makeRepo({ commits: 1 });
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-wt-')), 'w');
  try {
    assert.equal(J.cloneId(root), null);
    appendJournal(root, FIELDS);
    const id = J.cloneId(root);
    assert.equal(fs.readFileSync(path.join(root, '.git', 'slicekit', 'clone-id'), 'utf8').trim(), id);
    git(root, ['worktree', 'add', '--quiet', '-b', 'other', wt]);
    assert.equal(J.cloneId(wt), id);
    assert.equal(J.cloneId(fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-nogit-'))), 'no-clone');
  } finally {
    cleanup();
  }
});

// D-34 (M4/M5): names that sanitise alike get different files; a long name still appends.
test('feature/a and feature__a go to different files, and a 300-character branch appends', () => {
  const { root, cleanup } = tmpDir();
  try {
    appendJournal(root, FIELDS, { branch: 'feature/a' });
    appendJournal(root, FIELDS, { branch: 'feature__a' });
    assert.notEqual(fileOf(root, 'feature/a'), fileOf(root, 'feature__a'));
    const long = `slice/${'y'.repeat(294)}`;
    appendJournal(root, FIELDS, { branch: long });
    assert.ok(path.basename(fileOf(root, long)).length < 100);
    const r = verifyJournal(root);
    assert.equal(r.ok, true);
    assert.equal(r.files.length, 3);
  } finally {
    cleanup();
  }
});

// REQ-3.8 (M6): no blank-skipping; a last line that is not a journal line stops the append.
test('append refuses a file whose last line is blank or not a journal line', async () => {
  const { root, cleanup } = tmpDir();
  try {
    appendJournal(root, FIELDS, { branch: 'main' });
    const file = fileOf(root, 'main');
    fs.appendFileSync(file, '\n');
    let before = fs.readFileSync(file, 'utf8');
    assert.throws(() => appendJournal(root, FIELDS, { branch: 'main' }), /does not parse/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    fs.writeFileSync(file, `${before.trimEnd()}\nnot a journal line\n`);
    before = fs.readFileSync(file, 'utf8');
    withConfig(root);
    fs.renameSync(file, fileOf(root, 'no-branch'));
    const out = await runHook('session-end', { stdin: JSON.stringify({ session_id: 's', cwd: root, reason: 'exit' }), root, env: {} });
    assert.equal(out.stdout, '{}');
    assert.match(out.stderr, /does not parse/);
    assert.equal(fs.readFileSync(fileOf(root, 'no-branch'), 'utf8'), before);
  } finally {
    cleanup();
  }
});

// REQ-3.8 (M7): anything in the journal directory other than a regular *.log (or a *.lock) is reported.
test('verify reports an unexpected entry in the journal directory', () => {
  const { root, cleanup } = tmpDir();
  try {
    appendJournal(root, FIELDS, { branch: 'main' });
    fs.writeFileSync(path.join(DIR(root), 'main--no-clone.log.lock'), '');
    assert.equal(verifyJournal(root).ok, true);
    fs.writeFileSync(path.join(DIR(root), 'notes.txt'), 'x');
    fs.mkdirSync(path.join(DIR(root), 'sub.log'));
    let linked = true;
    try {
      fs.symlinkSync(fileOf(root, 'main'), path.join(DIR(root), 'link.log'));
    } catch {
      linked = false; // no symlink right on this machine
    }
    const r = verifyJournal(root);
    assert.equal(r.ok, false);
    const msgs = r.problems.map((p) => p.message);
    assert.ok(msgs.includes('unexpected entry notes.txt in .slicekit/journal/'), msgs.join('; '));
    assert.ok(msgs.includes('unexpected entry sub.log in .slicekit/journal/'));
    if (linked) assert.ok(msgs.includes('unexpected entry link.log in .slicekit/journal/'));
    assert.ok(!msgs.some((m) => m.includes('.lock')));
    withConfig(root);
    assert.ok(journalRule.run(buildContext(root, cfg)).some((f) => f.message === 'unexpected entry notes.txt in .slicekit/journal/'));
  } finally {
    cleanup();
  }
});

// A repo whose main holds a committed two-line journal, now on a slice branch.
function committedJournal() {
  const r = makeRepo({ commits: 1 });
  withConfig(r.root);
  appendJournal(r.root, FIELDS);
  appendJournal(r.root, FIELDS);
  git(r.root, ['add', '-A']);
  git(r.root, ['commit', '--quiet', '-m', 'journal']);
  git(r.root, ['checkout', '--quiet', '-b', 'slice/x']);
  return { ...r, file: fileOf(r.root, 'main'), rel: relOf(r.root, 'main') };
}
const appendOnly = (root, opts) => J.appendOnlyProblems(root, cfg, opts);

// REQ-3.8 (I3): a committed journal file may only grow.
test('a committed journal file that only grew passes the append-only check', () => {
  const r = committedJournal();
  try {
    appendJournal(r.root, FIELDS, { branch: 'main' });
    assert.deepEqual(appendOnly(r.root), []);
    assert.deepEqual(journalRule.run(buildContext(r.root, cfg)), []);
  } finally {
    r.cleanup();
  }
});

// REQ-3.8 (I3)
test('a shortened committed journal file is reported against the default branch', () => {
  const r = committedJournal();
  try {
    const lines = fs.readFileSync(r.file, 'utf8').split('\n');
    fs.writeFileSync(r.file, `${lines[0]}\n`);
    assert.equal(verifyJournal(r.root).ok, true); // the chain alone cannot see it
    const msg = `journal file ${r.rel} was shortened or removed since main`;
    assert.deepEqual(appendOnly(r.root).map((p) => p.message), [msg]);
    assert.ok(journalRule.run(buildContext(r.root, cfg)).some((f) => f.message === msg));
    const cli = runCli(['journal', 'verify'], { cwd: r.root });
    assert.equal(cli.code, 1);
    assert.match(cli.stdout, /was shortened or removed since main/);
  } finally {
    r.cleanup();
  }
});

// REQ-3.8 (I3)
test('a removed or wholly rewritten committed journal file is reported', () => {
  const r = committedJournal();
  try {
    fs.rmSync(r.file);
    assert.deepEqual(appendOnly(r.root).map((p) => p.message), [`journal file ${r.rel} was shortened or removed since main`]);
    appendJournal(r.root, { ...FIELDS, actor: 'eve' }, { branch: 'main' });
    assert.equal(verifyJournal(r.root).ok, true); // a fresh chain from genesis verifies
    assert.equal(appendOnly(r.root).length, 1);
  } finally {
    r.cleanup();
  }
});

// REQ-3.8 (I3): --against names the ref; no repo or no base is no finding.
test('the append-only check takes --against and is silent without a repo or a base', () => {
  const r = committedJournal();
  const t = tmpDir();
  try {
    git(r.root, ['branch', 'keep']);
    fs.writeFileSync(r.file, '');
    assert.match(appendOnly(r.root, { against: 'keep' })[0].message, /since keep$/);
    const cli = runCli(['journal', 'verify', '--against', 'keep'], { cwd: r.root });
    assert.equal(cli.code, 1);
    assert.match(cli.stdout, /since keep/);
    assert.deepEqual(appendOnly(r.root, { against: 'nope' }), []);
    assert.deepEqual(appendOnly(t.root), []);
    git(r.root, ['branch', '-m', 'main', 'trunk']);
    assert.deepEqual(appendOnly(r.root), []);
  } finally {
    r.cleanup();
    t.cleanup();
  }
});
