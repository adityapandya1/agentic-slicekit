// P8/S-61 (REQ-3.7, REQ-1.5, D-103): the lane rule. A slice marked `lane: quick` whose expected
// changes, or whose branch's changes against the default branch, reach `src/`, `bin/` or `templates/`
// is a finding naming the slice and the path. A quick slice that expects and changes only docs is none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/check/context.js';
import { git } from '../../src/git.js';
import { commit, makeRepo } from '../helpers/tmp-repo.js';

const SLICE = 'P1/S-01';
const BRANCH = 'slice/P1-S-01-a';
const SLICE_FILE = 'docs/phases/P1-x/S-01-a.md';

// The rule, loaded when a test runs, so a missing rule fails each test on its own.
const loadRule = async () => (await import('../../src/check/rules/lane.js')).default;

const write = (root, rel, text) => {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

// A slice file for P1/S-01 marked `lane: quick`, expecting only `docs/a.md`.
const quickSlice = `---
slice: ${SLICE}
name: Fixture 1
repo: .
group: B
runbook: no
lane: quick
requirements: [REQ-1.8]
decisions: []
---

## Done when

1. The page says it.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| \`a.test.js » the page says it\` | happy | REQ-1.8 |
| \`a.test.js » the page says nothing else\` | negative | REQ-1.8 |

## Expected changes

\`docs/a.md\`.
`;

// An initialised repo with the quick slice file committed on main and the git hooks switched off, so
// each commit carries only what the test writes; then the slice branch is checked out, on which
// `files` ({ rel: text }) are committed. `fn` gets the root.
async function withBranch(files, fn) {
  const repo = makeRepo({ commits: 1 });
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    git(repo.root, ['config', '--unset', 'core.hooksPath']);
    git(repo.root, ['reset', '-q']);
    write(repo.root, SLICE_FILE, quickSlice);
    git(repo.root, ['add', '-A']);
    commit(repo.root, 'setup', { allowEmpty: false });
    git(repo.root, ['checkout', '-q', '-b', BRANCH]);
    for (const [rel, text] of Object.entries(files)) write(repo.root, rel, text);
    git(repo.root, ['add', '--', ...Object.keys(files)]);
    commit(repo.root, `work\n\nSlice: ${SLICE}`, { allowEmpty: false });
    return await fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

test('a quick slice whose branch changes a file under src is a finding naming the path', async () => {
  const rule = await loadRule();
  assert.equal(rule.id, 'lane');
  assert.equal(rule.blocking, true);
  await withBranch({ 'docs/a.md': '# A\n', 'src/init.js': 'export const x = 1;\n' }, async (root) => {
    const found = await rule.run(buildContext(root, loadConfig(root)));
    assert.ok(Array.isArray(found), String(found));
    const naming = found.filter((f) => f.message.includes('src/init.js'));
    assert.equal(naming.length, 1, JSON.stringify(found));
    assert.ok(naming[0].message.includes(SLICE), naming[0].message);
    // The expected changes name only docs, so the branch's change is the one finding.
    assert.equal(found.length, 1, JSON.stringify(found));
  });
});

test('a quick slice that expects only docs is no finding', async () => {
  const rule = await loadRule();
  await withBranch({ 'docs/a.md': '# A\n' }, async (root) => {
    const found = await rule.run(buildContext(root, loadConfig(root)));
    assert.deepEqual(found, []);
  });
});
