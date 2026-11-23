// P8/S-61 (REQ-2.6, REQ-2.5, D-103): a slice marked `lane: quick` has one in-loop review round. Its
// round-one verdict with a blocker stops the loop at changes-requested and names no second in-loop
// round; a slice with no lane keeps two. Both slices here expect and change only a doc, so the lane
// rule does not refuse the quick one at `build pr`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../src/git.js';
import { getSection } from '../src/prbody.js';
import { runCli } from './helpers/run-cli.js';
import { cli, commitAll, commitWorkCli, fixtureHost, project, stateIn, vpath, write } from './helpers/build-flow.js';

const ID = 'P1/S-01';
const REVIEWS = '.slicekit/reviews';
const SLICE_FILE = 'docs/phases/P1-x/S-01-thing-1.md';
const SLICE_BRANCH = 'slice/P1-S-01-thing-1';

// The evaluation test of the fixture slice: it reads docs/a.md, which the slice writes.
const DOC_TEST = [
  '// REQ-1.1',
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import fs from 'node:fs';",
  "test('works', () => assert.equal(fs.readFileSync(new URL('../docs/a.md', import.meta.url), 'utf8'), 'done\\n'));",
  '',
].join('\n');

// Slice P1/S-01 at draft-pr: a project with the kit installed, a bare origin and the fixture git
// host, whose slice file expects only `docs/a.md` and, with `lane`, carries `lane: <lane>`; then build
// start, red on test/a.test.js, a green build commit writing docs/a.md, and build pr.
async function draftedSlice({ lane } = {}) {
  const p = project({ slices: [{ n: 1, group: 'A', evalFile: 'a.test.js' }], commands: { test: 'node --test' }, remote: true, init: true });
  const h = fixtureHost();
  const cleanup = () => {
    h.cleanup();
    p.cleanup();
  };
  try {
    const file = path.join(p.root, ...SLICE_FILE.split('/'));
    let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    text = text.replace('`src/t1.js`.', '`docs/a.md`.');
    if (lane) text = text.replace('runbook: no\n', `runbook: no\nlane: ${lane}\n`);
    fs.writeFileSync(file, text);
    const status = runCli(['status', '--write'], { cwd: p.root });
    assert.equal(status.code, 0, status.stderr);
    commitAll(p.root, 'plan: the slice expects a doc');
    git(p.root, ['push', '-q', 'origin', 'main']);

    const started = await cli(p.root, ['build', 'start', ID]);
    assert.equal(started.code, 0, started.stderr);
    const wt = started.stdout.split('\n')[0];
    write(wt, 'test/a.test.js', DOC_TEST);
    const red = await cli(p.root, ['build', 'red', ID, '--tests', 'test/a.test.js']);
    assert.equal(red.code, 0, red.stderr);
    write(wt, 'docs/a.md', 'done\n');
    const s = { ...p, wt };
    const done = await commitWorkCli(s, '--message', `docs(${ID}): a`, '--require-green');
    assert.equal(done.code, 0, done.stderr);
    const opened = await cli(p.root, ['build', 'pr', ID, '--notes', h.notes], h.env);
    assert.equal(opened.code, 0, opened.stderr);
    assert.equal(stateIn(wt).state, 'draft-pr');
    return { ...s, host: h.host, env: h.env, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

// A well-formed in-loop verdict of round `k` on the worktree's head, written into the session root,
// then given to build verdict. `findings` are [id, what is wrong] pairs.
function verdict(p, k, kind, findings = []) {
  const rows = findings.map(([fid, wrong]) => `| ${fid} | docs/a.md:1 | ${wrong} | it matters | \`node --test\` printed "fail 1" |`);
  const text = [
    `Verdict: ${kind}`,
    `Head: ${git(p.wt, ['rev-parse', 'HEAD'])}`,
    '',
    '| ID | File:line | What is wrong | Why it matters | How verified |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '## Checklists run',
    '',
    '- correctness',
    '',
    '## Not checked',
    '',
    '- performance',
    '',
  ].join('\n');
  const rel = `${REVIEWS}/P1-S-01-r${k}.md`;
  write(p.root, rel, text);
  return cli(p.root, ['build', 'verdict', ID, rel], p.env);
}

const prIn = (p) => JSON.parse(fs.readFileSync(path.join(p.host, 'pr-1.json'), 'utf8'));

test("a quick slice's round-one blocker stops the loop with no second reviewer", async () => {
  const p = await draftedSlice({ lane: 'quick' });
  try {
    const one = await verdict(p, 1, 'BLOCK', [['B-1', 'the page names the wrong command']]);
    const out = `${one.stdout}${one.stderr}`;
    // The loop has stopped: `stuck` exits 1, and the state is changes-requested.
    assert.equal(one.code, 1, out);
    assert.match(one.stdout, /^next: stuck\n/, out);
    assert.match(one.stdout, /^blockers: B-1$/m, out);
    assert.match(one.stdout, /^rounds: 1 of 1$/m, out);
    // No second in-loop round is named: no verdict path for round 2, no `fix` step.
    assert.doesNotMatch(out, /P1-S-01-r2\.md/, out);
    assert.ok(!one.stdout.includes(vpath(p.root, 'P1-S-01-r2.md')), out);
    assert.doesNotMatch(one.stdout, /^next: fix$/m, out);
    // What is stuck is printed.
    assert.ok(one.stderr.includes('stopped: B-1 survive round 1; the pull request stays draft'), one.stderr);
    const st = stateIn(p.wt);
    assert.equal(st.state, 'changes-requested');
    assert.equal(st.verdicts.length, 1);
    assert.equal(git(p.remote, ['rev-parse', `refs/heads/${SLICE_BRANCH}`]), git(p.wt, ['rev-parse', 'HEAD']));
    const pr = prIn(p);
    assert.equal(pr.isDraft, true);
    assert.equal(getSection(pr.body, 'Reviewer blocked'), 'B-1 `the page names the wrong command` — not fixed after round 1');
  } finally {
    p.cleanup();
  }
});

test('a slice with no lane keeps two in-loop rounds', async () => {
  const p = await draftedSlice();
  try {
    const one = await verdict(p, 1, 'BLOCK', [['B-1', 'the page names the wrong command']]);
    assert.equal(one.code, 0, `${one.stdout}${one.stderr}`);
    assert.equal(one.stdout, `next: fix\nblockers: B-1\nshould-haves: none\nrounds: 1 of 2\nverdict ${vpath(p.root, 'P1-S-01-r2.md')}\n`);
    assert.equal(stateIn(p.wt).state, 'in-review');
  } finally {
    p.cleanup();
  }
});
