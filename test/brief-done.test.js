// P7/S-56 fix round 1, H-1 (REQ-2.15, D-99): every topic of the brief is either answered or listed
// under Open questions. `brief done` refuses while a topic was never asked and answered, and
// `stage require brief` refuses a hand-edited brief with an empty section not listed as open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defaultConfig } from '../src/config.js';
import { main } from '../src/cli/index.js';
import { git } from '../src/git.js';
import { commit, makeRepo } from './helpers/tmp-repo.js';

const baseCfg = defaultConfig({ name: 'demo', shape: 'backend' });
const env = { ...process.env, SLICEKIT_NOW: '2026-03-04T05:06:07.000Z' };
const TOPICS = ['problem', 'today', 'use-cases', 'out-of-scope', 'success-measures', 'constraints', 'unknowns'];
const HEADINGS = ['Problem and who has it', 'What they do today', 'Use cases', 'Out of scope', 'Success measures', 'Constraints', 'Open questions'];

async function cli(root, args) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, { cwd: root, env, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } });
  return { code, stdout, stderr };
}

async function withRepo(fn) {
  const repo = makeRepo({ files: { '.slicekit/config.json': `${JSON.stringify(baseCfg, null, 2)}\n`, 'docs/spec/stack.md': '# Stack\n' } });
  git(repo.root, ['add', '-A']);
  commit(repo.root, 'config');
  git(repo.root, ['switch', '-q', '-c', 'spec/payments-retry']);
  try {
    return await fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

async function askAnswer(root, topic, { unknown = false } = {}) {
  const q = await cli(root, ['brief', 'ask', '--topic', topic, '--question', `What about ${topic}?`]);
  assert.equal(q.code, 0, `${topic}: ${q.stderr}`);
  const a = await cli(root, unknown ? ['brief', 'answer', '--unknown'] : ['brief', 'answer', '--answer', `The answer on ${topic}.`]);
  assert.equal(a.code, 0, `${topic}: ${a.stderr}`);
}

test('brief done refuses while a topic was never asked and answered, naming the first one', async () => {
  await withRepo(async (root) => {
    assert.equal((await cli(root, ['brief', 'start', 'payments-retry'])).code, 0);
    const head = git(root, ['rev-parse', 'HEAD']);
    const none = await cli(root, ['brief', 'done']);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /topic problem was never asked/);
    await askAnswer(root, 'problem');
    await askAnswer(root, 'today');
    const two = await cli(root, ['brief', 'done']);
    assert.equal(two.code, 1);
    assert.match(two.stderr, /topic use-cases was never asked/);
    assert.ok(!two.stdout.includes('/slicekit intake'), two.stdout);
    assert.equal(git(root, ['rev-parse', 'HEAD']), head);
    assert.equal(git(root, ['ls-files', 'docs/brief']), '');
    // The rest of the topics, each answered --unknown, count as answered.
    for (const topic of TOPICS.slice(2)) await askAnswer(root, topic, { unknown: true });
    const d = await cli(root, ['brief', 'done']);
    assert.equal(d.code, 0, d.stderr);
    assert.equal(d.stdout.trim().split('\n').at(-1), '/slicekit intake docs/brief/payments-retry.md');
    assert.equal((await cli(root, ['stage', 'require', 'brief'])).code, 0);
  });
});

test('stage require brief refuses an empty section not listed under Open questions', async () => {
  await withRepo(async (root) => {
    const write = (text) => {
      fs.mkdirSync(path.join(root, 'docs', 'brief'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'brief', 'orders.md'), text);
    };
    const body = { 'Open questions': [] };
    const brief = (fill) => `${HEADINGS.map((h) => [`## ${h}`, ...(fill[h] ?? [])].join('\n\n')).join('\n\n')}\n`;
    // Only the problem is filled: the first empty topic section is named.
    write(brief({ ...body, 'Problem and who has it': ['Orders are lost.'] }));
    const r = await cli(root, ['stage', 'require', 'brief']);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes('docs/brief/orders.md'), r.stderr);
    assert.match(r.stderr, /## What they do today/);
    assert.doesNotMatch(r.stderr, /Use cases/);
    // Every topic filled but the success measures, which are listed under Open questions: ready.
    const filled = Object.fromEntries(HEADINGS.slice(0, 6).map((h) => [h, [`Said on ${h}.`]]));
    write(brief({ ...filled, 'Success measures': [], 'Open questions': ['Success measures'] }));
    const ok = await cli(root, ['stage', 'require', 'brief']);
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /^ready: brief$/m);
    // The same, with the success measures not listed: refused, naming the section.
    write(brief({ ...filled, 'Success measures': [] }));
    const bad = await cli(root, ['stage', 'require', 'brief']);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /docs\/brief\/orders\.md has an empty section ## Success measures/);
  });
});
