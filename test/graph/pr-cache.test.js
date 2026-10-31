// REQ-4.2: the pull request cache holds the git host's answer alone (P3/S-34, issue #38). No code
// reads a cache key, so `key` leaves the cache entry, prNumbers' entries and the state fragment's pull
// request references; an entry written earlier with a `key` still reads as a cached answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stateFragment } from '../../src/graph/kitfiles.js';
import { prNumbers, pullRequestNodes } from '../../src/graph/prs.js';

const pr = (n, state) => ({ number: n, title: `[P1/S-0${n}] a`, state, mergedAt: state === 'MERGED' ? '2026-10-30T10:00:00Z' : null, headSha: 'a'.repeat(40), url: `https://example.test/pull/${n}` });

test('a cache entry holds the answer alone, and an entry with a key still reads', () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-pr-cache-'));
  try {
    // The state fragment's reference and prNumbers' entry carry no key.
    const state = { slice: 'P1/S-01', state: 'merged', pr: { number: 1, url: 'https://example.test/pull/1', headSha: 'a'.repeat(40) }, history: [] };
    const frag = stateFragment('.slicekit/state/P1-S-01.json', `${JSON.stringify(state, null, 2)}\n`);
    assert.deepEqual(frag.prRefs, [{ number: 1, at: '.slicekit/state/P1-S-01.json:5', slice: 'slice:P1/S-01' }]);
    const refs = prNumbers([frag], [{ sha: 'c'.repeat(40), subject: 'Merge pull request #2 from acme/x' }]);
    assert.deepEqual([...refs], [
      [1, { at: '.slicekit/state/P1-S-01.json:5', slice: 'slice:P1/S-01', sliceAt: '.slicekit/state/P1-S-01.json:5', releases: [] }],
      [2, { at: 'c'.repeat(40), slice: null, sliceAt: null, releases: [] }],
    ]);

    // A fetched answer is written as {pr} alone.
    const host = { calls: 0, getPullRequest: (n) => (host.calls++, { ...pr(n, 'MERGED'), body: 'Slice: P1/S-01' }) };
    const first = pullRequestNodes(new Map([[1, refs.get(1)]]), { host, cacheDir });
    assert.equal(first.fetched, 1);
    const entry = JSON.parse(fs.readFileSync(path.join(cacheDir, 'pr-1.json'), 'utf8'));
    assert.deepEqual(entry, { pr: pr(1, 'MERGED') });

    // An entry written before, with a key, still reads: merged, it is final and the host is not asked
    // (only a merged answer is final, D-52).
    fs.writeFileSync(path.join(cacheDir, 'pr-2.json'), `${JSON.stringify({ key: 'c'.repeat(40), pr: pr(2, 'MERGED') }, null, 2)}\n`);
    const again = pullRequestNodes(new Map([[2, refs.get(2)]]), { host, cacheDir });
    assert.equal(host.calls, 1);
    assert.deepEqual([again.fetched, again.cached], [0, 1]);
    assert.equal(again.nodes[0].state, 'MERGED');
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
