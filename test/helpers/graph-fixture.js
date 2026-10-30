// The repositories the graph builder (P3/S-17, REQ-4.1 to REQ-4.4, REQ-4.8) is tested against:
// graphRepo, a small repository holding every node kind and every edge kind, and bigRepo, 10,000
// commits written by one `git fast-import`. Both live in os.tmpdir() and are never committed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../../src/config.js';
import { hashLine, lineBody, GENESIS } from '../../src/journal.js';
import { init as initKit } from '../../src/init.js';
import { makeRepo } from './tmp-repo.js';

// Commits made here carry fixed dates, one minute apart, so a graph's builtAt never depends on the
// wall clock; the hooks init installs are bypassed (they refuse a commit on main).
const EPOCH = 1_790_000_000; // 2026-09-21T14:13:20Z
let tick = 0;
const nextDate = () => `${EPOCH + 60 * tick++} +0000`;

export function gitIn(root, args, { env } = {}) {
  return execFileSync('git', ['-c', 'core.hooksPath=.git/slicekit-no-hooks', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  }).trim();
}

export function write(root, rel, text) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// Writes `files` ({rel: text}), stages everything and commits with the next fixed date -> its SHA.
export function commitFixed(root, message, files = {}) {
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  gitIn(root, ['add', '-A']);
  const date = nextDate();
  gitIn(root, ['commit', '-q', '--allow-empty', '-m', message], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return gitIn(root, ['rev-parse', 'HEAD']);
}

function mergeFixed(root, branch, message) {
  const date = nextDate();
  gitIn(root, ['merge', '-q', '--no-ff', '-m', message, branch], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return gitIn(root, ['rev-parse', 'HEAD']);
}

const sliceFile = (id, name, requirements, decisions) => `---
slice: ${id}
name: ${name}
repo: .
group: A
runbook: no
requirements: [${requirements.join(', ')}]
decisions: [${decisions.join(', ')}]
---

## Done when

1. It works.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| \`a.test.js » works\` | happy | ${requirements[0]} |

## Expected changes

\`src/a.js\`.
`;

const SPEC = `# 01 — X

## REQ-1.1 It works

The kit SHALL work.

Scenario: GIVEN a repo WHEN it runs THEN it works.

Cites: D-01.

## REQ-1.2 It asks

The kit SHALL ask.

Scenario: GIVEN a question WHEN it runs THEN it asks.

Cites: D-02, intake/2026-10-01-ask.md.

### REQ-1.3 It answers

The kit SHALL answer.

Scenario: GIVEN an answer WHEN it runs THEN it answers.

Cites: D-01.
`;

const DECISIONS = `# Decisions

## Settled

| # | Type | Question | Answer | Who, when |
|---|------|----------|--------|-----------|
| D-01 | Decision | Name? | demo | team, 2026-10-01 |
| D-02 | Decision | Ask first? | yes, as D-01 names it | team, 2026-10-01 |

## Open

| # | Type | Question | Why it matters | Recommendation |
|---|------|----------|----------------|----------------|
`;

const GAPS = `# Gaps

| # | Class | Where | What | Closed by |
|-------|-------|-------|------|-----------|
| G-1 | missing | REQ-1.1 | the limit is not given | D-01 |
`;

const CONTRACT = `# C-1 Thing

**Producer:** P1/S-01. **Consumers:** P1/S-02.

| Operation | Input | Output |
|---|---|---|
| \`thing\` | a | b |
`;

const RUNBOOK = `# Runbook: demo

## How to run it

Run P1/S-01 first; it carries REQ-1.1 under D-01.

## Rollback

Not yet known
`;

export const PR_TITLE = '[P1/S-01] Thing a';
export const PR_URL = 'https://github.com/acme/demo/pull/1';

// The raw gh answer for pull request 1 (what `gh pr view 1 --json ...` prints).
export function prRaw(headSha, { state = 'MERGED' } = {}) {
  return {
    number: 1,
    url: PR_URL,
    state,
    mergedAt: state === 'MERGED' ? '2026-10-02T10:00:00Z' : null,
    headRefOid: headSha,
    headRefName: 'slice/P1-S-01-a',
    isDraft: false,
    title: PR_TITLE,
    body: 'Slice: P1/S-01',
    labels: [],
  };
}

function state(id, fields) {
  return `${JSON.stringify({
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
}

export const stateS01 = (headSha) =>
  state('P1/S-01', {
    state: 'merged',
    branch: 'slice/P1-S-01-a',
    pr: { number: 1, url: PR_URL, headSha },
    verdicts: ['P1-S-01-r1'],
    mergedAt: '2026-10-02T10:00:00Z',
    history: [
      { from: 'todo', to: 'building', at: '2026-10-01T09:00:00Z', by: 'cli', evidence: {} },
      { from: 'in-review', to: 'merged', at: '2026-10-02T10:00:00Z', by: 'sync', evidence: { source: 'host' } },
    ],
  });

function journalLine() {
  const body = lineBody({ actor: 'developer', slice: 'P1/S-01', stage: 'build', commits: [], verdicts: [], decisions: ['D-01'] }, GENESIS, '2026-10-01T09:30:00.000Z');
  return `${body} hash=${hashLine(body)}\n`;
}

// A repository with the kit installed and every node kind of REQ-4.1 plus verdict:
//   main:  plan  ->  merge of slice/P1-S-01-a ("Merge pull request #1 ...")  ->  kit files commit
//   slice/P1-S-01-a: one commit (Slice: P1/S-01), merged and then deleted
//   slice/P1-S-02-b: one commit (Slice: P1/S-02), not merged
// Slice P1/S-01 (docs/phases/P1-x/S-01-a.md) names REQ-1.1 and REQ-1.3 on line 7; P1/S-02 names
// REQ-1.2 and the unknown REQ-9.9 on line 7. test/a.test.js names REQ-1.1 on line 3; the CRLF file
// test/crlf.test.js names REQ-1.2 on line 3; src/Billing.java names REQ-1.1 in a comment.
// -> {root, fixture (the git host directory, holding pr-1.json), shas, cleanup}
export function graphRepo() {
  const repo = makeRepo();
  const { root } = repo;
  initKit(root, { name: 'demo', shape: 'backend', commands: { test: 'node --test' }, cli: 'node bin/slicekit.js' });
  gitIn(root, ['remote', 'add', 'origin', 'https://github.com/acme/demo.git']);
  const files = {
    'docs/spec/01-x.md': SPEC,
    'docs/decisions.md': DECISIONS,
    'docs/spec/gaps.md': GAPS,
    'docs/spec/contracts/C-1-thing.md': CONTRACT,
    'docs/intake/2026-10-01-ask.md': '# Ask\n\nThe kit should ask first.\n',
    'docs/intake/2026-10-01-ask.md.meta.json': `${JSON.stringify({ origin: 'a call', sha256: 'a'.repeat(64), broughtInBy: 'Slicekit Test', at: '2026-10-01' }, null, 2)}\n`,
    'docs/phases/P1-x/P1.md': '# Phase 1 — X\n\n**Order:** A\n',
    'docs/phases/P1-x/S-01-a.md': sliceFile('P1/S-01', 'Thing a', ['REQ-1.1', 'REQ-1.3'], ['D-01']),
    'docs/phases/P1-x/S-02-b.md': sliceFile('P1/S-02', 'Thing b', ['REQ-1.2', 'REQ-9.9'], ['D-02']),
    'docs/runbook.md': RUNBOOK,
    'docs/releases/P1.md': '# Release P1\n\nPull requests: #1.\n',
  };
  const plan = commitFixed(root, 'plan', files);

  gitIn(root, ['switch', '-q', '-c', 'slice/P1-S-01-a']);
  const sliceA = commitFixed(root, 'feat(P1/S-01): a\n\nSlice: P1/S-01', {
    'src/a.js': 'export const a = 1;\n',
    'test/a.test.js': "import { test } from 'node:test';\n\ntest('REQ-1.1 works', () => {});\n",
    'test/crlf.test.js': "// first\r\n// second\r\ntest('REQ-1.2 asks', () => {});\r\n",
    'src/Billing.java': '// REQ-1.1 billing\nclass Billing {}\n',
  });
  gitIn(root, ['switch', '-q', 'main']);
  const merge = mergeFixed(root, 'slice/P1-S-01-a', 'Merge pull request #1 from acme/slice/P1-S-01-a');
  gitIn(root, ['branch', '-q', '-D', 'slice/P1-S-01-a']);

  const kit = commitFixed(root, 'chore(P1/S-01): state, verdict and journal\n\nSlice: P1/S-01', {
    '.slicekit/state/P1-S-01.json': stateS01(sliceA),
    '.slicekit/state/P1-S-02.json': state('P1/S-02', { state: 'building', branch: 'slice/P1-S-02-b' }),
    '.slicekit/reviews/P1-S-01-r1.md': `Verdict: APPROVE\nHead: ${sliceA}\n\n## Checklists run\n\n- correctness\n\n## Not checked\n\n- nothing\n`,
    '.slicekit/journal/main--0000abcd.log': journalLine(),
  });

  gitIn(root, ['switch', '-q', '-c', 'slice/P1-S-02-b']);
  const sliceB = commitFixed(root, 'feat(P1/S-02): b\n\nSlice: P1/S-02', { 'src/b.js': 'export const b = 2;\n' });
  gitIn(root, ['switch', '-q', 'main']);

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-graph-host-'));
  fs.writeFileSync(path.join(fixture, 'pr-1.json'), `${JSON.stringify(prRaw(sliceA), null, 2)}\n`);
  return {
    root,
    fixture,
    shas: { plan, sliceA, merge, kit, sliceB },
    cleanup() {
      fs.rmSync(fixture, { recursive: true, force: true });
      repo.cleanup();
    },
  };
}

// A repository of `commits` commits on main, written by one `git fast-import --quiet` stream on top
// of one setup commit (config, a spec with REQ-1.1 to REQ-1.10, decisions, one phase with `slices`
// slice files and their state files). Each commit changes one or two of src/f<k>.js, every tenth
// also test/t<k>.test.js with a line naming a REQ; each message ends `Slice: P1/S-<nn>` except
// every fiftieth; committer dates are one minute apart from a fixed epoch. No hook runs.
export function bigRepo({ commits = 10_000, slices = 20, files = 500 } = {}) {
  const repo = makeRepo();
  const { root } = repo;
  const pad = (n) => String(n).padStart(2, '0');
  const cfg = defaultConfig({ name: 'big', shape: 'backend', commands: { test: 'node --test' } });
  write(root, '.slicekit/config.json', `${JSON.stringify(cfg, null, 2)}\n`);
  write(root, '.gitignore', '.slicekit/graph/\n');
  let spec = '# 01 — Big\n';
  for (let k = 1; k <= 10; k++) spec += `\n## REQ-1.${k} Thing ${k}\n\nThe kit SHALL do ${k}.\n\nScenario: GIVEN ${k} WHEN it runs THEN ${k}.\n\nCites: D-01.\n`;
  write(root, 'docs/spec/01-big.md', spec);
  write(root, 'docs/decisions.md', DECISIONS);
  write(root, 'docs/phases/P1-big/P1.md', '# Phase 1 — Big\n\n**Order:** A\n');
  for (let s = 1; s <= slices; s++) {
    const id = `P1/S-${pad(s)}`;
    write(root, `docs/phases/P1-big/S-${pad(s)}-s.md`, sliceFile(id, `Slice ${s}`, [`REQ-1.${((s - 1) % 10) + 1}`], ['D-01']));
    write(root, `.slicekit/state/P1-S-${pad(s)}.json`, state(id, {}));
  }
  const setupDate = `${EPOCH - 60} +0000`;
  gitIn(root, ['add', '-A']);
  gitIn(root, ['commit', '-q', '-m', 'setup'], { env: { GIT_AUTHOR_DATE: setupDate, GIT_COMMITTER_DATE: setupDate } });
  const base = gitIn(root, ['rev-parse', 'HEAD']);

  const chunks = [];
  const data = (text) => `data ${Buffer.byteLength(text)}\n${text}\n`;
  for (let i = 1; i <= commits; i++) {
    const slice = ((i - 1) % slices) + 1;
    const message = i % 50 === 0 ? `chore: change ${i}\n` : `feat(P1/S-${pad(slice)}): change ${i}\n\nSlice: P1/S-${pad(slice)}\n`;
    let c = `commit refs/heads/main\ncommitter Slicekit Test <test@example.com> ${EPOCH + 60 * i} +0000\n${data(message)}`;
    if (i === 1) c += `from ${base}\n`;
    c += `M 100644 inline src/f${i % files}.js\n${data(`export const v = ${i};\n`)}`;
    if (i % 2 === 0) c += `M 100644 inline src/f${(i * 7 + 3) % files}.js\n${data(`export const w = ${i};\n`)}`;
    if (i % 10 === 0) c += `M 100644 inline test/t${(i / 10) % 50}.test.js\n${data(`// REQ-1.${(i % 100) / 10 + 1} commit ${i}\n`)}`;
    chunks.push(c, '\n');
  }
  execFileSync('git', ['fast-import', '--quiet'], { cwd: root, input: chunks.join(''), stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  gitIn(root, ['checkout', '-q', '-f', 'main']);
  return { root, cleanup: repo.cleanup };
}
