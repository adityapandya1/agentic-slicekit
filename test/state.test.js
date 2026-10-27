import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { init } from '../src/init.js';
import { loadConfig } from '../src/config.js';
import { kitPaths } from '../src/paths.js';
import { STATES, nextStates } from '../src/state/transitions.js';
import { readSlice, listSlices, setState, unfreeze, TransitionError, LockError } from '../src/state/index.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli, binPath } from './helpers/run-cli.js';
import { writeSliceFixture, writeSliceFixtures } from './helpers/slice-fixture.js';

function withKit(fn, { slices = 1, freeze = true, commits = 0 } = {}) {
  const repo = makeRepo({ commits });
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

const RED = 'c1c1c1c';
const HEAD = 'abc1234';
const AT = '2026-01-01T00:00:00Z';
const PR = { number: 7, url: 'http://x/7', headSha: HEAD, title: '[P1/S-01] thing' };
const verdict = (root, round, blockers, independent = true) => {
  fs.writeFileSync(path.join(root, `v${round}.md`), '');
  return { verdict: { round, path: `v${round}.md`, blockers, independent } };
};
const green = (sha = HEAD) => ({ ci: { status: 'success', sha } });
const push = (headSha) => ({ testExit: 0, checkExit: 0, pr: { ...PR, headSha } });

function toDraftPr(root, cfg, id) {
  fs.writeFileSync(path.join(root, 'a.test.js'), '');
  setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: ['a.test.js'] });
  setState(root, cfg, id, 'building', {});
  return setState(root, cfg, id, 'draft-pr', { testExit: 0, checkExit: 0, pr: PR });
}

test('states are the ten in order', () => {
  assert.equal(STATES.length, 10);
  assert.equal(STATES[0], 'todo');
  assert.deepEqual(nextStates('todo'), ['tests-red']);
  assert.deepEqual(nextStates('in-review').sort(), ['changes-requested', 'ci-green', 'draft-pr', 'in-review']);
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
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 0, tests: ['a'] })), /non-zero/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { testExit: 1, tests: ['a'] })), /commit/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: [] })), /tests/);
    const s = setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: ['a.test.js'] });
    assert.equal(s.state, 'tests-red');
    assert.equal(s.redCommit, RED);
    assert.deepEqual(s.frozenTests, ['a.test.js']);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].by, 'cli');
    assert.equal(readSlice(root, cfg, id).state, 'tests-red');
  });
});

test('building needs the frozen tests present when freezeTests', () => {
  withKit((root, cfg, [id]) => {
    setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: ['a.test.js'] });
    assert.match(refusal(() => setState(root, cfg, id, 'building', {})), /a\.test\.js/);
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    assert.equal(setState(root, cfg, id, 'building', {}).state, 'building');
  });
});

test('building needs the frozen tests present even when freezeTests is off', () => {
  withKit(
    (root, cfg, [id]) => {
      setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: ['gone.test.js'] });
      assert.match(refusal(() => setState(root, cfg, id, 'building', {})), /gone\.test\.js/);
    },
    { freeze: false },
  );
});

test('draft-pr needs green tests, check and a prefixed title', () => {
  withKit((root, cfg, [id]) => {
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: ['a.test.js'] });
    setState(root, cfg, id, 'building', {});
    const ok = { testExit: 0, checkExit: 0, pr: PR };
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, testExit: 1 })), /test/);
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, checkExit: 2 })), /check/);
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, pr: { ...PR, title: 'nope' } })), /\[P1\/S-01\]/);
    const s = setState(root, cfg, id, 'draft-pr', ok);
    assert.equal(s.pr.number, 7);
    assert.equal(s.pr.headSha, HEAD);
  });
});

test('the title prefix must be followed by a space or the end of the title', () => {
  withKit((root, cfg, [id]) => {
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: ['a.test.js'] });
    setState(root, cfg, id, 'building', {});
    const ok = { testExit: 0, checkExit: 0 };
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, pr: { ...PR, title: '[P1/S-01]x' } })), /\[P1\/S-01\]/);
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { ...ok, pr: { ...PR, title: '[P1/S-01]: x' } })), /\[P1\/S-01\]/);
    assert.equal(setState(root, cfg, id, 'draft-pr', { ...ok, pr: { ...PR, title: '[P1/S-01]' } }).state, 'draft-pr');
  });
});

test('full path to released with verdicts, ci and release', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    assert.match(refusal(() => setState(root, cfg, id, 'in-review', {})), /verdict/);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 2));
    assert.match(refusal(() => setState(root, cfg, id, 'ci-green', green())), /blocker/);
    setState(root, cfg, id, 'changes-requested', {});
    setState(root, cfg, id, 'in-review', verdict(root, 2, 0));
    assert.match(refusal(() => setState(root, cfg, id, 'ci-green', { ci: { status: 'failure', sha: HEAD } })), /success/);
    assert.match(refusal(() => setState(root, cfg, id, 'ci-green', green('9999999'))), /sha/);
    setState(root, cfg, id, 'ci-green', green());
    setState(root, cfg, id, 'ready', {});
    assert.match(refusal(() => setState(root, cfg, id, 'merged', {})), /mergedAt/);
    setState(root, cfg, id, 'merged', { mergedAt: AT });
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

test('verdicts carry the head sha they were given on', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    const s = setState(root, cfg, id, 'in-review', verdict(root, 1, 0));
    assert.equal(s.verdicts[0].headSha, HEAD);
  });
});

test('ready refuses an independent approval given on a superseded head', () => {
  withKit((root, cfg, [id]) => {
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: ['a.test.js'] });
    setState(root, cfg, id, 'building', {});
    setState(root, cfg, id, 'draft-pr', push('aaaaaaa'));
    setState(root, cfg, id, 'in-review', verdict(root, 1, 0, true));
    setState(root, cfg, id, 'ci-green', green('aaaaaaa'));
    setState(root, cfg, id, 'ready', {});
    setState(root, cfg, id, 'draft-pr', push('bbbbbbb'));
    setState(root, cfg, id, 'in-review', verdict(root, 2, 3, false));
    setState(root, cfg, id, 'changes-requested', {});
    setState(root, cfg, id, 'draft-pr', push('ccccccc'));
    setState(root, cfg, id, 'in-review', verdict(root, 3, 0, false));
    setState(root, cfg, id, 'ci-green', green('ccccccc'));
    assert.match(refusal(() => setState(root, cfg, id, 'ready', {})), /independent.*current head/);
    assert.equal(readSlice(root, cfg, id).state, 'ci-green');
  });
});

test('changes-requested and ci-green read the latest verdict for the current head only', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 2));
    setState(root, cfg, id, 'draft-pr', push('bbbbbbb'));
    // A hand-edited state file at in-review with no verdict on the new head.
    const file = path.join(kitPaths(root, cfg).state, 'P1-S-01.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...raw, state: 'in-review' }));
    assert.match(refusal(() => setState(root, cfg, id, 'changes-requested', {})), /blockers/);
    raw.verdicts[0].blockers = 0;
    fs.writeFileSync(file, JSON.stringify({ ...raw, state: 'in-review' }));
    assert.match(refusal(() => setState(root, cfg, id, 'ci-green', green('bbbbbbb'))), /verdict/);
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
    setState(root, cfg, id, 'ci-green', green());
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

// D-39: an independent verdict can send a green slice back to review; an in-loop one cannot.
test('ci-green moves to in-review only on an independent verdict', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 0, false));
    setState(root, cfg, id, 'ci-green', green());
    assert.equal(refusal(() => setState(root, cfg, id, 'in-review', verdict(root, 2, 1, false))), 'ci-green takes only an independent verdict');
    const s = setState(root, cfg, id, 'in-review', verdict(root, 2, 1, true));
    assert.equal(s.state, 'in-review');
    assert.deepEqual(s.verdicts.at(-1), { round: 2, path: 'v2.md', blockers: 1, independent: true, headSha: HEAD });
    assert.equal(s.history.at(-1).from, 'ci-green');
    assert.equal(refusal(() => setState(root, cfg, id, 'in-review', verdict(root, 3, 0, false))), 'in-review takes only an independent verdict');
    setState(root, cfg, id, 'in-review', verdict(root, 3, 0, true));
    setState(root, cfg, id, 'ci-green', green());
    setState(root, cfg, id, 'ready', {});
    assert.equal(refusal(() => setState(root, cfg, id, 'in-review', verdict(root, 4, 0, false))), 'ready takes only an independent verdict');
    assert.equal(setState(root, cfg, id, 'in-review', verdict(root, 4, 0, true)).history.at(-1).from, 'ready');
  });
});

test('changes-requested can go back to draft-pr after a fix push', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 1));
    setState(root, cfg, id, 'changes-requested', {});
    const s = setState(root, cfg, id, 'draft-pr', push('def5678'));
    assert.equal(s.state, 'draft-pr');
    assert.equal(s.pr.headSha, 'def5678');
  });
});

test('backfill skips the from check and records by backfill', () => {
  withKit((root, cfg, [id]) => {
    assert.match(refusal(() => setState(root, cfg, id, 'merged', { mergedAt: AT })), /cannot move/);
    assert.match(refusal(() => setState(root, cfg, id, 'merged', { backfill: true })), /mergedAt/);
    const noPr = { backfill: true, mergedAt: AT };
    assert.match(refusal(() => setState(root, cfg, id, 'merged', noPr)), /pr.number and pr.headSha/);
    assert.match(refusal(() => setState(root, cfg, id, 'merged', { ...noPr, pr: { number: 1 } })), /pr.headSha/);
    assert.match(refusal(() => setState(root, cfg, id, 'merged', { ...noPr, pr: { number: 1.5, headSha: HEAD } })), /pr.number/);
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', { backfill: true, pr: { number: 1 } })), /pr.headSha/);
    assert.match(refusal(() => setState(root, cfg, id, 'ci-green', { backfill: true, ci: { sha: HEAD, status: 'success' } })), /pr.number and pr.headSha/);
    const s = setState(root, cfg, id, 'merged', {
      backfill: true,
      mergedAt: AT,
      pr: { number: 1, url: 'http://x/1', headSha: HEAD },
    });
    assert.equal(s.state, 'merged');
    assert.equal(s.pr.number, 1);
    assert.equal(s.mergedAt, AT);
    assert.equal(s.history.at(-1).by, 'backfill');
    assert.equal(s.history.at(-1).from, 'todo');
    assert.equal('backfill' in s.history.at(-1).evidence, false);
  });
});

test('merged stores mergedAt at the top level of the state', () => {
  withKit((root, cfg, [id]) => {
    assert.equal(readSlice(root, cfg, id).mergedAt, null);
    toDraftPr(root, cfg, id);
    cfg.review.independent = 'optional';
    setState(root, cfg, id, 'in-review', verdict(root, 1, 0));
    setState(root, cfg, id, 'ci-green', green());
    setState(root, cfg, id, 'ready', {});
    assert.equal(setState(root, cfg, id, 'merged', { mergedAt: AT }).mergedAt, AT);
    assert.equal(readSlice(root, cfg, id).mergedAt, AT);
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

test('unfreeze refuses a path that is not a frozen test', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    assert.match(refusal(() => unfreeze(root, cfg, id, 'src/a.js')), /src\/a\.js is not a frozen test/);
    assert.deepEqual(readSlice(root, cfg, id).unfrozen, []);
    const r = runCli(['state', 'unfreeze', id, 'src/a.js'], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^refused: src\/a\.js is not a frozen test/);
  });
});

test('write is atomic: 20 slices in one process, 5 parallel processes', async () => {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const ids = writeSliceFixtures(repo.root, 20);
    const cfg = loadConfig(repo.root);
    await Promise.all(
      ids.map(async (id) => setState(repo.root, cfg, id, 'tests-red', { backfill: true, commit: RED, tests: ['f.js'] })),
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
      assert.equal(j.state, 'tests-red');
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
    r = run('set', id, 'tests-red', '--commit', RED, '--test-exit', '1', '--tests', 'a.test.js,b.test.js');
    assert.equal(r.code, 0, r.stderr);
    r = run('show', id);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^P1\/S-01 {2}tests-red {2}PR -/);
    assert.deepEqual(JSON.parse(run('show', id, '--json').stdout).frozenTests, ['a.test.js', 'b.test.js']);
    const id2 = writeSliceFixture(repo.root, { n: 2 });
    r = run('set', id2, 'merged', '--backfill', '--merged-at', AT, '--pr-number', '1', '--pr-url', 'u', '--pr-sha', HEAD);
    assert.equal(r.code, 0, r.stderr);
    assert.match(run('show', id2).stdout, /merged {2}PR #1\n$/);
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

const spawnCapture = (args, cwd, env = process.env) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [binPath, ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });

test('draft-pr without a head sha is refused', () => {
  withKit((root, cfg, [id]) => {
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: ['a.test.js'] });
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

test('evidence of the wrong shape is refused whatever the target', () => {
  withKit((root, cfg, [id]) => {
    const red = { testExit: 1, tests: ['a.test.js'] };
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { ...red, commit: 'c1' })), /^commit must be 7 to 40 lowercase hex/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { ...red, commit: 'ABC1234' })), /^commit must be/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { ...red, commit: RED, pr: { headSha: 'xyz' } })), /^pr\.headSha must be 7 to 40/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { ...red, commit: RED, ci: { sha: 'not-a-sha' } })), /^ci\.sha must be 7 to 40/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { ...red, commit: RED, mergedAt: 'yesterday' })), /^mergedAt must be an ISO date/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { ...red, commit: RED, pr: { number: 0 } })), /^pr\.number must be a positive integer/);
    assert.equal(readSlice(root, cfg, id).state, 'todo');
  });
});

test('in a repository with commits, the commit must resolve and short shas are stored in full', () => {
  withKit(
    (root, cfg, [id]) => {
      const full = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
      const short = full.slice(0, 7);
      fs.writeFileSync(path.join(root, 'a.test.js'), '');
      const red = { testExit: 1, tests: ['a.test.js'] };
      assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { ...red, commit: 'deadbee' })), /deadbee is not a commit in this repository/);
      const s = setState(root, cfg, id, 'tests-red', { ...red, commit: short });
      assert.equal(s.redCommit, full);
      assert.equal(s.history.at(-1).evidence.commit, full);
      setState(root, cfg, id, 'building', {});
      assert.equal(setState(root, cfg, id, 'draft-pr', push(short)).pr.headSha, full);
      setState(root, cfg, id, 'in-review', verdict(root, 1, 0));
      assert.equal(setState(root, cfg, id, 'ci-green', green(short)).ci.sha, full);
    },
    { commits: 1 },
  );
});

test('a head sha the repository cannot resolve stays as given; ci-green matches it by prefix', () => {
  withKit(
    (root, cfg, [id]) => {
      const full = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
      fs.writeFileSync(path.join(root, 'a.test.js'), '');
      setState(root, cfg, id, 'tests-red', { commit: full, testExit: 1, tests: ['a.test.js'] });
      setState(root, cfg, id, 'building', {});
      setState(root, cfg, id, 'draft-pr', push(HEAD));
      assert.equal(readSlice(root, cfg, id).pr.headSha, HEAD);
      setState(root, cfg, id, 'in-review', verdict(root, 1, 0));
      assert.match(refusal(() => setState(root, cfg, id, 'ci-green', green('abc1235'))), /sha/);
      assert.equal(setState(root, cfg, id, 'ci-green', green(`${HEAD}${'0'.repeat(33)}`)).state, 'ci-green');
    },
    { commits: 1 },
  );
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
    setState(root, cfg, id, 'merged', { backfill: true, mergedAt: AT, pr: { number: 7, url: 'http://x/7', headSha: HEAD } });
    fs.writeFileSync(path.join(root, 'r.md'), 'see http://x/7');
    assert.equal(setState(root, cfg, id, 'released', { release: 'r.md' }).state, 'released');
  });
});

test('released does not take #70 or the url of pull request 70 for pull request 7', () => {
  withKit((root, cfg, [id]) => {
    setState(root, cfg, id, 'merged', { backfill: true, mergedAt: AT, pr: { number: 7, url: 'http://x/7', headSha: HEAD } });
    fs.writeFileSync(path.join(root, 'r.md'), 'shipped #70 and #17, see http://x/70');
    assert.match(refusal(() => setState(root, cfg, id, 'released', { release: 'r.md' })), /#7\b/);
    fs.writeFileSync(path.join(root, 'r.md'), 'shipped (#7).');
    assert.equal(setState(root, cfg, id, 'released', { release: 'r.md' }).state, 'released');
  });
});

test('backfill from a non-todo state is refused', () => {
  withKit((root, cfg, [id]) => {
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: ['a.test.js'] });
    assert.equal(
      refusal(() => setState(root, cfg, id, 'merged', { backfill: true, mergedAt: AT })),
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
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: 'a.test.js' })), /tests/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1.5, tests: ['a'] })), /testExit/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: RED, testExit: -1, tests: ['a'] })), /testExit/);
    assert.match(refusal(() => setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: [''] })), /tests/);
  });
});

test('a new head sha returns a reviewed state to draft-pr; the same sha is refused', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    setState(root, cfg, id, 'in-review', verdict(root, 1, 0));
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', push(HEAD))), /head sha/);
    assert.equal(setState(root, cfg, id, 'draft-pr', push('a1a1a1a')).state, 'draft-pr');
    setState(root, cfg, id, 'in-review', verdict(root, 2, 0));
    setState(root, cfg, id, 'ci-green', green('a1a1a1a'));
    assert.match(refusal(() => setState(root, cfg, id, 'draft-pr', push('a1a1a1a'))), /head sha/);
    const s = setState(root, cfg, id, 'draft-pr', push('a2a2a2a'));
    assert.equal(s.state, 'draft-pr');
    assert.equal(s.pr.headSha, 'a2a2a2a');
    assert.equal(s.ci, null);
    assert.equal(s.history.at(-1).from, 'ci-green');
  });
});

test('ci-green returns to draft-pr on a new head sha, and ready too', () => {
  withKit((root, cfg, [id]) => {
    toDraftPr(root, cfg, id);
    cfg.review.independent = 'optional';
    setState(root, cfg, id, 'in-review', verdict(root, 1, 0));
    setState(root, cfg, id, 'ci-green', green());
    setState(root, cfg, id, 'ready', {});
    const s = setState(root, cfg, id, 'draft-pr', push('fffffff'));
    assert.equal(s.history.at(-1).from, 'ready');
  });
});

test('a malformed slice id is refused before touching a path', () => {
  withKit((root, cfg) => {
    assert.throws(() => readSlice(root, cfg, '../../x'), /unknown slice \.\.\/\.\.\/x/);
  });
});

test('a corrupt state file is named, not a bare JSON error', () => {
  withKit((root, cfg, [id]) => {
    const dir = kitPaths(root, cfg).state;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'P1-S-01.json');
    fs.writeFileSync(file, '{ broken');
    assert.throws(() => readSlice(root, cfg, id), (e) => e.constructor === Error && e.message === `${file}: not valid JSON`);
  });
});

test('parallel processes writing the same slice all land', async () => {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const [id] = writeSliceFixtures(repo.root, 1);
    const cfg = loadConfig(repo.root);
    const paths = ['a.js', 'b.js', 'c.js', 'd.js'];
    setState(repo.root, cfg, id, 'tests-red', { backfill: true, commit: RED, tests: paths });
    const codes = await Promise.all(paths.map((p) => spawnCli(['state', 'unfreeze', id, p], repo.root)));
    assert.deepEqual(codes, [0, 0, 0, 0]);
    const s = readSlice(repo.root, cfg, id);
    assert.deepEqual([...s.unfrozen].sort(), paths);
    assert.equal(s.history.length, 5);
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
    const s = setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: ['a.test.js'] });
    assert.equal(s.state, 'tests-red');
    assert.equal(fs.existsSync(lock), false);
  });
});

test('a held lock is a one-line message and exit 2 from state and status, after the wait budget', async () => {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const [id] = writeSliceFixtures(repo.root, 1);
    const cfg = loadConfig(repo.root);
    const dir = kitPaths(repo.root, cfg).state;
    // A slice parked at ready, so status --sync tries to write it.
    setState(repo.root, cfg, id, 'ready', { backfill: true, verdict: { round: 1, path: 'v.md', blockers: 0, independent: true } });
    const file = path.join(dir, 'P1-S-01.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...raw, pr: { number: 14, headSha: 'abc1234def5678' } }));
    const lock = path.join(dir, 'P1-S-01.json.lock');
    fs.writeFileSync(lock, '');
    const fixture = path.resolve(path.dirname(binPath), '..', 'test', 'fixtures', 'githost');
    const started = Date.now();
    const [st, sy] = await Promise.all([
      spawnCapture(['state', 'unfreeze', id, 'x.js'], repo.root),
      spawnCapture(['status', '--sync'], repo.root, { ...process.env, SLICEKIT_GITHOST_FIXTURE: fixture }),
    ]);
    const message = `slicekit: could not lock ${id}: another slicekit is writing it\n`;
    assert.equal(st.code, 2);
    assert.equal(st.stderr, message);
    assert.equal(sy.code, 2);
    assert.equal(sy.stderr, message);
    assert.ok(Date.now() - started >= 4500, 'the wait budget is 5 s');
    assert.ok(fs.existsSync(lock), 'a held lock is not taken');
  } finally {
    repo.cleanup();
  }
});

test('LockError names the slice', () => {
  const e = new LockError('P1/S-01');
  assert.equal(e.message, 'could not lock P1/S-01: another slicekit is writing it');
  assert.equal(e.name, 'LockError');
});

// D-35: CI that ran on a later head adding only bookkeeping is CI on the reviewed work.
function commitEverything(root, message) {
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['commit', '-q', '--no-verify', '-m', message], { cwd: root, stdio: 'pipe', env: { ...process.env, ALLOW_PROTECTED_COMMIT: '1' } });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}
// A slice in review on a real head H1 with a clean verdict, and a later head H2 that changes BUILD.md
// and the state file, and whatever `extra` writes.
function reviewedThenCommitted(fn, extra) {
  withKit((root, cfg, [id]) => {
    fs.writeFileSync(path.join(root, 'a.test.js'), '');
    fs.mkdirSync(path.join(root, '.slicekit', 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(root, '.slicekit', 'reviews', 'P1-S-01-r1.md'), '');
    setState(root, cfg, id, 'tests-red', { commit: RED, testExit: 1, tests: ['a.test.js'] });
    setState(root, cfg, id, 'building', {});
    const h1 = commitEverything(root, 'h1');
    setState(root, cfg, id, 'draft-pr', push(h1));
    setState(root, cfg, id, 'in-review', { verdict: { round: 1, path: '.slicekit/reviews/P1-S-01-r1.md', blockers: 0 } });
    fs.writeFileSync(kitPaths(root, cfg).build, '# Build\n\nlater\n');
    extra(root);
    const h2 = commitEverything(root, 'h2');
    fn(root, cfg, id, h2);
  });
}

test('ci-green accepts CI on a later head that only adds bookkeeping', () => {
  reviewedThenCommitted(
    (root, cfg, id, h2) => {
      const s = setState(root, cfg, id, 'ci-green', green(h2));
      assert.equal(s.state, 'ci-green');
      assert.equal(s.ci.sha, h2);
    },
    () => {},
  );
  reviewedThenCommitted(
    (root, cfg, id, h2) => {
      assert.equal(
        refusal(() => setState(root, cfg, id, 'ci-green', green(h2))),
        'ci-green needs the CI sha to be the pull request head sha or a later head that only adds bookkeeping',
      );
      assert.equal(readSlice(root, cfg, id).state, 'in-review');
    },
    (root) => {
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'x.js'), 'export const x = 1;\n');
    },
  );
});
