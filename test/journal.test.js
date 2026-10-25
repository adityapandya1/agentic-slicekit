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
import {
  GENESIS, appendJournal, branchFileName, hashLine, journalBranch, parseLine, readLast, verifyJournal,
} from '../src/journal.js';
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
const fileOf = (root, branch) => path.join(DIR(root), `${branchFileName(branch)}.log`);
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
    assert.equal(path.basename(file), 'slice__P1-S-07-x.log');
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text, `${first}\n${second}\n`);
    const a = parseLine(first);
    const b = parseLine(second);
    assert.equal(a.prev, GENESIS);
    assert.equal(b.prev, a.hash);
    assert.match(first, /^2026-10-25T10:00:00\.000Z actor=ada slice=P1\/S-07 stage=build commits=abc1234 verdicts=- decisions=D-34 prev=genesis hash=[0-9a-f]{64}$/);
    assert.match(second, / commits=abc1234,def5678 /);
    assert.equal(a.hash, hashLine(first.slice(0, first.indexOf(' hash='))));
    assert.deepEqual(verifyJournal(root), { ok: true, lines: 2, brokenAt: null, file: null, message: null, files: [{ file: '.slicekit/journal/slice__P1-S-07-x.log', lines: 2, brokenAt: null }] });
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
    assert.equal(r.file, '.slicekit/journal/main.log');
    assert.equal(r.message, 'journal chain broken at line 2 of .slicekit/journal/main.log');
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
    assert.deepEqual(fs.readdirSync(DIR(root)), ['main.log']);
    const cli = runCli(['journal', 'verify'], { cwd: root });
    assert.equal(cli.code, 1);
    assert.match(cli.stdout, /journal chain broken at line 1 of \.slicekit\/journal\/main\.log/);
    assert.equal(fs.readFileSync(file, 'utf8'), tampered);
  } finally {
    cleanup();
  }
});

// ---- the rest ----

// REQ-3.8, D-34
test('branch names map to one file name each', () => {
  assert.equal(branchFileName('slice/P1-S-07-x'), 'slice__P1-S-07-x');
  assert.equal(branchFileName('feature/a b:c'), 'feature__a_b_c');
  assert.equal(branchFileName('main'), 'main');
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
    assert.deepEqual(r.files.map((f) => [f.file, f.lines]), [['.slicekit/journal/slice__a.log', 1], ['.slicekit/journal/slice__b.log', 2]]);
    fs.writeFileSync(fileOf(root, 'slice/b'), fs.readFileSync(fileOf(root, 'slice/b'), 'utf8').replace(/stage=build/, 'stage=plan'));
    r = verifyJournal(root);
    assert.equal(r.ok, false);
    assert.equal(r.message, 'journal chain broken at line 1 of .slicekit/journal/slice__b.log');
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
    assert.deepEqual(fs.readdirSync(DIR(root)).sort(), ['slice__a.log', 'slice__b.log']);
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
test('concurrent appends from two processes both land with a valid chain', async () => {
  const { root, cleanup } = tmpDir();
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
    assert.deepEqual(run(), [{ file: '.slicekit/journal/main.log', line: 1, message: 'journal chain broken at line 1 of .slicekit/journal/main.log' }]);
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
    fs.writeFileSync(path.join(DIR(root), 'no-branch.log'), 'torn');
    const out = await runHook('session-end', { stdin: JSON.stringify({ session_id: 's', cwd: root, reason: 'exit' }), root, env: {} });
    assert.equal(out.code, 0);
    assert.equal(out.stdout, '{}');
    assert.match(out.stderr, /slicekit hook session-end failed: .*torn/);
    assert.equal(fs.readFileSync(path.join(DIR(root), 'no-branch.log'), 'utf8'), 'torn');
  } finally {
    cleanup();
  }
});
