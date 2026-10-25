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

test('a Cites entry resolves against the spec file directory, then the root, and only under intake', async () => {
  await withProgram(async (root) => {
    writeDecisions(root);
    writeSpec(
      root,
      [
        req('REQ-1.1', 'a', '../intake/2026-01-01-brief.md'),
        req('REQ-1.2', 'b', '`docs/intake/2026-01-01-brief.md:1`'),
        req('REQ-1.3', 'c', 'docs/decisions.md'),
        req('REQ-1.4', 'd', 'D-99, docs/intake/none.md'),
        req('REQ-1.5', 'e', 'D-99, D-01'),
      ].join('\n'),
    );
    const got = unsupportedReqs(root, loadConfig(root));
    assert.deepEqual(got.map((r) => r.req), ['REQ-1.3', 'REQ-1.4']);
    assert.ok(got.every((r) => r.file === 'docs/spec/01-orders.md' && r.line > 0));
  });
});
