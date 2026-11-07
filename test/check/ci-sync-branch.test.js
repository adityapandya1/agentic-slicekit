// REQ-3.11: a `[sync]` title is the state sync pull request, accepted by ci-title only on a
// `sync/<short sha>` branch (D-78).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/check/context.js';
import ciTitle from '../../src/check/rules/ci-title.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const BODY = '**Done when:** the state matches the host.\n\n**Proof:** status --sync --write.\n\n**Decisions:** none.\n';

// ci-title on a pull_request event whose head branch is `ref`, titled `title`.
function judge(title, ref) {
  const repo = makeRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-sync-branch-'));
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const cfg = loadConfig(repo.root);
    const file = path.join(dir, 'event.json');
    fs.writeFileSync(file, JSON.stringify({ pull_request: { number: 9, title, body: BODY, head: { ref, sha: 'abc1234' }, user: { login: 'github-actions[bot]' } } }));
    const env = { GITHUB_EVENT_PATH: file, GITHUB_HEAD_REF: ref };
    return ciTitle.run(buildContext(repo.root, cfg, { ci: true, env }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    repo.cleanup();
  }
}

test('a [sync] title is accepted on a sync branch', () => {
  assert.deepEqual(judge('[sync] state after abc1234', 'sync/abc1234'), []);
});

test('a [sync] title on any other branch fails', () => {
  for (const ref of ['feature/x', 'slice/P1-S-01-x', 'sync/not-a-sha']) {
    const found = judge('[sync] state after abc1234', ref);
    assert.equal(found.length, 1, ref);
    assert.match(found[0].message, /a \[sync\] title belongs to a sync\/<short sha> branch/);
  }
});
