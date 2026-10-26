import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../../src/config.js';
import { git } from '../../src/git.js';
import { buildContext } from '../../src/check/context.js';
import coverage, { expand } from '../../src/check/rules/coverage.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'stage');
const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
const PLAN = ['after-intake', 'after-plan'];

const slice = (id, { group = 'B', requirements = '[REQ-1.1]', changes = ['src/a.js'], kinds = ['happy', 'negative'] } = {}) => `---
slice: ${id}
name: Fixture ${id}
repo: .
group: ${group}
runbook: no
requirements: ${requirements}
decisions: [D-01]
---

## Done when

1. It works.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
${kinds.map((k) => `| \`a.test.js » ${k}\` | ${k} | REQ-1.1 |`).join('\n')}

## Expected changes

${changes.map((c) => `- \`${c}\``).join('\n')}
`;

const UNCOVERED = `
### REQ-1.2 The other thing works

The other thing SHALL work.

Scenario: GIVEN a thing WHEN it runs THEN it works.

Cites: D-01.

Enforced by: advisory
`;

const BUILDING = JSON.stringify({ slice: 'P1/S-01', state: 'building' });

// Copies the fixture points into a temp repo, writes `files` over them, and commits unless told not
// to; then runs the coverage rule on it and returns its findings. With `docsRoot`, the fixtures'
// `docs/` is moved there and the config says so; `files` keys are then relative to the repo root.
function findings(points, { files = {}, commit = true, after = {}, docsRoot = 'docs' } = {}) {
  const repo = makeRepo();
  const write = (rel, text) => {
    const f = path.join(repo.root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof text === 'function' ? text(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '') : text);
  };
  try {
    for (const p of points) fs.cpSync(path.join(FIXTURES, p), repo.root, { recursive: true });
    if (docsRoot !== 'docs') fs.renameSync(path.join(repo.root, 'docs'), path.join(repo.root, ...docsRoot.split('/')));
    for (const [rel, text] of Object.entries(files)) write(rel, text);
    if (commit) {
      git(repo.root, ['add', '-A']);
      git(repo.root, ['commit', '-m', 'fixture']);
    }
    for (const [rel, text] of Object.entries(after)) write(rel, text);
    return coverage.run(buildContext(repo.root, { ...cfg, docsRoot }));
  } finally {
    repo.cleanup();
  }
}

test('the rule is blocking and not a ratchet', () => {
  assert.equal(coverage.id, 'coverage');
  assert.equal(coverage.blocking, true);
  assert.equal(coverage.ratchet, false);
});

test('uncovered REQ after plan is a finding', () => {
  const at = [{ file: 'docs/spec/a.md', line: 13, message: 'REQ-1.2 is named by no slice' }];
  // The program is at plan (the spec is merged, the plan does not yet name REQ-1.2): a finding on its heading.
  assert.deepEqual(findings(PLAN, { files: { 'docs/spec/a.md': (t) => t + UNCOVERED } }), at);
  // Plan merged and its one slice merged since: still a finding.
  assert.deepEqual(findings([...PLAN, 'all-merged']), []);
  assert.deepEqual(findings([...PLAN, 'all-merged'], { files: { 'docs/spec/a.md': (t) => t + UNCOVERED } }), at);
});

test('the plan branch is checked before it merges', () => {
  // main holds the plan; a slice file written on the plan branch, not yet committed, overlaps S-01.
  const out = findings(PLAN, { after: { 'docs/phases/P1-x/S-02-b.md': slice('P1/S-02') } });
  assert.deepEqual(out, [{ file: 'docs/phases/P1-x/S-02-b.md', line: 24, message: 'slices P1/S-01 and P1/S-02 in group B both expect src/a.js' }]);
});

test('a brace pattern is expanded before comparing', () => {
  const out = findings(PLAN, {
    files: {
      'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { changes: ['src/cli/{state,status}.js'] }),
      'docs/phases/P1-x/S-02-b.md': slice('P1/S-02', { changes: ['src/x.js', 'src/cli/status.js'] }),
    },
  });
  assert.deepEqual(out, [{ file: 'docs/phases/P1-x/S-02-b.md', line: 25, message: 'slices P1/S-01 and P1/S-02 in group B both expect src/cli/status.js' }]);
});

test('nested and repeated brace groups are expanded fully', () => {
  assert.deepEqual(expand('src/{a,b/{c,d}}.js').sort(), ['src/a.js', 'src/b/c.js', 'src/b/d.js'].sort());
  assert.deepEqual(expand('src/{a,b}/{c,d}.js').sort(), ['src/a/c.js', 'src/a/d.js', 'src/b/c.js', 'src/b/d.js']);
  assert.deepEqual(expand('src/{x,{y,z}/{p,q}}.js').length, 5);
});

test('an overlap that only a nested expansion reveals is a finding', () => {
  const out = findings(PLAN, {
    files: {
      'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { changes: ['src/{a,b/{c,d}}.js'] }),
      'docs/phases/P1-x/S-02-b.md': slice('P1/S-02', { changes: ['src/x.js', 'src/b/d.js'] }),
    },
  });
  assert.deepEqual(out, [{ file: 'docs/phases/P1-x/S-02-b.md', line: 25, message: 'slices P1/S-01 and P1/S-02 in group B both expect src/b/d.js' }]);
});

test('a slice that lists no expected changes is a finding', () => {
  const empty = findings(PLAN, { files: { 'docs/phases/P1-x/S-02-b.md': slice('P1/S-02', { changes: [] }) } });
  assert.deepEqual(empty, [{ file: 'docs/phases/P1-x/S-02-b.md', line: 22, message: 'slice P1/S-02 lists no expected changes' }]);
  const missing = findings(PLAN, {
    files: { 'docs/phases/P1-x/S-02-b.md': slice('P1/S-02').replace(/## Expected changes[\s\S]*$/, '') },
  });
  assert.deepEqual(missing, [{ file: 'docs/phases/P1-x/S-02-b.md', line: 1, message: 'slice P1/S-02 lists no expected changes' }]);
});

test('a corrupt state file is a finding and opens the gate', () => {
  // Nothing is committed, so only the state file could open the gate; it does not parse.
  const out = findings(PLAN, {
    commit: false,
    files: { 'docs/spec/a.md': (t) => t + UNCOVERED, '.slicekit/state/P1-S-01.json': '{ not json' },
  });
  assert.deepEqual(out, [
    { file: '.slicekit/state/P1-S-01.json', line: 1, message: 'state file .slicekit/state/P1-S-01.json is not valid JSON' },
    { file: 'docs/spec/a.md', line: 13, message: 'REQ-1.2 is named by no slice' },
  ]);
});

test('overlapping expected changes in one group is a finding', () => {
  const out = findings(PLAN, {
    files: {
      'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { changes: ['src/billing/', 'src/a.js'] }),
      'docs/phases/P1-x/S-02-b.md': slice('P1/S-02', { changes: ['./src/billing/invoice.js', 'src/a.js/', 'src/b.js'] }),
    },
  });
  assert.deepEqual(out, [
    { file: 'docs/phases/P1-x/S-02-b.md', line: 24, message: 'slices P1/S-01 and P1/S-02 in group B both expect src/billing/invoice.js' },
    { file: 'docs/phases/P1-x/S-02-b.md', line: 25, message: 'slices P1/S-01 and P1/S-02 in group B both expect src/a.js' },
  ]);
  // A path segment is not a prefix of a longer segment: `src/a` and `src/ab.js` do not overlap.
  const apart = findings(PLAN, {
    files: {
      'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { changes: ['src/a'] }),
      'docs/phases/P1-x/S-02-b.md': slice('P1/S-02', { changes: ['src/ab.js'] }),
    },
  });
  assert.deepEqual(apart, []);
});

test('before plan, coverage is silent', () => {
  assert.deepEqual(findings(['after-intake']), []);
  // The plan is written but not merged and nothing is building: an uncovered REQ and an overlap say nothing yet.
  const out = findings(PLAN, {
    commit: false,
    files: {
      'docs/spec/a.md': (t) => t + UNCOVERED,
      'docs/phases/P1-x/S-02-b.md': slice('P1/S-02'),
    },
  });
  assert.deepEqual(out, []);
});

test('a building slice counts as planned', () => {
  // The plan never merged (nothing is committed), but a slice is building: the program is past planning.
  const out = findings(PLAN, {
    commit: false,
    files: {
      'docs/spec/a.md': (t) => t + UNCOVERED,
      '.slicekit/state/P1-S-01.json': BUILDING,
    },
  });
  assert.deepEqual(out, [{ file: 'docs/spec/a.md', line: 13, message: 'REQ-1.2 is named by no slice' }]);
});

test('test/ and src/cli/index.js never overlap', () => {
  const shared = ['.', 'test/', 'test/check/a.test.js', 'src/cli/index.js'];
  const out = findings(PLAN, {
    files: {
      'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { changes: [...shared, 'src/x.js'] }),
      'docs/phases/P1-x/S-02-b.md': slice('P1/S-02', { changes: [...shared, 'src/x.js', 'src/b.js'] }),
    },
  });
  // The rule is speaking (src/x.js is reported), and nothing else the two share is.
  assert.deepEqual(out, [{ file: 'docs/phases/P1-x/S-02-b.md', line: 28, message: 'slices P1/S-01 and P1/S-02 in group B both expect src/x.js' }]);
});

test('the runbook never overlaps, wherever the docs root is', () => {
  const out = findings(PLAN, {
    files: {
      'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { changes: ['docs/runbook.md', 'src/x.js'] }),
      'docs/phases/P1-x/S-02-b.md': slice('P1/S-02', { changes: ['./docs/runbook.md', 'src/x.js'] }),
    },
  });
  assert.deepEqual(out, [{ file: 'docs/phases/P1-x/S-02-b.md', line: 25, message: 'slices P1/S-01 and P1/S-02 in group B both expect src/x.js' }]);

  // Under another docs root the runbook is `handbook/runbook.md`; `docs/runbook.md` is then an
  // ordinary path and still overlaps.
  const moved = findings(PLAN, {
    docsRoot: 'handbook',
    files: {
      'handbook/phases/P1-x/S-01-a.md': slice('P1/S-01', { changes: ['handbook/runbook.md', 'docs/runbook.md'] }),
      'handbook/phases/P1-x/S-02-b.md': slice('P1/S-02', { changes: ['handbook/runbook.md', 'docs/runbook.md'] }),
    },
  });
  assert.deepEqual(moved, [
    { file: 'handbook/phases/P1-x/S-02-b.md', line: 25, message: 'slices P1/S-01 and P1/S-02 in group B both expect docs/runbook.md' },
  ]);
});

test('different groups may overlap', () => {
  const out = findings(PLAN, {
    files: {
      'docs/phases/P1-x/S-02-b.md': slice('P1/S-02', { group: 'C', changes: ['src/a.js', 'src/c.js'] }),
      'docs/phases/P1-x/S-03-c.md': slice('P1/S-03', { group: 'C', changes: ['src/c.js'] }),
    },
  });
  // S-01 (group B) and S-02 (group C) both expect src/a.js: not a finding. S-02 and S-03 share group C.
  assert.deepEqual(out, [{ file: 'docs/phases/P1-x/S-03-c.md', line: 24, message: 'slices P1/S-02 and P1/S-03 in group C both expect src/c.js' }]);
});

test('an unparseable slice file is a finding, not a crash', () => {
  const out = findings(PLAN, {
    commit: false,
    files: {
      '.slicekit/state/P1-S-01.json': BUILDING,
      'docs/phases/P1-x/S-02-b.md': '---\nslice: P1/S-02\n---\n',
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].file, 'docs/phases/P1-x/S-02-b.md');
  assert.equal(out[0].line, 1);
  assert.match(out[0].message, /^slice file cannot be read: .*missing front-matter field "name"/);
});

const phase = (order) => `# Phase 1 — X

${order === null ? 'No Order line.' : `**Order:** ${order}`}
`;

test('a slice with no negative test is a finding', () => {
  // REQ-2.5: each slice's evaluation set has at least one happy and one negative test.
  const out = findings(PLAN, { files: { 'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { kinds: ['happy'] }) } });
  assert.deepEqual(out, [{ file: 'docs/phases/P1-x/S-01-a.md', line: 1, message: 'slice P1/S-01 has no negative test' }]);
  const noHappy = findings(PLAN, { files: { 'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { kinds: ['negative', 'e2e'] }) } });
  assert.deepEqual(noHappy, [{ file: 'docs/phases/P1-x/S-01-a.md', line: 1, message: 'slice P1/S-01 has no happy test' }]);
  // Before plan, silent like the rule's other findings.
  const early = findings(PLAN, { commit: false, files: { 'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { kinds: ['happy'] }) } });
  assert.deepEqual(early, []);
});

test('an Order line missing a group is a finding', () => {
  // REQ-2.5 / D-38: the Order line names every group of the phase once, and only groups a slice has.
  const two = {
    'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { group: 'A' }),
    'docs/phases/P1-x/S-02-b.md': slice('P1/S-02', { group: 'B', changes: ['src/b.js'] }),
  };
  const at = (message) => [{ file: 'docs/phases/P1-x/P1.md', line: 3, message }];
  assert.deepEqual(findings(PLAN, { files: { ...two, 'docs/phases/P1-x/P1.md': phase('A') } }), at('phase P1 Order line does not name group B'));
  assert.deepEqual(findings(PLAN, { files: { ...two, 'docs/phases/P1-x/P1.md': phase('A; B; B') } }), at('phase P1 Order line names group B twice'));
  assert.deepEqual(
    findings(PLAN, { files: { ...two, 'docs/phases/P1-x/P1.md': phase('A; B, C') } }),
    at('phase P1 Order line names group C, which no slice has'),
  );
  // A complete line, and a phase with no Order line, give nothing.
  assert.deepEqual(findings(PLAN, { files: { ...two, 'docs/phases/P1-x/P1.md': phase('A; B') } }), []);
  assert.deepEqual(findings(PLAN, { files: { ...two, 'docs/phases/P1-x/P1.md': phase(null) } }), []);
});

test('slices in one Order step are checked for overlap', () => {
  // D-38: the groups of one step run at the same time, so their slices must not share a path.
  const files = {
    'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { group: 'B', changes: ['src/x.js'] }),
    'docs/phases/P1-x/S-02-b.md': slice('P1/S-02', { group: 'C', changes: ['src/x.js'] }),
    'docs/phases/P1-x/S-03-c.md': slice('P1/S-03', { group: 'A', changes: ['src/x.js'] }),
  };
  assert.deepEqual(findings(PLAN, { files: { ...files, 'docs/phases/P1-x/P1.md': phase('A; B, C') } }), [
    { file: 'docs/phases/P1-x/S-02-b.md', line: 24, message: 'slices P1/S-01 and P1/S-02 in step B, C both expect src/x.js' },
  ]);
  assert.deepEqual(findings(PLAN, { files: { ...files, 'docs/phases/P1-x/P1.md': phase('A; B; C') } }), []);
  // Without an Order line each group is its own step: B and C do not overlap.
  assert.deepEqual(findings(PLAN, { files: { ...files, 'docs/phases/P1-x/P1.md': phase(null) } }), []);
});

test('a group named in two steps is checked for overlap in each', () => {
  // D-38: a group named twice is a finding, and its overlaps in every step that names it all show.
  const files = {
    'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { group: 'A', changes: ['src/x.js'] }),
    'docs/phases/P1-x/S-02-b.md': slice('P1/S-02', { group: 'B', changes: ['src/x.js', 'src/y.js'] }),
    'docs/phases/P1-x/S-03-c.md': slice('P1/S-03', { group: 'C', changes: ['src/y.js'] }),
    'docs/phases/P1-x/P1.md': phase('A, B; B, C'),
  };
  assert.deepEqual(findings(PLAN, { files }), [
    { file: 'docs/phases/P1-x/P1.md', line: 3, message: 'phase P1 Order line names group B twice' },
    { file: 'docs/phases/P1-x/S-02-b.md', line: 24, message: 'slices P1/S-01 and P1/S-02 in step A, B both expect src/x.js' },
    { file: 'docs/phases/P1-x/S-03-c.md', line: 24, message: 'slices P1/S-02 and P1/S-03 in step B, C both expect src/y.js' },
  ]);
});

test('a second Order line is a finding', () => {
  // D-38: a phase file carries one Order line; the first is the one followed.
  const files = {
    'docs/phases/P1-x/S-01-a.md': slice('P1/S-01', { group: 'A' }),
    'docs/phases/P1-x/P1.md': `${phase('A')}\n**Order:** A\n`,
  };
  assert.deepEqual(findings(PLAN, { files }), [{ file: 'docs/phases/P1-x/P1.md', line: 5, message: 'phase P1 has more than one Order line' }]);
});
