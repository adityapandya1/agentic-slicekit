// REQ-3.11, REQ-3.14: the sync job opens its [sync] pull request with the workflow's own token, which
// GitHub refuses while "Allow GitHub Actions to create and approve pull requests" is off. The
// host-rules rule reads that setting through C-1 readWorkflowPermissions (the fixture's
// workflow-permissions.json) and reports it off: a failure under --ci, a note otherwise. A read the
// host refuses is a note in both. `init --protect` names the setting and never changes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/check/context.js';
import { check } from '../../src/check/index.js';
import { git } from '../../src/git.js';
import hostRules from '../../src/check/rules/host-rules.js';
import { makeRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/run-cli.js';

const rule = (r) => ({ ...r, ruleset_source_type: 'Repository', ruleset_source: 'acme/demo', ruleset_id: 7 });
const EVERY_RULE = [
  rule({ type: 'pull_request', parameters: { required_approving_review_count: 1, require_code_owner_review: false } }),
  rule({ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'gate' }, { context: 'checks' }] } }),
  rule({ type: 'non_fast_forward' }),
];
const permissions = (on) => ({ default_workflow_permissions: 'read', can_approve_pull_request_reviews: on });
const SETTING = /Settings, Actions, General, Workflow permissions, "Allow GitHub Actions to create and approve pull requests"/;

function withHost(files, fn) {
  const repo = makeRepo({ commits: 1 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-actions-'));
  try {
    const { root } = repo;
    init(root, { name: 'demo', shape: 'backend', cli: 'slicekit', commands: { test: 'node --test' } });
    git(root, ['config', '--unset', 'core.hooksPath']);
    for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
    return fn(root, { SLICEKIT_GITHOST_FIXTURE: dir }, dir);
  } finally {
    repo.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const runRule = (root, env, ci) => hostRules.run(buildContext(root, loadConfig(root), { ci, env }));

test('the Actions pull request setting off fails under --ci and is a note otherwise', () => {
  withHost({ 'branch-rules-main.json': EVERY_RULE, 'workflow-permissions.json': permissions(false) }, (root, env) => {
    const inCi = runRule(root, env, true);
    assert.equal(inCi.length, 1);
    assert.equal(inCi[0].note, undefined);
    assert.match(inCi[0].message, SETTING);
    assert.match(inCi[0].message, /approvals still need a human/);
    assert.equal(check(root, { ci: true, env, rules: [hostRules] }).exitCode, 1);

    const local = runRule(root, env, false);
    assert.equal(local.length, 1);
    assert.equal(local[0].note, true);
    const r = check(root, { ci: false, env, rules: [hostRules] });
    assert.equal(r.exitCode, 0, r.lines.join('\n'));
    assert.ok(r.notes.some((n) => SETTING.test(n)), r.notes.join('\n'));
  });
});

test('the Actions pull request setting on, or not known, reports nothing; a refused read is a note', () => {
  withHost({ 'branch-rules-main.json': EVERY_RULE, 'workflow-permissions.json': permissions(true) }, (root, env) => {
    assert.deepEqual(runRule(root, env, true), []);
  });
  withHost({ 'branch-rules-main.json': EVERY_RULE }, (root, env) => {
    assert.deepEqual(runRule(root, env, true), []);
  });
  withHost({ 'branch-rules-main.json': EVERY_RULE, 'workflow-permissions-error.txt': 'HTTP 403: Resource not accessible by integration' }, (root, env) => {
    const found = runRule(root, env, true);
    assert.equal(found.length, 1);
    assert.equal(found[0].note, true);
    assert.match(found[0].message, /^the Actions pull request setting not checked: .*403/);
    assert.equal(check(root, { ci: true, env, rules: [hostRules] }).exitCode, 0);
  });
});

test('init --protect names the Actions pull request setting when it is off and does not change it', () => {
  withHost({ 'branch-rules-main.json': EVERY_RULE, 'workflow-permissions.json': permissions(false) }, (root, env, dir) => {
    const before = fs.readFileSync(path.join(dir, 'workflow-permissions.json'), 'utf8');
    const r = runCli(['init', '--protect'], { cwd: root, env: { ...process.env, ...env } });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const line = r.stdout.split('\n').find((l) => l.startsWith('not set: '));
    assert.ok(line, r.stdout);
    assert.match(line, SETTING);
    assert.match(line, /init --protect does not change it$/);
    assert.equal(fs.readFileSync(path.join(dir, 'workflow-permissions.json'), 'utf8'), before);
  });
  withHost({ 'branch-rules-main.json': EVERY_RULE, 'workflow-permissions.json': permissions(true) }, (root, env) => {
    const r = runCli(['init', '--protect'], { cwd: root, env: { ...process.env, ...env } });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(!r.stdout.includes('not set: '), r.stdout);
  });
});
