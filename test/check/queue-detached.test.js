// REQ-1.6, REQ-3.7 (P8/S-58, review B-4): the CI test job checks out the pull request's merge commit
// with a detached HEAD, so the queue rule judges the pull request's head branch GITHUB_HEAD_REF names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { setState } from '../../src/state/index.js';
import { renderBuild } from '../../src/state/build.js';
import { buildContext } from '../../src/check/context.js';
import queue from '../../src/check/rules/queue.js';
import { makeRepo } from '../helpers/tmp-repo.js';
import { writeSliceFixtures } from '../helpers/slice-fixture.js';

const PR = { number: 14, url: 'http://x/14', headSha: 'abc1234', title: '[P1/S-01] x' };

// An initialised repo whose BUILD.md says `todo` for a slice the state file moved to `draft-pr`, on a
// detached HEAD; `fn` gets a function that runs the rule with the given environment.
function detachedStale(fn) {
  const repo = makeRepo({ commits: 1 });
  try {
    execFileSync('git', ['checkout', '-q', '--detach'], { cwd: repo.root, stdio: ['ignore', 'pipe', 'pipe'] });
    init(repo.root, { name: 'demo', shape: 'backend' });
    const ids = writeSliceFixtures(repo.root, 2);
    const cfg = loadConfig(repo.root);
    const build = path.join(repo.root, 'BUILD.md');
    fs.writeFileSync(build, renderBuild(repo.root, cfg, fs.existsSync(build) ? fs.readFileSync(build, 'utf8') : ''));
    setState(repo.root, cfg, ids[0], 'draft-pr', { backfill: true, testExit: 0, checkExit: 0, pr: PR });
    return fn((env) => queue.run(buildContext(repo.root, cfg, { env })));
  } finally {
    repo.cleanup();
  }
}

test('on a detached HEAD with GITHUB_HEAD_REF naming a slice branch the queue rule reports nothing', () => {
  detachedStale((run) => {
    assert.deepEqual(run({ GITHUB_HEAD_REF: 'slice/P1-S-01-x' }), []);
  });
});

test('on a detached HEAD without GITHUB_HEAD_REF the queue rule still reports', () => {
  detachedStale((run) => {
    const findings = run({});
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.match(findings[0].message, /row for P1\/S-01 says "Todo", state says "PR #14"/);
    assert.deepEqual(run({ GITHUB_HEAD_REF: 'feature/x' }).length, 1);
  });
});
