import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defaultConfig } from '../src/config.js';
import { main } from '../src/cli/index.js';
import {
  DecisionError,
  TYPES,
  addDecision,
  interfacesNamed,
  interfacesWithoutContract,
  readDecisions,
  settleDecision,
} from '../src/decisions.js';
import { makeRepo } from './helpers/tmp-repo.js';

const cfg = defaultConfig({ name: 'demo', shape: 'backend' });

const SETTLED_HEAD = '| # | Type | Question | Answer | Who, when |\n|---|------|----------|--------|-----------|\n';
const OPEN_HEAD = '| # | Type | Question | Why it matters | Recommendation |\n|---|------|----------|----------------|----------------|\n';

function decisionsText({ settled = [], open = [] } = {}) {
  return `# Decisions\n\n## Settled\n\n${SETTLED_HEAD}${settled.map((r) => `${r}\n`).join('')}\n## Open\n\n${OPEN_HEAD}${open.map((r) => `${r}\n`).join('')}`;
}

const THREE = [
  '| D-01 | Decision | Which runtime? | Node | ann, 2026-01-01 |',
  '| D-02 | Decision | Which license? | MIT | ann, 2026-01-01 |',
  '| D-03 | Information | Which host? | GitHub | ann, 2026-01-01 |',
];

// A temp repository with a config and the given decisions file (none when `text` is null).
function withRepo(text, fn, extra = {}) {
  const repo = makeRepo({
    files: {
      '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n`,
      ...(text === null ? {} : { 'docs/decisions.md': text }),
      ...extra,
    },
  });
  let out;
  try {
    out = fn(repo.root);
  } catch (e) {
    repo.cleanup();
    throw e;
  }
  if (out instanceof Promise) return out.finally(repo.cleanup);
  repo.cleanup();
  return out;
}

async function cli(root, args) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

const file = (root) => path.join(root, 'docs', 'decisions.md');
const read = (root) => fs.readFileSync(file(root), 'utf8');
const DATE = '\\d{4}-\\d{2}-\\d{2}';

// REQ-1.4
test('add writes the next id with who and when', async () => {
  await withRepo(decisionsText({ settled: THREE }), async (root) => {
    const r = await cli(root, ['decide', 'add', '--type', 'Decision', '--question', 'q', '--answer', 'a', '--who', 'ann']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'D-04\n');
    const { rows } = readDecisions(read(root));
    const settled = rows.filter((x) => x.table === 'settled');
    assert.equal(settled.at(-1).id, 'D-04');
    assert.match(read(root), new RegExp(`\\| D-03 \\|.*\\n\\| D-04 \\| Decision \\| q \\| a \\| ann, ${DATE} \\|\\n`));

    const o = await cli(root, ['decide', 'add', '--type', 'Open', '--question', 'q', '--why', 'w', '--recommendation', 'r', '--who', 'ann']);
    assert.equal(o.code, 0, o.stderr);
    assert.equal(o.stdout, 'D-05\n');
    const row = readDecisions(read(root)).rows.find((x) => x.id === 'D-05');
    assert.equal(row.table, 'open');
    assert.equal(row.type, 'Open');
    assert.equal(row.why, 'w');
    assert.equal(row.recommendation, 'r');
    const openPart = read(root).slice(read(root).indexOf('## Open'));
    assert.match(openPart, /\|-+\|\n\| D-05 \| Open \| q \| w \| r \|\n$/);
  });
});

// REQ-1.4
test('a pipe in the answer is escaped and a newline is refused', async () => {
  await withRepo(decisionsText({ settled: THREE }), async (root) => {
    const r = await cli(root, ['decide', 'add', '--type', 'Decision', '--question', 'q', '--answer', 'a|b', '--who', 'ann']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(read(root), /\| D-04 \| Decision \| q \| a\\\|b \| ann, /);
    assert.equal(readDecisions(read(root)).rows.find((x) => x.id === 'D-04').answer, 'a|b');

    const before = read(root);
    const bad = await cli(root, ['decide', 'add', '--type', 'Decision', '--question', 'two\nlines', '--answer', 'a', '--who', 'ann']);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /question must be one line/);
    assert.equal(read(root), before);
    assert.throws(
      () => addDecision(root, cfg, { type: 'Decision', question: 'q', answer: 'a\rb', who: 'ann' }),
      (e) => e instanceof DecisionError && e.code === 2 && e.message === 'answer must be one line',
    );
    assert.equal(read(root), before);
  });
});

// REQ-1.4
test('settle moves an open row, keeps its type and refuses a settled one', async () => {
  const text = decisionsText({ settled: THREE, open: ['| D-04 | Action | Reserve the name? | Losing it | Publish now |'] });
  await withRepo(text, async (root) => {
    const r = await cli(root, ['decide', 'settle', 'D-04', '--answer', 'Published', '--who', 'bo']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'D-04\n');
    const rows = readDecisions(read(root)).rows;
    assert.equal(rows.filter((x) => x.id === 'D-04').length, 1);
    const row = rows.find((x) => x.id === 'D-04');
    assert.equal(row.table, 'settled');
    assert.equal(row.type, 'Action');
    assert.equal(row.question, 'Reserve the name?');
    assert.equal(row.answer, 'Published');
    assert.match(row.who, new RegExp(`^bo, ${DATE}$`));
    assert.match(read(root), /\| D-03 \|.*\n\| D-04 \| Action \| Reserve the name\? \| Published \| bo, /);

    const before = read(root);
    const again = await cli(root, ['decide', 'settle', 'D-04', '--answer', 'x', '--who', 'bo']);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /D-04 is settled; a reversal is a new row \(decide add --replaces D-04\)/);
    assert.equal(read(root), before);

    const unknown = await cli(root, ['decide', 'settle', 'D-99', '--answer', 'x', '--who', 'bo']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /unknown decision D-99/);
  });
});

test('interfacesNamed reads the name and the source', () => {
  withRepo(decisionsText({ settled: THREE }), (root) => {
    const a = addDecision(root, cfg, {
      type: 'Information',
      question: 'Which topic carries orders?',
      answer: 'Kafka topic orders.v1.',
      who: 'ann',
      iface: { name: 'orders topic', source: 'docs/intake/x.md:12' },
    });
    const b = addDecision(root, cfg, { type: 'Decision', question: 'How do the two services talk?', answer: 'REST.', who: 'ann', iface: { name: 'billing api' } });
    const c = addDecision(root, cfg, { type: 'Decision', question: 'Still REST?', answer: 'gRPC.', who: 'ann', replaces: b.id });
    assert.deepEqual([a.id, b.id, c.id], ['D-04', 'D-05', 'D-06']);
    const text = read(root);
    assert.match(text, /\| D-04 \| Information \| Interface: orders topic\. Which topic carries orders\? \| Kafka topic orders\.v1\. Named at docs\/intake\/x\.md:12\. \|/);
    assert.match(text, /\| D-06 \| Decision \| Replaces D-05\. Still REST\? \|/);
    assert.deepEqual(interfacesNamed(text), [
      { id: 'D-04', name: 'orders topic', source: 'docs/intake/x.md:12' },
      { id: 'D-05', name: 'billing api', source: null },
    ]);
    assert.throws(
      () => addDecision(root, cfg, { type: 'Decision', question: 'q', answer: 'a', who: 'ann', replaces: 'D-77' }),
      (e) => e instanceof DecisionError && e.code === 2 && e.message === 'unknown decision D-77',
    );
  });
});

test('interfacesWithoutContract skips an interface a contract cites', () => {
  const settled = [
    ...THREE,
    '| D-04 | Information | Interface: orders topic. Which topic? | orders.v1. Named at docs/intake/x.md:12. | ann, 2026-01-01 |',
    '| D-05 | Decision | Interface: billing api. How? | REST. | ann, 2026-01-01 |',
  ];
  const contract = '# C-1 Billing API\n\nProducer: billing.\n\nCites: D-05, D-01.\n';
  withRepo(decisionsText({ settled }), (root) => {
    assert.deepEqual(interfacesWithoutContract(root, cfg), [{ id: 'D-04', name: 'orders topic', source: 'docs/intake/x.md:12', line: 10 }]);
  }, { 'docs/spec/contracts/C-1-billing.md': contract });
});

test('readDecisions numbers the next id at the width already used', () => {
  assert.equal(readDecisions(decisionsText({ settled: THREE })).next, 'D-04');
  assert.equal(readDecisions('').next, 'D-1');
  assert.equal(readDecisions(decisionsText({ settled: ['| D-9 | Decision | q | a | x |'] })).next, 'D-10');
  assert.deepEqual(TYPES, ['Decision', 'Action', 'Information', 'Counsel', 'Open']);
});

test('add needs the fields of its table and an existing file and table', async () => {
  await withRepo(null, async (root) => {
    const r = await cli(root, ['decide', 'add', '--type', 'Decision', '--question', 'q', '--answer', 'a', '--who', 'ann']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /docs\/decisions\.md is missing; run slicekit init/);
  });
  await withRepo('# Decisions\n\n## Settled\n\n' + SETTLED_HEAD, async (root) => {
    assert.throws(
      () => addDecision(root, cfg, { type: 'Open', question: 'q', why: 'w', recommendation: 'r', who: 'ann' }),
      (e) => e.code === 1 && e.message === 'decisions.md has no Open table',
    );
    assert.throws(() => addDecision(root, cfg, { type: 'Decision', question: 'q', who: 'ann' }), (e) => e.code === 2);
    assert.throws(() => addDecision(root, cfg, { type: 'Maybe', question: 'q', answer: 'a', who: 'ann' }), (e) => e.code === 2);
    const usage = await cli(root, ['decide', 'nope']);
    assert.equal(usage.code, 2);
  });
});

test('who defaults to git user.name', () => {
  withRepo(decisionsText({ settled: THREE }), (root) => {
    addDecision(root, cfg, { type: 'Decision', question: 'q', answer: 'a', today: '2026-02-03' });
    assert.match(read(root), /\| D-04 \| Decision \| q \| a \| Slicekit Test, 2026-02-03 \|/);
  });
});
