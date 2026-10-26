import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../src/cli/index.js';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { unsupportedReqs } from '../../src/spec-verify.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const INTAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'stage', 'after-intake');
const SNAPSHOT = 'docs/intake/2026-01-01-brief.md';

async function cli(root, args) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

// An initialised repository with a pinned intake snapshot.
async function withProgram(fn) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend', env: {} });
    fs.cpSync(INTAKE, repo.root, { recursive: true });
    return await fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

// Writes decisions.md with D-01 settled and, when `open` is set, D-02 in the Open table.
function writeDecisions(root, { open = false } = {}) {
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
    ...(open ? ['| D-02 | Decision | Which carrier? | Cost | Pick one |'] : []),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'docs/decisions.md'), text);
}

const req = (id, claim, cites) =>
  `## ${id} ${claim}\n\nThe system SHALL ${claim}.\n\nScenario: it happens.\n\nCites: ${cites}\n\nEnforced by: \`x.test.js\`\n`;

function writeSpec(root, body) {
  fs.mkdirSync(path.join(root, 'docs/spec'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/spec/01-orders.md'), `# Orders\n\n${body}`);
}

test('a claim no intake sentence or decision supports is written as a clarification marker, not guessed', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    writeSpec(root, `${req('REQ-1.1', 'store orders', 'D-01')}\n${req('REQ-1.2', 'ship within a day', 'D-99')}`);
    const bad = await cli(root, ['spec', 'verify']);
    assert.equal(bad.code, 1, bad.stdout + bad.stderr);
    const findings = (bad.stdout + bad.stderr).trim().split('\n');
    assert.equal(findings.length, 1, findings.join('\n'));
    assert.match(findings[0], /^docs\/spec\/01-orders\.md:\d+ REQ-1\.2 cites nothing that exists; write \[NEEDS CLARIFICATION: <question>\] instead of a guess$/);

    const marker = '[NEEDS CLARIFICATION: how fast must orders ship?]';
    writeSpec(root, `${req('REQ-1.1', 'store orders', 'D-01')}\n${req('REQ-1.2', `ship orders ${marker}`, SNAPSHOT)}`);
    const ok = await cli(root, ['spec', 'verify']);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    const out = ok.stdout.trim().split('\n');
    assert.equal(out[0], 'spec verified: 2 REQ, 0 contracts, 2 clarification markers');
    assert.ok(out.slice(1).every((l) => l.startsWith('docs/spec/01-orders.md:') && l.endsWith(marker)), out.join('\n'));
  });
});

test('verify refuses while clarify is not done', async () => {
  await withProgram(async (root) => {
    writeDecisions(root, { open: true });
    writeSpec(root, req('REQ-1.1', 'ship orders', 'D-02'));
    const r = await cli(root, ['spec', 'verify']);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /^-:0 clarify not done: D-02 is Open and cited by the spec$/m);
  });
});

test('spec verify refuses a bad usage with exit 2', async () => {
  await withProgram(async (root) => {
    assert.equal((await cli(root, ['spec'])).code, 2);
    assert.equal((await cli(root, ['spec', 'verify', 'extra'])).code, 2);
    assert.equal((await cli(root, ['spec', 'check'])).code, 2);
  });
});

// The forms a Cites entry may take, each on its own REQ, and whether it is supported. `check`'s
// citation rule and `spec verify` share one resolver, so the two agree on every form.
const FORMS = [
  ['REQ-1.1', 'docs/intake/2026-01-01-brief.md', true],
  ['REQ-1.2', 'intake/2026-01-01-brief.md', true],
  ['REQ-1.3', '2026-01-01-brief.md', true],
  ['REQ-1.4', '[the brief](../intake/2026-01-01-brief.md)', true],
  ['REQ-1.5', 'docs/intake/2026-01-01-brief.md.meta.json', true],
  ['REQ-1.11', '../intake/2026-01-01-brief.md', true],
  ['REQ-1.6', 'D-01', true],
  ['REQ-1.7', 'D-99, D-01', true],
  ['REQ-1.8', 'D-99', false],
  ['REQ-1.9', 'docs/intake/none.md', false],
  ['REQ-1.10', 'docs/decisions.md', false],
];

test('every Cites form resolves the way the citation rule resolves it', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    writeSpec(root, FORMS.map(([id, cites]) => req(id, 'x', cites)).join('\n'));
    const got = unsupportedReqs(root, loadConfig(root));
    assert.deepEqual(got.map((r) => r.req), FORMS.filter(([, , ok]) => !ok).map(([id]) => id));
    assert.ok(got.every((r) => r.file === 'docs/spec/01-orders.md' && r.line > 0));
  });
});

test('check and spec verify agree on every Cites form', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    writeSpec(root, FORMS.map(([id, cites]) => req(id, 'x', cites)).join('\n'));
    const ch = await cli(root, ['check', '--json']);
    const findings = JSON.parse(ch.stdout).findings.filter((f) => f.rule === 'citations');
    // check flags each cited decision or intake file it cannot find, or the entry when it names
    // none; spec verify calls a REQ unsupported when nothing it cites resolves. They agree when
    // the REQs spec verify names are the ones check flags on every reference.
    const refs = (cites) => cites.split(/[\s,]+/).filter((t) => /D-\d|intake\/|^\d{4}-/.test(t)).length;
    const flaggedByCheck = FORMS.filter(([id, cites]) => findings.filter((f) => f.message.startsWith(`${id} `)).length >= Math.max(1, refs(cites))).map(([id]) => id);
    const sv = await cli(root, ['spec', 'verify']);
    const byVerify = FORMS.map(([id]) => id).filter((id) => new RegExp(`:\\d+ ${id} cites nothing`).test(sv.stdout));
    assert.deepEqual(byVerify, flaggedByCheck, JSON.stringify(findings.map((f) => f.message)));
    assert.deepEqual(byVerify, FORMS.filter(([, , ok]) => !ok).map(([id]) => id));
  });
});

test('a nested REQ heading ends the block above it', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    writeSpec(root, `## REQ-1.1 outer\n\nThe system SHALL x.\n\nScenario: y.\n\nCites: D-99\n\nEnforced by: \`x.test.js\`\n\n### REQ-1.2 inner\n\nThe system SHALL z.\n\nScenario: y.\n\nCites: D-01\n\nEnforced by: \`x.test.js\`\n`);
    assert.deepEqual(unsupportedReqs(root, loadConfig(root)).map((r) => r.req), ['REQ-1.1']);
  });
});

test('a REQ in a contract is not read as part of the spec', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    writeSpec(root, req('REQ-1.1', 'x', 'D-01'));
    fs.mkdirSync(path.join(root, 'docs/spec/contracts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/spec/contracts/orders.md'), `# Orders topic\n\n${req('REQ-9.1', 'y', 'D-99')}`);
    const r = await cli(root, ['spec', 'verify']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^spec verified: 1 REQ, 1 contracts, 0 clarification markers$/m);
  });
});

test('a marker in a code span is not counted and a wrapped marker counts once at its first line', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    writeSpec(root, `${req('REQ-1.1', 'x', 'D-01')}\nWrite \`[NEEDS CLARIFICATION: <q>]\` for a gap.\n\nShips [NEEDS CLARIFICATION: how fast\nmust orders ship?] soon.\n`);
    const r = await cli(root, ['spec', 'verify']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = r.stdout.trim().split('\n');
    assert.equal(out[0], 'spec verified: 1 REQ, 0 contracts, 1 clarification markers');
    const at = fs.readFileSync(path.join(root, 'docs/spec/01-orders.md'), 'utf8').split('\n').findIndex((l) => l.startsWith('Ships')) + 1;
    assert.equal(out[1], `docs/spec/01-orders.md:${at} [NEEDS CLARIFICATION: how fast must orders ship?]`);
  });
});

test('the kit spec has no clarification marker', async () => {
  const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { verifySpec } = await import('../../src/spec-verify.js');
  assert.deepEqual(verifySpec(kit, loadConfig(kit)).markers, []);
});
