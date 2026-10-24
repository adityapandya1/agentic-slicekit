import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { init } from '../src/init.js';
import { loadConfig } from '../src/config.js';
import { kitPaths } from '../src/paths.js';
import { STATES, nextStates } from '../src/state/transitions.js';
import { readSlice, listSlices, setState, unfreeze, TransitionError } from '../src/state/index.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli, binPath } from './helpers/run-cli.js';
import { writeSliceFixture, writeSliceFixtures } from './helpers/slice-fixture.js';

function withKit(fn, { slices = 1, freeze = true } = {}) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const cfgFile = path.join(repo.root, '.slicekit', 'config.json');
    const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    raw.freezeTests = freeze;
    fs.writeFileSync(cfgFile, JSON.stringify(raw, null, 2));
    const ids = writeSliceFixtures(repo.root, slices);
    return fn(repo.root, loadConfig(repo.root), ids);
  } finally {
    repo.cleanup();
  }
}

const refusal = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof TransitionError, `expected TransitionError, got ${e}`);
    return e.reason;
  }
  return assert.fail('expected a refusal');
};

const PR = { number: 7, url: 'http://x/7', headSha: 'abc', title: '[P1/S-01] thing' };
const verdict = (root, round, blockers, independent = true) => {
  fs.writeFileSync(path.join(root, `v${round}.md`), '');
  return { verdict: { round, path: `v${round}.md`, blockers, independent } };
};

function toDraftPr(root, cfg, id) {
  fs.writeFileSync(path.join(root, 'a.test.js'), '');
  setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1, tests: ['a.test.js'] });
  setState(root, cfg, id, 'building', {});
  return setState(root, cfg, id, 'draft-pr', { testExit: 0, checkExit: 0, pr: PR });
}

test('states are the ten in order', () => {
  assert.equal(STATES.length, 10);
  assert.equal(STATES[0], 'todo');
  assert.deepEqual(nextStates('todo'), ['tests-red']);
  assert.deepEqual(nextStates('in-review').sort(), ['changes-requested', 'ci-green', 'draft-pr']);
  assert.deepEqual(nextStates('released'), []);
});

test('readSlice defaults to todo; unknown slice throws', () => {
  withKit((root, cfg, [id]) => {
    const s = readSlice(root, cfg, id);
    assert.equal(s.state, 'todo');
    assert.deepEqual(s.history, []);
    assert.deepEqual(s.frozenTests, []);
    assert.throws(() => readSlice(root, cfg, 'P9/S-99'), /unknown slice P9\/S-99/);
    assert.deepEqual(listSlices(root, cfg).map((x) => x.state.state), ['todo']);
  });
});

test('todo to tests-red needs a failing run and tests', () => {
  withKit((root, cfg, [id]) => {
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 0, tests: ['a'] })), /non-zero/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { testExit: 1, tests: ['a'] })), /commit/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1, tests: [] })), /tests/);
    const s = setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1, tests: ['a.test.js'] });
    assert.equal(s.state, 'tests-red');
    assert.equal(s.redCommit, 'c1');
    assert.deepEqual(s.frozenTests, ['a.test.js']);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].by, 'cli');
    assert.equal(readSlice(root, cfg, id).state, 'tests-red');
  });
});

test('building needs the frozen tests present when freezeTests', () => {
  withKit((root, cfg, [id]) => {
    setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1, tests: ['a.test.js'] });
    assert.match(refusal(() => setState(root, cfg, id, 'building', {})), /a\.test\.js/);
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    assert.equal(setState(root, cfg, id, 'building', {}).state, 'building');
  });
});

test('building needs the frozen tests present even when freezeTests is off', () => {
  withKit(
    (root, cfg, [id]) => {
      setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1, tests: ['gone.test.js'] });
      assert.match(refusal(() => setState(root, cfg, id, 'building', {})), /gone\.test\.js/);
    },
    { freeze: false },
  );
});

test('draft-pr needs green tests, check and a prefixed title', () => {
  withKit((root, cfg, [id]) => {
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1, tests: ['a.test.js'] });
    setState(root, cfg, id, 'building', {});
    const ok = { testExit: 0, checkExit: 0, pr: PR };
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, testExit: 1 })), /test/);
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, checkExit: 2 })), /check/);
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, pr: { ...PR, title: 'nope' } })), /\[P1\/S-01\]/);
    const s = setState(root, cfg, id, 'draft-pr', ok);
    assert.equal(s.pr.number, 7);
    assert.equal(s.pr.headSha, 'abc');
  });
});

test('full path to released with verdicts, ci and release', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    assert.match(refusal(() => setState(root, cfg, id, 'in-review', {})), /verdict/);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 2));
    assert.match(refusal(() => setState(root, cfg, id, 'ci-green', { ci: { status: 'success', sha: 'abc' } })), /blocker/);
    setState(root, cfg, id, 'changes-requested', {});
    setState(root, cfg, id, 'in-review', verdict(root, 2, 0));
    assert.match(refusal(() => setState(root, cfg, id, 'ci-green', { ci: { status: 'failure', sha: 'abc' } })), /success/);
    assert.match(refusal(() => setState(root, cfg, id, 'ci-green', { ci: { status: 'success', sha: 'zzz' } })), /sha/);
    setState(root, cfg, id, 'ci-green', { ci: { status: 'success', sha: 'abc' } });
    setState(root, cfg, id, 'ready', {});
    assert.match(refusal(() => setState(root, cfg, id, 'merged', {})), /mergedAt/);
    setState(root, cfg, id, 'merged', { mergedAt: '2026-01-01T00:00:00Z' });
    assert.match(refusal(() => setState(root, cfg, id, 'released', { release: 'nope.md' })), /nope\.md/);
    fs.writeFileSync(path.join(root, 'bad.md'), 'nothing here');
    assert.match(refusal(() => setState(root, cfg, id, 'released', { release: 'bad.md' })), /pull request/);
    fs.writeFileSync(path.join(root, 'rel.md'), 'shipped #7');
    const s = setState(root, cfg, id, 'released', { release: 'rel.md' });
    assert.equal(s.state, 'released');
    assert.equal(s.verdicts.length, 2);
    assert.equal(s.ci.status, 'success');
  });
});

test('changes-requested needs open blockers', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 0, false));
    assert.match(refusal(() => setState(root, cfg, id, 'changes-requested', {})), /blocker/);
  });
});

test('ready needs an independent clean verdict when review is required', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 0, false));
    setState(root, cfg, id, 'ci-green', { ci: { status: 'success', sha: 'abc' } });
    assert.match(refusal(() => setState(root, cfg, id, 'ready', {})), /independent/);
    cfg.review.independent = 'optional';
    assert.equal(setState(root, cfg, id, 'ready', {}).state, 'ready');
  });
});

test('skipping a state is refused', () => {
  withKit((root, cfg, [id]) => {
    assert.equal(refusal(() => setState(root, cfg, id, 'building', {})), 'todo cannot move to building');
    assert.equal(refusal(() => setState(root, cfg, id, 'todo', {})), 'todo cannot move to todo');
  });
});

test('changes-requested can go back to draft-pr after a fix push', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 1));
    setState(root, cfg, id, 'changes-requested', {});
    const s = setState(root, cfg, id, 'draft-pr', { testExit: 0, checkExit: 0, pr: { ...PR, headSha: 'def' } });
    assert.equal(s.state, 'draft-pr');
    assert.equal(s.pr.headSha, 'def');
  });
});

test('backfill skips the from check and records by backfill', () => {
  withKit((root, cfg, [id]) => {
    assert.match(refusal(() => setState(root, cfg, id, 'merged', { mergedAt: 'x' })), /cannot move/);
    assert.match(refusal(() => setState(root, cfg, id, 'merged', { backfill: true })), /mergedAt/);
    const noPr = { backfill: true, mergedAt: 'x' };
    assert.match(refusal(() => setState(root, cfg, id, 'merged', noPr)), /pr.number and pr.headSha/);
    assert.match(refusal(() => setState(root, cfg, id, 'merged', { ...noPr, pr: { number: 1 } })), /pr.headSha/);
    assert.match(refusal(() => setState(root, cfg, id, 'merged', { ...noPr, pr: { number: 1.5, headSha: 'a' } })), /pr.number/);
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { backfill: true, pr: { number: 1 } })), /pr.headSha/);
    assert.match(refusal(() => setState(root, cfg, id, 'ci-green', { backfill: true, ci: { sha: 'a', status: 'success' } })), /pr.number and pr.headSha/);
    const s = setState(root, cfg, id, 'merged', {
      backfill: true,
      mergedAt: '2026-01-01T00:00:00Z',
      pr: { number: 1, url: 'http://x/1', headSha: 'abc' },
    });
    assert.equal(s.state, 'merged');
    assert.equal(s.pr.number, 1);
    assert.equal(s.history.at(-1).by, 'backfill');
    assert.equal(s.history.at(-1).from, 'todo');
    assert.equal('backfill' in s.history.at(-1).evidence, false);
  });
});

test('unfreeze records the path and a history entry', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    const s = unfreeze(root, cfg, id, 'a.test.js');
    assert.deepEqual(s.unfrozen, ['a.test.js']);
    assert.equal(s.state, 'draft-pr');
    assert.deepEqual(s.history.at(-1).evidence, { unfreeze: 'a.test.js' });
    assert.equal(s.history.at(-1).from, 'draft-pr');
    assert.equal(s.history.at(-1).to, 'draft-pr');
  });
});

test('write is atomic: 20 slices in one process, 5 parallel processes', async () => {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const ids = writeSliceFixtures(repo.root, 20);
    const cfg = loadConfig(repo.root);
    await Promise.all(
      ids.map(async (id) => setState(repo.root, cfg, id, 'merged', { backfill: true, mergedAt: 'x', pr: { number: 1, headSha: 'abc' } })),
    );
    const procs = ids.slice(0, 5).map(
      (id) =>
        new Promise((resolve) => {
          const p = spawn(process.execPath, [binPath, 'state', 'unfreeze', id, 'f.js'], { cwd: repo.root });
          p.on('close', resolve);
        }),
    );
    assert.deepEqual(await Promise.all(procs), [0, 0, 0, 0, 0]);
    const dir = kitPaths(repo.root, cfg).state;
    const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.') || f.includes('.tmp-') || f.endsWith('.lock'));
    assert.equal(files.filter((f) => f.includes('.tmp-')).length, 0);
    assert.equal(files.length, 20);
    assert.equal(files.filter((f) => f.endsWith('.lock')).length, 0);
    for (const f of files) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      assert.equal(j.state, 'merged');
    }
    for (const id of ids.slice(0, 5)) {
      assert.deepEqual(readSlice(repo.root, cfg, id).unfrozen, ['f.js']);
    }
  } finally {
    repo.cleanup();
  }
});

test('cli: set, show and refusal', () => {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const id = writeSliceFixture(repo.root, { n: 1 });
    const run = (...a) => runCli(['state', ...a], { cwd: repo.root });
    let r = run('set', id, 'building');
    assert.equal(r.code, 1);
    assert.equal(r.stderr.trim(), 'refused: todo cannot move to building');
    r = run('set', id, 'tests-red', '--commit', 'c1', '--test-exit', '1', '--tests', 'a.test.js,b.test.js');
    assert.equal(r.code, 0, r.stderr);
    r = run('show', id);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^P1\/S-01 {2}tests-red {2}PR -/);
    assert.deepEqual(JSON.parse(run('show', id, '--json').stdout).frozenTests, ['a.test.js', 'b.test.js']);
    const id2 = writeSliceFixture(repo.root, { n: 2 });
    r = run('set', id2, 'merged', '--backfill', '--merged-at', 'x', '--pr-number', '1', '--pr-url', 'u', '--pr-sha', 'abc');
    assert.equal(r.code, 0, r.stderr);
    assert.match(run('show', id2).stdout, /merged {2}PR 1/);
    r = run('show', 'P9/S-99');
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown slice P9\/S-99/);
    assert.equal(run('set', id, 'bogus').code, 2);
    r = run('unfreeze', id, 'b.test.js');
    assert.equal(r.code, 0, r.stderr);
  } finally {
    repo.cleanup();
  }
});

const spawnCli = (args, cwd) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [binPath, ...args], { cwd });
    p.on('close', resolve);
  });

test('draft-pr without a head sha is refused', () => {
  withKit((root, cfg, [id]) => {
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1, tests: ['a.test.js'] });
    setState(root, cfg, id, 'building', {});
    const ok = { testExit: 0, checkExit: 0 };
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, pr: { ...PR, headSha: undefined } })), /headSha/);
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, pr: { ...PR, headSha: '' } })), /headSha/);
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, pr: { ...PR, number: undefined } })), /number/);
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, pr: { ...PR, number: 1.5 } })), /number/);
  });
});

test('ci-green without a ci sha is refused', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 0));
    assert.match(refusal(() => setState(root, cfg, id, 'ci-green', { ci: { status: 'success' } })), /sha/);
    assert.match(refusal(() => setState(root, cfg, id, 'ci-green', { ci: { status: 'success', sha: '' } })), /sha/);
  });
});

test('in-review needs a verdict path, an existing file and round 1 first', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    const v = { round: 1, blockers: 0, independent: true };
    assert.match(refusal(() => setState(root, cfg, id, 'in-review', { verdict: v })), /path/);
    assert.match(refusal(() => setState(root, cfg, id, 'in-review', { verdict: { ...v, path: 'missing.md' } })), /missing\.md/);
    fs.writeFileSync(path.join(root, 'v2.md'), '');
    assert.match(refusal(() => setState(root, cfg, id, 'in-review', { verdict: { ...v, round: 2, path: 'v2.md' } })), /round 1/);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 0));
  });
});

test('released accepts a record that names the pull request url', () => {
  withKit((root, cfg, [id]) => {
    setState(root, cfg, id, 'merged', { backfill: true, mergedAt: 'x', pr: { number: 7, url: 'http://x/7', headSha: 'abc' } });
    fs.writeFileSync(path.join(root, 'r.md'), 'see http://x/7');
    assert.equal(setState(root, cfg, id, 'released', { release: 'r.md' }).state, 'released');
  });
});

test('backfill from a non-todo state is refused', () => {
  withKit((root, cfg, [id]) => {
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1, tests: ['a.test.js'] });
    assert.equal(
      refusal(() => setState(root, cfg, id, 'merged', { backfill: true, mergedAt: 'x' })),
      'backfill is only allowed from todo',
    );
  });
});

test('backfill to ready under required needs an independent clean verdict', () => {
  withKit((root, cfg, [id]) => {
    const bad = { backfill: true, verdict: { round: 1, path: 'v.md', blockers: 0, independent: false } };
    assert.match(refusal(() => setState(root, cfg, id, 'ready', bad)), /independent/);
    assert.match(refusal(() => setState(root, cfg, id, 'ready', { backfill: true })), /independent/);
    const good = { backfill: true, verdict: { round: 1, path: 'v.md', blockers: 0, independent: true } };
    assert.equal(setState(root, cfg, id, 'ready', good).state, 'ready');
  });
});

test('a string for tests is refused, as is a bad number', () => {
  withKit((root, cfg, [id]) => {
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1, tests: 'a.test.js' })), /tests/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1.5, tests: ['a'] })), /testExit/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: -1, tests: ['a'] })), /testExit/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1, tests: [''] })), /tests/);
  });
});

test('a new head sha returns a reviewed state to draft-pr; the same sha is refused', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 0));
    const ev = { testExit: 0, checkExit: 0 };
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ev, pr: { ...PR, headSha: 'abc' } })), /head sha/);
    assert.equal(setState(root, cfg, id, 'draft-pr', { ...ev, pr: { ...PR, headSha: 'n1' } }).state, 'draft-pr');
    setState(root, cfg, id, 'in-review', verdict(root, 2, 0));
    setState(root, cfg, id, 'ci-green', { ci: { status: 'success', sha: 'n1' } });
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ev, pr: { ...PR, headSha: 'n1' } })), /head sha/);
    const s = setState(root, cfg, id, 'draft-pr', { ...ev, pr: { ...PR, headSha: 'n2' } });
    assert.equal(s.state, 'draft-pr');
    assert.equal(s.pr.headSha, 'n2');
    assert.equal(s.ci, null);
    assert.equal(s.history.at(-1).from, 'ci-green');
  });
});

test('ci-green returns to draft-pr on a new head sha, and ready too', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    cfg.review.independent = 'optional';
    setState(root, cfg, id, 'in-review', verdict(root, 1, 0));
    setState(root, cfg, id, 'ci-green', { ci: { status: 'success', sha: 'abc' } });
    setState(root, cfg, id, 'ready', {});
    const s = setState(root, cfg, id, 'draft-pr', { testExit: 0, checkExit: 0, pr: { ...PR, headSha: 'z' } });
    assert.equal(s.history.at(-1).from, 'ready');
  });
});

test('a malformed slice id is refused before touching a path', () => {
  withKit((root, cfg) => {
    assert.throws(() => readSlice(root, cfg, '../../x'), /unknown slice \.\.\/\.\.\/x/);
  });
});

test('parallel processes writing the same slice all land', async () => {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const [id] = writeSliceFixtures(repo.root, 1);
    const cfg = loadConfig(repo.root);
    const paths = ['a.js', 'b.js', 'c.js', 'd.js'];
    const codes = await Promise.all(paths.map((p) => spawnCli(['state', 'unfreeze', id, p], repo.root)));
    assert.deepEqual(codes, [0, 0, 0, 0]);
    const s = readSlice(repo.root, cfg, id);
    assert.deepEqual([...s.unfrozen].sort(), paths);
    assert.equal(s.history.length, 4);
    const dir = kitPaths(repo.root, cfg).state;
    assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.lock') || f.includes('.tmp-')).length, 0);
  } finally {
    repo.cleanup();
  }
});

test('a stale lock file is taken over and removed', () => {
  withKit((root, cfg, [id]) => {
    const dir = kitPaths(root, cfg).state;
    fs.mkdirSync(dir, { recursive: true });
    const lock = path.join(dir, 'P1-S-01.json.lock');
    fs.writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    const s = setState(root, cfg, id, 'tests-red', { commit: 'c1', testExit: 1, tests: ['a.test.js'] });
    assert.equal(s.state, 'tests-red');
    assert.equal(fs.existsSync(lock), false);
  });
});
