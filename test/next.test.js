// P8/S-62 (REQ-2.16, D-104, D-101): `slicekit next` reads the program and slice state from files
// only and prints the one next step on its first line and the command that runs it on its second.
// It changes no file and calls no git host; at a person's point (a merge, an Open decision row the
// step depends on) it names the command for the person and runs nothing. Each test runs it on a
// fixture repository at the build stage and compares every file's bytes before and after the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { git } from '../src/git.js';
import { CI_PULL_REQUEST, runCli } from './helpers/run-cli.js';
import { makeRepo } from './helpers/tmp-repo.js';

const STAGE_FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stage');
const ID = 'P1/S-01';
const STATE_FILE = '.slicekit/state/P1-S-01.json';
const SLICE_FILE = 'docs/phases/P1-x/S-01-a.md';

function write(root, rel, text) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// Every file under `root` but .git, as a map of its path to the sha256 of its bytes.
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (rel === '.git') continue;
      if (entry.isDirectory()) walk(full);
      else out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(root);
  return out;
}

// A repository at the build stage (the after-intake and after-plan stage fixtures) with the kit's
// config and the slice P1/S-01, committed on main. `state` is the slice's state file, written with
// the head commit when it is a function of it; `files` are written before the commit.
function fixture({ state, files = {} } = {}) {
  const repo = makeRepo();
  for (const point of ['after-intake', 'after-plan']) fs.cpSync(path.join(STAGE_FIXTURES, point), repo.root, { recursive: true });
  write(repo.root, '.slicekit/config.json', `${JSON.stringify(defaultConfig({ name: 'demo', shape: 'backend' }), null, 2)}\n`);
  for (const [rel, text] of Object.entries(files)) write(repo.root, rel, typeof text === 'function' ? text(fs.readFileSync(path.join(repo.root, rel), 'utf8')) : text);
  git(repo.root, ['add', '-A']);
  git(repo.root, ['commit', '-q', '-m', 'fixture']);
  if (state) {
    const head = git(repo.root, ['rev-parse', 'HEAD']).trim();
    const body = typeof state === 'function' ? state(head) : state;
    write(repo.root, STATE_FILE, `${JSON.stringify(body, null, 2)}\n`);
    git(repo.root, ['add', '-A']);
    git(repo.root, ['commit', '-q', '-m', 'state']);
  }
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-next-host-'));
  return {
    root: repo.root,
    host,
    cleanup() {
      fs.rmSync(host, { recursive: true, force: true });
      repo.cleanup();
    },
  };
}

// The slice's state file with the fields every state carries.
const sliceState = (fields) => ({
  slice: ID,
  state: 'todo',
  branch: null,
  pr: null,
  redCommit: null,
  frozenTests: [],
  unfrozen: [],
  verdicts: [],
  ci: null,
  mergedAt: null,
  handoff: null,
  history: [],
  ...fields,
});

// Runs `slicekit next` in the fixture with the fixture git host set to an empty directory; returns
// the exit code, the output and its lines, and asserts the run changed no file and left the host
// directory empty.
function next(p) {
  const env = { ...process.env, SLICEKIT_GITHOST_FIXTURE: p.host };
  for (const k of Object.keys(env)) if (CI_PULL_REQUEST.includes(k.toUpperCase())) delete env[k];
  const before = snapshot(p.root);
  const r = runCli(['next'], { cwd: p.root, env });
  assert.deepEqual(snapshot(p.root), before, `slicekit next changed a file: ${r.stdout}${r.stderr}`);
  assert.deepEqual(fs.readdirSync(p.host), [], 'slicekit next called the git host');
  return { ...r, lines: r.stdout.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '') };
}

function withFixture(opts, fn) {
  const p = fixture(opts);
  try {
    return fn(p);
  } finally {
    p.cleanup();
  }
}

test('at tests-red next names the build step and its command', () => {
  withFixture(
    {
      state: (head) =>
        sliceState({
          state: 'tests-red',
          branch: 'slice/P1-S-01-the-thing',
          redCommit: head,
          frozenTests: [{ file: 'test/a.test.js', name: 'works' }],
          history: [{ from: 'todo', to: 'tests-red', at: '2026-11-23T10:00:00.000Z', by: 'cli', evidence: { commit: head, testExit: 1, tests: ['test/a.test.js'] } }],
        }),
    },
    (p) => {
      const r = next(p);
      assert.equal(r.code, 0, r.stderr);
      assert.ok(r.lines.length >= 2, `slicekit next printed fewer than two lines: ${r.stdout}`);
      assert.match(r.lines[0], /P1\/S-01/, `the first line does not name the slice: ${r.lines[0]}`);
      assert.match(r.lines[0], /build/i, `the first line does not name the build step: ${r.lines[0]}`);
      assert.match(r.lines[1], /slicekit build\b.*P1\/S-01/, `the second line is not the build command for the slice: ${r.lines[1]}`);
    },
  );
});

test('at ready next names the merge for a person and changes no file', () => {
  withFixture(
    {
      state: (head) =>
        sliceState({
          state: 'ready',
          branch: 'slice/P1-S-01-the-thing',
          redCommit: head,
          pr: { number: 42, url: 'https://example.com/pull/42', headSha: head, title: `[${ID}] The thing` },
          verdicts: [
            { round: 1, path: '.slicekit/reviews/P1-S-01-r1.md', blockers: 0, independent: false, headSha: head },
            { round: 2, path: '.slicekit/reviews/P1-S-01i-r2.md', blockers: 0, independent: true, headSha: head },
          ],
          ci: { sha: head, conclusion: 'success' },
        }),
    },
    (p) => {
      const r = next(p);
      assert.equal(r.code, 0, r.stderr);
      assert.ok(r.lines.length >= 2, `slicekit next printed fewer than two lines: ${r.stdout}`);
      assert.match(r.lines[0], /merge/i, `the first line does not name the merge: ${r.lines[0]}`);
      assert.match(r.lines[0], /person|human/i, `the first line does not say the merge is a person's: ${r.lines[0]}`);
      assert.match(r.lines[0], /(^|[^\d])42(?!\d)/, `the first line does not name pull request 42: ${r.lines[0]}`);
      assert.match(r.lines[1], /(^|[^\d])42(?!\d)/, `the command for the person does not name pull request 42: ${r.lines[1]}`);
    },
  );
});

test('two runs with no change print the same step and never a recorded round', () => {
  withFixture(
    {
      files: {
        '.slicekit/reviews/P1-S-01-r1.md':
          'Verdict: CHANGES\n\n| ID | File:line | What is wrong | Why it matters | How verified |\n|---|---|---|---|---|\n| H-1 | src/a.js:1 | It returns 1. | The test wants 2. | ran: node --test |\n\n## Checklists run\n\n- Done when 1.\n\n## Not checked\n\n- Nothing else.\n',
      },
      state: (head) =>
        sliceState({
          state: 'changes-requested',
          branch: 'slice/P1-S-01-the-thing',
          redCommit: head,
          pr: { number: 7, url: 'https://example.com/pull/7', headSha: head, title: `[${ID}] The thing` },
          verdicts: [{ round: 1, path: '.slicekit/reviews/P1-S-01-r1.md', blockers: 1, independent: false, headSha: head }],
          history: [
            { from: 'building', to: 'draft-pr', at: '2026-11-23T10:00:00.000Z', by: 'cli', evidence: { testExit: 0, checkExit: 0, pr: { number: 7, headSha: head } } },
            {
              from: 'draft-pr',
              to: 'changes-requested',
              at: '2026-11-23T10:10:00.000Z',
              by: 'cli',
              evidence: { verdict: { round: 1, path: '.slicekit/reviews/P1-S-01-r1.md', blockers: 1, independent: false } },
            },
          ],
        }),
    },
    (p) => {
      const first = next(p);
      const second = next(p);
      assert.equal(first.code, 0, first.stderr);
      assert.equal(second.code, 0, second.stderr);
      assert.ok(first.lines.length >= 2, `slicekit next printed fewer than two lines: ${first.stdout}`);
      assert.deepEqual(second.lines, first.lines, 'the second run printed another step');
      for (const r of [first, second]) {
        assert.doesNotMatch(r.stdout, /round 1(?!\d)/i, `slicekit next names round 1, which the state file records: ${r.stdout}`);
        assert.doesNotMatch(r.stdout, /-r1\.md/, `slicekit next names the round 1 verdict file: ${r.stdout}`);
      }
      assert.match(first.lines[0], /P1\/S-01/, `the first line does not name the slice: ${first.lines[0]}`);
    },
  );
});

test('an Open decision row the step depends on stops next for a person', () => {
  withFixture(
    {
      files: {
        // D-02 is in the Open table, cited by the slice file only, so the clarify stage passes and
        // the slice's build start is the step that depends on it.
        'docs/decisions.md': (text) =>
          `${text.trimEnd()}\n| D-02 | Decision | Which port? | The thing listens on it | 8080 |\n`,
        [SLICE_FILE]: (text) => text.replace('decisions: [D-01]', 'decisions: [D-01, D-02]'),
      },
    },
    (p) => {
      const r = next(p);
      assert.equal(r.code, 0, r.stderr);
      assert.ok(r.lines.length >= 2, `slicekit next printed fewer than two lines: ${r.stdout}`);
      assert.match(r.lines[0], /D-02/, `the first line does not name the Open row D-02: ${r.lines[0]}`);
      assert.match(r.lines[0], /person|human/i, `the first line does not say the step is a person's: ${r.lines[0]}`);
      assert.doesNotMatch(r.stdout, /build start/, `slicekit next names build start while D-02 is Open: ${r.stdout}`);
    },
  );
});
