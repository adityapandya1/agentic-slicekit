import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handle, normalise } from '../../src/hooks/pre-edit.js';
import { runHook } from '../../src/hooks/io.js';
import { defaultConfig } from '../../src/config.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const WIN = process.platform === 'win32';
const SLICE = 'P1/S-06';
const BRANCH = 'slice/P1-S-06-hooks';
const cfgFor = (over = {}) => ({ ...defaultConfig({ name: 'demo', shape: 'backend' }), ...over });
const FROZEN = 'frozen for P1/S-06; amend the slice file to change the evaluation set';
const NEW_DOC = "no slice starts a document; a document changes only when this slice's code made it wrong";

function writeState(root, state) {
  const file = path.join(root, '.slicekit', 'state', 'P1-S-06.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ slice: SLICE, state: 'building', frozenTests: [], unfrozen: [], ...state }));
}

// A repo on the slice branch with a state file and the given files.
function sliceRepo(state = {}, { branch = BRANCH, files = {} } = {}) {
  const repo = makeRepo({ branch, files: { 'test/a.test.js': 'x', 'docs/runbook.md': '# r', ...files } });
  writeState(repo.root, { frozenTests: ['test/a.test.js'], ...state });
  return repo;
}

function decide(root, filePath, { tool = 'Write', cfg = cfgFor(), cwd = root, key = 'file_path' } = {}) {
  return handle({ session_id: 's', tool_name: tool, tool_input: { [key]: filePath }, cwd }, { root, cfg, env: {} });
}
const reason = (r) => r.hookSpecificOutput?.permissionDecisionReason;
function assertDeny(r, text) {
  assert.equal(r.hookSpecificOutput?.permissionDecision, 'deny', `expected a deny, got ${JSON.stringify(r)}`);
  assert.equal(reason(r), text);
}
function assertAllow(r) {
  assert.deepEqual(r, {}, `expected allow, got ${JSON.stringify(r)}`);
}
const backslashed = (p) => p.replace(/\//g, '\\');

// ---- evaluation set ----

// REQ-3.3
test('backslash path matches frozen file', () => {
  const { root, cleanup } = sliceRepo();
  try {
    assertDeny(decide(root, `${backslashed(root)}\\test\\a.test.js`, { tool: 'Edit' }), FROZEN);
    assertDeny(decide(root, 'test\\a.test.js', { tool: 'Edit' }), FROZEN);
    assertDeny(decide(root, path.join(root, 'test', 'a.test.js'), { tool: 'MultiEdit' }), FROZEN);
    assertDeny(decide(root, 'test/a.test.js', { tool: 'Write' }), FROZEN);
    assertAllow(decide(root, 'test/b.test.js', { tool: 'Edit' }));
  } finally {
    cleanup();
  }
});

// REQ-3.3
test('new doc during build is denied, runbook allowed', () => {
  for (const state of ['building', 'tests-red']) {
    const { root, cleanup } = sliceRepo({ state }, { files: { 'docs/spec/old.md': '# old' } });
    try {
      assertDeny(decide(root, path.join(root, 'docs', 'new.md')), NEW_DOC);
      assertDeny(decide(root, 'docs/spec/new.md'), NEW_DOC);
      assertAllow(decide(root, 'docs/runbook.md'));
      assertAllow(decide(root, 'docs/spec/old.md'));
      assertAllow(decide(root, 'docs/new.md', { tool: 'Edit' }));
      assertAllow(decide(root, 'src/new.js'));
    } finally {
      cleanup();
    }
  }
  const { root, cleanup } = sliceRepo({ state: 'review' });
  try {
    assertAllow(decide(root, 'docs/new.md'));
  } finally {
    cleanup();
  }
});

// REQ-3.3
test('kit-owned files are denied', () => {
  const { root, cleanup } = sliceRepo({ state: 'todo' });
  try {
    for (const tool of ['Edit', 'Write', 'MultiEdit']) {
      assertDeny(decide(root, '.slicekit/journal.log', { tool }), '.slicekit/journal.log is written only by the slicekit CLI');
    }
    assertDeny(decide(root, '.slicekit/state/P1-S-06.json'), '.slicekit/state/P1-S-06.json is written only by the slicekit CLI');
    assertDeny(decide(root, '.slicekit/baselines/coverage.json'), '.slicekit/baselines/coverage.json is written only by the slicekit CLI');
    assertDeny(decide(root, '.slicekit/.subagent-abc'), '.slicekit/.subagent-abc is written only by the slicekit CLI');
    assertAllow(decide(root, '.slicekit/config.json', { tool: 'Edit' }));
  } finally {
    cleanup();
  }
});

// ---- normalisation ----

test('relative path with .. resolves against cwd', () => {
  const { root, cleanup } = sliceRepo({}, { files: { 'src/x.js': '' } });
  try {
    assertDeny(decide(root, '../test/a.test.js', { tool: 'Edit', cwd: path.join(root, 'src') }), FROZEN);
    assertDeny(decide(root, './test/../test/./a.test.js', { tool: 'Edit' }), FROZEN);
    assert.equal(normalise('src/../test/a.test.js', root), 'test/a.test.js');
  } finally {
    cleanup();
  }
});

test('path outside root is allowed', () => {
  const { root, cleanup } = sliceRepo();
  try {
    assertAllow(decide(root, path.join(os.tmpdir(), 'elsewhere', 'a.test.js')));
    assertAllow(decide(root, '../outside/.slicekit/journal.log'));
    assert.equal(normalise(path.join(root, '..', 'x.js'), root), null);
  } finally {
    cleanup();
  }
});

test('win32 Git Bash /c/ form matches', { skip: !WIN && 'win32 only' }, () => {
  const { root, cleanup } = sliceRepo();
  try {
    const posix = root.replace(/\\/g, '/');
    const bash = `/${posix[0].toLowerCase()}${posix.slice(2)}/test/a.test.js`;
    assertDeny(decide(root, bash, { tool: 'Edit' }), FROZEN);
  } finally {
    cleanup();
  }
});

test('case difference matches on win32 only', () => {
  const { root, cleanup } = sliceRepo();
  try {
    const r = decide(root, 'TEST/A.test.js', { tool: 'Edit' });
    if (WIN) assertDeny(r, FROZEN);
    else assertAllow(r);
  } finally {
    cleanup();
  }
});

test('NotebookEdit notebook_path is guarded', () => {
  const { root, cleanup } = sliceRepo({ frozenTests: ['test/a.test.js', 'test/nb.ipynb'] }, { files: { 'test/nb.ipynb': '{}' } });
  try {
    assertDeny(decide(root, 'test/nb.ipynb', { tool: 'NotebookEdit', key: 'notebook_path' }), FROZEN);
    assertDeny(decide(root, 'docs/new.ipynb', { tool: 'NotebookEdit', key: 'notebook_path' }), NEW_DOC);
    assertDeny(decide(root, '.slicekit/journal.log', { tool: 'NotebookEdit', key: 'notebook_path' }),
      '.slicekit/journal.log is written only by the slicekit CLI');
  } finally {
    cleanup();
  }
});

// ---- the rules' conditions ----

test('phase-file write allowed during build', () => {
  const { root, cleanup } = sliceRepo({}, { files: { 'docs/phases/P1-spine/P1.md': '# Phase 1 - spine' } });
  try {
    assertAllow(decide(root, 'docs/phases/P1-spine/S-06-pr-notes.md'));
    assertDeny(decide(root, 'docs/phases/P2-loop/S-01-x.md'), NEW_DOC);
  } finally {
    cleanup();
  }
});

test('docsRoot comes from config', () => {
  const { root, cleanup } = sliceRepo({}, { files: { 'handbook/runbook.md': '# r' } });
  try {
    const cfg = cfgFor({ docsRoot: 'handbook' });
    assertDeny(decide(root, 'handbook/new.md', { cfg }), NEW_DOC);
    assertAllow(decide(root, 'handbook/runbook.md', { cfg }));
    assertAllow(decide(root, 'docs/new.md', { cfg }));
  } finally {
    cleanup();
  }
});

test('no active slice allows a frozen-looking file', () => {
  const onMain = sliceRepo({}, { branch: 'main' });
  try {
    assertAllow(decide(onMain.root, 'test/a.test.js', { tool: 'Edit' }));
    assertAllow(decide(onMain.root, 'docs/new.md'));
    assertDeny(decide(onMain.root, '.slicekit/journal.log'), '.slicekit/journal.log is written only by the slicekit CLI');
  } finally {
    onMain.cleanup();
  }
  const noState = makeRepo({ branch: BRANCH, files: { 'test/a.test.js': 'x' } });
  try {
    assertAllow(decide(noState.root, 'test/a.test.js', { tool: 'Edit' }));
  } finally {
    noState.cleanup();
  }
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-norepo-'));
  try {
    assertAllow(decide(notRepo, 'test/a.test.js', { tool: 'Edit' }));
    assertDeny(decide(notRepo, '.slicekit/baselines/x.json'), '.slicekit/baselines/x.json is written only by the slicekit CLI');
  } finally {
    fs.rmSync(notRepo, { recursive: true, force: true });
  }
});

test('unfrozen lets one file through', () => {
  const { root, cleanup } = sliceRepo({ frozenTests: ['test/a.test.js', 'test/b.test.js'], unfrozen: ['test\\a.test.js'] });
  try {
    assertAllow(decide(root, 'test/a.test.js', { tool: 'Edit' }));
    assertDeny(decide(root, 'test/b.test.js', { tool: 'Edit' }), FROZEN);
  } finally {
    cleanup();
  }
});

test('frozen tests are free outside tests-red and building, and with freezeTests off', () => {
  const review = sliceRepo({ state: 'review' });
  try {
    assertAllow(decide(review.root, 'test/a.test.js', { tool: 'Edit' }));
  } finally {
    review.cleanup();
  }
  const { root, cleanup } = sliceRepo();
  try {
    assertAllow(decide(root, 'test/a.test.js', { tool: 'Edit', cfg: cfgFor({ freezeTests: false }) }));
  } finally {
    cleanup();
  }
});

test('a missing path or an unreadable state file fails closed through runHook', async () => {
  const { root, cleanup } = sliceRepo();
  try {
    fs.writeFileSync(path.join(root, '.slicekit', 'config.json'), JSON.stringify(cfgFor()));
    const ok = await runHook('pre-edit', {
      stdin: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/x.js' }, cwd: root }), root,
    });
    assert.equal(ok.stdout, '{}');
    const missing = await runHook('pre-edit', { stdin: JSON.stringify({ tool_name: 'Edit', tool_input: {}, cwd: root }), root });
    assert.equal(JSON.parse(missing.stdout).hookSpecificOutput.permissionDecision, 'deny');
    fs.writeFileSync(path.join(root, '.slicekit', 'state', 'P1-S-06.json'), '{not json');
    const broken = await runHook('pre-edit', {
      stdin: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/x.js' }, cwd: root }), root,
    });
    assert.equal(JSON.parse(broken.stdout).hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    cleanup();
  }
});
