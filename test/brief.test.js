// P7/S-56 (REQ-2.15, D-99): `slicekit brief start | ask | answer | done` interviews a person one topic
// at a time, in the order of REQ-2.15, and writes `<docsRoot>/brief/<slug>.md` from their answers
// alone. An unknown answer becomes an open question; `brief done` writes no spec and commits the brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defaultConfig } from '../src/config.js';
import { main } from '../src/cli/index.js';
import { git } from '../src/git.js';
import { commit, makeRepo } from './helpers/tmp-repo.js';

const baseCfg = defaultConfig({ name: 'demo', shape: 'backend' });
const NOW = '2026-03-04T05:06:07.000Z';
const env = { ...process.env, SLICEKIT_NOW: NOW };

// The seven headings of REQ-2.15, in their order.
const HEADINGS = [
  '## Problem and who has it',
  '## What they do today',
  '## Use cases',
  '## Out of scope',
  '## Success measures',
  '## Constraints',
  '## Open questions',
];
// The topics of REQ-2.15, in their order; each one's answer goes under the heading beside it.
const TOPICS = [
  ['problem', '## Problem and who has it'],
  ['today', '## What they do today'],
  ['use-cases', '## Use cases'],
  ['out-of-scope', '## Out of scope'],
  ['success-measures', '## Success measures'],
  ['constraints', '## Constraints'],
  ['unknowns', '## Open questions'],
];
// One scripted person's answers, by topic.
const ANSWERS = {
  problem: 'Card payments that fail on a timeout are lost; the support team has it.',
  today: 'Support staff retry each failed payment by hand from the admin screen.',
  'use-cases': 'A payment that timed out is retried once within five minutes.',
  'out-of-scope': 'Refunds and chargebacks.',
  'success-measures': 'Fewer than ten payments a week retried by hand.',
  constraints: 'The card processor allows one retry per payment.',
  unknowns: 'Whether the processor charges for a retry.',
};

async function cli(root, args) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, env, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

// A repository with a committed config and stack file on main, switched to `branch`.
async function withRepo(fn, { branch = 'spec/payments-retry' } = {}) {
  const repo = makeRepo({
    files: {
      '.slicekit/config.json': `${JSON.stringify(baseCfg, null, 2)}\n`,
      'docs/spec/stack.md': '# Stack\n',
    },
  });
  git(repo.root, ['add', '-A']);
  commit(repo.root, 'config');
  if (branch !== 'main') git(repo.root, ['switch', '-q', '-c', branch]);
  try {
    return await fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

const first = (r) => r.stdout.split('\n')[0];
const briefRel = (slug) => `docs/brief/${slug}.md`;
const readBrief = (root, slug) => fs.readFileSync(path.join(root, briefRel(slug)), 'utf8').replace(/\r\n/g, '\n');
const nonBlank = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

// The non-blank lines under each `## ` heading of a brief, keyed by the heading.
function sections(text) {
  const out = {};
  let at = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      at = line.trim();
      out[at] = [];
    } else if (at !== null && line.trim() !== '') out[at].push(line.trim());
  }
  return out;
}

// Runs the interview for `slug`: one question per topic in order, then an answer, or `--unknown`
// for a topic in `unknown`. Every step must exit 0.
async function interview(root, slug, { unknown = [] } = {}) {
  const s = await cli(root, ['brief', 'start', slug]);
  assert.equal(s.code, 0, s.stderr);
  let n = 0;
  for (const [topic] of TOPICS) {
    const q = await cli(root, ['brief', 'ask', '--topic', topic, '--question', `What about ${topic}?`]);
    assert.equal(q.code, 0, `${topic}: ${q.stderr}`);
    assert.equal(first(q), `question ${++n}`);
    const a = unknown.includes(topic)
      ? await cli(root, ['brief', 'answer', '--unknown'])
      : await cli(root, ['brief', 'answer', '--answer', ANSWERS[topic]]);
    assert.equal(a.code, 0, `${topic}: ${a.stderr}`);
    // The answer is in the brief before the next question is asked.
    if (!unknown.includes(topic)) assert.ok(readBrief(root, slug).includes(ANSWERS[topic]), `${topic} is not in the brief yet`);
  }
}

test('a scripted interview writes the seven sections in order with each answer once', async () => {
  await withRepo(async (root) => {
    await interview(root, 'payments-retry');
    const d = await cli(root, ['brief', 'done']);
    assert.equal(d.code, 0, d.stderr);
    const text = readBrief(root, 'payments-retry');
    // The headings in their order, each answer once under its own, and no other text.
    const expected = TOPICS.flatMap(([topic, heading]) => [heading, ANSWERS[topic]]);
    assert.deepEqual(nonBlank(text), expected);
    assert.deepEqual(nonBlank(text).filter((l) => l.startsWith('## ')), HEADINGS);
    for (const answer of Object.values(ANSWERS)) assert.equal(text.split(answer).length - 1, 1, `${answer} is not written once`);
  });
});

test('an unknown answer is written under Open questions and not under its topic', async () => {
  await withRepo(async (root) => {
    await interview(root, 'payments-retry', { unknown: ['success-measures'] });
    const text = readBrief(root, 'payments-retry');
    const got = sections(text);
    assert.deepEqual(Object.keys(got), HEADINGS);
    // Nothing is written under the topic's own heading: no invented requirement.
    assert.deepEqual(got['## Success measures'], []);
    assert.ok(!text.includes(ANSWERS['success-measures']), 'an answer the person did not give is in the brief');
    // The topic is listed under Open questions, beside the unknowns the person named.
    const open = got['## Open questions'];
    assert.equal(open.length, 2, open.join('\n'));
    assert.ok(open.includes(ANSWERS.unknowns), open.join('\n'));
    assert.ok(open.some((l) => l !== ANSWERS.unknowns && /success[ -]measures/i.test(l)), open.join('\n'));
    // And under no other heading.
    for (const [heading, lines] of Object.entries(got)) {
      if (heading === '## Open questions') continue;
      assert.ok(!lines.some((l) => /success[ -]measures/i.test(l)), `${heading} names the unknown topic`);
    }
    // The other answers stay under their own headings.
    for (const [topic, heading] of TOPICS) {
      if (topic === 'success-measures' || topic === 'unknowns') continue;
      assert.deepEqual(got[heading], [ANSWERS[topic]], heading);
    }
  });
});

test('brief ask refuses a topic out of order and a second question before an answer', async () => {
  await withRepo(async (root) => {
    assert.equal((await cli(root, ['brief', 'start', 'payments-retry'])).code, 0);
    const ask = (topic) => cli(root, ['brief', 'ask', '--topic', topic, '--question', `What about ${topic}?`]);
    const snapshot = () => (fs.existsSync(path.join(root, briefRel('payments-retry'))) ? readBrief(root, 'payments-retry') : null);

    // The first topic is the problem; any other is out of order.
    const before = snapshot();
    const early = await ask('today');
    assert.equal(early.code, 1);
    assert.notEqual(early.stderr, '');
    assert.equal(snapshot(), before);

    const q1 = await ask('problem');
    assert.equal(q1.code, 0, q1.stderr);
    assert.equal(first(q1), 'question 1');

    // A second question while the first has no answer is refused, even on the next topic.
    const waiting = await ask('today');
    assert.equal(waiting.code, 1);
    assert.notEqual(waiting.stderr, '');

    assert.equal((await cli(root, ['brief', 'answer', '--answer', ANSWERS.problem])).code, 0);
    const q2 = await ask('today');
    assert.equal(q2.code, 0, q2.stderr);
    assert.equal(first(q2), 'question 2');
    assert.equal((await cli(root, ['brief', 'answer', '--answer', ANSWERS.today])).code, 0);

    // Skipping ahead and going back are both out of order.
    const afterTwo = snapshot();
    for (const topic of ['constraints', 'problem']) {
      const r = await ask(topic);
      assert.equal(r.code, 1, topic);
      assert.notEqual(r.stderr, '', topic);
    }
    assert.equal(snapshot(), afterTwo);
    const q3 = await ask('use-cases');
    assert.equal(q3.code, 0, q3.stderr);
    assert.equal(first(q3), 'question 3');
  });
});

test('brief done refuses when a spec file changed during the interview', async () => {
  // A spec file changed, and a spec file that appeared.
  const cases = [
    ['docs/spec/stack.md', (root) => fs.appendFileSync(path.join(root, 'docs', 'spec', 'stack.md'), '\nNode.\n')],
    ['docs/spec/retry.md', (root) => fs.writeFileSync(path.join(root, 'docs', 'spec', 'retry.md'), '# Retry\n')],
  ];
  for (const [rel, change] of cases) {
    await withRepo(async (root) => {
      const s = await cli(root, ['brief', 'start', 'payments-retry']);
      assert.equal(s.code, 0, s.stderr);
      change(root);
      // The rest of the interview, after the spec change.
      let n = 0;
      for (const [topic] of TOPICS) {
        const q = await cli(root, ['brief', 'ask', '--topic', topic, '--question', `What about ${topic}?`]);
        assert.equal(q.code, 0, q.stderr);
        assert.equal(first(q), `question ${++n}`);
        assert.equal((await cli(root, ['brief', 'answer', '--answer', ANSWERS[topic]])).code, 0);
      }
      const head = git(root, ['rev-parse', 'HEAD']);
      const d = await cli(root, ['brief', 'done']);
      assert.equal(d.code, 1, rel);
      assert.ok(d.stderr.includes(rel), `${rel}: ${d.stderr}`);
      assert.ok(!d.stdout.includes('/slicekit intake'), d.stdout);
      // Nothing was committed.
      assert.equal(git(root, ['rev-parse', 'HEAD']), head);
      assert.equal(git(root, ['ls-files', 'docs/brief']), '');
    });
  }
});

test('brief done commits the brief and prints the intake command as its last line', async () => {
  // The scenario of REQ-2.15: every topic answered but the success measures.
  await withRepo(async (root) => {
    const base = git(root, ['rev-parse', 'HEAD']);
    await interview(root, 'payments-retry', { unknown: ['success-measures'] });
    const d = await cli(root, ['brief', 'done']);
    assert.equal(d.code, 0, d.stderr);
    const lines = d.stdout.split('\n').filter((l) => l.trim() !== '');
    assert.equal(lines.at(-1), '/slicekit intake docs/brief/payments-retry.md');

    // docs/brief/payments-retry.md has all seven sections, with success measures an open question.
    const got = sections(readBrief(root, 'payments-retry'));
    assert.deepEqual(Object.keys(got), HEADINGS);
    assert.deepEqual(got['## Success measures'], []);
    assert.ok(got['## Open questions'].some((l) => /success[ -]measures/i.test(l)));

    // One commit, on the current branch, holding the brief alone; no spec file changed.
    assert.equal(git(root, ['branch', '--show-current']), 'spec/payments-retry');
    assert.equal(git(root, ['rev-parse', 'HEAD~1']), base);
    assert.equal(git(root, ['show', '--name-only', '--format=', 'HEAD']), 'docs/brief/payments-retry.md');
    assert.equal(git(root, ['diff', '--name-only', base, 'HEAD', '--', 'docs/spec']), '');
    assert.equal(git(root, ['status', '--porcelain']), '');
  });
});

// ---- P8/S-63 (REQ-1.7, D-99, issue #206): the blank brief's guidance is no answer ----

// The kit's blank brief, and the one line it holds under each heading.
const BLANK = fs.readFileSync(new URL('../templates/brief/blank.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const GUIDANCE = sections(BLANK);

// REQ-1.7
test("a brief holding the blank brief's guidance line under a heading is refused", async () => {
  // The template holds one guidance line under each of the seven headings, and a title with <name>.
  assert.deepEqual(Object.keys(GUIDANCE), HEADINGS);
  for (const h of HEADINGS) assert.equal(GUIDANCE[h].length, 1, h);
  assert.match(BLANK.split('\n')[0], /<name>/);

  await withRepo(async (root) => {
    const rel = 'docs/brief/orders.md';
    const write = (text) => {
      fs.mkdirSync(path.join(root, 'docs', 'brief'), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    // A brief with each section answered, and `fill` over some of them.
    const filled = (fill = {}, title = '# Brief: Orders') => `${[title, ...HEADINGS.map((h) => [h, fill[h] ?? `Said on ${h.slice(3)}.`].join('\n\n'))].join('\n\n')}\n`;
    const stage = () => cli(root, ['stage', 'require', 'brief']);

    // Every section answered and a real title: ready.
    write(filled());
    const ok = await stage();
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /^ready: brief$/m);

    // The blank brief copied with no line replaced.
    write(BLANK);
    const blank = await stage();
    assert.equal(blank.code, 1, blank.stdout);
    assert.ok(blank.stderr.includes(rel), blank.stderr);

    // One section's only line is the guidance line the blank brief holds under that heading.
    for (const h of ['## What they do today', '## Success measures', '## Open questions']) {
      write(filled({ [h]: GUIDANCE[h][0] }));
      const r = await stage();
      assert.equal(r.code, 1, `${h}: ${r.stdout}`);
      assert.ok(r.stderr.includes(rel), `${h}: ${r.stderr}`);
      assert.ok(r.stderr.includes(h), `${h}: ${r.stderr}`);
      assert.doesNotMatch(r.stdout, /^ready: brief$/m);
    }

    // The title still holds <name>.
    write(filled({}, BLANK.split('\n')[0]));
    const titled = await stage();
    assert.equal(titled.code, 1, titled.stdout);
    assert.ok(titled.stderr.includes(rel), titled.stderr);
    assert.ok(titled.stderr.includes('<name>'), titled.stderr);
  });

  // brief done refuses the same: an answer that is the guidance line of its heading.
  await withRepo(async (root) => {
    assert.equal((await cli(root, ['brief', 'start', 'payments-retry'])).code, 0);
    for (const [topic, heading] of TOPICS) {
      const q = await cli(root, ['brief', 'ask', '--topic', topic, '--question', `What about ${topic}?`]);
      assert.equal(q.code, 0, `${topic}: ${q.stderr}`);
      await cli(root, ['brief', 'answer', '--answer', topic === 'today' ? GUIDANCE[heading][0] : ANSWERS[topic]]);
    }
    const head = git(root, ['rev-parse', 'HEAD']);
    const d = await cli(root, ['brief', 'done']);
    assert.equal(d.code, 1, d.stdout);
    assert.ok(d.stderr.includes(briefRel('payments-retry')), d.stderr);
    assert.ok(d.stderr.includes('## What they do today'), d.stderr);
    assert.ok(!d.stdout.includes('/slicekit intake'), d.stdout);
    assert.equal(git(root, ['rev-parse', 'HEAD']), head);
    assert.equal(git(root, ['ls-files', 'docs/brief']), '');
  });
});
