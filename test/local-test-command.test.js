// REQ-2.6: the build steps run a local test command and say so, while check keeps the committed one.
// P2/S-29 Done when 6: an untracked .slicekit/local.json may set `testCommand`; `build red`, `build
// commit --require-green` and `build pr` run it and say so; CI and `slicekit check` keep the committed
// command; `init` adds the local file to the ignore rules it owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { git } from '../src/git.js';
import { GREEN, IMPORTING, cli, fixtureHost, startedWithTest, stateIn, write } from './helpers/build-flow.js';

// The committed test command cannot run on this machine: every step that ran it would refuse with
// "could not run". The local one is the real suite, two files at a time.
const COMMITTED = 'no-such-test-runner-s29';
const LOCAL = 'node --test --test-concurrency=2';
const LOCAL_FILE = '.slicekit/local.json';

// The build steps never read the local file under CI (D-43): this run is a machine's, not CI's.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CI'));
const says = (r) => `${r.stdout}${r.stderr}`.includes(LOCAL_FILE);

test('build steps run the local test command and say so; check keeps the committed one', async () => {
  const p = await startedWithTest(IMPORTING, { test: COMMITTED, remote: true, init: true });
  const h = fixtureHost();
  try {
    // init owns the ignore rule for the local file, so it is never committed.
    const ignore = fs.readFileSync(path.join(p.root, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    assert.ok(ignore.includes(LOCAL_FILE) || ignore.includes(`/${LOCAL_FILE}`), `.gitignore has no ${LOCAL_FILE} rule`);

    // The machine's own file, in the main checkout the build steps run from.
    write(p.root, LOCAL_FILE, `${JSON.stringify({ testCommand: LOCAL })}\n`);
    assert.equal(git(p.root, ['status', '--porcelain', '--', LOCAL_FILE]), '');

    const red = await cli(p.root, ['build', 'red', 'P1/S-01', '--tests', 'test/a.test.js'], ENV);
    assert.equal(red.code, 0, red.stderr);
    assert.ok(says(red), `build red does not say it ran ${LOCAL_FILE}'s command:\n${red.stdout}${red.stderr}`);
    assert.match(git(p.wt, ['log', '-1', '--format=%B', stateIn(p.wt).redCommit]), new RegExp(`ran: ${LOCAL} → exit [1-9]`));

    write(p.wt, 'src/t1.js', GREEN);
    const done = await cli(p.root, ['build', 'commit', 'P1/S-01', '--message', 'feat(P1/S-01): x', '--require-green'], ENV);
    assert.equal(done.code, 0, done.stderr);
    assert.ok(says(done), `build commit does not say it ran ${LOCAL_FILE}'s command:\n${done.stdout}${done.stderr}`);

    const pr = await cli(p.root, ['build', 'pr', 'P1/S-01', '--notes', h.notes], { ...ENV, SLICEKIT_GITHOST_FIXTURE: h.host });
    assert.equal(pr.code, 0, pr.stderr);
    assert.ok(says(pr), `build pr does not say it ran ${LOCAL_FILE}'s command:\n${pr.stdout}${pr.stderr}`);
    assert.equal(stateIn(p.wt).state, 'draft-pr');

    // The committed command is untouched: the config, CI's workflow, and check, which passes.
    assert.equal(loadConfig(p.wt).commands.test, COMMITTED);
    const workflows = path.join(p.wt, '.github', 'workflows');
    const ci = fs.readdirSync(workflows).map((f) => fs.readFileSync(path.join(workflows, f), 'utf8')).join('\n');
    assert.ok(ci.includes(COMMITTED), 'the CI workflow does not run the committed command');
    assert.ok(!ci.includes(LOCAL), 'the CI workflow runs the local command');
    const check = await cli(p.wt, ['check'], ENV);
    assert.equal(check.code, 0, check.stdout + check.stderr);
  } finally {
    h.cleanup();
    p.cleanup();
  }
});
