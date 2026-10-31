// REQ-2.6 step 9: `build finish` and `status --sync` drive the fixture host with CI records that carry
// workflowName and event, as gh prints them: a run replaced by a newer run of the same workflow is
// not the commit's answer (issue #43).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { getHost } from '../src/adapters/githost/index.js';
import { git } from '../src/git.js';
import { cli, green, stateIn, write } from './helpers/build-flow.js';
import { runCli } from './helpers/run-cli.js';

const OLD_URL = 'https://example.test/runs/11';
const RUN_URL = 'https://example.test/runs/12';

function verdictText(head) {
  return [
    'Verdict: APPROVE',
    `Head: ${head}`,
    '',
    '| ID | File:line | What is wrong | Why it matters | How verified |',
    '|---|---|---|---|---|',
    '',
    '## Checklists run',
    '',
    '- correctness',
    '',
    '## Not checked',
    '',
    '- performance',
    '',
  ].join('\n');
}

const prFile = (p) => path.join(p.host, 'pr-1.json');
function editPr(p, over) {
  const raw = JSON.parse(fs.readFileSync(prFile(p), 'utf8'));
  fs.writeFileSync(prFile(p), `${JSON.stringify({ ...raw, ...over }, null, 2)}\n`);
}

// gh's runs of `sha`: an older run of the slicekit workflow cancelled by the newer one, which succeeded.
function ciRecords(p, sha) {
  const common = { status: 'completed', workflowName: 'slicekit', event: 'pull_request', workflowDatabaseId: 77 };
  write(
    p.host,
    `ci-${sha}.json`,
    JSON.stringify([
      { ...common, databaseId: 12, conclusion: 'success', url: RUN_URL, createdAt: '2026-10-30T10:05:00Z', startedAt: '2026-10-30T10:05:00Z' },
      { ...common, databaseId: 11, conclusion: 'cancelled', url: OLD_URL, createdAt: '2026-10-30T10:00:00Z', startedAt: '2026-10-30T10:00:00Z' },
    ]),
  );
}

test('build finish and status --sync read the newest run of each workflow from the fixture host', async () => {
  const p = await green();
  try {
    const opened = await p.pr();
    assert.equal(opened.code, 0, opened.stderr);
    const rel = '.slicekit/reviews/P1-S-01-r1.md';
    write(p.root, rel, verdictText(git(p.wt, ['rev-parse', 'HEAD'])));
    const v = await cli(p.root, ['build', 'verdict', 'P1/S-01', rel], p.env);
    assert.equal(v.code, 0, v.stderr);
    const head = git(p.wt, ['rev-parse', 'HEAD']);
    editPr(p, { headRefOid: head });
    ciRecords(p, head);

    const done = await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);
    assert.equal(done.code, 0, done.stderr);
    assert.ok(done.stdout.startsWith(`ci-green\n${RUN_URL}\n`), done.stdout);
    assert.equal(stateIn(p.wt).state, 'ci-green');
    assert.deepEqual(stateIn(p.wt).ci, { sha: head, status: 'success', url: RUN_URL });

    // status --sync reads the same host: the merge is synced, and its CI answer for the head is success.
    const host = getHost(loadConfig(p.wt), p.env, p.wt);
    assert.deepEqual(host.ciStatus(head), { status: 'success', url: RUN_URL });
    editPr(p, { state: 'MERGED', mergedAt: '2026-10-30T12:00:00Z' });
    const synced = runCli(['status', '--sync'], { cwd: p.wt, env: p.env });
    assert.equal(synced.code, 0, synced.stderr);
    assert.ok(synced.stdout.includes('synced P1/S-01 → merged (PR #1)'), synced.stdout);
    assert.equal(stateIn(p.wt).state, 'merged');
  } finally {
    p.cleanup();
  }
});
