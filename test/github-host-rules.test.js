// REQ-3.14, D-70, D-84: readBranchRules, readCodeowners and applyBranchRules on the GitHub host, driven
// through an injected exec: the host comes from the origin remote and goes to `gh api --hostname`,
// the rules are read from the rulesets endpoint, CODEOWNERS from the three paths GitHub reads, and the
// one ruleset named slicekit is created or, when present, updated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubHost } from '../src/adapters/githost/github.js';
import { GitHostError } from '../src/adapters/githost/errors.js';
import { parseRemoteUrl } from '../src/adapters/githost/gh-json.js';
import { requiredChecks, workflowCheckNames } from '../src/check/rules/host-rules.js';
import { defaultConfig, loadConfig } from '../src/config.js';
import { fileURLToPath } from 'node:url';

const kitRoot = fileURLToPath(new URL('..', import.meta.url));

// A host whose `git remote get-url origin` prints `url` and whose `gh api <endpoint>` answers from
// `answers` (a value, or an Error whose stderr gh would print). Every call is recorded.
function hostWith(url, answers) {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, input: opts?.input });
    if (cmd === 'git') return `${url}\n`;
    const endpoint = args.at(-1);
    const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
    const got = answers[`${method} ${endpoint}`];
    if (got === undefined || got instanceof Error) {
      const e = new Error('gh failed');
      e.status = 1;
      e.stderr = got?.stderr ?? 'gh: Not Found (HTTP 404)';
      throw e;
    }
    return JSON.stringify(got);
  };
  return { host: githubHost({}, '/repo', exec), calls };
}

test('the remote url names the host, owner and repository', () => {
  assert.deepEqual(parseRemoteUrl('https://github.com/acme/demo.git'), { host: 'github.com', owner: 'acme', repo: 'demo' });
  assert.deepEqual(parseRemoteUrl('git@ghe.example.com:acme/demo.git'), { host: 'ghe.example.com', owner: 'acme', repo: 'demo' });
  assert.deepEqual(parseRemoteUrl('ssh://git@ghe.example.com:2222/acme/demo'), { host: 'ghe.example.com', owner: 'acme', repo: 'demo' });
  assert.deepEqual(parseRemoteUrl('https://x-access-token:t@ghe.example.com/acme/demo/'), { host: 'ghe.example.com', owner: 'acme', repo: 'demo' });
  for (const local of ['/tmp/remote', 'C:/tmp/remote', 'file:///tmp/remote.git', '../remote', 'https://github.com/acme']) {
    assert.equal(parseRemoteUrl(local), null, local);
  }
});

test('readBranchRules asks the origin host for the rulesets of the branch and folds them', () => {
  const { host, calls } = hostWith('git@ghe.example.com:acme/demo.git', {
    'GET repos/acme/demo/rules/branches/main?per_page=100': [
      { type: 'pull_request', parameters: { required_approving_review_count: 0 }, ruleset_id: 1 },
      { type: 'pull_request', parameters: { required_approving_review_count: 2, require_code_owner_review: true }, ruleset_id: 2 },
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'gate' }] }, ruleset_id: 2 },
      { type: 'non_fast_forward', ruleset_id: 1 },
    ],
    'GET repos/acme/demo/branches/main': { name: 'main', protected: true, protection: { enabled: false } },
  });
  assert.deepEqual(host.readBranchRules('main'), {
    pullRequest: true,
    approvals: 2,
    codeOwnerReview: true,
    requiredChecks: ['gate'],
    refuseForcePush: true,
    classic: false,
    ruleCount: 4,
  });
  const api = calls.filter((c) => c.cmd === 'gh');
  assert.ok(api.every((c) => c.args[0] === 'api' && c.args[1] === '--hostname' && c.args[2] === 'ghe.example.com'), JSON.stringify(api));
  assert.equal(calls.filter((c) => c.cmd === 'git').length, 1, 'the remote is read once');
});

test('readBranchRules on a remote that names no host is a GitHostError, before any gh call', () => {
  const { host, calls } = hostWith('/tmp/remote.git', {});
  assert.throws(() => host.readBranchRules('main'), (e) => e instanceof GitHostError && /names no git host/.test(e.message));
  assert.equal(calls.filter((c) => c.cmd === 'gh').length, 0);
});

test('readCodeowners returns the first of the three paths GitHub reads, or null', () => {
  const { host } = hostWith('https://github.com/acme/demo.git', {
    'GET repos/acme/demo/contents/CODEOWNERS': { type: 'file', encoding: 'base64', content: Buffer.from('* @acme/team\n').toString('base64') },
    'GET repos/acme/demo/contents/docs/CODEOWNERS': { type: 'file', encoding: 'base64', content: Buffer.from('* @other\n').toString('base64') },
  });
  assert.deepEqual(host.readCodeowners(), { path: 'CODEOWNERS', text: '* @acme/team\n' });
  assert.equal(hostWith('https://github.com/acme/demo.git', {}).host.readCodeowners(), null);
  const refused = hostWith('https://github.com/acme/demo.git', { 'GET repos/acme/demo/contents/.github/CODEOWNERS': Object.assign(new Error(), { stderr: 'gh: Resource not accessible (HTTP 403)' }) });
  assert.throws(() => refused.host.readCodeowners(), GitHostError);
});

test('applyBranchRules creates the slicekit ruleset, or folds the rules into the one there', () => {
  const made = hostWith('https://github.com/acme/demo.git', {
    'GET repos/acme/demo/rulesets?includes_parents=false&per_page=100': [{ id: 9, name: 'protected-main', source_type: 'Repository' }],
    'POST repos/acme/demo/rulesets': { id: 10 },
  });
  assert.deepEqual(made.host.applyBranchRules('main', { requiredChecks: ['gate'], refuseForcePush: true }), { id: 10, name: 'slicekit', created: true, removedChecks: [] });
  const post = made.calls.find((c) => c.args.includes('POST'));
  assert.deepEqual(JSON.parse(post.input), {
    name: 'slicekit',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
    rules: [
      { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'gate' }] } },
      { type: 'non_fast_forward' },
    ],
  });

  const there = hostWith('https://github.com/acme/demo.git', {
    'GET repos/acme/demo/rulesets?includes_parents=false&per_page=100': [{ id: 11, name: 'slicekit', source_type: 'Repository' }],
    'GET repos/acme/demo/rulesets/11': {
      id: 11,
      name: 'slicekit',
      conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
      rules: [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'gate' }] } }],
      bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
    },
    'PUT repos/acme/demo/rulesets/11': { id: 11 },
  });
  assert.deepEqual(there.host.applyBranchRules('main', { approvals: 1, requiredChecks: ['cmd-test'] }), { id: 11, name: 'slicekit', created: false, removedChecks: [] });
  const put = JSON.parse(there.calls.find((c) => c.args.includes('PUT')).input);
  assert.deepEqual(put.rules.map((r) => r.type).sort(), ['pull_request', 'required_status_checks']);
  assert.deepEqual(put.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks, [{ context: 'gate' }, { context: 'cmd-test' }]);
  assert.equal(put.rules.find((r) => r.type === 'pull_request').parameters.required_approving_review_count, 1);
  assert.deepEqual(put.bypass_actors, [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }]);
});

test('the required checks are the gate and checks jobs, never a matrix name (B-1)', () => {
  const cfg = { ...defaultConfig({ name: 'demo', shape: 'backend' }), cli: 'node bin/slicekit.js', commands: { test: 'npm test', lint: 'npm run lint', build: '', e2e: '' } };
  assert.deepEqual(requiredChecks(cfg), ['gate', 'checks']);
  const sharded = { ...cfg, ci: { ...cfg.ci, matrix: true, shards: { 'windows-latest': 2 } }, ...{ ci: { ...cfg.ci, matrix: true, shards: { 'windows-latest': 2 }, observabilitySteps: [{ name: 'Smoke', run: 'true' }] } } };
  assert.deepEqual(requiredChecks(sharded), ['gate', 'checks']);
  assert.deepEqual(workflowCheckNames("jobs:\n  gate:\n    runs-on: x\n  obs-1:\n    name: 'Smoke: prod'\n  checks:\n    name: 'All checks'\n  sync:\n    runs-on: x\n"), ['gate', 'All checks']);
});

// The `slicekit` ruleset as the author created it on 2026-11-07: the gate and the five matrix names of
// the kit's test job, with a bypass for Repository admin on pull requests only.
const LIVE_MATRIX = ['cmd-test (ubuntu-latest, 1/1)', 'cmd-test (windows-latest, 1/3)', 'cmd-test (windows-latest, 2/3)', 'cmd-test (windows-latest, 3/3)', 'cmd-test (macos-latest, 1/1)'];
const LIVE_BYPASS = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }];

test('the live slicekit ruleset loses its five matrix names, gains checks and keeps its bypass', () => {
  const kit = loadConfig(kitRoot);
  const kitChecks = requiredChecks(kit);
  assert.deepEqual(kitChecks, ['gate', 'checks']);
  const live = [{ context: 'gate' }, ...LIVE_MATRIX.map((context) => ({ context }))];
  const { host, calls } = hostWith('https://github.com/adityapandya1/agentic-slicekit.git', {
    'GET repos/adityapandya1/agentic-slicekit/rulesets?includes_parents=false&per_page=100': [
      { id: 26101926, name: 'protected-main', source_type: 'Repository' },
      { id: 26757970, name: 'slicekit', source_type: 'Repository' },
    ],
    'GET repos/adityapandya1/agentic-slicekit/rulesets/26757970': {
      id: 26757970,
      name: 'slicekit',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
      rules: [
        { type: 'pull_request', parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } },
        { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: live } },
      ],
      bypass_actors: LIVE_BYPASS,
    },
    'PUT repos/adityapandya1/agentic-slicekit/rulesets/26757970': { id: 26757970 },
  });
  // What protect() passes once the rules are read: the live rules have gate but not checks.
  const missing = kitChecks.filter((c) => !live.some((l) => l.context === c));
  assert.deepEqual(missing, ['checks']);
  const done = host.applyBranchRules('main', { requiredChecks: missing, kitChecks });
  assert.deepEqual(done.removedChecks, LIVE_MATRIX);
  const puts = calls.filter((c) => c.args.includes('PUT'));
  assert.equal(puts.length, 1);
  assert.ok(puts[0].args.includes('repos/adityapandya1/agentic-slicekit/rulesets/26757970'), 'only the slicekit ruleset is written');
  const body = JSON.parse(puts[0].input);
  assert.deepEqual(body.bypass_actors, LIVE_BYPASS);
  assert.deepEqual(body.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks, [{ context: 'gate' }, { context: 'checks' }]);
  assert.equal(body.rules.find((r) => r.type === 'pull_request').parameters.required_approving_review_count, 1);
});

test('applyBranchRules takes a check no job reports out of the slicekit ruleset, and writes nothing when nothing changes', () => {
  const answers = (rules) => ({
    'GET repos/acme/demo/rulesets?includes_parents=false&per_page=100': [{ id: 9, name: 'protected-main', source_type: 'Repository' }, { id: 11, name: 'slicekit', source_type: 'Repository' }],
    'GET repos/acme/demo/rulesets/11': { id: 11, name: 'slicekit', conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } }, rules },
    'PUT repos/acme/demo/rulesets/11': { id: 11 },
  });
  const stale = hostWith('https://github.com/acme/demo.git', answers([
    { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'gate' }, { context: 'cmd-old' }] } },
    { type: 'non_fast_forward' },
  ]));
  assert.deepEqual(stale.host.applyBranchRules('main', { kitChecks: ['gate'] }).removedChecks, ['cmd-old']);
  const puts = stale.calls.filter((c) => c.args.includes('PUT'));
  assert.equal(puts.length, 1);
  assert.ok(puts.every((c) => c.args.includes('repos/acme/demo/rulesets/11')), 'only the slicekit ruleset is written');
  assert.deepEqual(JSON.parse(puts[0].input).rules, [
    { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'gate' }] } },
    { type: 'non_fast_forward' },
  ]);

  const clean = hostWith('https://github.com/acme/demo.git', answers([{ type: 'non_fast_forward' }]));
  assert.deepEqual(clean.host.applyBranchRules('main', { kitChecks: ['gate'] }).removedChecks, []);
  assert.equal(clean.calls.filter((c) => c.args.includes('PUT') || c.args.includes('POST')).length, 0);
});
