// P5/S-23, REQ-2.13, D-57: `slicekit ops context <symptom>` and `slicekit ops check <report>`. The
// context names the files the symptom's words match in the graph, their history, the runbook, the
// observability file and the last release record; the check reads the report the ops agent replied
// with. Neither changes a tracked file. Every repository here lives in os.tmpdir() with a bare origin
// and the fixture git host; nothing reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init as initKit } from '../../src/init.js';
import { cli } from '../helpers/build-flow.js';
import { commitFixed, gitIn } from '../helpers/graph-fixture.js';
import { CI_PULL_REQUEST } from '../helpers/run-cli.js';
import { makeRemote, makeRepo } from '../helpers/tmp-repo.js';

// ---- the fixture (frozen with these tests, D-10) ----

// No slice file, spec file or branch here carries the words `billing`, `health` or `release` in its
// name: a symptom word names a file by a segment of its path.
const SLICES = {
  1: { word: 'charges', name: 'Billing charges', req: 'REQ-1.1', files: { 'src/billing/charge.js': 'export const charge = (n) => n;\n', 'src/billing/refund.js': 'export const refund = (n) => -n;\n' } },
  2: { word: 'status', name: 'Health answer', req: 'REQ-1.2', files: { 'src/health.js': "export const health = () => 'ok';\n" } },
};
const MERGED_AT = { 1: '2026-10-02T10:00:00Z', 2: '2026-10-03T11:00:00Z' };
const url = (n) => `https://github.com/acme/demo/pull/${n}`;
const title = (n) => `[P1/S-0${n}] ${SLICES[n].name}`;
const branchOf = (n) => `slice/P1-S-0${n}-${SLICES[n].word}`;

const sliceFile = (n) => `---
slice: P1/S-0${n}
name: ${SLICES[n].name}
repo: .
group: A
runbook: no
requirements: [${SLICES[n].req}]
decisions: [D-01]
---

## Done when

1. It works.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| \`a.test.js » works\` | happy | ${SLICES[n].req} |
| \`a.test.js » refuses\` | negative | ${SLICES[n].req} |

## Expected changes

${Object.keys(SLICES[n].files).map((f) => `\`${f}\``).join(', ')}.
`;

const SPEC = `# 01 — X

## REQ-1.1 Billing charges a card

The service SHALL charge a card and refund it (\`src/billing/\`).

Scenario: GIVEN a card WHEN a charge runs THEN the card is charged.

Cites: D-01.

## REQ-1.2 Health answers

The service SHALL answer GET /health with \`ok\` (\`src/health.js\`).

Scenario: GIVEN a running service WHEN GET /health runs THEN it answers ok.

Cites: D-01.
`;

const DECISIONS = `# Decisions

## Settled

| # | Type | Question | Answer | Who, when |
|---|------|----------|--------|-----------|
| D-01 | Decision | Name? | demo | team, 2026-10-01 |

## Open

| # | Type | Question | Why it matters | Recommendation |
|---|------|----------|----------------|----------------|
`;

const FIRST_CHECK = 'When billing returns 500, read the charge and refund code under `src/billing/` first.';
const RUNBOOK = `# Runbook: demo

## How to run it

Run it with node.

## Health

GET /health answers \`ok\` (\`src/health.js\`).

## Known failure modes and the first thing to check

${FIRST_CHECK}

## Rollback

Revert the pull request on the host, then run the sync.
`;
const FIRST_CHECK_LINE = RUNBOOK.split('\n').indexOf(FIRST_CHECK) + 1;

const OBSERVABILITY = '# Observability\n\n## Logs\n\nThe service logs to stdout.\n';

const prRaw = (n, headSha) => ({
  number: n,
  url: url(n),
  state: 'MERGED',
  mergedAt: MERGED_AT[n],
  headRefOid: headSha,
  headRefName: branchOf(n),
  isDraft: false,
  title: title(n),
  body: `## ${title(n)}\n\n**Done when:** it works\n**Proof:** node --test → exit 0\n**Decisions:** D-01\n**Runbook:** no operational change: docs only\n`,
  labels: [],
});

const stateJson = (n, headSha) =>
  `${JSON.stringify({
    slice: `P1/S-0${n}`,
    state: 'merged',
    branch: branchOf(n),
    pr: { number: n, url: url(n), headSha },
    redCommit: null,
    frozenTests: [],
    unfrozen: [],
    verdicts: [],
    ci: null,
    mergedAt: MERGED_AT[n],
    handoff: null,
    history: [{ from: 'ready', to: 'merged', at: MERGED_AT[n], by: 'sync', evidence: { source: 'host', mergedAt: MERGED_AT[n] } }],
  }, null, 2)}\n`;

// The environment of a run: the fixture git host, and no pull request of the runner's own.
function hostEnv(host) {
  const env = { ...process.env, SLICEKIT_GITHOST_FIXTURE: host };
  for (const k of Object.keys(env)) if (CI_PULL_REQUEST.includes(k.toUpperCase())) delete env[k];
  return env;
}

// A repository with the kit installed, a bare origin and a built graph, on `main` with a clean tree:
//   phase P1 "X": P1/S-01 (REQ-1.1; src/billing/charge.js, src/billing/refund.js), merged as pull
//   request 1, and P1/S-02 (REQ-1.2; src/health.js, answering `ok`), merged as pull request 2;
//   docs/runbook.md, whose `## Health` section says GET /health answers `ok` and whose
//   `## Known failure modes and the first thing to check` section names src/billing/;
//   docs/observability.md; `slicekit release P1` run on release/p1 and merged, so docs/releases/P1.md
//   lists both pull requests;
//   then the seeded regression: `fix: health answers up` under `Slice: P1/S-03` (a slice with no
//   file), changing src/health.js to answer `up`;
//   then 60 files under src/release/, so the word `release` names more than fifty files.
// -> {root, host, env, shas: {plan, s01, s02, regression}, run(args), cleanup}
async function opsRepo() {
  const repo = makeRepo();
  const { root } = repo;
  initKit(root, { name: 'demo', shape: 'backend', commands: { test: 'node --test' }, cli: 'node bin/slicekit.js' });
  const origin = makeRemote(root);
  const shas = {};
  shas.plan = commitFixed(root, 'plan', {
    'docs/spec/01-x.md': SPEC,
    'docs/decisions.md': DECISIONS,
    'docs/phases/P1-x/P1.md': '# Phase 1 — X\n\n**Order:** A\n',
    'docs/phases/P1-x/S-01-charges.md': sliceFile(1),
    'docs/phases/P1-x/S-02-status.md': sliceFile(2),
    'docs/runbook.md': RUNBOOK,
    'docs/observability.md': OBSERVABILITY,
  });
  const heads = {};
  for (const n of [1, 2]) {
    gitIn(root, ['switch', '-q', '-c', branchOf(n)]);
    heads[n] = commitFixed(root, `feat(P1/S-0${n}): ${SLICES[n].word}\n\nSlice: P1/S-0${n}`, SLICES[n].files);
    gitIn(root, ['switch', '-q', 'main']);
    const date = `${1_790_100_000 + 60 * n} +0000`;
    gitIn(root, ['merge', '-q', '--no-ff', '-m', `Merge pull request #${n} from acme/${branchOf(n)}`, branchOf(n)], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    gitIn(root, ['branch', '-q', '-D', branchOf(n)]);
  }
  shas.s01 = heads[1];
  shas.s02 = heads[2];
  commitFixed(root, 'chore(slicekit): sync state', {
    '.slicekit/state/P1-S-01.json': stateJson(1, heads[1]),
    '.slicekit/state/P1-S-02.json': stateJson(2, heads[2]),
  });
  gitIn(root, ['push', '-q', 'origin', 'main']);
  gitIn(root, ['fetch', '-q', 'origin']);
  gitIn(root, ['switch', '-q', '-c', 'release/p1']);

  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-ops-host-'));
  for (const n of [1, 2]) fs.writeFileSync(path.join(host, `pr-${n}.json`), `${JSON.stringify(prRaw(n, heads[n]), null, 2)}\n`);
  const env = hostEnv(host);
  const cleanup = () => {
    fs.rmSync(host, { recursive: true, force: true });
    origin.cleanup();
    repo.cleanup();
  };
  try {
    const released = await cli(root, ['release', 'P1'], env);
    assert.equal(released.code, 0, `the fixture's release: ${released.stderr}`);
    commitFixed(root, 'chore(release): P1');
    gitIn(root, ['switch', '-q', 'main']);
    gitIn(root, ['merge', '-q', '--ff-only', 'release/p1']);
    gitIn(root, ['branch', '-q', '-D', 'release/p1']);

    shas.regression = commitFixed(root, 'fix: health answers up\n\nSlice: P1/S-03', { 'src/health.js': "export const health = () => 'up';\n" });
    const steps = {};
    for (let k = 1; k <= 60; k++) steps[`src/release/step${String(k).padStart(2, '0')}.js`] = `export const step = ${k};\n`;
    commitFixed(root, 'chore: the release steps', steps);
    const graph = await cli(root, ['graph'], env);
    assert.equal(graph.code, 0, `the fixture's graph: ${graph.stderr}`);
    assert.equal(gitIn(root, ['status', '--porcelain']), '', 'the fixture starts with a clean tree');
  } catch (e) {
    cleanup();
    throw e;
  }
  return { root, host, env, shas, run: (args) => cli(root, args, env), cleanup };
}

// ---- helpers ----

const SYMPTOM = 'billing returns 500 after the release';
const outLines = (r) => r.stdout.replace(/\n$/, '').split('\n');
const writeReport = (root, rel, text) => fs.writeFileSync(path.join(root, ...rel.split('/')), text);
// The 1-based line of `text` that holds `needle`.
const lineOf = (text, needle) => {
  const at = text.split('\n').findIndex((l) => l.includes(needle));
  assert.notEqual(at, -1, `no line holds: ${needle}`);
  return at + 1;
};
// The file nodes of the built graph one of whose path segments is `word` (D-57).
function filesNamedBy(root, word) {
  const graph = JSON.parse(fs.readFileSync(path.join(root, '.slicekit', 'graph', 'graph.json'), 'utf8'));
  return graph.nodes
    .filter((n) => n.kind === 'file')
    .map((n) => n.id.replace(/^file:/, ''))
    .filter((f) => f.toLowerCase().split(/[/._-]/).includes(word));
}
// Every `<rel>:<line> <message>` line a check printed, on either stream -> the line numbers, sorted.
const problemLines = (r, rel) =>
  `${r.stdout}\n${r.stderr}`
    .split('\n')
    .filter((l) => l.startsWith(`${rel}:`))
    .map((l) => Number(/^:(\d+) /.exec(l.slice(rel.length))?.[1]))
    .sort((a, b) => a - b);

const GOOD_REPORT = `# Ops: ${SYMPTOM}

## Likely slices and pull requests

- P1/S-01, #1: src/billing/charge.js, src/billing/refund.js

## First checks

- docs/runbook.md:${FIRST_CHECK_LINE} When billing returns 500, read the charge and refund code first.

## Proposed actions

- Read the service's log for the failing request (anyone)
- Revert the pull request the first check points at (on-call)
- Ask whether the charge limits changed (owner: Dana)

Skipped: nothing
Not checked: the service's log
`;

// ---- evaluation set ----

// REQ-2.13: "GIVEN the symptom "billing returns 500 after the release" WHEN `/slicekit ops` runs THEN
// the report lists the slices and pull requests that touched the billing files with the runbook's
// first checks, and no file outside the report changed."
test('commands/ops.test.js » the report lists the slices and pull requests that touched the named files, and nothing else changes', async () => {
  const p = await opsRepo();
  try {
    const { root } = p;
    const head = gitIn(root, ['rev-parse', 'HEAD']);
    const r = await p.run(['ops', 'context', SYMPTOM]);
    assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    const lines = outLines(r);
    const report = '.slicekit/reports/ops-1.md';
    assert.equal(lines[0], report, 'the report path comes first');
    assert.ok(fs.existsSync(path.join(root, ...report.split('/'))), 'the report path is reserved');
    assert.ok(lines.includes(`symptom: ${SYMPTOM}`), r.stdout);
    assert.deepEqual(lines.filter((l) => l.startsWith('file: ')), ['file: src/billing/charge.js', 'file: src/billing/refund.js']);

    // slicekit history for the two files: the billing slice with its pull request and release.
    const from = lines.indexOf('history:');
    assert.notEqual(from, -1, r.stdout);
    const to = lines.findIndex((l, i) => i > from && l.startsWith('runbook: '));
    assert.notEqual(to, -1, r.stdout);
    const history = lines.slice(from + 1, to);
    const billing = history.find((l) => l.startsWith('P1/S-01'));
    assert.ok(billing, `no history line for P1/S-01:\n${r.stdout}`);
    assert.ok(billing.includes('PR #1'), billing);
    assert.ok(billing.includes('released P1'), billing);
    assert.ok(!lines.some((l) => l.startsWith('P1/S-02')), `the health slice is listed:\n${r.stdout}`);

    assert.ok(lines.includes('runbook: docs/runbook.md'), r.stdout);
    assert.ok(lines.includes('observability: docs/observability.md'), r.stdout);
    assert.ok(lines.includes('last release: docs/releases/P1.md'), r.stdout);

    // The agent's reply, written to the reserved path, passes the check.
    writeReport(root, report, GOOD_REPORT);
    const checked = await p.run(['ops', 'check', report]);
    assert.equal(checked.code, 0, `stdout: ${checked.stdout}\nstderr: ${checked.stderr}`);
    assert.equal(checked.stdout.trim(), `ok ${report}`);

    // A second run takes the next free path and leaves the first report as written.
    const again = await p.run(['ops', 'context', SYMPTOM]);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(outLines(again)[0], '.slicekit/reports/ops-2.md');
    assert.equal(fs.readFileSync(path.join(root, ...report.split('/')), 'utf8'), GOOD_REPORT);

    assert.equal(gitIn(root, ['status', '--porcelain']), '', 'no tracked or untracked file changed');
    assert.equal(gitIn(root, ['rev-parse', 'HEAD']), head, 'no commit was made');
  } finally {
    p.cleanup();
  }
});

// D-57: a word matching more than fifty files is reported and names none of them.
test('commands/ops.test.js » a word that matches more than fifty files is reported as too broad', async () => {
  const p = await opsRepo();
  try {
    const named = filesNamedBy(p.root, 'release');
    assert.equal(named.filter((f) => f.startsWith('src/release/')).length, 60);
    assert.ok(named.length > 50);
    const r = await p.run(['ops', 'context', SYMPTOM]);
    assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    const lines = outLines(r);
    assert.ok(lines.includes(`too broad: release (${named.length} files)`), r.stdout);
    assert.ok(!lines.some((l) => l.startsWith('file: ') && l.includes('release')), `a file the word release names is listed:\n${r.stdout}`);
    // The words that name no file are listed, and the broad word is not one of them.
    const none = lines.find((l) => l.startsWith('no file: '));
    assert.ok(none, r.stdout);
    assert.deepEqual(none.slice('no file: '.length).split(', '), ['returns', '500', 'after', 'the']);
  } finally {
    p.cleanup();
  }
});

// D-57: with no file named and no --path there is nothing to read the history of.
test('commands/ops.test.js » a symptom naming no file exits 1 and asks for --path', async () => {
  const p = await opsRepo();
  try {
    const r = await p.run(['ops', 'context', 'everything is slow']);
    assert.equal(r.code, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(r.stderr.includes('the symptom names no file in the graph; name one with --path <path>'), r.stderr);

    const named = await p.run(['ops', 'context', 'everything is slow', '--path', 'src/health.js']);
    assert.equal(named.code, 0, `stdout: ${named.stdout}\nstderr: ${named.stderr}`);
    const lines = outLines(named);
    assert.match(lines[0], /^\.slicekit\/reports\/ops-\d+\.md$/);
    assert.deepEqual(lines.filter((l) => l.startsWith('file: ')), ['file: src/health.js']);
    assert.ok(lines.some((l) => l.startsWith('P1/S-02') && l.includes('PR #2')), named.stdout);

    // A --path that names nothing in the graph is a usage error.
    const unknown = await p.run(['ops', 'context', 'everything is slow', '--path', 'src/nosuch.js']);
    assert.equal(unknown.code, 2, `stdout: ${unknown.stdout}\nstderr: ${unknown.stderr}`);
    assert.ok(unknown.stderr.includes('src/nosuch.js is not in the graph'), unknown.stderr);

    assert.equal(gitIn(p.root, ['status', '--porcelain']), '');
  } finally {
    p.cleanup();
  }
});

// REQ-2.13: every proposed action is marked by who may take it, and the report names only slices
// and pull requests the graph holds.
test('commands/ops.test.js » ops check refuses an action no one may take and a slice that does not exist', async () => {
  const p = await opsRepo();
  try {
    const { root } = p;
    const context = await p.run(['ops', 'context', SYMPTOM]);
    assert.equal(context.code, 0, `stdout: ${context.stdout}\nstderr: ${context.stderr}`);
    const report = outLines(context)[0];
    assert.equal(report, '.slicekit/reports/ops-1.md');

    const bad = `# Ops: ${SYMPTOM}

## Likely slices and pull requests

- P1/S-01, #1: src/billing/charge.js
- P1/S-09: src/billing/refund.js
- #9: src/billing/refund.js

## First checks

- docs/runbook.md:${FIRST_CHECK_LINE} When billing returns 500, read the charge and refund code first.
- docs/runbook.md:999 A check the runbook does not hold.

## Proposed actions

- Read the service's log for the failing request (anyone)
- Restart the billing service

Skipped: nothing
Not checked: nothing
`;
    writeReport(root, report, bad);
    const r = await p.run(['ops', 'check', report]);
    assert.equal(r.code, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    const all = `${r.stdout}\n${r.stderr}`.split('\n');
    const slice = lineOf(bad, '- P1/S-09');
    const action = lineOf(bad, '- Restart the billing service');
    assert.ok(all.some((l) => l.startsWith(`${report}:${slice} `) && l.includes('P1/S-09')), `no line for the unknown slice:\n${all.join('\n')}`);
    assert.ok(all.some((l) => l.startsWith(`${report}:${action} `)), `no line for the unmarked action:\n${all.join('\n')}`);
    // One line per problem, and none for a line that is in order: the unknown slice, the unknown
    // pull request, the cited line the runbook does not have, the action marked by no one.
    assert.deepEqual(problemLines(r, report), [slice, lineOf(bad, '- #9'), lineOf(bad, 'docs/runbook.md:999'), action]);
    assert.ok(!r.stdout.includes(`ok ${report}`), r.stdout);

    // A report with no Proposed actions section is refused too.
    const cut = GOOD_REPORT.replace(/## Proposed actions\n[\s\S]*?\n(?=Skipped:)/, '');
    assert.ok(!cut.includes('## Proposed actions'));
    writeReport(root, report, cut);
    const missing = await p.run(['ops', 'check', report]);
    assert.equal(missing.code, 1, `stdout: ${missing.stdout}\nstderr: ${missing.stderr}`);
    assert.ok(`${missing.stdout}\n${missing.stderr}`.split('\n').some((l) => l.startsWith(`${report}:`) && l.includes('Proposed actions')), `${missing.stdout}\n${missing.stderr}`);

    assert.equal(gitIn(root, ['status', '--porcelain']), '');
  } finally {
    p.cleanup();
  }
});
