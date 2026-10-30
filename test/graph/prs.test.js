import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pullRequestNodes } from '../../src/graph/prs.js';

// A host that answers each call with the next answer in `answers` and counts the calls.
function scriptedHost(answers) {
  const host = { calls: 0, getPullRequest: () => answers[Math.min(host.calls++, answers.length - 1)] };
  return host;
}
const pr = (state, mergedAt = null) => ({ number: 1, title: '[P1/S-01] a', state, mergedAt, headSha: 'a'.repeat(40), url: 'https://example.test/pull/1' });
const refs = new Map([[1, { key: 'a'.repeat(40), releases: [] }]]);

// S-17 review H-1: a merge does not move the recorded head, so an open answer must be asked again.
test('a pull request cached while open is fetched again and shows its merge', () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-prs-'));
  try {
    const host = scriptedHost([pr('OPEN'), pr('MERGED', '2026-10-30T10:00:00Z')]);
    const first = pullRequestNodes(refs, { host, cacheDir });
    assert.equal(first.nodes[0].state, 'OPEN');
    const second = pullRequestNodes(refs, { host, cacheDir });
    assert.equal(host.calls, 2);
    assert.equal(second.nodes[0].state, 'MERGED');
    assert.equal(second.nodes[0].mergedAt, '2026-10-30T10:00:00Z');
    // Once merged the answer is final: a third build asks nothing.
    pullRequestNodes(refs, { host, cacheDir });
    assert.equal(host.calls, 2);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
