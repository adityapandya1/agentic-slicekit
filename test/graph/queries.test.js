// P3/S-18, the queries: REQ-4.5 (trace, trace --file, history, uncovered, shipped, each with --json,
// unknown IDs and paths refused with exit 2). Every graph here is built from graphRepo
// (test/helpers/graph-fixture.js) or a repository written in the test, against the fixture host;
// nothing reaches the network. The queries themselves never run git or call the host.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../../src/config.js';
import { cli } from '../helpers/build-flow.js';
import { makeRepo } from '../helpers/tmp-repo.js';
import { commitFixed, graphRepo, PR_URL, write } from '../helpers/graph-fixture.js';

const fixtureEnv = (fixture) => ({ ...process.env, SLICEKIT_GITHOST_FIXTURE: fixture });
const lines = (stdout) => stdout.replace(/\n$/, '').split('\n');
const sha7 = (sha) => sha.slice(0, 7);

async function buildGraph(root, fixture) {
  const r = await cli(root, ['graph'], fixtureEnv(fixture));
  assert.equal(r.code, 0, `graph failed: ${r.stderr}`);
}

// One repository for every test but history's: graphRepo, then one commit on main with no Slice
// trailer that adds a requirement no test names (REQ-1.4), a test file naming no requirement and a
// planned phase P2 with no release record. The graph is built once.
let shared;
let loose;
before(async () => {
  shared = graphRepo();
  const spec = fs.readFileSync(path.join(shared.root, 'docs', 'spec', '01-x.md'), 'utf8');
  loose = commitFixed(shared.root, 'chore: loose ends', {
    'docs/spec/01-x.md': `${spec}\n## REQ-1.4 It waits\n\nThe kit SHALL wait.\n\nScenario: GIVEN a wait WHEN it runs THEN it waits.\n\nCites: D-01.\n`,
    'test/none.test.js': "import { test } from 'node:test';\n\ntest('nothing named', () => {});\n",
    'docs/phases/P2-y/P2.md': '# Phase 2 — Y\n\n**Order:** A\n',
  });
  await buildGraph(shared.root, shared.fixture);
});
after(() => shared?.cleanup());

const q = (args) => cli(shared.root, args);

test('trace prints the slices, tests, commits, pull requests and files under a requirement as a tree', async () => {
  const { sliceA, kit } = shared.shas;
  const r = await q(['trace', 'REQ-1.1']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [
    'requirement REQ-1.1 It works',
    '  slice P1/S-01 Thing a (merged)',
    `    pull request #1 ${PR_URL}`,
    `    commit ${sha7(kit)} chore(P1/S-01): state, verdict and journal`,
    '      file .slicekit/journal/main--0000abcd.log',
    '      file .slicekit/reviews/P1-S-01-r1.md',
    '      file .slicekit/state/P1-S-01.json',
    '      file .slicekit/state/P1-S-02.json',
    `    commit ${sha7(sliceA)} feat(P1/S-01): a`,
    '      file src/Billing.java',
    '      file src/a.js',
    '      file test/a.test.js',
    '      file test/crlf.test.js',
    '  test test/a.test.js:3',
  ]);

  // REQ-1.3 sits under the same slice and no test names it.
  const r3 = await q(['trace', 'REQ-1.3']);
  assert.equal(r3.code, 0, r3.stderr);
  const out = lines(r3.stdout);
  assert.equal(out[0], 'requirement REQ-1.3 It answers');
  assert.equal(out[1], '  slice P1/S-01 Thing a (merged)');
  assert.equal(out[2], `    pull request #1 ${PR_URL}`);
  const commitAt = out.indexOf(`    commit ${sha7(sliceA)} feat(P1/S-01): a`);
  assert.ok(commitAt > 2, `no commit line for ${sha7(sliceA)}:\n${r3.stdout}`);
  assert.ok(out.slice(commitAt + 1).includes('      file src/a.js'), r3.stdout);
  assert.ok(!out.some((l) => l.startsWith('  test ')), `REQ-1.3 has no covering test:\n${r3.stdout}`);
  assert.ok(!out.some((l) => l.includes('P1/S-02')), r3.stdout);
});

test('trace --file prints the requirements, decisions and slices above a file', async () => {
  const r = await q(['trace', '--file', 'src/a.js']);
  assert.equal(r.code, 0, r.stderr);
  const out = lines(r.stdout);
  assert.equal(out[0], 'file src/a.js');
  assert.equal(out[1], '  slice P1/S-01 Thing a (merged)');
  const req1 = out.indexOf('    requirement REQ-1.1 It works');
  const req3 = out.indexOf('    requirement REQ-1.3 It answers');
  assert.ok(req1 > 1 && req3 > req1, `the slice's requirements, in id order:\n${r.stdout}`);
  assert.equal(out[req1 + 1], '      decision D-01', `REQ-1.1 cites D-01:\n${r.stdout}`);
  assert.equal(out[req3 + 1], '      decision D-01', `REQ-1.3 cites D-01:\n${r.stdout}`);
  assert.ok(out.includes('    decision D-01'), `the slice cites D-01:\n${r.stdout}`);
  assert.ok(!out.some((l) => l.includes('P1/S-02') || l.includes('REQ-1.2')), `only the slice that touched the file:\n${r.stdout}`);
});

test('history lists the slices that touched a path, newest first, with verdict and release', async () => {
  const repo = makeRepo();
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-graph-host-'));
  try {
    const { root } = repo;
    const cfg = defaultConfig({ name: 'billing', shape: 'backend', commands: { test: 'node --test' } });
    const slice = (id, name) =>
      `---\nslice: ${id}\nname: ${name}\nrepo: .\ngroup: A\nrunbook: no\nrequirements: [REQ-1.1]\ndecisions: [D-01]\n---\n\n## Done when\n\n1. It bills.\n\n## Evaluation set\n\n| Test | Kind | Covers |\n|---|---|---|\n| \`a.test.js » bills\` | happy | REQ-1.1 |\n\n## Expected changes\n\n\`src/billing/a.js\`.\n`;
    commitFixed(root, 'plan', {
      '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n`,
      '.gitignore': '.slicekit/graph/\n',
      'docs/spec/01-billing.md': '# 01 — Billing\n\n## REQ-1.1 It bills\n\nThe kit SHALL bill.\n\nScenario: GIVEN a bill WHEN it runs THEN it bills.\n\nCites: D-01.\n',
      'docs/decisions.md': '# Decisions\n\n## Settled\n\n| # | Type | Question | Answer | Who, when |\n|---|------|----------|--------|-----------|\n| D-01 | Decision | Bill? | yes | team, 2026-10-01 |\n',
      'docs/phases/P1-billing/P1.md': '# Phase 1 — Billing\n\n**Order:** A\n',
      'docs/phases/P1-billing/S-03-first.md': slice('P1/S-03', 'First'),
      'docs/phases/P1-billing/S-07-second.md': slice('P1/S-07', 'Second'),
    });
    // S-07's commit is the older, S-03's the newer.
    const s07 = commitFixed(root, 'feat(P1/S-07): bill\n\nSlice: P1/S-07', { 'src/billing/a.js': 'export const a = 7;\n' });
    const s03 = commitFixed(root, 'feat(P1/S-03): bill\n\nSlice: P1/S-03', { 'src/billing/a.js': 'export const a = 3;\n' });
    commitFixed(root, 'chore: no slice', { 'src/billing/b.js': 'export const b = 1;\n' });
    const state = (id, n, head) =>
      `${JSON.stringify({ slice: id, state: 'merged', branch: null, pr: { number: n, url: `https://github.com/acme/billing/pull/${n}`, headSha: head }, redCommit: null, frozenTests: [], unfrozen: [], verdicts: [], ci: null, mergedAt: '2026-10-02T10:00:00Z', handoff: null, history: [] }, null, 2)}\n`;
    const verdict = (head) => `Verdict: APPROVE\nHead: ${head}\n\n## Checklists run\n\n- correctness\n\n## Not checked\n\n- nothing\n`;
    commitFixed(root, 'chore: state, verdicts and release', {
      '.slicekit/state/P1-S-03.json': state('P1/S-03', 14, s03),
      '.slicekit/state/P1-S-07.json': state('P1/S-07', 21, s07),
      '.slicekit/reviews/P1-S-03-r1.md': verdict(s03),
      '.slicekit/reviews/P1-S-07-r1.md': verdict(s07),
      'docs/releases/P1.md': '# Release P1\n\nPull requests: #14.\n',
    });
    const pr = (n, head, id) => ({
      number: n,
      url: `https://github.com/acme/billing/pull/${n}`,
      state: 'MERGED',
      mergedAt: '2026-10-02T10:00:00Z',
      headRefOid: head,
      headRefName: `slice/${id.replace('/', '-')}-x`,
      isDraft: false,
      title: `[${id}] Bill`,
      body: `Slice: ${id}`,
      labels: [],
    });
    fs.writeFileSync(path.join(host, 'pr-14.json'), `${JSON.stringify(pr(14, s03, 'P1/S-03'), null, 2)}\n`);
    fs.writeFileSync(path.join(host, 'pr-21.json'), `${JSON.stringify(pr(21, s07, 'P1/S-07'), null, 2)}\n`);
    await buildGraph(root, host);

    const r = await cli(root, ['history', 'src/billing']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'P1/S-03  PR #14  APPROVE  released P1\nP1/S-07  PR #21  APPROVE  unreleased\n');
  } finally {
    fs.rmSync(host, { recursive: true, force: true });
    repo.cleanup();
  }
});

test('uncovered lists requirements with no test, tests naming no requirement and commits with no slice trailer', async () => {
  const { plan, merge } = shared.shas;
  const r = await q(['uncovered']);
  assert.equal(r.code, 0, r.stderr);
  const out = lines(r.stdout);
  const heading = (prefix) => {
    const i = out.findIndex((l) => l.startsWith(prefix));
    assert.ok(i !== -1, `no heading "${prefix}":\n${r.stdout}`);
    return i;
  };
  const reqs = heading('requirements with no covering test: ');
  const tests = heading('tests naming no requirement: ');
  const commits = heading('commits on main with no slice trailer: ');
  assert.ok(reqs < tests && tests < commits, `the three sections in order:\n${r.stdout}`);
  assert.equal(out[reqs], 'requirements with no covering test: 2');
  assert.equal(out[tests], 'tests naming no requirement: 1');
  assert.equal(out[commits], 'commits on main with no slice trailer: 2');

  const section = (from, to) => out.slice(from + 1, to);
  const reqItems = section(reqs, tests);
  assert.equal(reqItems.length, 2, r.stdout);
  assert.ok(reqItems[0].startsWith('  requirement REQ-1.3 It answers') && reqItems[0].includes('docs/spec/01-x.md:19'), r.stdout);
  assert.ok(reqItems[1].startsWith('  requirement REQ-1.4 It waits') && reqItems[1].includes('docs/spec/01-x.md:'), r.stdout);
  assert.deepEqual(section(tests, commits), ['  test test/none.test.js']);
  // Newest first; the merge commit carries no trailer and is left out.
  assert.deepEqual(section(commits, out.length), [`  commit ${sha7(loose)} chore: loose ends`, `  commit ${sha7(plan)} plan`]);
  assert.ok(!r.stdout.includes(sha7(merge)), `the merge commit is listed:\n${r.stdout}`);
});

test('shipped lists the requirements and pull requests of a release with links', async () => {
  const r = await q(['shipped', 'P1']);
  assert.equal(r.code, 0, r.stderr);
  const out = lines(r.stdout);
  assert.equal(out[0], 'P1 docs/releases/P1.md');
  const reqs = out.indexOf('requirements: 2');
  const prs = out.indexOf('pull requests: 1');
  assert.ok(reqs > 0 && prs > reqs, `requirements, then pull requests:\n${r.stdout}`);
  assert.deepEqual(out.slice(reqs + 1, prs).map((l) => l.trim()), [
    'REQ-1.1 It works  docs/spec/01-x.md:3',
    'REQ-1.3 It answers  docs/spec/01-x.md:19',
  ]);
  assert.deepEqual(out.slice(prs + 1).map((l) => l.trim()), [`#1 [P1/S-01] Thing a ${PR_URL}`]);
});

test('each query prints one JSON document with --json', async () => {
  const parse = (r, what) => {
    assert.equal(r.code, 0, `${what}: ${r.stderr}`);
    try {
      return JSON.parse(r.stdout);
    } catch (e) {
      assert.fail(`${what} --json is not one JSON document (${e.message}):\n${r.stdout}`);
    }
  };
  const bare = (v) => String(v ?? '').replace(/^[a-z-]+:/, '');

  const tree = parse(await q(['trace', 'REQ-1.1', '--json']), 'trace');
  assert.equal(tree.id, 'requirement:REQ-1.1');
  assert.equal(tree.kind, 'requirement');
  assert.equal(tree.label, 'It works');
  assert.equal(tree.from, 'docs/spec/01-x.md:3');
  assert.equal(tree.children[0].id, 'slice:P1/S-01');
  const covering = tree.children.find((c) => c.kind === 'test');
  assert.ok(covering, 'no test child');
  assert.equal(covering.id, 'test:test/a.test.js');
  assert.equal(covering.at, 'test/a.test.js:3');
  assert.ok(Array.isArray(covering.children));

  const above = parse(await q(['trace', '--file', 'src/a.js', '--json']), 'trace --file');
  assert.equal(above.id, 'file:src/a.js');
  assert.equal(above.children[0].id, 'slice:P1/S-01');

  const touched = parse(await q(['history', 'src', '--json']), 'history');
  assert.ok(Array.isArray(touched), 'history --json is not an array');
  assert.deepEqual(touched.map((e) => [bare(e.slice), e.pr, e.verdict, e.release === null ? null : bare(e.release)]), [
    ['P1/S-02', null, null, null],
    ['P1/S-01', 1, 'APPROVE', 'P1'],
  ]);
  assert.equal(touched[1].sha, shared.shas.sliceA);

  const gaps = parse(await q(['uncovered', '--json']), 'uncovered');
  for (const k of ['requirements', 'tests', 'commits']) assert.ok(Array.isArray(gaps[k]), `uncovered --json has no ${k} array`);
  assert.equal(gaps.requirements.length, 2);
  assert.equal(gaps.tests.length, 1);
  assert.equal(gaps.commits.length, 2);

  const release = parse(await q(['shipped', 'P1', '--json']), 'shipped');
  assert.ok(release.release, 'shipped --json has no release');
  assert.equal(release.requirements.length, 2);
  assert.equal(release.pullRequests.length, 1);

  // An unknown ID or path: one JSON document naming it, exit 2.
  for (const args of [['trace', 'REQ-9.9'], ['trace', '--file', 'nope.js'], ['history', 'nope.js'], ['shipped', 'P9']]) {
    const r = await q([...args, '--json']);
    assert.equal(r.code, 2, `${args.join(' ')} --json exits ${r.code}: ${r.stderr}`);
    let doc;
    try {
      doc = JSON.parse(r.stdout);
    } catch (e) {
      assert.fail(`${args.join(' ')} --json is not one JSON document (${e.message}):\n${r.stdout}`);
    }
    assert.equal(doc.error, `${args.at(-1)} is not in the graph`);
  }
});

test('a requirement or path not in the graph exits 2 naming it', async () => {
  const r = await q(['trace', 'REQ-9.9']);
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.stderr, 'slicekit: REQ-9.9 is not in the graph\n');
  assert.equal(r.stdout, '');

  const f = await q(['trace', '--file', 'nope.js']);
  assert.equal(f.code, 2, f.stderr);
  assert.equal(f.stderr, 'slicekit: nope.js is not in the graph\n');

  const h = await q(['history', 'src', 'nope.js']);
  assert.equal(h.code, 2, h.stderr);
  assert.equal(h.stderr, 'slicekit: nope.js is not in the graph\n');
  assert.equal(h.stdout, '');

  const s = await q(['shipped', 'P9']);
  assert.equal(s.code, 2, s.stderr);
  assert.equal(s.stderr, 'slicekit: P9 is not in the graph\n');
});

test('shipped for a phase with no release record is refused', async () => {
  const r = await q(['shipped', 'P2']);
  assert.equal(r.code, 1, `shipped P2 exits ${r.code}: ${r.stderr}`);
  assert.equal(r.stderr, 'slicekit: P2 has no release record\n');
  assert.equal(r.stdout, '');
});

test('a path written with backslashes or a leading ./ finds the same file', async () => {
  const want = await q(['trace', '--file', 'src/a.js']);
  assert.equal(want.code, 0, want.stderr);
  for (const p of ['src\\a.js', './src/a.js', '.\\src\\a.js']) {
    const r = await q(['trace', '--file', p]);
    assert.equal(r.code, 0, `trace --file ${p}: ${r.stderr}`);
    assert.equal(r.stdout, want.stdout, `trace --file ${p}`);
  }

  const dir = await q(['history', 'src']);
  assert.equal(dir.code, 0, dir.stderr);
  assert.ok(dir.stdout !== '', 'history src printed nothing');
  for (const p of ['src\\', './src/', '.\\src']) {
    const r = await q(['history', p]);
    assert.equal(r.code, 0, `history ${p}: ${r.stderr}`);
    assert.equal(r.stdout, dir.stdout, `history ${p}`);
  }
});
