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
  assert.throws(() => getTracker({ tracker: { kind: 'linear' } }, {}), (e) => e instanceof TrackerError && e.message === 'unsupported tracker: linear');
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

// P4/S-44 (REQ-1.1, D-74): Jira Cloud behind C-2. The network is a `fetch` passed in, as intake does.
const JIRA_BASE = 'https://acme.atlassian.net';
const jiraCfg = () => ({ tracker: { kind: 'jira', baseUrl: JIRA_BASE, project: 'SK', issueType: 'Task' } });
const loadJira = async () => (await import('../src/adapters/tracker/jira.js')).jiraTracker;

// A fetch that records each request and answers from `answer(call)` ({status, json}).
function jiraFetch(answer) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const call = {
      url: new URL(String(url)),
      method: String(init.method ?? 'GET').toUpperCase(),
      auth: new Headers(init.headers ?? {}).get('authorization'),
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    };
    seen.push(call);
    const { status = 200, json = {} } = answer(call);
    const text = JSON.stringify(json);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => JSON.parse(text),
      text: async () => text,
    };
  };
  return { seen, fetchImpl };
}

test('jira open, comment and find call the Jira REST API with the configured project', async () => {
  const env = { JIRA_EMAIL: 'bot@acme.test', JIRA_API_TOKEN: 'tok-123' };
  const basic = `Basic ${Buffer.from('bot@acme.test:tok-123').toString('base64')}`;
  let found = [];
  const { seen, fetchImpl } = jiraFetch((c) => {
    if (c.method === 'POST' && c.url.pathname === '/rest/api/3/issue') return { status: 201, json: { id: '10001', key: 'SK-7', self: `${JIRA_BASE}/rest/api/3/issue/10001` } };
    if (c.method === 'POST' && c.url.pathname === '/rest/api/3/issue/10001/comment') return { status: 201, json: { id: '1' } };
    if (c.method === 'GET' && c.url.pathname === '/rest/api/3/search/jql') return { json: { issues: found } };
    return { status: 404, json: { errorMessages: ['no such route'] } };
  });
  const jiraTracker = await loadJira();
  const t = jiraTracker(jiraCfg(), env, fetchImpl);
  assert.equal(t.kind, 'jira');

  const made = await t.open({ title: '[P2/S-15] H-1: a long function', body: 'the body', labels: ['slicekit'], slice: 'P2/S-15' });
  assert.deepEqual(made, { id: 10001, url: `${JIRA_BASE}/browse/SK-7` });
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url.origin, JIRA_BASE);
  assert.equal(seen[0].auth, basic);
  assert.equal(seen[0].body.fields.project.key, 'SK');
  assert.equal(seen[0].body.fields.issuetype.name, 'Task');
  assert.equal(seen[0].body.fields.summary, '[P2/S-15] H-1: a long function');
  assert.deepEqual(seen[0].body.fields.labels, ['slicekit']);
  assert.match(JSON.stringify(seen[0].body.fields.description), /the body/);

  await t.comment(10001, 'more');
  assert.equal(seen[1].method, 'POST');
  assert.equal(seen[1].url.pathname, '/rest/api/3/issue/10001/comment');
  assert.equal(seen[1].auth, basic);
  assert.match(JSON.stringify(seen[1].body), /more/);

  // Oldest first; a summary that only mentions the prefix, or names H-10, is not H-1; done reads as closed.
  found = [
    { id: '3', key: 'SK-3', fields: { summary: 'mentions [P2/S-15] H-1: elsewhere', status: { statusCategory: { key: 'new' } } } },
    { id: '4', key: 'SK-4', fields: { summary: '[P2/S-15] H-10: other', status: { statusCategory: { key: 'new' } } } },
    { id: '7', key: 'SK-7', fields: { summary: '[P2/S-15] H-1: x', status: { statusCategory: { key: 'done' } } } },
    { id: '8', key: 'SK-8', fields: { summary: '[P2/S-15] H-1: later', status: { statusCategory: { key: 'indeterminate' } } } },
  ];
  assert.deepEqual(await t.find('P2/S-15', 'H-1'), { id: 7, url: `${JIRA_BASE}/browse/SK-7`, state: 'closed' });
  const search = seen[2];
  assert.equal(search.method, 'GET');
  assert.equal(search.url.pathname, '/rest/api/3/search/jql');
  assert.equal(search.auth, basic);
  const jql = search.url.searchParams.get('jql');
  assert.match(jql, /project\s*=\s*"?SK"?/);
  assert.match(jql, /summary\s*~\s*"/);
  assert.ok(jql.includes('P2/S-15') && jql.includes('H-1'), jql);
  assert.match(jql, /ORDER BY created ASC/i);

  found = [{ id: '8', key: 'SK-8', fields: { summary: '[P2/S-15] H-1: later', status: { statusCategory: { key: 'indeterminate' } } } }];
  assert.deepEqual(await t.find('P2/S-15', 'H-1'), { id: 8, url: `${JIRA_BASE}/browse/SK-8`, state: 'open' });
  found = [];
  assert.equal(await t.find('P2/S-15', 'H-2'), null);

  // getTracker selects the Jira adapter from config.
  assert.equal(getTracker(jiraCfg(), env).kind, 'jira');
});

test('jira without JIRA_API_TOKEN fails naming the variable and prints no token', async () => {
  const jiraTracker = await loadJira();
  const { seen, fetchImpl } = jiraFetch(() => ({ status: 201, json: { id: '1', key: 'SK-1' } }));
  const attempt = async (env) => {
    const t = jiraTracker(jiraCfg(), env, fetchImpl);
    return t.open({ title: '[P2/S-15] H-1: x', body: 'b', slice: 'P2/S-15' });
  };
  await assert.rejects(attempt({ JIRA_EMAIL: 'bot@acme.test' }), (e) => e instanceof TrackerError && /JIRA_API_TOKEN/.test(e.message));
  await assert.rejects(attempt({ JIRA_API_TOKEN: 'tok-123' }), (e) => e instanceof TrackerError && /JIRA_EMAIL/.test(e.message));
  assert.equal(seen.length, 0, 'no request without both variables');

  // Jira refusing the call: the error names the status but carries neither the token nor the auth header.
  const token = 'tok-SECRET-9f8e7d';
  const header = Buffer.from(`bot@acme.test:${token}`).toString('base64');
  const refusing = jiraFetch(() => ({ status: 401, json: { errorMessages: [`bad credentials ${token} Basic ${header}`] } }));
  const t = jiraTracker(jiraCfg(), { JIRA_EMAIL: 'bot@acme.test', JIRA_API_TOKEN: token }, refusing.fetchImpl);
  for (const call of [
    () => t.open({ title: '[P2/S-15] H-1: x', body: 'b', slice: 'P2/S-15' }),
    () => t.comment(1, 'x'),
    () => t.find('P2/S-15', 'H-1'),
  ]) {
    await assert.rejects(call(), (e) => {
      assert.ok(e instanceof TrackerError, String(e));
      assert.match(e.message, /401/);
      const shown = `${e.message}\n${e.stack}\n${e.stderr ?? ''}\n${JSON.stringify(e)}`;
      assert.ok(!shown.includes(token), shown);
      assert.ok(!shown.includes(header), shown);
      return true;
    });
  }
});
