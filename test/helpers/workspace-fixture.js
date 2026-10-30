// REQ-4.6: a program repository with a workspace file and two service repositories, for the
// workspace build, `impact` and the workspace check rule (P3/S-20). Everything lives in
// os.tmpdir() and is never committed; no hook runs (commitFixed bypasses them).
//
//   program: spec REQ-1.1 and REQ-1.2; slices P1/S-01 and P1/S-02 (repo .), P1/S-04 (repo orders),
//            P1/S-09 (repo billing); contract C-2 "order.created topic", produced by P1/S-04 and
//            consumed by P1/S-09; contract C-3 "billing API", produced by P1/S-02 and consumed by a
//            party named in words; P1/S-01 and P1/S-02 both touch src/a.js and src/b.js, S-01 also src/c.js.
//   orders:  P1/S-04 touches src/topic.js and test/topic.test.js (names REQ-1.1), merged as pull request #3.
//   billing: P1/S-09 touches src/consumer.js, on main.
//   The workspace also lists `remote` (url only), `gone` (a path that does not exist) and `plain`
//   (a directory that is no git repository), none of which can be reached.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init as initKit } from '../../src/init.js';
import { commitFixed, gitIn } from './graph-fixture.js';
import { makeRepo } from './tmp-repo.js';

export const WORKSPACE_REL = '.slicekit/workspace.json';

export const sliceFile = (id, name, repo, requirements) => `---
slice: ${id}
name: ${name}
repo: ${repo}
group: A
runbook: no
requirements: [${requirements.join(', ')}]
decisions: [D-01]
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

const SPEC = `# 01 — Orders

## REQ-1.1 Orders are published

The program SHALL publish order.created.

Scenario: GIVEN an order WHEN it is placed THEN order.created is published.

Cites: D-01.

## REQ-1.2 Orders are billed

The program SHALL bill each order.

Scenario: GIVEN order.created WHEN billing reads it THEN an invoice is made.

Cites: D-01.
`;

const DECISIONS = `# Decisions

## Settled

| # | Type | Question | Answer | Who, when |
|---|------|----------|--------|-----------|
| D-01 | Decision | Topics? | yes | team, 2026-10-01 |

## Open

| # | Type | Question | Why it matters | Recommendation |
|---|------|----------|----------------|----------------|
`;

export const CONTRACT_C2 = `# C-2 order.created topic

**Producer:** P1/S-04. **Consumers:** P1/S-09.

| Field | Type |
|---|---|
| \`orderId\` | string |
`;

export const CONTRACT_C3 = `# C-3 billing API

**Producer:** P1/S-02. **Consumer:** the finance team's ledger.
`;

const posix = (p) => p.split(path.sep).join('/');

export function writeJson(root, rel, value) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

// -> {root, orders, billing, fixture, entries, cleanup}; `fixture` is the git host directory, with
// orders/pr-3.json for the orders repository.
export function workspaceProgram() {
  const program = makeRepo();
  const orders = makeRepo();
  const billing = makeRepo();
  const plain = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-plain-')));
  const { root } = program;
  initKit(root, { name: 'program', shape: 'backend', commands: { test: 'node --test' }, cli: 'node bin/slicekit.js' });

  const entries = [
    { name: 'orders', path: posix(path.relative(root, orders.root)), defaultBranch: 'main' },
    { name: 'billing', path: billing.root, url: 'https://github.com/acme/billing', defaultBranch: 'main' },
    { name: 'remote', url: 'https://github.com/acme/remote', defaultBranch: 'main' },
    { name: 'gone', path: '../slicekit-no-such-repo', defaultBranch: 'main' },
    { name: 'plain', path: plain, defaultBranch: 'main' },
  ];
  commitFixed(root, 'plan', {
    'docs/spec/01-orders.md': SPEC,
    'docs/decisions.md': DECISIONS,
    'docs/spec/contracts/C-2-order-created.md': CONTRACT_C2,
    'docs/spec/contracts/C-3-billing-api.md': CONTRACT_C3,
    'docs/phases/P1-orders/P1.md': '# Phase 1 — Orders\n\n**Order:** A\n',
    'docs/phases/P1-orders/S-01-a.md': sliceFile('P1/S-01', 'Program a', '.', ['REQ-1.1']),
    'docs/phases/P1-orders/S-02-b.md': sliceFile('P1/S-02', 'Program b', '.', ['REQ-1.2']),
    'docs/phases/P1-orders/S-04-publish.md': sliceFile('P1/S-04', 'Publish orders', 'orders', ['REQ-1.1']),
    'docs/phases/P1-orders/S-09-bill.md': sliceFile('P1/S-09', 'Bill orders', 'billing', ['REQ-1.2']),
    [WORKSPACE_REL]: `${JSON.stringify({ repos: entries }, null, 2)}\n`,
  });
  commitFixed(root, 'feat(P1/S-01): a\n\nSlice: P1/S-01', { 'src/a.js': '1\n', 'src/b.js': '1\n', 'src/c.js': '1\n' });
  commitFixed(root, 'feat(P1/S-02): b\n\nSlice: P1/S-02', { 'src/a.js': '2\n', 'src/b.js': '2\n' });

  commitFixed(orders.root, 'init', { 'README.md': '# orders\n' });
  gitIn(orders.root, ['switch', '-q', '-c', 'slice/P1-S-04-publish']);
  commitFixed(orders.root, 'feat(P1/S-04): publish\n\nSlice: P1/S-04', {
    'src/topic.js': 'export const topic = 1;\n',
    'test/topic.test.js': "// REQ-1.1: the topic is published\ntest('publishes', () => {});\n",
  });
  gitIn(orders.root, ['switch', '-q', 'main']);
  gitIn(orders.root, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #3 from acme/slice/P1-S-04-publish', 'slice/P1-S-04-publish']);

  commitFixed(billing.root, 'feat(P1/S-09): bill\n\nSlice: P1/S-09', { 'src/consumer.js': 'export const c = 1;\n' });

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-graph-host-'));
  writeJson(fixture, 'orders/pr-3.json', {
    number: 3,
    url: 'https://github.com/acme/orders/pull/3',
    state: 'MERGED',
    mergedAt: '2026-10-02T10:00:00Z',
    headRefOid: gitIn(orders.root, ['rev-parse', 'slice/P1-S-04-publish']),
    headRefName: 'slice/P1-S-04-publish',
    isDraft: false,
    title: '[P1/S-04] Publish orders',
    body: 'Slice: P1/S-04',
    labels: [],
  });
  return {
    root,
    orders: orders.root,
    billing: billing.root,
    plain,
    fixture,
    entries,
    cleanup() {
      fs.rmSync(fixture, { recursive: true, force: true });
      fs.rmSync(plain, { recursive: true, force: true });
      program.cleanup();
      orders.cleanup();
      billing.cleanup();
    },
  };
}
