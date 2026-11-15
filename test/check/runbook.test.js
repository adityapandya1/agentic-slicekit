// P5/S-21, REQ-3.7, D-21, D-55: the runbook rule. On a slice branch whose slice says `runbook: yes`
// and whose state is draft-pr or later, a pull request body whose Runbook line does not begin
// "no operational change", on a branch that changed no `##` section of the runbook, is one finding
// at the slice file's `runbook:` line. With no body the rule does not judge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { writeSlice } from '../../src/state/index.js';
import { buildContext } from '../../src/check/context.js';
import { git } from '../../src/git.js';
import runbook from '../../src/check/rules/runbook.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const BRANCH = 'slice/P1-S-01-a';
const SLICE_REL = 'docs/phases/P1-x/S-01-a.md';
const RUNBOOK_REL = 'docs/runbook.md';
const MESSAGE = `runbook: the slice says runbook: yes, ${RUNBOOK_REL} changed no section, and the Runbook line does not begin "no operational change"`;

const SLICE = `---
slice: P1/S-01
name: Fixture 1
repo: .
group: A
runbook: yes
requirements: [REQ-1.8]
decisions: []
---

## Done when

1. It works.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| \`a.test.js » works\` | happy | REQ-1.8 |

## Expected changes

\`src/a.js\`.
`;

const RUNBOOK = `# Runbook

How the thing is run.

## Rollback

Revert the pull request.

## Alerts

None yet.
`;

const body = (runbookLine) =>
  `## [P1/S-01] Fixture 1\n\n**Done when:** it works\n**Proof:** node --test → exit 0\n**Decisions:** none\n**Runbook:** ${runbookLine}\n`;

function write(root, rel, text) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

// An initialised repository whose default branch holds slice P1/S-01 (`runbook: yes`, state
// draft-pr) and a runbook with `# Runbook`, `## Rollback` and `## Alerts`; then the slice branch,
// on which `change` writes what the branch adds. The git hooks are switched off, so a commit
// carries only what the test gives it. `fn` gets `run(env)`, the rule's findings under that env.
function withBranch(change, fn) {
  const repo = makeRepo();
  try {
    const { root } = repo;
    init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    git(root, ['config', '--unset', 'core.hooksPath']);
    const cfg = loadConfig(root);
    write(root, SLICE_REL, SLICE);
    write(root, RUNBOOK_REL, RUNBOOK);
    writeSlice(root, cfg, { slice: 'P1/S-01', state: 'draft-pr', branch: BRANCH, pr: { number: 1, url: 'http://x/1', headSha: 'abc1234' } });
    commitAll(root, 'plan');
    git(root, ['checkout', '-q', '-b', BRANCH]);
    change(root);
    commitAll(root, 'feat(P1/S-01): work\n\nSlice: P1/S-01');
    const run = (env) => runbook.run(buildContext(root, cfg, { env }));
    return fn({ root, run });
  } finally {
    repo.cleanup();
  }
}

const codeOnly = (root) => write(root, 'src/a.js', 'export const a = 1;\n');
// The line of `runbook:` in the slice file, 1-based.
const flagLine = SLICE.split('\n').findIndex((l) => l.startsWith('runbook:')) + 1;
const FINDING = { file: SLICE_REL, line: flagLine, message: MESSAGE };

// REQ-3.7: the flag is set, the branch changed no section of the runbook, and the body's Runbook
// line does not begin "no operational change".
test('a runbook flag with no runbook section changed is a finding', () => {
  assert.equal(runbook.id, 'runbook');
  assert.equal(runbook.blocking, true);
  assert.equal(runbook.ratchet, false);
  withBranch(codeOnly, ({ run }) => {
    assert.deepEqual(run({ SLICEKIT_PR_BODY: body('see docs') }), [FINDING]);
  });
});

// REQ-3.7, D-55: a line added inside a `##` section is a changed section.
test('a changed runbook section passes', () => {
  withBranch(
    (root) => {
      codeOnly(root);
      write(root, RUNBOOK_REL, `${RUNBOOK}\nPage the owner when the queue is over 100.\n`);
    },
    ({ run }) => {
      assert.deepEqual(run({ SLICEKIT_PR_BODY: body('see docs') }), []);
    },
  );
});

// REQ-3.7, D-21: the slice says why the runbook did not change.
test('a body whose Runbook line begins no operational change passes', () => {
  withBranch(codeOnly, ({ run }) => {
    assert.deepEqual(run({ SLICEKIT_PR_BODY: body('no operational change: docs only') }), []);
  });
});

// D-55: a change above the first `##` heading lies in no section.
test('a change above the first section heading is not a section change', () => {
  withBranch(
    (root) => {
      codeOnly(root);
      write(root, RUNBOOK_REL, RUNBOOK.replace('# Runbook\n', '# Runbook: demo\n'));
    },
    ({ run }) => {
      assert.deepEqual(run({ SLICEKIT_PR_BODY: body('see docs') }), [FINDING]);
    },
  );
});

// D-55: a local run has no pull request body, and `build pr` already refuses without one.
test('with no pull request body the rule does not judge', () => {
  withBranch(codeOnly, ({ run }) => {
    assert.deepEqual(run({}), []);
    // The same branch is a finding once a body is given, so the empty answer is the missing body's.
    assert.deepEqual(run({ SLICEKIT_PR_BODY: body('see docs') }), [FINDING]);
  });
});
