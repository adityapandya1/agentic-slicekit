import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../../src/cli/index.js';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { CLASSES, GapError, addGap, closeGap, readGaps } from '../../src/gaps.js';
import { makeRepo } from '../helpers/tmp-repo.js';

async function cli(root, args) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

// An initialised repository: init writes docs/spec/gaps.md from the template.
async function withProgram(fn) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend', env: {} });
    return await fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

const gapsText = (root) => fs.readFileSync(path.join(root, 'docs/spec/gaps.md'), 'utf8');

// decisions.md with D-01 settled and D-02 open.
function writeDecisions(root) {
  const text = [
    '# Decisions',
    '',
    '## Settled',
    '',
    '| # | Type | Question | Answer | Who, when |',
    '|---|------|----------|--------|-----------|',
    '| D-01 | Decision | Which store? | Postgres | Ana, 2026-01-02 |',
    '',
    '## Open',
    '',
    '| # | Type | Question | Why it matters | Recommendation |',
    '|---|------|----------|----------------|----------------|',
    '| D-02 | Decision | Which carrier? | Cost | Pick one |',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'docs/decisions.md'), text);
}

function writeSpec(root) {
  fs.mkdirSync(path.join(root, 'docs/spec'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'docs/spec/01-orders.md'),
    '# Orders\n\n## REQ-1.1 store orders\n\nThe system SHALL store orders.\n\nScenario: it happens.\n\nCites: D-01\n\nEnforced by: `x.test.js`\n',
  );
}

test('each of the five gap classes is written as a G row', async () => {
  await withProgram(async (root) => {
    for (const [i, cls] of CLASSES.entries()) {
      const r = await cli(root, ['gaps', 'add', '--class', cls, '--where', `docs/spec/01-orders.md:${i + 3}`, '--what', `gap ${i + 1}`]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.stdout, `G-${i + 1}\n`);
    }
    const { rows, next } = readGaps(gapsText(root));
    assert.deepEqual(rows.map((r) => r.id), ['G-1', 'G-2', 'G-3', 'G-4', 'G-5']);
    assert.deepEqual(rows.map((r) => r.cls), CLASSES);
    assert.ok(rows.every((r) => r.closedBy === ''), 'every new row is open');
    assert.equal(next, 'G-6');

    const before = gapsText(root);
    const bad = await cli(root, ['gaps', 'add', '--class', 'vague', '--where', 'a:1', '--what', 'x']);
    assert.equal(bad.code, 2, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /unknown class 'vague'; one of missing, unsupported, contradiction, unknown, unrequested/);
    assert.equal(gapsText(root), before);
  });
});

test('close refuses a decision that does not exist', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    const add = await cli(root, ['gaps', 'add', '--class', 'unknown', '--where', 'docs/decisions.md:13', '--what', 'D-02 is open']);
    assert.equal(add.stdout, 'G-1\n', add.stderr);

    const bad = await cli(root, ['gaps', 'close', 'G-1', '--decision', 'D-77']);
    assert.equal(bad.code, 2, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /unknown decision D-77/);
    assert.equal(readGaps(gapsText(root)).rows[0].closedBy, '');

    const ok = await cli(root, ['gaps', 'close', 'G-1', '--decision', 'D-01']);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.equal(ok.stdout, 'G-1 closed by D-01\n');
    assert.equal(readGaps(gapsText(root)).rows[0].closedBy, 'D-01');

    const again = await cli(root, ['gaps', 'close', 'G-1', '--decision', 'D-01']);
    assert.equal(again.code, 1, again.stdout + again.stderr);
    assert.match(again.stderr, /G-1 is closed by D-01/);
  });
});

test('a gap closes with a REQ heading of the spec', async () => {
  await withProgram(async (root) => {
    writeSpec(root);
    await cli(root, ['gaps', 'add', '--class', 'unsupported', '--where', 'docs/spec/01-orders.md:3', '--what', 'no evidence']);
    const bad = await cli(root, ['gaps', 'close', 'G-1', '--req', 'REQ-9.9']);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /unknown requirement REQ-9\.9/);
    const ok = await cli(root, ['gaps', 'close', 'G-1', '--req', 'REQ-1.1']);
    assert.equal(ok.stdout, 'G-1 closed by REQ-1.1\n', ok.stderr);
    assert.equal(readGaps(gapsText(root)).rows[0].closedBy, 'REQ-1.1');
  });
});

test('close takes exactly one of decision and req, and an existing G-ID', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    writeSpec(root);
    await cli(root, ['gaps', 'add', '--class', 'missing', '--where', 'a:1', '--what', 'x']);
    const cfg = loadConfig(root);
    const usage = (e) => e instanceof GapError && e.code === 2;
    assert.throws(() => closeGap(root, cfg, 'G-1', {}), usage);
    assert.throws(() => closeGap(root, cfg, 'G-1', { decision: 'D-01', req: 'REQ-1.1' }), usage);
    assert.throws(() => closeGap(root, cfg, 'G-9', { decision: 'D-01' }), (e) => usage(e) && /unknown gap G-9/.test(e.message));
    assert.equal((await cli(root, ['gaps', 'close', 'G-1'])).code, 2);
    assert.equal((await cli(root, ['gaps', 'close', 'G-1', '--decision', 'D-01', '--req', 'REQ-1.1'])).code, 2);
    assert.equal(readGaps(gapsText(root)).rows[0].closedBy, '');
  });
});

test('add escapes a pipe, refuses a line break, and returns the existing row for a repeat', async () => {
  await withProgram(async (root) => {
    const cfg = loadConfig(root);
    assert.deepEqual(addGap(root, cfg, { cls: 'contradiction', where: 'a:1', what: 'x | y' }), { id: 'G-1', added: true });
    assert.ok(gapsText(root).includes('| G-1 | contradiction | a:1 | x \\| y |  |'), gapsText(root));
    assert.equal(readGaps(gapsText(root)).rows[0].what, 'x | y');
    assert.deepEqual(addGap(root, cfg, { cls: 'contradiction', where: 'a:1', what: 'x | y' }), { id: 'G-1', added: false });
    assert.throws(() => addGap(root, cfg, { cls: 'missing', where: 'a:1', what: 'x\ny' }), (e) => e.code === 2 && e.message === 'what must be one line');
    assert.equal(readGaps(gapsText(root)).rows.length, 1);
  });
});
