// REQ-3.11, REQ-2.8: the `ready` label is granted only when the latest verdict on the pull request's
// current head has no open blockers and, when the config requires one, an independent verdict on that
// head has none either. The CLI is information only: it always exits 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../src/init.js';
import { loadConfig } from '../src/config.js';
import { readSlice, writeSlice } from '../src/state/index.js';
import { decideReady } from '../src/ready-label.js';
import { githubHost } from '../src/adapters/githost/github.js';
import { fixtureHost } from '../src/adapters/githost/fixture.js';
import { GitHostError } from '../src/adapters/githost/errors.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';
import { writeSliceFixtures } from './helpers/slice-fixture.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const required = { review: { independent: 'required' } };
const optional = { review: { independent: 'optional' } };

const verdict = (round, blockers, { independent = false, headSha = HEAD } = {}) => ({
  round,
  path: `docs/reviews/r${round}.md`,
  blockers,
  independent,
  headSha,
});
const slice = (verdicts, headSha = HEAD) => ({ state: 'ci-green', pr: { number: 9, headSha }, verdicts });

test('label needs zero blockers and, when required, an independent verdict', () => {
  // REQ-3.11: the latest verdict on the current head decides; an independent one is needed when required.
  assert.deepEqual(decideReady(slice([]), required), { ready: false, reason: 'no review verdict on the current head' });
  assert.equal(decideReady(slice([verdict(1, 0, { independent: true }), verdict(2, 2)]), required).ready, false);
  assert.match(decideReady(slice([verdict(1, 0, { independent: true }), verdict(2, 2)]), required).reason, /2 open blockers/);
  assert.deepEqual(decideReady(slice([verdict(1, 0)]), required), { ready: false, reason: 'independent review missing' });
  assert.equal(decideReady(slice([verdict(1, 0)]), optional).ready, true);
  assert.equal(decideReady(slice([verdict(1, 0, { independent: true })]), required).ready, true);
  assert.equal(decideReady(slice([verdict(1, 0, { independent: true }), verdict(2, 0)]), required).ready, true);
  // An independent verdict with blockers does not count.
  assert.deepEqual(decideReady(slice([verdict(1, 1, { independent: true }), verdict(2, 0)]), required), {
    ready: false,
    reason: 'independent review missing',
  });
});

test('only verdicts on the current head count', () => {
  const old = [verdict(1, 0, { independent: true, headSha: OLD })];
  assert.deepEqual(decideReady(slice(old), required), { ready: false, reason: 'no review verdict on the current head' });
  // The event's head is the live one: it wins over the head the state recorded.
  const recorded = slice([verdict(1, 0, { independent: true })]);
  assert.equal(decideReady(recorded, required).ready, true);
  assert.deepEqual(decideReady(recorded, required, { headSha: OLD }), {
    ready: false,
    reason: 'no review verdict on the current head',
  });
  // A later verdict on an old head does not hide a clean one on the current head.
  const mixed = slice([verdict(1, 0, { independent: true }), verdict(2, 3, { headSha: OLD })]);
  assert.equal(decideReady(mixed, required).ready, true);
  // A state with no pull request has no current head.
  assert.equal(decideReady({ state: 'todo', pr: null, verdicts: [verdict(1, 0, { independent: true })] }, required).ready, false);
});

test('githubHost.setLabel runs gh pr edit with add or remove', () => {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    return '';
  };
  const host = githubHost({ X: '1' }, '/the/project', exec);
  host.setLabel(12, 'ready', true);
  host.setLabel(12, 'ready', false);
  assert.deepEqual(calls, [
    { cmd: 'gh', args: ['pr', 'edit', '12', '--add-label', 'ready'], cwd: '/the/project' },
    { cmd: 'gh', args: ['pr', 'edit', '12', '--remove-label', 'ready'], cwd: '/the/project' },
  ]);
  assert.throws(() => host.setLabel(0, 'ready', true), /positive integer/);
  assert.throws(() => host.setLabel(1, '', true), /label/);
  const failing = githubHost({}, '/p', () => {
    const e = new Error('exit 1');
    e.status = 1;
    e.stderr = "could not add label: 'ready' not found";
    throw e;
  });
  assert.throws(() => failing.setLabel(3, 'ready', true), (e) => e instanceof GitHostError && /not found/.test(e.message));
});

test('fixtureHost.setLabel records each call', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-labels-'));
  try {
    const host = fixtureHost(dir);
    host.setLabel(4, 'ready', true);
    host.setLabel(4, 'ready', false);
    assert.deepEqual(readCalls(dir), [
      { number: 4, name: 'ready', present: true },
      { number: 4, name: 'ready', present: false },
    ]);
    fs.writeFileSync(path.join(dir, 'label-error.txt'), "'ready' not found");
    assert.throws(() => host.setLabel(4, 'ready', true), (e) => e instanceof GitHostError && /not found/.test(e.message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function readCalls(dir) {
  const file = path.join(dir, 'label-calls.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// A kit with two slices, a temporary git host fixture, and a pull request event file.
function withCli(fn) {
  const repo = makeRepo();
  const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-host-'));
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const ids = writeSliceFixtures(repo.root, 2);
    const cfg = loadConfig(repo.root);
    const event = (title, { labels = [], number = 9, head = HEAD } = {}) => {
      const file = path.join(hostDir, 'event.json');
      fs.writeFileSync(
        file,
        JSON.stringify({ pull_request: { number, title, body: '', head: { sha: head }, labels: labels.map((name) => ({ name })) } }),
      );
      return file;
    };
    const run = (eventFile, env = {}) =>
      runCli(['ready-label'], {
        cwd: repo.root,
        env: { ...process.env, GH_TOKEN: '', GITHUB_EVENT_PATH: eventFile ?? '', SLICEKIT_GITHOST_FIXTURE: hostDir, SLICEKIT_CHECKS_FAILED: '', ...env },
      });
    return fn({ root: repo.root, cfg, ids, event, run, calls: () => readCalls(hostDir), hostDir });
  } finally {
    repo.cleanup();
    fs.rmSync(hostDir, { recursive: true, force: true });
  }
}

function park(root, cfg, id, verdicts) {
  writeSlice(root, cfg, { ...readSlice(root, cfg, id), state: 'ci-green', pr: { number: 9, headSha: HEAD }, verdicts });
}

test('ready-label: no pull request event does nothing', () => {
  withCli(({ run, calls, hostDir }) => {
    const push = path.join(hostDir, 'push.json');
    fs.writeFileSync(push, JSON.stringify({ ref: 'refs/heads/main' }));
    for (const r of [run(push, { GH_TOKEN: 't' }), run('', { GH_TOKEN: 't' })]) {
      assert.equal(r.code, 0);
      assert.match(r.stdout, /ready-label: not a pull request; nothing to do/);
    }
    assert.deepEqual(calls(), []);
  });
});

test('ready-label: a title without a slice id removes the label', () => {
  withCli(({ event, run, calls }) => {
    let r = run(event('Fix billing', { labels: ['ready'] }), { GH_TOKEN: 't' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /not ready: the title names no slice/);
    assert.deepEqual(calls(), [{ number: 9, name: 'ready', present: false }]);
    r = run(event('[spec] New spec', { labels: [] }), { GH_TOKEN: 't' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\[spec\] or \[plan\]/);
    assert.equal(calls().length, 1, 'no label to remove');
  });
});

test('ready-label: grants the label when the decision is ready, removes it when not', () => {
  withCli(({ root, cfg, ids, event, run, calls }) => {
    park(root, cfg, ids[0], [verdict(1, 0, { independent: true })]);
    let r = run(event(`[${ids[0]}] Fixture`), { GH_TOKEN: 't' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(`${ids[0]} ready`));
    assert.match(r.stdout, /added label ready to #9/);
    assert.deepEqual(calls(), [{ number: 9, name: 'ready', present: true }]);

    park(root, cfg, ids[0], [verdict(1, 0, { independent: true }), verdict(2, 1, { independent: true })]);
    r = run(event(`[${ids[0]}] Fixture`, { labels: ['ready'] }), { GH_TOKEN: 't' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /not ready: .*1 open blocker/);
    assert.match(r.stdout, /removed label ready from #9/);
    assert.deepEqual(calls().at(-1), { number: 9, name: 'ready', present: false });
  });
});

test('ready-label: a failed check is not ready', () => {
  withCli(({ root, cfg, ids, event, run, calls }) => {
    park(root, cfg, ids[0], [verdict(1, 0, { independent: true })]);
    const r = run(event(`[${ids[0]}] Fixture`, { labels: ['ready'] }), { GH_TOKEN: 't', SLICEKIT_CHECKS_FAILED: 'true' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /not ready: a required check failed/);
    assert.deepEqual(calls(), [{ number: 9, name: 'ready', present: false }]);
  });
});

test('ready-label: a slice with no state file is not ready', () => {
  withCli(({ ids, event, run }) => {
    const r = run(event(`[${ids[1]}] Fixture`));
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(`${ids[1]} not ready: slice ${ids[1]} has no state file`));
    const unknown = run(event('[P9/S-99] Ghost'));
    assert.equal(unknown.code, 0);
    assert.match(unknown.stdout, /not ready/);
  });
});

test('ready-label: without GH_TOKEN it only prints the decision', () => {
  withCli(({ root, cfg, ids, event, run, calls }) => {
    park(root, cfg, ids[0], [verdict(1, 0, { independent: true })]);
    const r = run(event(`[${ids[0]}] Fixture`));
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(`${ids[0]} ready`));
    assert.match(r.stdout, /GH_TOKEN not set; label left unchanged/);
    assert.deepEqual(calls(), []);
  });
});

test('ready-label: a host error is reported and still exits 0', () => {
  withCli(({ root, cfg, ids, event, run, hostDir }) => {
    park(root, cfg, ids[0], [verdict(1, 0, { independent: true })]);
    fs.writeFileSync(path.join(hostDir, 'label-error.txt'), "could not add label: 'ready' not found");
    const r = run(event(`[${ids[0]}] Fixture`), { GH_TOKEN: 't' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /'ready' not found/);
  });
});

test('ready-label: a broken event file is reported and still exits 0', () => {
  withCli(({ run, hostDir }) => {
    const bad = path.join(hostDir, 'bad.json');
    fs.writeFileSync(bad, '{ not json');
    const r = run(bad, { GH_TOKEN: 't' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /cannot read the GitHub event/);
  });
});
