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
import { TransitionError, readSlice, setState, writeSlice } from '../src/state/index.js';
import { READY_LABEL_COLOR, READY_LABEL_DESCRIPTION, decideReady } from '../src/ready-label.js';
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
    reason: 'independent review found 1 blocker',
  });
});

test('the latest independent verdict on the head decides, not any earlier one', () => {
  const vs = [verdict(1, 0, { independent: true }), verdict(2, 2, { independent: true }), verdict(3, 0)];
  assert.deepEqual(decideReady(slice(vs), required), { ready: false, reason: 'independent review found 2 blockers' });
  assert.equal(decideReady(slice(vs), optional).ready, true);
});

test('a missing review config counts as independent review required', () => {
  assert.deepEqual(decideReady(slice([verdict(1, 0)]), {}), { ready: false, reason: 'independent review missing' });
  assert.equal(decideReady(slice([verdict(1, 0, { independent: true })]), {}).ready, true);
});

test('a slice outside the review states, or another pull request, is not ready', () => {
  const clean = [verdict(1, 0, { independent: true })];
  for (const st of ['todo', 'tests-red', 'building', 'merged', 'released']) {
    const d = decideReady({ ...slice(clean), state: st }, required);
    assert.equal(d.ready, false, st);
    assert.match(d.reason, new RegExp(`is ${st}`));
  }
  for (const st of ['draft-pr', 'in-review', 'changes-requested', 'ci-green', 'ready']) {
    assert.equal(decideReady({ ...slice(clean), state: st }, required, { number: 9 }).ready, true, st);
  }
  assert.deepEqual(decideReady(slice(clean), required, { number: 10 }), {
    ready: false,
    reason: 'the state records pull request #9, not #10',
  });
  assert.equal(decideReady(slice(clean), required, { number: null }).ready, false);
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
        env: { ...process.env, GH_TOKEN: '', GITHUB_EVENT_PATH: eventFile ?? '', SLICEKIT_GITHOST_FIXTURE: hostDir, SLICEKIT_CHECKS_OK: 'true', ...env },
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
    assert.deepEqual(calls(), [CREATE, { number: 9, name: 'ready', present: true }]);

    park(root, cfg, ids[0], [verdict(1, 0, { independent: true }), verdict(2, 1, { independent: true })]);
    r = run(event(`[${ids[0]}] Fixture`, { labels: ['ready'] }), { GH_TOKEN: 't' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /not ready: .*1 open blocker/);
    assert.match(r.stdout, /removed label ready from #9/);
    assert.deepEqual(calls().at(-1), { number: 9, name: 'ready', present: false });
  });
});

test('ready-label: unless the checks are reported as passed, it is not ready', () => {
  withCli(({ root, cfg, ids, event, run, calls }) => {
    park(root, cfg, ids[0], [verdict(1, 0, { independent: true })]);
    // Fail closed: anything but the string true, including no value at all.
    for (const ok of ['false', 'True', '', undefined]) {
      const r = run(event(`[${ids[0]}] Fixture`, { labels: ['ready'] }), { GH_TOKEN: 't', SLICEKIT_CHECKS_OK: ok });
      assert.equal(r.code, 0);
      assert.match(r.stdout, /not ready: a required check did not pass/, String(ok));
    }
    assert.equal(calls().length, 4);
    assert.ok(calls().every((c) => c.present === false));
  });
});

test('ready-label: an event for another pull request than the one recorded is not ready', () => {
  withCli(({ root, cfg, ids, event, run }) => {
    park(root, cfg, ids[0], [verdict(1, 0, { independent: true })]);
    const r = run(event(`[${ids[0]}] Fixture`, { number: 12 }));
    assert.match(r.stdout, /not ready: the state records pull request #9, not #12/);
  });
});

test('ready needs the latest independent verdict on the head to be clean', () => {
  withCli(({ root, cfg, ids }) => {
    const vs = [verdict(1, 0, { independent: true }), verdict(2, 2, { independent: true }), verdict(3, 0)];
    writeSlice(root, cfg, { ...readSlice(root, cfg, ids[0]), state: 'ci-green', pr: { number: 9, headSha: HEAD }, verdicts: vs });
    assert.throws(() => setState(root, cfg, ids[0], 'ready', {}), (e) => e instanceof TransitionError && /found 2 blockers/.test(e.message));
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
    // I2: a GitHub annotation on stdout, so the failure shows on the run's summary page.
    assert.match(r.stdout, /^::warning title=slicekit ready-label::could not add the label: gh pr edit failed: could not add label: 'ready' not found$/m);
  });
});

const CREATE = { create: 'ready', color: '0e8a16', description: 'slicekit: reviewed and green' };

test('the ready label is created green with a fixed description (I2)', () => {
  assert.equal(READY_LABEL_COLOR, '0e8a16');
  assert.equal(READY_LABEL_DESCRIPTION, 'slicekit: reviewed and green');
});

test('githubHost.ensureLabel runs gh label create --force', () => {
  const calls = [];
  const host = githubHost({}, '/the/project', (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    return '';
  });
  host.ensureLabel('ready', { color: '0e8a16', description: 'slicekit: reviewed and green' });
  assert.deepEqual(calls, [
    {
      cmd: 'gh',
      args: ['label', 'create', 'ready', '--color', '0e8a16', '--description', 'slicekit: reviewed and green', '--force'],
      cwd: '/the/project',
    },
  ]);
  assert.throws(() => host.ensureLabel('', { color: '0e8a16', description: 'd' }), /label/);
  assert.throws(() => host.ensureLabel('ready', { color: 'green', description: 'd' }), /color/);
  const failing = githubHost({}, '/p', () => {
    const e = new Error('exit 1');
    e.status = 1;
    e.stderr = 'HTTP 403: Resource not accessible by integration';
    throw e;
  });
  assert.throws(() => failing.ensureLabel('ready', { color: '0e8a16', description: 'd' }), (e) => e instanceof GitHostError && /gh label create failed: HTTP 403/.test(e.message));
});

test('fixtureHost.ensureLabel records the call, or refuses as gh would', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-labels-'));
  try {
    const host = fixtureHost(dir);
    host.ensureLabel('ready', { color: '0e8a16', description: 'slicekit: reviewed and green' });
    assert.deepEqual(readCalls(dir), [CREATE]);
    fs.writeFileSync(path.join(dir, 'label-create-error.txt'), 'HTTP 403');
    assert.throws(() => host.ensureLabel('ready', { color: '0e8a16', description: 'd' }), (e) => e instanceof GitHostError && /gh label create failed: HTTP 403/.test(e.message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ready-label: a failed label create is a warning, and adding is still tried (I2)', () => {
  withCli(({ root, cfg, ids, event, run, calls, hostDir }) => {
    park(root, cfg, ids[0], [verdict(1, 0, { independent: true })]);
    fs.writeFileSync(path.join(hostDir, 'label-create-error.txt'), 'HTTP 403: Resource not accessible by integration');
    const r = run(event(`[${ids[0]}] Fixture`), { GH_TOKEN: 't' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^::warning title=slicekit ready-label::could not create the label: gh label create failed: HTTP 403: Resource not accessible by integration$/m);
    assert.deepEqual(calls(), [{ number: 9, name: 'ready', present: true }]);
  });
});

test('ready-label: removing the label creates nothing', () => {
  withCli(({ root, cfg, ids, event, run, calls }) => {
    park(root, cfg, ids[0], [verdict(1, 2, { independent: true })]);
    run(event(`[${ids[0]}] Fixture`, { labels: ['ready'] }), { GH_TOKEN: 't' });
    assert.deepEqual(calls(), [{ number: 9, name: 'ready', present: false }]);
  });
});

test('ready-label: a warning annotation escapes what would end or break it', () => {
  withCli(({ root, cfg, ids, event, run, hostDir }) => {
    park(root, cfg, ids[0], [verdict(1, 0, { independent: true })]);
    fs.writeFileSync(path.join(hostDir, 'label-error.txt'), '100% wrong\r\nnext');
    const r = run(event(`[${ids[0]}] Fixture`), { GH_TOKEN: 't' });
    assert.match(r.stdout, /^::warning title=slicekit ready-label::could not add the label: gh pr edit failed: 100%25 wrong%0D%0Anext$/m);
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
