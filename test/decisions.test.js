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
    assert.equal(row.answer, 'Published (Asked because: Losing it. Recommended: Publish now.)');
    assert.match(row.who, new RegExp(`^bo, ${DATE}$`));
    assert.match(read(root), /\| D-03 \|.*\n\| D-04 \| Action \| Reserve the name\? \| Published \(Asked because: Losing it\. Recommended: Publish now\.\) \| bo, /);

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

// REQ-1.4: a reversal names the row it replaces by that row's own ID, and only a settled row.
test('replaces writes the matched id and refuses an open row', async () => {
  const text = decisionsText({ settled: THREE, open: ['| D-04 | Decision | Which port? | w | r |'] });
  await withRepo(text, async (root) => {
    const r = await cli(root, ['decide', 'add', '--type', 'Decision', '--question', 'new', '--answer', 'b', '--replaces', 'D-1', '--who', 'ann']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(read(root), /\| D-05 \| Decision \| Replaces D-01\. new \| b \| ann, /);
    const before = read(root);
    const open = await cli(root, ['decide', 'add', '--type', 'Decision', '--question', 'new', '--answer', 'b', '--replaces', 'D-4', '--who', 'ann']);
    assert.equal(open.code, 2);
    assert.match(open.stderr, /D-04 is still open; settle it instead/);
    assert.equal(read(root), before);
  });
});

// REQ-1.4: settling keeps the reasoning the open row carried.
test('settle keeps the why and the recommendation in the answer', async () => {
  const text = decisionsText({
    settled: THREE,
    open: [
      '| D-04 | Decision | Which port? | D-30 needs it | Follow D-30 |',
      '| D-05 | Action | Publish? |  | Do it a\\|b |',
      '| D-06 | Information | Interface: orders. Which topic? | it feeds billing. Named at docs/intake/x.md:12. | ask |',
    ],
  });
  await withRepo(text, async (root) => {
    assert.equal((await cli(root, ['decide', 'settle', 'D-04', '--answer', 'Port 80', '--type', 'Decision', '--who', 'bo'])).code, 0);
    assert.equal((await cli(root, ['decide', 'settle', 'D-05', '--answer', 'Done', '--who', 'bo'])).code, 0);
    assert.equal((await cli(root, ['decide', 'settle', 'D-06', '--answer', 'orders.v1', '--who', 'bo'])).code, 0);
    const rows = readDecisions(read(root)).rows;
    const by = (id) => rows.find((x) => x.id === id);
    assert.equal(by('D-04').answer, 'Port 80 (Asked because: D-30 needs it. Recommended: Follow D-30.)');
    assert.equal(by('D-05').answer, 'Done (Recommended: Do it a|b.)');
    assert.match(read(root), /\| D-05 \| Action \| Publish\? \| Done \(Recommended: Do it a\\\|b\.\) \| bo, /);
    assert.equal(by('D-06').answer, 'orders.v1 (Asked because: it feeds billing. Recommended: ask.) Named at docs/intake/x.md:12.');
    assert.deepEqual(interfacesNamed(read(root)), [{ id: 'D-06', name: 'orders', source: 'docs/intake/x.md:12' }]);
  });
});

// REQ-1.4: an Open row carries its real Type; settling sets a Type only when the row's Type is Open.
test('an open row keeps its real type and settle sets a type only on an Open-typed row', async () => {
  await withRepo(decisionsText({ settled: THREE }), async (root) => {
    const a = await cli(root, ['decide', 'add', '--open', '--type', 'Action', '--question', 'Publish?', '--why', 'w', '--recommendation', 'r']);
    assert.equal(a.code, 0, a.stderr);
    assert.equal(a.stdout, 'D-04\n');
    const b = await cli(root, ['decide', 'add', '--open', '--question', 'Port?', '--why', 'w', '--recommendation', 'r']);
    assert.equal(b.code, 0, b.stderr);
    const rows = readDecisions(read(root)).rows;
    assert.deepEqual(rows.filter((x) => x.table === 'open').map((x) => [x.id, x.type]), [['D-04', 'Action'], ['D-05', 'Open']]);

    const before = read(root);
    const noType = await cli(root, ['decide', 'settle', 'D-05', '--answer', '80', '--who', 'bo']);
    assert.equal(noType.code, 2);
    assert.match(noType.stderr, /D-05 has Type Open; settle with --type/);
    const change = await cli(root, ['decide', 'settle', 'D-04', '--answer', 'done', '--type', 'Decision', '--who', 'bo']);
    assert.equal(change.code, 2);
    const asOpen = await cli(root, ['decide', 'settle', 'D-05', '--answer', '80', '--type', 'Open', '--who', 'bo']);
    assert.equal(asOpen.code, 2);
    assert.equal(read(root), before);

    assert.equal((await cli(root, ['decide', 'settle', 'D-05', '--answer', '80', '--type', 'Decision', '--who', 'bo'])).code, 0);
    assert.equal((await cli(root, ['decide', 'settle', 'D-04', '--answer', 'done', '--type', 'Action', '--who', 'bo'])).code, 0);
    const settled = readDecisions(read(root)).rows.filter((x) => x.table === 'settled');
    assert.deepEqual(settled.slice(-2).map((x) => [x.id, x.type]), [['D-05', 'Decision'], ['D-04', 'Action']]);
  });
});

// REQ-1.4: a table whose columns are not the template's is refused, not written into.
test('a table with other columns is refused and the file is unchanged', async () => {
  const text = decisionsText({ settled: THREE }).replace('| # | Type | Question | Answer | Who, when |', '| # | Question | Type | Answer | Who, when |');
  await withRepo(text, async (root) => {
    const r = await cli(root, ['decide', 'add', '--type', 'Decision', '--question', 'q', '--answer', 'a', '--who', 'ann']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /decisions table Settled has columns # \| Question \| Type \| Answer \| Who, when; expected # \| Type \| Question \| Answer \| Who, when/);
    assert.equal(read(root), text);
  });
});

// REQ-1.4: inserted lines follow the first line's ending; every other line keeps its own.
test('line endings follow the first line and other lines keep theirs', async () => {
  const crlf = decisionsText({ settled: THREE, open: ['| D-04 | Action | q | w | r |'] }).replace(/\n/g, '\r\n');
  await withRepo(crlf, async (root) => {
    assert.equal((await cli(root, ['decide', 'add', '--type', 'Decision', '--question', 'q', '--answer', 'a', '--who', 'ann'])).code, 0);
    assert.equal((await cli(root, ['decide', 'settle', 'D-04', '--answer', 'z', '--who', 'bo'])).code, 0);
    const text = read(root);
    assert.equal(text.replace(/\r\n/g, '').includes('\n'), false);
    assert.match(text, /\| D-05 \| Decision \| q \| a \| ann, [^\r\n]*\r\n/);
    assert.deepEqual(fs.readdirSync(path.dirname(file(root))), ['decisions.md']);
  });
  // LF lines with one CRLF line: the CRLF line stays, the new row uses LF.
  const mixed = decisionsText({ settled: THREE }).replace('## Open\n', '## Open\r\n');
  await withRepo(mixed, async (root) => {
    assert.equal((await cli(root, ['decide', 'add', '--type', 'Decision', '--question', 'q', '--answer', 'a', '--who', 'ann'])).code, 0);
    const text = read(root);
    assert.match(text, /## Open\r\n/);
    assert.match(text, /\| D-04 \| Decision \| q \| a \| ann, [^\r\n]*\n/);
    assert.equal(text.match(/\r\n/g).length, 1);
  });
});

test('the usage says how to pass a value that starts with -', async () => {
  await withRepo(decisionsText({ settled: THREE }), async (root) => {
    const r = await cli(root, ['decide']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--answer=<text>/);
    const ok = await cli(root, ['decide', 'add', '--type', 'Decision', '--question', 'q', '--answer=-x', '--who', 'ann']);
    assert.equal(ok.code, 0, ok.stderr);
  });
});
