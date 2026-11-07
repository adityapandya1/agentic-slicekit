// REQ-3.14: `slicekit check` reads the repository rulesets that apply to the default branch and the
// CODEOWNERS file through C-1, and fails naming each rule missing. The git host is the fixture
// (SLICEKIT_GITHOST_FIXTURE): branch-rules-<branch>.json is what `gh api .../rules/branches/<branch>`
// prints, branch-<branch>.json what `gh api .../branches/<branch>` prints, codeowners.json the file
// GitHub would read, and branch-rules-error.txt a host that refuses the read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/check/context.js';
import { check } from '../../src/check/index.js';
import { git } from '../../src/git.js';
import hostRules from '../../src/check/rules/host-rules.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..', 'src');
const BIN = path.resolve(here, '..', '..', 'bin');

// The checks a merge waits on in the generated workflow: the gate and the checks job (B-1).
const CHECKS = ['gate', 'checks'];

const pullRequestRule = (params = {}) => ({
  type: 'pull_request',
  parameters: {
    required_approving_review_count: 1,
    dismiss_stale_reviews_on_push: false,
    require_code_owner_review: false,
    require_last_push_approval: false,
    required_review_thread_resolution: false,
    ...params,
  },
  ruleset_source_type: 'Repository',
  ruleset_source: 'acme/demo',
  ruleset_id: 7,
});
const checksRule = (contexts) => ({
  type: 'required_status_checks',
  parameters: { strict_required_status_checks_policy: false, required_status_checks: contexts.map((context) => ({ context })) },
  ruleset_source_type: 'Repository',
  ruleset_source: 'acme/demo',
  ruleset_id: 7,
});
const noForcePush = { type: 'non_fast_forward', ruleset_source_type: 'Repository', ruleset_source: 'acme/demo', ruleset_id: 7 };
const EVERY_RULE = [pullRequestRule(), checksRule(CHECKS), noForcePush];

// An init'd repository with a test command and a git host fixture holding `files`; `fn` gets the
// root, the environment that names the fixture, and the fixture directory.
function withHost(files, fn) {
  const repo = makeRepo({ commits: 1 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-host-'));
  try {
    const { root } = repo;
    init(root, { name: 'demo', shape: 'backend', cli: 'slicekit', commands: { test: 'node --test' } });
    git(root, ['config', '--unset', 'core.hooksPath']);
    for (const [name, value] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
    }
    return fn(root, { SLICEKIT_GITHOST_FIXTURE: dir }, dir);
  } finally {
    repo.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const runRule = (root, env, ci = false) => hostRules.run(buildContext(root, loadConfig(root), { ci, env }));
const messages = (root, env, ci = false) => runRule(root, env, ci).map((f) => f.message);

test('a default branch with every rule passes', () => {
  withHost({ 'branch-rules-main.json': EVERY_RULE }, (root, env) => {
    assert.deepEqual(messages(root, env), []);
    assert.deepEqual(messages(root, env, true), []);
  });
  // With CODEOWNERS, the approving review must come from a code owner; a ruleset that asks for one passes.
  const owned = [pullRequestRule({ require_code_owner_review: true }), checksRule([...CHECKS, 'extra']), noForcePush];
  withHost({ 'branch-rules-main.json': owned, 'codeowners.json': { path: '.github/CODEOWNERS', text: '* @acme/team\n' } }, (root, env) => {
    assert.deepEqual(messages(root, env, true), []);
    const r = check(root, { ci: true, env, rules: [hostRules] });
    assert.equal(r.exitCode, 0, r.lines.join('\n'));
  });
});

test('each missing rule is a finding naming it', () => {
  // A default branch that allows a direct push: every rule is missing, one finding each.
  withHost({ 'branch-rules-main.json': [] }, (root, env) => {
    const found = messages(root, env, true);
    assert.equal(found.length, 4, found.join('\n'));
    assert.ok(found.includes('main: a pull request is not required before merge; run slicekit init --protect as an admin'), found.join('\n'));
    assert.ok(found.some((m) => /^main: no approving review is required\b/.test(m)), found.join('\n'));
    assert.ok(found.some((m) => /^main: the kit's CI checks are not required: gate, checks\b/.test(m)), found.join('\n'));
    assert.ok(found.some((m) => /^main: force push is not refused\b/.test(m)), found.join('\n'));
    for (const m of found) assert.match(m, /; run slicekit init --protect as an admin$/);
    const r = check(root, { ci: false, env, rules: [hostRules] });
    assert.equal(r.exitCode, 1);
  });
  // One rule missing at a time: only that one is named.
  const cases = [
    [[pullRequestRule({ required_approving_review_count: 0 }), checksRule(CHECKS), noForcePush], /^main: no approving review is required\b/],
    [[pullRequestRule(), checksRule(['gate']), noForcePush], /^main: the kit's CI checks are not required: checks;/],
    [[pullRequestRule(), checksRule(CHECKS)], /^main: force push is not refused\b/],
  ];
  for (const [rules, expected] of cases) {
    withHost({ 'branch-rules-main.json': rules }, (root, env) => {
      const found = messages(root, env, true);
      assert.equal(found.length, 1, found.join('\n'));
      assert.match(found[0], expected);
    });
  }
  // CODEOWNERS exists but the review need not come from a code owner.
  withHost({ 'branch-rules-main.json': EVERY_RULE, 'codeowners.json': { path: 'CODEOWNERS', text: '* @acme/team\n' } }, (root, env) => {
    const found = messages(root, env, true);
    assert.equal(found.length, 1, found.join('\n'));
    assert.match(found[0], /^main: the approving review is not required to come from a code owner \(CODEOWNERS\)/);
  });
  // Classic branch protection alone: told to move to a ruleset.
  withHost({ 'branch-rules-main.json': [], 'branch-main.json': { name: 'main', protected: true, protection: { enabled: true } } }, (root, env) => {
    const found = messages(root, env, true);
    assert.ok(found.some((m) => /^main: protected by classic branch protection only; move to a repository ruleset/.test(m)), found.join('\n'));
  });
});

test('unreadable rules fail in CI and warn outside it', () => {
  withHost({ 'branch-rules-error.txt': 'HTTP 403: Resource not accessible by integration' }, (root, env) => {
    const inCi = runRule(root, env, true);
    assert.equal(inCi.length, 1);
    assert.match(inCi[0].message, /^main: host rules not checked: /);
    const ci = check(root, { ci: true, env, rules: [hostRules] });
    assert.equal(ci.exitCode, 1, ci.lines.join('\n'));

    const local = check(root, { ci: false, env, rules: [hostRules] });
    assert.equal(local.exitCode, 0, local.lines.join('\n'));
    assert.equal(local.blocking, 0);
    assert.ok(local.lines.some((l) => l.includes('host rules not checked')), local.lines.join('\n'));
  });
});

// Every call of applyBranchRules in the kit's code, outside the git host adapters that define it.
function callers(dir) {
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.[cm]?js$/.test(e.name)) {
        const rel = path.relative(path.dirname(SRC), abs).split(path.sep).join('/');
        if (rel.startsWith('src/adapters/githost/')) continue;
        const text = fs.readFileSync(abs, 'utf8');
        const n = (text.match(/applyBranchRules\b/g) ?? []).length;
        if (n > 0) found.push({ rel, n });
      }
    }
  };
  walk(dir);
  return found;
}

test('applyBranchRules has one caller, init --protect', () => {
  const found = [...callers(SRC), ...callers(BIN)];
  assert.deepEqual(found, [{ rel: 'src/init.js', n: 1 }]);
  const text = fs.readFileSync(path.join(SRC, 'init.js'), 'utf8');
  const at = text.indexOf('applyBranchRules');
  const fnStart = text.lastIndexOf('export function protect', at);
  assert.ok(fnStart !== -1 && text.indexOf('\nexport function', fnStart + 1) > at, 'the call is inside protect()');
  // The adapters define it and never call it themselves.
  for (const name of ['github.js', 'fixture.js']) {
    const adapter = fs.readFileSync(path.join(SRC, 'adapters', 'githost', name), 'utf8');
    assert.equal((adapter.match(/applyBranchRules\b/g) ?? []).length, 1, name);
  }
});
