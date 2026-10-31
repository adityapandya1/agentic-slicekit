// REQ-2.6, REQ-2.10: a declined should-have is opened as one tracker issue and listed under Should-haves declined in the pull request body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getTracker, TrackerError } from '../src/adapters/tracker/index.js';
import { fixtureTracker } from '../src/adapters/tracker/fixture.js';
import { githubIssues } from '../src/adapters/tracker/github-issues.js';
import { fixtureHost } from '../src/adapters/githost/fixture.js';
import { declineFinding } from '../src/build/decline.js';
import { init } from '../src/init.js';
import { loadConfig } from '../src/config.js';
import { readSlice, writeSlice } from '../src/state/index.js';
import { REQUIRED_SECTIONS, getSection, renderPrBody } from '../src/prbody.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { writeSliceFixture } from './helpers/slice-fixture.js';
import { runCli } from './helpers/run-cli.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function tempCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-tracker-'));
  fs.cpSync(path.join(here, 'fixtures', 'tracker'), dir, { recursive: true });
  return dir;
}

const calls = (dir) =>
  fs
    .readFileSync(path.join(dir, 'issue-calls.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l));

test('the fixture tracker opens, finds and comments', () => {
  const dir = tempCopy();
  try {
    const t = fixtureTracker(dir);
    const made = t.open({ title: '[P2/S-15] H-1: a long function', body: 'the body', labels: ['slicekit'], slice: 'P2/S-15' });
    assert.deepEqual(made, { id: 1, url: 'https://example.test/issues/1' });
    assert.deepEqual(t.find('P2/S-15', 'H-1'), { id: 1, url: 'https://example.test/issues/1', state: 'open' });
    assert.equal(t.find('P2/S-15', 'H-2'), null);
    assert.equal(t.find('P2/S-16', 'H-1'), null);
    t.comment(1, 'a comment');
    const issues = JSON.parse(fs.readFileSync(path.join(dir, 'issues.json'), 'utf8'));
    assert.equal(issues.length, 1);
    assert.equal(issues[0].comments.length, 1);
    assert.deepEqual(issues[0].labels, ['slicekit']);
    const log = calls(dir);
    assert.equal(log.length, 2);
    assert.equal(log[0].op, 'open');
    assert.equal(log[0].slice, 'P2/S-15');
    assert.deepEqual(log[1], { op: 'comment', id: 1, body: 'a comment' });
    assert.throws(() => t.comment(9, 'x'), TrackerError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the fixture tracker refuses open when issue-create-error.txt exists', () => {
  const dir = tempCopy();
  try {
    fs.writeFileSync(path.join(dir, 'issue-create-error.txt'), 'HTTP 403: Resource not accessible\n');
    assert.throws(
      () => fixtureTracker(dir).open({ title: '[P2/S-15] H-1: x', body: 'b', slice: 'P2/S-15' }),
      (e) => e instanceof TrackerError && /403/.test(e.message),
    );
    assert.equal(fs.existsSync(path.join(dir, 'issue-calls.jsonl')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the GitHub tracker reads the number from the url', () => {
  const seen = [];
  let answer = '';
  const exec = (cmd, args, opts) => {
    seen.push({ cmd, args, opts });
    return answer;
  };
  const t = githubIssues({ X: '1' }, '/the/project', exec);
  answer = 'Creating issue in o/r\n\nhttps://github.com/o/r/issues/7\n';
  assert.deepEqual(t.open({ title: '[P2/S-15] H-1: x', body: 'the body', labels: ['a', 'b'], slice: 'P2/S-15' }), {
    id: 7,
    url: 'https://github.com/o/r/issues/7',
  });
  assert.equal(seen[0].cmd, 'gh');
  assert.deepEqual(seen[0].args, ['issue', 'create', '--title=[P2/S-15] H-1: x', '--body-file', '-', '--label=a', '--label=b']);
  assert.equal(seen[0].opts.input, 'the body');
  assert.equal(seen[0].opts.cwd, '/the/project');
  assert.deepEqual(seen[0].opts.env, { X: '1' });

  answer = '';
  t.comment(7, 'more');
  assert.deepEqual(seen[1].args, ['issue', 'comment', '7', '--body-file', '-']);
  assert.equal(seen[1].opts.input, 'more');

  answer = JSON.stringify([
    { number: 3, url: 'https://github.com/o/r/issues/3', title: 'mentions [P2/S-15] H-1: elsewhere' },
    { number: 4, url: 'https://github.com/o/r/issues/4', title: '[P2/S-15] H-10: other' },
    { number: 7, url: 'https://github.com/o/r/issues/7', title: '[P2/S-15] H-1: x', state: 'CLOSED' },
  ]);
  assert.deepEqual(t.find('P2/S-15', 'H-1'), { id: 7, url: 'https://github.com/o/r/issues/7', state: 'closed' });
  assert.deepEqual(seen[2].args, [
    'issue',
    'list',
    '--state',
    'all',
    '--search',
    '"[P2/S-15] H-1:" in:title sort:created-asc',
    '--json',
    'number,url,title,state',
    '--limit',
    '50',
  ]);
  answer = '[]';
  assert.equal(t.find('P2/S-15', 'H-2'), null);

  answer = 'no url here\n';
  assert.throws(() => t.open({ title: 't', body: 'b', slice: 'P2/S-15' }), TrackerError);
  const failing = githubIssues({}, '/p', () => {
    const e = new Error('exit 1');
    e.status = 1;
    e.stderr = 'GraphQL: Resource not accessible by integration\n';
    throw e;
  });
  assert.throws(() => failing.comment(1, 'x'), (e) => e instanceof TrackerError && /not accessible/.test(e.message));
});

test('getTracker picks the fixture, then the configured kind', () => {
  assert.equal(getTracker({ tracker: { kind: 'github-issues' } }, { SLICEKIT_TRACKER_FIXTURE: '/x' }).kind, 'fixture');
  assert.equal(getTracker({ tracker: { kind: 'github-issues' } }, {}).kind, 'github-issues');
  assert.throws(() => getTracker({ tracker: { kind: 'jira' } }, {}), (e) => e instanceof TrackerError && e.message === 'unsupported tracker: jira');
});

const VERDICT = `Verdict: CHANGES

| ID | File:line | What is wrong | Why it matters | How verified |
|---|---|---|---|---|
| H-1 | src/a.js:3 | a long function | hard to read | read it |

## Checklists run

- correctness

## Not checked

- performance
`;

// A repository whose own checkout holds the slice's branch, two recorded verdicts and a pull request
// in a fixture host: enough for declineFinding before Task 2's recording step lands.
function withDeclineKit(fn) {
  const repo = makeRepo();
  const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-host-'));
  const trackerDir = tempCopy();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const id = writeSliceFixture(repo.root);
    execFileSync('git', ['checkout', '-q', '-b', 'slice/P1-S-01-a'], { cwd: repo.root });
    const cfg = loadConfig(repo.root);
    const reviews = path.join(repo.root, '.slicekit', 'reviews');
    fs.mkdirSync(reviews, { recursive: true });
    fs.writeFileSync(path.join(reviews, 'P1-S-01-r1.md'), VERDICT.replace('| H-1 |', '| H-9 |'));
    fs.writeFileSync(path.join(reviews, 'P1-S-01-r2.md'), VERDICT);
    const state = readSlice(repo.root, cfg, id);
    writeSlice(repo.root, cfg, {
      ...state,
      state: 'in-review',
      pr: { number: 1, url: 'https://example.test/pull/1', headSha: 'abc1234' },
      verdicts: [
        { round: 2, path: '.slicekit/reviews/P1-S-01-r2.md', blockers: 0, independent: false, headSha: 'abc1234' },
        { round: 1, path: '.slicekit/reviews/P1-S-01-r1.md', blockers: 0, independent: false, headSha: 'abc1234' },
      ],
    });
    const sections = { ...Object.fromEntries(REQUIRED_SECTIONS.map((n) => [n, `text for ${n}`])), 'Should-haves declined': 'none' };
    const body = renderPrBody({ slice: id, name: 'Fixture 1', sections });
    const pr = { number: 1, url: 'https://example.test/pull/1', state: 'OPEN', isDraft: true, headRefName: 'slice/P1-S-01-a', title: `[${id}] Fixture 1`, body, headRefOid: 'abc1234', labels: [] };
    fs.writeFileSync(path.join(hostDir, 'pr-1.json'), JSON.stringify(pr));
    return fn({ root: repo.root, cfg, id, host: fixtureHost(hostDir), tracker: fixtureTracker(trackerDir), hostDir, trackerDir });
  } finally {
    repo.cleanup();
    fs.rmSync(hostDir, { recursive: true, force: true });
    fs.rmSync(trackerDir, { recursive: true, force: true });
  }
}

test('declineFinding opens one issue for a should-have of the latest verdict and lists it in the body', () => {
  withDeclineKit(({ root, cfg, id, host, tracker, trackerDir }) => {
    const first = declineFinding(root, cfg, host, tracker, id, 'H-1');
    assert.deepEqual(first, { url: 'https://example.test/issues/1', created: true, state: 'open' });
    const [issue] = JSON.parse(fs.readFileSync(path.join(trackerDir, 'issues.json'), 'utf8'));
    assert.equal(issue.title, `[${id}] H-1: a long function`);
    assert.ok(issue.body.includes('a long function'), issue.body);
    assert.ok(issue.body.includes('hard to read'), issue.body);
    assert.ok(issue.body.includes('read it'), issue.body);
    assert.ok(issue.body.includes('Verdict: .slicekit/reviews/P1-S-01-r2.md at abc1234'), issue.body);
    assert.equal(getSection(host.getPullRequest(1).body, 'Should-haves declined'), 'https://example.test/issues/1');

    const again = declineFinding(root, cfg, host, tracker, id, 'H-1');
    assert.deepEqual(again, { url: 'https://example.test/issues/1', created: false, state: 'open' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(trackerDir, 'issues.json'), 'utf8')).length, 1);
    assert.equal(getSection(host.getPullRequest(1).body, 'Should-haves declined'), 'https://example.test/issues/1');

    // H-9 belongs to round 1 only; the latest round is 2, whatever the order of the state's array.
    assert.throws(() => declineFinding(root, cfg, host, tracker, id, 'H-9'), (e) => e.code === 2 && e.message === 'H-9 is not a should-have of round 2');
    assert.throws(() => declineFinding(root, cfg, host, tracker, id, 'B-1'), (e) => e.code === 2 && e.message === 'B-1 is not a should-have of round 2');
  });
});

test('declineFinding cuts a long title to 256 characters and keeps its prefix', () => {
  withDeclineKit(({ root, cfg, id, host, tracker, trackerDir }) => {
    const long = 'x'.repeat(400);
    fs.writeFileSync(path.join(root, '.slicekit', 'reviews', 'P1-S-01-r2.md'), VERDICT.replace('a long function', long));
    declineFinding(root, cfg, host, tracker, id, 'H-1');
    const [issue] = JSON.parse(fs.readFileSync(path.join(trackerDir, 'issues.json'), 'utf8'));
    assert.equal(issue.title.length, 256);
    assert.ok(issue.title.startsWith(`[${id}] H-1: xxx`), issue.title);
    assert.ok(issue.title.endsWith('x…'), issue.title);
    assert.ok(issue.body.includes(long), 'the body keeps the full text');
  });
});

test('declineFinding wraps @mentions in backticks in the title and body', () => {
  withDeclineKit(({ root, cfg, id, host, tracker, trackerDir }) => {
    const text = VERDICT.replace('a long function', 'ask @octocat about it').replace('hard to read', 'see @acme/team, mail a@b.com, `@kept`');
    fs.writeFileSync(path.join(root, '.slicekit', 'reviews', 'P1-S-01-r2.md'), text);
    declineFinding(root, cfg, host, tracker, id, 'H-1');
    const [issue] = JSON.parse(fs.readFileSync(path.join(trackerDir, 'issues.json'), 'utf8'));
    assert.equal(issue.title, `[${id}] H-1: ask \`@octocat\` about it`);
    assert.ok(issue.body.includes('see `@acme/team`, mail a@b.com, `@kept`'), issue.body);
    assert.ok(!/(^|[^`\w])@\w/.test(issue.body.replace(/`[^`]*`/g, '')), issue.body);
  });
});

test('declineFinding reports an issue already filed, open or closed, and never opens another', () => {
  for (const state of ['open', 'closed']) {
    withDeclineKit(({ root, cfg, id, host, tracker, trackerDir }) => {
      const file = path.join(trackerDir, 'issues.json');
      const existing = { number: 5, url: 'https://example.test/issues/5', title: `[${id}] H-1: filed by hand`, body: '', labels: [], comments: [], state };
      fs.writeFileSync(file, JSON.stringify([existing]));
      assert.deepEqual(declineFinding(root, cfg, host, tracker, id, 'H-1'), { url: existing.url, created: false, state });
      const after = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(after.length, 1);
      assert.equal(after[0].state, state);
      assert.equal(getSection(host.getPullRequest(1).body, 'Should-haves declined'), existing.url);
    });
  }
});

test('build decline prints already filed, and closed for a closed issue', () => {
  for (const [state, line] of [
    ['open', 'https://example.test/issues/5 (already filed)\n'],
    ['closed', 'https://example.test/issues/5 (already filed, closed)\n'],
  ]) {
    withDeclineKit(({ root, id, hostDir, trackerDir }) => {
      const existing = { number: 5, url: 'https://example.test/issues/5', title: `[${id}] H-1: x`, body: '', labels: [], comments: [], state };
      fs.writeFileSync(path.join(trackerDir, 'issues.json'), JSON.stringify([existing]));
      const r = runCli(['build', 'decline', id, 'H-1'], { cwd: root, env: { ...process.env, SLICEKIT_GITHOST_FIXTURE: hostDir, SLICEKIT_TRACKER_FIXTURE: trackerDir } });
      assert.equal(r.stderr, '');
      assert.equal(r.code, 0);
      assert.equal(r.stdout, line);
    });
  }
});
