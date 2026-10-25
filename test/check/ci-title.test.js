import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { setState, writeSlice } from '../../src/state/index.js';
import { buildContext } from '../../src/check/context.js';
import { check } from '../../src/check/index.js';
import { readCiEvent } from '../../src/check/ci-event.js';
import ciTitle from '../../src/check/rules/ci-title.js';
import { makeRepo } from '../helpers/tmp-repo.js';
import { writeSliceFixtures } from '../helpers/slice-fixture.js';

const events = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ci-events');
const FILE = '.github/pull_request';
const PR = { number: 14, url: 'http://x/14', headSha: 'abc1234', title: '[P1/S-01] x' };

// An initialised repo with two slice files (P1/S-01, P1/S-02), neither with a state file yet.
function withKit(fn) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    writeSliceFixtures(repo.root, 2);
    const cfg = loadConfig(repo.root);
    const run = (env, ci = true) => ciTitle.run(buildContext(repo.root, cfg, { ci, env }));
    return fn({ root: repo.root, cfg, run });
  } finally {
    repo.cleanup();
  }
}

const titled = (title) => ({ SLICEKIT_PR_TITLE: title });
const toDraftPr = (root, cfg, id) => setState(root, cfg, id, 'draft-pr', { backfill: true, testExit: 0, checkExit: 0, pr: PR });

test('the rule is blocking and not a ratchet', () => {
  assert.equal(ciTitle.id, 'ci-title');
  assert.equal(ciTitle.blocking, true);
  assert.equal(ciTitle.ratchet, false);
});

// REQ-3.11: "GIVEN a pull request titled `Fix billing` WHEN CI runs THEN it fails with
// "title must begin with [P<n>/S-<nn>]"".
test('title without slice id is a finding', () => {
  withKit(({ run }) => {
    const want = [{ file: FILE, line: 0, message: 'title must begin with [P<n>/S-<nn>]' }];
    assert.deepEqual(run({ GITHUB_EVENT_PATH: path.join(events, 'pr-no-slice.json') }), want);
    assert.deepEqual(run(titled('[fix] billing')), want);
    assert.deepEqual(run(titled('[spec]Write')), want);
    assert.deepEqual(run(titled('see [P1/S-01] later')), want);
  });
});

// REQ-3.11: the slice's state must be at least `draft-pr`.
test('slice before draft-pr is a finding', () => {
  withKit(({ root, cfg, run }) => {
    writeSlice(root, cfg, { slice: 'P1/S-01', state: 'tests-red' });
    assert.deepEqual(run(titled('[P1/S-01] Fixture 1')), [
      { file: FILE, line: 0, message: 'slice P1/S-01 is tests-red; open the pull request through /slicekit build' },
    ]);
  });
});

test('a slice at draft-pr or later passes', () => {
  withKit(({ root, cfg, run }) => {
    toDraftPr(root, cfg, 'P1/S-01');
    assert.deepEqual(run(titled('[P1/S-01] Fixture 1')), []);
    writeSlice(root, cfg, { slice: 'P1/S-01', state: 'ci-green' });
    assert.deepEqual(run(titled('[P1/S-01] Fixture 1')), []);
  });
});

test('a slice with no state file is a finding', () => {
  withKit(({ run }) => {
    assert.deepEqual(run(titled('[P1/S-02] Fixture 2')).map((f) => f.message), ['slice P1/S-02 has no state file']);
  });
});

test('a slice that does not exist is a finding', () => {
  withKit(({ run }) => {
    assert.deepEqual(run(titled('[P1/S-09] Ghost')).map((f) => f.message), ['slice P1/S-09 has no slice file']);
  });
});

test('[spec] and [plan] titles are exempt from the slice rule', () => {
  withKit(({ run }) => {
    assert.deepEqual(run(titled('[spec] Write the spec')), []);
    assert.deepEqual(run(titled('[plan] Plan phase 1')), []);
  });
});

test('outside --ci the rule does nothing', () => {
  withKit(({ run }) => assert.deepEqual(run(titled('Fix billing'), false), []));
});

test('a push event has no pull request and no findings', () => {
  withKit(({ run }) => assert.deepEqual(run({ GITHUB_EVENT_PATH: path.join(events, 'push.json') }), []));
});

test('a draft pull request with a null body is judged like any other', () => {
  withKit(({ root, cfg, run }) => {
    const env = { GITHUB_EVENT_PATH: path.join(events, 'pr-null-body.json') };
    assert.deepEqual(run(env).map((f) => f.message), ['slice P1/S-01 has no state file']);
    toDraftPr(root, cfg, 'P1/S-01');
    assert.deepEqual(run(env), []);
  });
});

// CI must not pass on an event it cannot read: the rule crashes, and the runner blocks on it.
test('a broken or missing event file is a blocking finding through the runner', () => {
  withKit(({ root }) => {
    for (const p of [path.join(events, 'broken.json'), path.join(events, 'absent.json')]) {
      const r = check(root, { ci: true, env: { GITHUB_EVENT_PATH: p }, rules: [ciTitle] });
      assert.equal(r.exitCode, 1);
      assert.equal(r.blocking, 1);
      assert.match(r.findings[0].message, /^rule ci-title crashed: /);
    }
  });
});

test('readCiEvent reads the pull request fields', () => {
  const ev = readCiEvent({ GITHUB_EVENT_PATH: path.join(events, 'pr-complete.json') });
  assert.equal(ev.number, 6);
  assert.equal(ev.headSha, '0123456789abcdef0123456789abcdef01234567');
  assert.deepEqual(ev.labels, ['ready']);
  assert.match(ev.title, /^\[P1\/S-06\] /);
  assert.match(ev.body, /^## \[P1\/S-06\]/);
  assert.equal(readCiEvent({ GITHUB_EVENT_PATH: path.join(events, 'pr-null-body.json') }).body, '');
  assert.equal(readCiEvent({ GITHUB_EVENT_PATH: path.join(events, 'push.json') }), null);
  assert.equal(readCiEvent({}), null);
});

test('readCiEvent uses the local override only when no event file is set', () => {
  assert.deepEqual(readCiEvent({ SLICEKIT_PR_TITLE: 't', SLICEKIT_PR_BODY: 'b' }), { title: 't', body: 'b', number: null, headSha: null, labels: [], author: null });
  assert.equal(readCiEvent({ SLICEKIT_PR_BODY: 'b' }).title, '');
  assert.equal(readCiEvent({ GITHUB_EVENT_PATH: path.join(events, 'push.json'), SLICEKIT_PR_TITLE: 'Fix billing' }), null);
});

test('readCiEvent refuses a pull request without a string title', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-ev-'));
  try {
    const p = path.join(dir, 'e.json');
    fs.writeFileSync(p, JSON.stringify({ pull_request: { number: 1, body: '' } }));
    assert.throws(() => readCiEvent({ GITHUB_EVENT_PATH: p }), /title/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Fix round 1: a merged or released slice is finished; a change after merge needs its own slice.
test('a merged or released slice is a finding', () => {
  withKit(({ root, cfg, run }) => {
    for (const state of ['merged', 'released']) {
      writeSlice(root, cfg, { slice: 'P1/S-01', state });
      assert.deepEqual(run(titled('[P1/S-01] Fixture 1')).map((f) => f.message), [`slice P1/S-01 is ${state}; a change after merge needs its own slice`]);
    }
  });
});

// D-37: a pull request opened by a listed bot is exempt from the title and body rules.
test('readCiEvent reads the author login', () => {
  assert.equal(readCiEvent({ GITHUB_EVENT_PATH: path.join(events, 'pr-bot.json') }).author, 'dependabot[bot]');
  assert.equal(readCiEvent({ GITHUB_EVENT_PATH: path.join(events, 'pr-complete.json') }).author, null);
});

test('a pull request from a listed bot is exempt from ci-title (D-37)', () => {
  withKit(({ root, cfg }) => {
    const bot = { GITHUB_EVENT_PATH: path.join(events, 'pr-bot.json') };
    const runWith = (c) => ciTitle.run(buildContext(root, c, { ci: true, env: bot }));
    assert.deepEqual(runWith(cfg), [], 'dependabot[bot] is in the default list');
    assert.deepEqual(runWith({ ...cfg, ci: { ...cfg.ci, botActors: ['renovate[bot]'] } }), [
      { file: FILE, line: 0, message: 'title must begin with [P<n>/S-<nn>]' },
    ]);
    const { botActors, ...noList } = cfg.ci;
    assert.deepEqual(runWith({ ...cfg, ci: noList }), [], 'an absent list is the default');
  });
});
