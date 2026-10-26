import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

// Runs git in the repository; init installs the kit's hooks, so a commit on main needs the escape.
const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ALLOW_PROTECTED_COMMIT: '1' } })
    .toString()
    .trim();

// A program through spec review: a pinned intake snapshot, D-01 settled, D-02 open, the spec, all
// on main; then the branch `gaps/x` is checked out. Returns the base's short SHA.
function mergedSpec(root) {
  const intake = path.join(root, 'docs/intake/2026-01-01-brief.md');
  fs.mkdirSync(path.dirname(intake), { recursive: true });
  fs.writeFileSync(intake, 'Store orders.\n');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(intake)).digest('hex');
  fs.writeFileSync(intake.replace(/\.md$/, '.meta.json'), JSON.stringify({ sha256 }));
  writeDecisions(root);
  writeSpec(root);
  git(root, 'add', '-A');
  git(root, ['com', 'mit'].join(''), '-q', '-m', 'spec');
  git(root, 'checkout', '-q', '-b', 'gaps/x');
  return git(root, 'rev-parse', 'HEAD').slice(0, 7);
}

const specFile = (root) => path.join(root, 'docs/spec/01-orders.md');

test('a gap closes with a REQ heading of the spec that changed since the merge base', async () => {
  await withProgram(async (root) => {
    const base = mergedSpec(root);
    await cli(root, ['gaps', 'add', '--class', 'unsupported', '--where', 'docs/spec/01-orders.md:3', '--what', 'no evidence']);
    const bad = await cli(root, ['gaps', 'close', 'G-1', '--req', 'REQ-9.9']);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /unknown requirement REQ-9\.9/);
    const same = await cli(root, ['gaps', 'close', 'G-1', '--req', 'REQ-1.1']);
    assert.equal(same.code, 2, same.stdout + same.stderr);
    assert.match(same.stderr, new RegExp(`REQ-1\\.1 is unchanged from ${base}; change it first`));
    assert.equal(readGaps(gapsText(root)).rows[0].closedBy, '');

    fs.writeFileSync(specFile(root), fs.readFileSync(specFile(root), 'utf8').replace('SHALL store orders', 'SHALL store every order'));
    const ok = await cli(root, ['gaps', 'close', 'G-1', '--req', 'REQ-1.1']);
    assert.equal(ok.stdout, 'G-1 closed by REQ-1.1\n', ok.stderr);
    assert.equal(readGaps(gapsText(root)).rows[0].closedBy, 'REQ-1.1');
  });
});

test('a REQ new since the merge base closes a gap, and with no merge base a REQ cannot', async () => {
  await withProgram(async (root) => {
    writeSpec(root);
    await cli(root, ['gaps', 'add', '--class', 'missing', '--where', 'a:1', '--what', 'x']);
    const none = await cli(root, ['gaps', 'close', 'G-1', '--req', 'REQ-1.1']);
    assert.equal(none.code, 2, none.stdout + none.stderr);
    assert.match(none.stderr, /REQ-1\.1 has no merge base with main to compare with/);
  });
  await withProgram(async (root) => {
    mergedSpec(root);
    await cli(root, ['gaps', 'add', '--class', 'missing', '--where', 'a:1', '--what', 'x']);
    fs.appendFileSync(specFile(root), '\n## REQ-1.2 ship orders\n\nThe system SHALL ship orders.\n\nScenario: it ships.\n\nCites: D-01\n\nEnforced by: `y.test.js`\n');
    const ok = await cli(root, ['gaps', 'close', 'G-1', '--req', 'REQ-1.2']);
    assert.equal(ok.stdout, 'G-1 closed by REQ-1.2\n', ok.stderr);
  });
});

test('an Open decision row cannot close a gap', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    await cli(root, ['gaps', 'add', '--class', 'unknown', '--where', 'docs/decisions.md:13', '--what', 'D-02 is open']);
    const r = await cli(root, ['gaps', 'close', 'G-1', '--decision', 'D-02']);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /D-02 is open; settle it first \(slicekit decide settle D-02\)/);
    assert.equal(readGaps(gapsText(root)).rows[0].closedBy, '');
  });
});

test('on a gaps branch with only gaps.md changed the gap-scan stage is ready', async () => {
  await withProgram(async (root) => {
    mergedSpec(root);
    await cli(root, ['gaps', 'add', '--class', 'unknown', '--where', 'docs/decisions.md:13', '--what', 'D-02 is open: Which carrier?']);
    const open = await cli(root, ['stage', 'require', 'gap-scan']);
    assert.equal(open.code, 1, open.stdout + open.stderr);
    assert.match(open.stderr, /G-1 is not closed/);
    await cli(root, ['gaps', 'close', 'G-1', '--decision', 'D-01']);
    const ready = await cli(root, ['stage', 'require', 'gap-scan']);
    assert.equal(ready.code, 0, ready.stdout + ready.stderr);
    assert.match(ready.stdout, /^ready: gap-scan/);
  });
});

test('a D id inside a gap row does not count as cited by the spec', async () => {
  await withProgram(async (root) => {
    mergedSpec(root);
    await cli(root, ['gaps', 'add', '--class', 'unknown', '--where', 'docs/decisions.md:13', '--what', 'D-02 is open: Which carrier?']);
    const r = await cli(root, ['stage', 'require', 'clarify']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /D-02/);
  });
});

test('closing a row keeps its extra cells, and a row with no G id is refused on load', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    const file = path.join(root, 'docs/spec/gaps.md');
    const head = '| # | Class | Where | What | Closed by |\n|---|---|---|---|---|\n';
    fs.writeFileSync(file, `# Gaps\n\n${head}| G-1 | missing | a:1 | x |  | note \\| kept |\n`);
    const ok = await cli(root, ['gaps', 'close', 'G-1', '--decision', 'D-01']);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.ok(gapsText(root).includes('| G-1 | missing | a:1 | x | D-01 | note \\| kept |'), gapsText(root));

    fs.writeFileSync(file, `# Gaps\n\n${head}| G-1 | missing | a:1 | x |  |\n| X-2 | missing | b:1 | y |  |\n`);
    const before = gapsText(root);
    const bad = await cli(root, ['gaps', 'add', '--class', 'unknown', '--where', 'c:1', '--what', 'z']);
    assert.equal(bad.code, 1, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /gaps table row 6 has no G id/);
    assert.equal(gapsText(root), before);
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

const rowsOf = (root) => readGaps(gapsText(root)).rows;
const stripped = (rows) => rows.map(({ id, cls, where, what, closedBy }) => ({ id, cls, where, what, closedBy }));

test('a Not yet known section is an unknown row', async () => {
  await withProgram(async (root) => {
    fs.writeFileSync(path.join(root, 'docs/observability.md'), '# Observability\n\n## Dashboards\n\nGrafana board orders.\n\n## Alert routes\n\nNot yet known\n');
    const r = await cli(root, ['gaps', 'scan']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const row = rowsOf(root).find((g) => g.where.startsWith('docs/observability.md:'));
    assert.ok(row, gapsText(root));
    assert.equal(row.cls, 'unknown');
    assert.equal(row.what, 'Alert routes not yet known');
    assert.equal(row.where, 'docs/observability.md:7');
    assert.ok(!rowsOf(root).some((g) => g.what === 'Dashboards not yet known'), 'a section with content is no gap');
    assert.ok(r.stdout.split('\n').includes(`${row.id} unknown Alert routes not yet known`), r.stdout);
  });
});

test('a REQ resting on an Open row is an unknown row', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    fs.writeFileSync(
      specFile(root),
      '# Orders\n\n## REQ-1.1 ship orders\n\nThe system SHALL ship orders.\n\nScenario: it ships.\n\nCites: D-02\n\nEnforced by: `x.test.js`\n\n## REQ-1.2 store orders\n\nThe system SHALL store orders.\n\nScenario: stored.\n\nCites: D-01\n\nEnforced by: `y.test.js`\n',
    );
    const r = await cli(root, ['gaps', 'scan']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rests = rowsOf(root).filter((g) => / rests on open /.test(g.what));
    assert.deepEqual(stripped(rests).map(({ cls, where, what }) => ({ cls, where, what })), [
      { cls: 'unknown', where: 'docs/spec/01-orders.md:3', what: 'REQ-1.1 rests on open D-02' },
    ]);
    const open = rowsOf(root).find((g) => g.what === 'D-02 is open: Which carrier?');
    assert.ok(open, gapsText(root));
    assert.equal(open.cls, 'unknown');
    assert.equal(open.where, 'docs/decisions.md:13');
  });
});

test('an interface named at intake and in no contract is a missing row naming the intake line', async () => {
  await withProgram(async (root) => {
    const d = await cli(root, ['decide', 'add', '--type', 'Decision', '--question', 'Which topic carries orders?', '--answer', 'orders.v1', '--interface', 'orders topic', '--source', 'docs/intake/2026-01-01-req.md:12', '--who', 'Ana']);
    assert.equal(d.code, 0, d.stdout + d.stderr);
    const r = await cli(root, ['gaps', 'scan']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const missing = rowsOf(root).filter((g) => g.cls === 'missing');
    assert.equal(missing.length, 1, gapsText(root));
    assert.equal(missing[0].where, 'docs/intake/2026-01-01-req.md:12');
    assert.match(missing[0].what, /orders topic/);
    assert.equal(missing[0].what, 'interface orders topic named at intake has no contract');

    fs.mkdirSync(path.join(root, 'docs/spec/contracts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/spec/contracts/C-1-orders.md'), `# C-1 orders topic\n\nCites: ${d.stdout.trim()}\n`);
    const again = await cli(root, ['gaps', 'scan']);
    assert.equal(again.stdout, 'no new gaps\n', again.stderr);
  });
});

test('scan run twice adds no duplicate row', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    fs.writeFileSync(specFile(root), '# Orders\n\n## REQ-1.1 ship orders\n\nThe system SHALL ship orders.\n\nScenario: it ships.\n\nCites: D-02\n\nEnforced by: `x.test.js`\n');
    const first = await cli(root, ['gaps', 'scan']);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    assert.ok(rowsOf(root).length > 2, gapsText(root));
    const lines = first.stdout.trim().split('\n');
    assert.equal(lines.length, rowsOf(root).length);
    assert.ok(lines.every((l) => /^G-\d+ (unknown|missing) \S/.test(l)), first.stdout);
    const before = gapsText(root);
    const second = await cli(root, ['gaps', 'scan']);
    assert.equal(second.code, 0, second.stdout + second.stderr);
    assert.equal(second.stdout, 'no new gaps\n');
    assert.equal(gapsText(root), before);
  });
});
