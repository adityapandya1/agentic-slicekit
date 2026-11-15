// P5/S-23, REQ-2.14, D-58: `slicekit audit context [area]` and `slicekit audit check <report>`. The
// context lists each claim in the area (a REQ block of the spec, a `##` section of the runbook) with
// the files it names and its candidate commits: those that touched one of those files and descend
// from the commit that last changed the claim's heading line. The check reads the auditor's report
// against those claims. Neither changes a tracked file. Every repository here lives in os.tmpdir()
// with a bare origin and the fixture git host; nothing reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init as initKit } from '../../src/init.js';
import { cli } from '../helpers/build-flow.js';
import { commitFixed, gitIn, write } from '../helpers/graph-fixture.js';
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

const outLines = (r) => r.stdout.replace(/\n$/, '').split('\n');
const writeReport = (root, rel, text) => fs.writeFileSync(path.join(root, ...rel.split('/')), text);
// The 1-based line of `text` that holds `needle`.
const lineOf = (text, needle) => {
  const at = text.split('\n').findIndex((l) => l.includes(needle));
  assert.notEqual(at, -1, `no line holds: ${needle}`);
  return at + 1;
};
const sha7 = (sha) => sha.slice(0, 7);

const HEALTH = 'runbook#health';
const HOW = 'runbook#how-to-run-it';
const FAILURES = 'runbook#known-failure-modes-and-the-first-thing-to-check';
const ROLLBACK = 'runbook#rollback';
const runbookLine = (heading) => RUNBOOK.split('\n').indexOf(`## ${heading}`) + 1;
const specLine = (id) => SPEC.split('\n').findIndex((l) => l.startsWith(`## ${id} `)) + 1;
const HEALTH_WHERE = `docs/runbook.md:${runbookLine('Health')}`;

// What `audit context` printed: the report path, then per claim `<id> <where> <title>`, a
// `  files: …` line and one `  candidate <sha7> <date> <subject>` line per candidate commit.
// -> {report, claims: [{id, where, title, files, candidates: [{sha, date, subject}]}]}
function parseContext(stdout) {
  const [report, ...rest] = stdout.replace(/\n$/, '').split('\n');
  const claims = [];
  for (const l of rest) {
    let m = /^(\S+) (\S+:\d+) (.*)$/.exec(l);
    if (m) {
      claims.push({ id: m[1], where: m[2], title: m[3], files: [], candidates: [] });
      continue;
    }
    const last = claims.at(-1);
    m = /^\s+files:\s*(.*)$/.exec(l);
    if (m && last) {
      last.files = m[1].split(',').map((f) => f.trim().replace(/\/$/, '')).filter((f) => f !== '');
      continue;
    }
    m = /^\s+candidate (\S+) (\S+) (.*)$/.exec(l);
    if (m && last) last.candidates.push({ sha: m[1], date: m[2], subject: m[3] });
  }
  return { report, claims };
}

async function context(p, area) {
  const r = await p.run(['audit', 'context', ...(area ? [area] : [])]);
  assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return { ...parseContext(r.stdout), stdout: r.stdout };
}

const claim = (ctx, id) => {
  const c = ctx.claims.find((x) => x.id === id);
  assert.ok(c, `the context lists no claim ${id}:\n${ctx.stdout}`);
  return c;
};

// The auditor's report: a `## Claims` table of six columns, then the two closing lines.
const row = (c, evidence, foundAt, status, commit = '') => `| ${c.id} | ${c.where} | ${evidence} | ${foundAt} | ${status} | ${commit} |`;
const auditReport = (rows) => `# Audit: runbook

## Claims

| Claim | Where | Evidence | Found at | Status | Commit |
|---|---|---|---|---|---|
${rows.join('\n')}

Skipped: nothing
Not checked: the CI history
`;
const DRIFT_EVIDENCE = 'the code answers up, the runbook says ok';

// Every `<rel>:<line> <message>` line a check printed, on either stream -> the distinct line
// numbers, sorted.
const problemLines = (r, rel) => [
  ...new Set(
    `${r.stdout}\n${r.stderr}`
      .split('\n')
      .filter((l) => l.startsWith(`${rel}:`))
      .map((l) => Number(/^:(\d+) /.exec(l.slice(rel.length))?.[1])),
  ),
].sort((a, b) => a - b);

// ---- evaluation set ----

// REQ-2.14: "GIVEN a runbook claim that a later commit made false WHEN `/slicekit audit` runs THEN
// the report lists that claim as `drifted` with the commit, and no other file changed."
test('commands/audit.test.js » a runbook claim a later commit made false is drifted, with that commit', async () => {
  const p = await opsRepo();
  try {
    const { root, shas } = p;
    const ctx = await context(p, 'runbook');
    assert.equal(ctx.report, '.slicekit/reports/audit-1.md');
    const health = claim(ctx, HEALTH);
    // The commits that touched src/health.js after the Health heading was written, newest first:
    // the seeded regression, then the slice that wrote the file. The billing slice is not one.
    assert.deepEqual(health.candidates.map((c) => sha7(c.sha)), [sha7(shas.regression), sha7(shas.s02)], ctx.stdout);
    assert.equal(health.candidates[0].subject, 'fix: health answers up');

    const text = auditReport([row(health, DRIFT_EVIDENCE, 'src/health.js:1', 'drifted', shas.regression)]);
    writeReport(root, ctx.report, text);
    const checked = await p.run(['audit', 'check', ctx.report, 'runbook']);
    assert.equal(checked.code, 0, `stdout: ${checked.stdout}\nstderr: ${checked.stderr}`);
    assert.equal(checked.stdout.trim(), `ok ${ctx.report}`);
    // A prefix of seven characters names the same commit.
    writeReport(root, ctx.report, auditReport([row(health, DRIFT_EVIDENCE, 'src/health.js:1', 'drifted', sha7(shas.regression))]));
    const short = await p.run(['audit', 'check', ctx.report, 'runbook']);
    assert.equal(short.code, 0, `stdout: ${short.stdout}\nstderr: ${short.stderr}`);

    // D-58: a candidate is found by ancestry, never by date. A commit to src/health.js whose dates
    // are a year before the commit that wrote the claim is still one.
    const planDate = Number(gitIn(root, ['log', '-1', '--format=%ct', shas.plan]));
    const before = `${planDate - 365 * 24 * 60 * 60} +0000`;
    write(root, 'src/health.js', "export const health = () => 'down';\n");
    gitIn(root, ['add', '-A']);
    gitIn(root, ['commit', '-q', '-m', 'fix: health answers down'], { env: { GIT_AUTHOR_DATE: before, GIT_COMMITTER_DATE: before } });
    const backdated = gitIn(root, ['rev-parse', 'HEAD']);
    const later = await context(p, 'runbook');
    const found = claim(later, HEALTH).candidates.map((c) => sha7(c.sha));
    assert.ok(found.includes(sha7(backdated)), `the backdated commit is not a candidate:\n${later.stdout}`);
    assert.ok(found.includes(sha7(shas.regression)), later.stdout);

    assert.equal(gitIn(root, ['status', '--porcelain']), '', 'no file outside the report changed');
  } finally {
    p.cleanup();
  }
});

// D-58: the claims are each REQ block of the spec and each `##` section of the runbook in the area,
// in spec order then runbook order; a claim's files are the paths it names that the graph holds.
test('commands/audit.test.js » the context lists each claim in the area with the files it names', async () => {
  const p = await opsRepo();
  try {
    const { root } = p;
    const ctx = await context(p, 'runbook');
    assert.equal(ctx.report, '.slicekit/reports/audit-1.md', 'the report path comes first');
    assert.ok(fs.existsSync(path.join(root, ...ctx.report.split('/'))), 'the report path is reserved');
    assert.deepEqual(ctx.claims.map((c) => c.id), [HOW, HEALTH, FAILURES, ROLLBACK]);
    const lines = outLines(ctx);
    const at = lines.indexOf(`${HEALTH} ${HEALTH_WHERE} Health`);
    assert.notEqual(at, -1, ctx.stdout);
    assert.equal(lines[at + 1], '  files: src/health.js');
    assert.deepEqual(claim(ctx, HEALTH).files, ['src/health.js']);
    const failures = claim(ctx, FAILURES);
    assert.equal(failures.where, `docs/runbook.md:${runbookLine('Known failure modes and the first thing to check')}`);
    assert.equal(failures.title, 'Known failure modes and the first thing to check');
    assert.deepEqual(failures.files, ['src/billing']);
    // A section that names no file has none, and so no candidate commit.
    assert.deepEqual(claim(ctx, HOW).files, []);
    assert.deepEqual(claim(ctx, HOW).candidates, []);

    // A REQ prefix and a spec file stem name the REQ blocks.
    const reqs = await context(p, 'REQ-1');
    assert.equal(reqs.report, '.slicekit/reports/audit-2.md');
    assert.deepEqual(reqs.claims.map((c) => c.id), ['REQ-1.1', 'REQ-1.2']);
    assert.equal(claim(reqs, 'REQ-1.1').where, `docs/spec/01-x.md:${specLine('REQ-1.1')}`);
    assert.deepEqual(claim(reqs, 'REQ-1.1').files, ['src/billing']);
    assert.equal(claim(reqs, 'REQ-1.2').where, `docs/spec/01-x.md:${specLine('REQ-1.2')}`);
    assert.deepEqual(claim(reqs, 'REQ-1.2').files, ['src/health.js']);
    assert.deepEqual((await context(p, '01-x')).claims.map((c) => c.id), ['REQ-1.1', 'REQ-1.2']);

    // A path names the claims whose files hold it; no area names every claim.
    assert.deepEqual((await context(p, 'src/health.js')).claims.map((c) => c.id), ['REQ-1.2', HEALTH]);
    assert.deepEqual((await context(p)).claims.map((c) => c.id), ['REQ-1.1', 'REQ-1.2', HOW, HEALTH, FAILURES, ROLLBACK]);

    const unknown = await p.run(['audit', 'context', 'nosuch']);
    assert.equal(unknown.code, 2, `stdout: ${unknown.stdout}\nstderr: ${unknown.stderr}`);
    assert.ok(unknown.stderr.includes('nosuch names no claim'), unknown.stderr);

    assert.equal(gitIn(root, ['status', '--porcelain']), '');
  } finally {
    p.cleanup();
  }
});

// D-58: a drifted row must name one of its own claim's candidate commits.
test('commands/audit.test.js » audit check refuses a drifted row whose commit is not a candidate', async () => {
  const p = await opsRepo();
  try {
    const { root, shas } = p;
    const ctx = await context(p, 'runbook');
    const health = claim(ctx, HEALTH);
    // The billing slice's commit touched src/billing/, so it is a candidate of the failure-modes
    // claim and not of the health claim.
    assert.ok(claim(ctx, FAILURES).candidates.some((c) => sha7(c.sha) === sha7(shas.s01)), ctx.stdout);
    const commit = shas.s01.slice(0, 12);
    const text = auditReport([
      row(health, DRIFT_EVIDENCE, 'src/health.js:1', 'drifted', commit),
      row(claim(ctx, ROLLBACK), 'the record quotes the rollback note', 'docs/releases/P1.md:1', 'broken'),
    ]);
    writeReport(root, ctx.report, text);
    const r = await p.run(['audit', 'check', ctx.report, 'runbook']);
    assert.equal(r.code, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    const all = `${r.stdout}\n${r.stderr}`.split('\n');
    const drifted = lineOf(text, `| ${HEALTH} |`);
    const want = `${ctx.report}:${drifted} drifted ${HEALTH} names ${commit}, which is not a commit that touched its files after it was written`;
    assert.ok(all.includes(want), `no line "${want}":\n${all.join('\n')}`);
    // A status other than holds, drifted or unverifiable is refused on its own line, and no other
    // line of the report is.
    assert.deepEqual(problemLines(r, ctx.report), [drifted, lineOf(text, `| ${ROLLBACK} |`)]);
    assert.ok(!r.stdout.includes(`ok ${ctx.report}`), r.stdout);

    assert.equal(gitIn(root, ['status', '--porcelain']), '');
  } finally {
    p.cleanup();
  }
});

// REQ-2.14: the audit changes nothing; its report lives outside git.
test('commands/audit.test.js » audit check passes a report of holds, drifted and unverifiable rows, and nothing else changes', async () => {
  const p = await opsRepo();
  try {
    const { root, shas } = p;
    const head = gitIn(root, ['rev-parse', 'HEAD']);
    const ctx = await context(p, 'runbook');
    const text = auditReport([
      row(claim(ctx, HOW), 'no test and no CI run starts the service', '', 'unverifiable'),
      row(claim(ctx, HEALTH), DRIFT_EVIDENCE, 'src/health.js:1', 'drifted', shas.regression),
      row(claim(ctx, FAILURES), 'the charge and refund code is under src/billing/', 'src/billing/charge.js:1', 'holds'),
      row(claim(ctx, ROLLBACK), 'the release record quotes the rollback note', '`node bin/slicekit.js history docs/runbook.md`', 'holds'),
    ]);
    writeReport(root, ctx.report, text);
    const r = await p.run(['audit', 'check', ctx.report, 'runbook']);
    assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), `ok ${ctx.report}`);
    assert.deepEqual(problemLines(r, ctx.report), []);

    assert.equal(gitIn(root, ['status', '--porcelain']), '', 'no tracked or untracked file changed');
    assert.equal(gitIn(root, ['rev-parse', 'HEAD']), head, 'no commit was made');
  } finally {
    p.cleanup();
  }
});
