// P5/S-21, REQ-2.9, D-12, D-54, D-55: `slicekit release P<n>`. It runs on a `release/<slug>` branch
// at the default branch's tip, refuses while a slice of the phase is not merged or fails the runbook
// judgement, and otherwise writes the release record, sets each slice released and rewrites BUILD.md.
// Every repository here lives in os.tmpdir() with a bare origin and the fixture git host; nothing
// reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { init as initKit } from '../../src/init.js';
import { kitPaths } from '../../src/paths.js';
import { renderBuild } from '../../src/state/build.js';
import { cli } from '../helpers/build-flow.js';
import { commitFixed, gitIn, write } from '../helpers/graph-fixture.js';
import { CI_PULL_REQUEST } from '../helpers/run-cli.js';
import { makeRemote, makeRepo } from '../helpers/tmp-repo.js';

const RECORD = 'docs/releases/P1.md';
const MERGED_AT = { 1: '2026-10-02T10:00:00Z', 2: '2026-10-03T11:00:00Z' };
const url = (n) => `https://github.com/acme/demo/pull/${n}`;
const title = (n) => `[P1/S-0${n}] Thing ${n === 1 ? 'a' : 'b'}`;

const sliceFile = (id, name, runbook, requirements, decisions, change) => `---
slice: ${id}
name: ${name}
repo: .
group: A
runbook: ${runbook}
requirements: [${requirements.join(', ')}]
decisions: [${decisions.join(', ')}]
---

## Done when

1. It works.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| \`a.test.js » works\` | happy | ${requirements[0]} |
| \`a.test.js » refuses\` | negative | ${requirements[0]} |

## Expected changes

\`${change}\`.
`;

const SPEC = `# 01 — X

## REQ-1.1 It works

The kit SHALL work.

Scenario: GIVEN a repo WHEN it runs THEN it works.

Cites: D-01.

## REQ-1.2 It asks

The kit SHALL ask.

Scenario: GIVEN a question WHEN it runs THEN it asks.

Cites: D-02.

## REQ-1.3 It answers

The kit SHALL answer.

Scenario: GIVEN an answer WHEN it runs THEN it answers.

Cites: D-01.
`;

const DECISIONS = `# Decisions

## Settled

| # | Type | Question | Answer | Who, when |
|---|------|----------|--------|-----------|
| D-01 | Decision | Name? | demo | team, 2026-10-01 |
| D-02 | Decision | Ask first? | yes | team, 2026-10-01 |

## Open

| # | Type | Question | Why it matters | Recommendation |
|---|------|----------|----------------|----------------|
`;

const ROLLBACK = 'Revert the pull request on the host, then run the sync.';
const RUNBOOK = `# Runbook: demo

## How to run it

Run it with node.

## Rollback

${ROLLBACK}
`;
const ROLLBACK_LINE = RUNBOOK.split('\n').indexOf('## Rollback') + 1;

const prBody = (n, runbookLine) =>
  `## ${title(n)}\n\n**Done when:** it works\n**Proof:** node --test → exit 0\n**Decisions:** D-02\n**Runbook:** ${runbookLine}\n`;

const prRaw = (n, headSha, runbookLine, state) => ({
  number: n,
  url: url(n),
  state,
  mergedAt: state === 'MERGED' ? MERGED_AT[n] : null,
  headRefOid: headSha,
  headRefName: `slice/P1-S-0${n}-${n === 1 ? 'a' : 'b'}`,
  isDraft: false,
  title: title(n),
  body: prBody(n, runbookLine),
  labels: [],
});

const stateJson = (id, fields) =>
  `${JSON.stringify({
    slice: id,
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
  }, null, 2)}\n`;

// The merge commit GitHub writes for pull request <n>, with a fixed date.
function mergePr(root, n, branch) {
  const date = `${1_790_100_000 + 60 * n} +0000`;
  gitIn(root, ['merge', '-q', '--no-ff', '-m', `Merge pull request #${n} from acme/${branch}`, branch], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

// The environment of a run: the fixture git host, and no pull request of the runner's own.
function hostEnv(fixture) {
  const env = { ...process.env, SLICEKIT_GITHOST_FIXTURE: fixture };
  for (const k of Object.keys(env)) if (CI_PULL_REQUEST.includes(k.toUpperCase())) delete env[k];
  return env;
}

// A repository with the kit installed and a bare origin, on `release/p1` at origin/main:
//   phase P1 "X" with P1/S-01 (REQ-1.1, REQ-1.3; `runbook: <s1Runbook>`) and P1/S-02 (REQ-1.2);
//   main: plan -> merge of #1 -> merge of #2 -> the state files, pushed to origin;
//   state: S-01 merged with pull request 1, S-02 at `s2State` with pull request 2;
//   the fixture host holds pr-1.json and pr-2.json, each body with `**Decisions:** D-02` and a
//   Runbook line (`pr1Runbook` for pull request 1).
// -> {root, remote, fixture, env, tip, run(args), cleanup}
function releaseRepo({ s2State = 'merged', s1Runbook = 'no', pr1Runbook = 'no operational change: docs only' } = {}) {
  const repo = makeRepo();
  const { root } = repo;
  initKit(root, { name: 'demo', shape: 'backend', commands: { test: 'node --test' }, cli: 'node bin/slicekit.js' });
  const origin = makeRemote(root);
  commitFixed(root, 'plan', {
    'docs/spec/01-x.md': SPEC,
    'docs/decisions.md': DECISIONS,
    'docs/phases/P1-x/P1.md': '# Phase 1 — X\n\n**Order:** A\n',
    'docs/phases/P1-x/S-01-a.md': sliceFile('P1/S-01', 'Thing a', s1Runbook, ['REQ-1.1', 'REQ-1.3'], ['D-01'], 'src/a.js'),
    'docs/phases/P1-x/S-02-b.md': sliceFile('P1/S-02', 'Thing b', 'no', ['REQ-1.2'], ['D-02'], 'src/b.js'),
    'docs/runbook.md': RUNBOOK,
  });

  const heads = {};
  for (const [n, letter] of [[1, 'a'], [2, 'b']]) {
    const branch = `slice/P1-S-0${n}-${letter}`;
    gitIn(root, ['switch', '-q', '-c', branch]);
    heads[n] = commitFixed(root, `feat(P1/S-0${n}): ${letter}\n\nSlice: P1/S-0${n}`, { [`src/${letter}.js`]: `export const ${letter} = ${n};\n` });
    gitIn(root, ['switch', '-q', 'main']);
    mergePr(root, n, branch);
    gitIn(root, ['branch', '-q', '-D', branch]);
  }

  const merged = (n) => ({
    state: 'merged',
    branch: `slice/P1-S-0${n}-${n === 1 ? 'a' : 'b'}`,
    pr: { number: n, url: url(n), headSha: heads[n] },
    mergedAt: MERGED_AT[n],
    history: [{ from: 'ready', to: 'merged', at: MERGED_AT[n], by: 'sync', evidence: { source: 'host', mergedAt: MERGED_AT[n] } }],
  });
  const tip = commitFixed(root, 'chore(slicekit): sync state', {
    '.slicekit/state/P1-S-01.json': stateJson('P1/S-01', merged(1)),
    '.slicekit/state/P1-S-02.json': stateJson('P1/S-02', s2State === 'merged' ? merged(2) : { ...merged(2), state: s2State, mergedAt: null, history: [] }),
  });
  gitIn(root, ['push', '-q', 'origin', 'main']);
  gitIn(root, ['fetch', '-q', 'origin']);
  gitIn(root, ['switch', '-q', '-c', 'release/p1']);

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-release-host-'));
  fs.writeFileSync(path.join(fixture, 'pr-1.json'), `${JSON.stringify(prRaw(1, heads[1], pr1Runbook, 'MERGED'), null, 2)}\n`);
  fs.writeFileSync(path.join(fixture, 'pr-2.json'), `${JSON.stringify(prRaw(2, heads[2], 'no operational change: docs only', s2State === 'merged' ? 'MERGED' : 'OPEN'), null, 2)}\n`);
  const env = hostEnv(fixture);
  return {
    root,
    remote: origin.remote,
    fixture,
    env,
    tip,
    run: (args) => cli(root, args, env),
    cleanup() {
      fs.rmSync(fixture, { recursive: true, force: true });
      origin.cleanup();
      repo.cleanup();
    },
  };
}

const read = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const stateOf = (root, n) => JSON.parse(read(root, `.slicekit/state/P1-S-0${n}.json`));
const buildFile = (root) => kitPaths(root, loadConfig(root)).build;
const readBuild = (root) => (fs.existsSync(buildFile(root)) ? fs.readFileSync(buildFile(root), 'utf8') : null);

// What a refusal may not touch: the record, both state files and BUILD.md.
const snapshot = (root) => ({
  record: fs.existsSync(path.join(root, ...RECORD.split('/'))),
  s1: read(root, '.slicekit/state/P1-S-01.json'),
  s2: read(root, '.slicekit/state/P1-S-02.json'),
  build: readBuild(root),
});

async function refused(p, line) {
  const before = snapshot(p.root);
  assert.equal(before.record, false);
  const r = await p.run(['release', 'P1']);
  assert.equal(r.code, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(r.stderr.includes(line), `stderr does not hold "${line}":\n${r.stderr}`);
  assert.equal(r.stdout, '');
  assert.deepEqual(snapshot(p.root), before, 'a refusal writes nothing');
  return r;
}

// REQ-2.9: "GIVEN a phase with one slice at `ready` WHEN `/slicekit release P1` runs THEN it refuses,
// names that slice, and writes no release record."
test('refuses while a slice of the phase is not merged, naming it', async () => {
  const p = releaseRepo({ s2State: 'ready' });
  try {
    const r = await refused(p, 'slicekit: P1/S-02 is ready, not merged');
    assert.ok(!r.stderr.includes('P1/S-01'), `the merged slice is named:\n${r.stderr}`);
  } finally {
    p.cleanup();
  }
});

// REQ-2.9, D-55: a merged `runbook: yes` slice whose body gives no "no operational change" line and
// whose head commit, present here, changed no section of the runbook.
test('refuses a merged slice that fails the runbook judgement, naming it', async () => {
  const p = releaseRepo({ s1Runbook: 'yes', pr1Runbook: 'see below' });
  try {
    const r = await refused(p, 'slicekit: P1/S-01 (#1): runbook: the slice says runbook: yes, docs/runbook.md changed no section');
    assert.ok(!r.stderr.includes('P1/S-02'), `the passing slice is named:\n${r.stderr}`);
  } finally {
    p.cleanup();
  }
});

// D-54: the record is written on a `release/<slug>` branch cut from the default branch's tip.
test("refuses off a release branch at the default branch's tip", async () => {
  const p = releaseRepo();
  try {
    const line = 'release runs on a release branch at the tip of main';
    gitIn(p.root, ['switch', '-q', 'main']);
    await refused(p, line);
    gitIn(p.root, ['switch', '-q', 'release/p1']);
    commitFixed(p.root, 'chore: one commit ahead', { 'notes.txt': 'ahead\n' });
    await refused(p, line);
  } finally {
    p.cleanup();
  }
});

// REQ-2.9, D-54: the record lists the default branch's commit, every requirement delivered, every
// pull request, the decisions taken in them and the runbook's rollback note.
test('writes the release record and sets each slice released', async () => {
  const p = releaseRepo();
  try {
    const { root } = p;
    const buildBefore = readBuild(root);
    const r = await p.run(['release', 'P1']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.stdout.replace(/\n$/, '').split('\n'), [RECORD, 'released P1/S-01', 'released P1/S-02']);

    const record = read(root, RECORD);
    assert.ok(!record.includes('\r'), 'the record has LF endings');
    assert.match(record, /[^\n]\n$/, 'the record ends in one newline');
    const lines = record.split('\n');
    assert.equal(lines[0], '# Release P1 — X');
    const committed = new Date(Number(gitIn(root, ['log', '-1', '--format=%ct', p.tip])) * 1000).toISOString().replace('.000Z', '');
    assert.match(lines[2], new RegExp(`^Default branch: main at ${p.tip}, committed ${committed}(?:\\.000)?(?:Z|\\+00:00)\\.$`), lines[2]);
    const section = (name) => {
      const from = lines.indexOf(`## ${name}`);
      assert.ok(from !== -1, `the record has no ## ${name}:\n${record}`);
      const rest = lines.slice(from + 1);
      const to = rest.findIndex((l) => l.startsWith('## '));
      return (to === -1 ? rest : rest.slice(0, to)).filter((l) => l !== '');
    };
    assert.deepEqual(section('Requirements delivered'), [
      '- REQ-1.1 It works (P1/S-01)',
      '- REQ-1.2 It asks (P1/S-02)',
      '- REQ-1.3 It answers (P1/S-01)',
    ]);
    assert.deepEqual(section('Pull requests'), [
      `- #1 ${title(1)} ${url(1)}, merged ${MERGED_AT[1]}`,
      `- #2 ${title(2)} ${url(2)}, merged ${MERGED_AT[2]}`,
    ]);
    assert.deepEqual(section('Decisions'), ['- D-02 Ask first? (#1, #2)']);
    assert.deepEqual(section('Rollback'), [`From docs/runbook.md:${ROLLBACK_LINE}:`, `> ${ROLLBACK}`]);

    for (const n of [1, 2]) {
      const st = stateOf(root, n);
      assert.equal(st.state, 'released', `P1/S-0${n}`);
      assert.equal(st.history.at(-1).to, 'released');
      assert.equal(st.history.at(-1).evidence.release, RECORD);
    }

    const build = readBuild(root);
    assert.notEqual(build, buildBefore, 'BUILD.md is rewritten');
    assert.equal(build, renderBuild(root, loadConfig(root), buildBefore ?? ''));
    for (const row of ['| S-01 | Thing a |', '| S-02 | Thing b |']) assert.ok(build.includes(row), `BUILD.md has no row ${row}`);

    // A phase is released once.
    const again = await p.run(['release', 'P1']);
    assert.equal(again.code, 1, again.stdout);
    assert.ok(again.stderr.includes(`${RECORD} exists; a phase is released once`), again.stderr);
    assert.equal(read(root, RECORD), record);
  } finally {
    p.cleanup();
  }
});

// D-54: the same bytes from the same inputs make the record checkable.
test('the record is byte-identical from two clones at the same commit', async () => {
  const p = releaseRepo();
  const clones = [];
  try {
    const outputs = [];
    for (const name of ['one', 'two']) {
      const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `slicekit-release-${name}-`)));
      clones.push(dir);
      gitIn(dir, ['clone', '-q', p.remote, '.']);
      gitIn(dir, ['config', 'user.name', `Clone ${name}`]);
      gitIn(dir, ['config', 'user.email', `${name}@example.com`]);
      assert.equal(gitIn(dir, ['rev-parse', 'HEAD']), p.tip);
      gitIn(dir, ['switch', '-q', '-c', `release/p1-${name}`]);
      const r = await cli(dir, ['release', 'P1', '--dry-run'], p.env);
      assert.equal(r.code, 0, r.stderr);
      assert.ok(!fs.existsSync(path.join(dir, ...RECORD.split('/'))), '--dry-run writes no record');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.slicekit', 'state', 'P1-S-01.json'), 'utf8')).state, 'merged', '--dry-run moves no state');
      outputs.push(r.stdout);
    }
    assert.match(outputs[0], /^# Release P1 — X\n/);
    assert.ok(outputs[0].includes(`Default branch: main at ${p.tip}, committed `), outputs[0]);
    assert.equal(outputs[0], outputs[1]);

    // The record a run writes is the text the dry run printed.
    const dry = await p.run(['release', 'P1', '--dry-run']);
    assert.equal(dry.code, 0, dry.stderr);
    assert.equal(dry.stdout, outputs[0]);
    const wrote = await p.run(['release', 'P1']);
    assert.equal(wrote.code, 0, wrote.stderr);
    assert.equal(read(p.root, RECORD), outputs[0]);
  } finally {
    for (const dir of clones) fs.rmSync(dir, { recursive: true, force: true });
    p.cleanup();
  }
});

// REQ-2.9 end to end: the record `release` writes is the one the graph's `shipped` reads.
test("the graph's shipped answers from the record", async () => {
  const p = releaseRepo();
  try {
    const released = await p.run(['release', 'P1']);
    assert.equal(released.code, 0, released.stderr);
    const graph = await p.run(['graph']);
    assert.equal(graph.code, 0, graph.stderr);
    const r = await p.run(['shipped', 'P1']);
    assert.equal(r.code, 0, r.stderr);
    const out = r.stdout.replace(/\n$/, '').split('\n');
    assert.equal(out[0], `P1 ${RECORD}`);
    const reqs = out.indexOf('requirements: 3');
    const prs = out.indexOf('pull requests: 2');
    assert.ok(reqs > 0 && prs > reqs, `requirements, then pull requests:\n${r.stdout}`);
    assert.deepEqual(out.slice(reqs + 1, prs).map((l) => l.trim().split(' ')[0]), ['REQ-1.1', 'REQ-1.2', 'REQ-1.3']);
    assert.deepEqual(out.slice(prs + 1).map((l) => l.trim()), [`#1 ${title(1)} ${url(1)}`, `#2 ${title(2)} ${url(2)}`]);
  } finally {
    p.cleanup();
  }
});
