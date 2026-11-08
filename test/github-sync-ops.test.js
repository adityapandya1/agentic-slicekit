// REQ-3.11, REQ-3.14: the GitHub host's readWorkflowPermissions, listOpenPullRequests and
// closePullRequest, driven through an injected exec, as gh would be called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubHost } from '../src/adapters/githost/github.js';
import { GitHostError } from '../src/adapters/githost/errors.js';

function hostWith(answer) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === 'git') return 'git@ghe.example.com:acme/demo.git\n';
    const got = answer(args);
    if (got instanceof Error) throw got;
    return typeof got === 'string' ? got : JSON.stringify(got);
  };
  return { host: githubHost({}, '/repo', exec), calls };
}
const ghCalls = (calls) => calls.filter((c) => c.cmd === 'gh').map((c) => c.args);

test('readWorkflowPermissions reads the Actions setting from the origin host', () => {
  const { host, calls } = hostWith(() => ({ default_workflow_permissions: 'read', can_approve_pull_request_reviews: false }));
  assert.deepEqual(host.readWorkflowPermissions(), { canCreatePullRequests: false, defaultPermissions: 'read' });
  assert.deepEqual(ghCalls(calls), [['api', '--hostname', 'ghe.example.com', 'repos/acme/demo/actions/permissions/workflow']]);

  const refused = hostWith(() => Object.assign(new Error('gh failed'), { status: 1, stderr: 'HTTP 403: Resource not accessible by integration' }));
  assert.throws(() => refused.host.readWorkflowPermissions(), GitHostError);
  const blank = hostWith(() => ({ default_workflow_permissions: 'read' }));
  assert.throws(() => blank.host.readWorkflowPermissions(), /can_approve_pull_request_reviews/);
});

test('listOpenPullRequests drops a fork and closePullRequest passes the comment as one argument', () => {
  const { host, calls } = hostWith((args) => (args[0] === 'pr' && args[1] === 'list'
    ? [
        { number: 9, url: 'u9', title: '[sync] state after abc1234', isCrossRepository: false, baseRefName: 'main', headRefName: 'sync/abc1234' },
        { number: 4, url: 'u4', title: '[sync] fork', isCrossRepository: true, baseRefName: 'main', headRefName: 'sync/0000000' },
      ]
    : ''));
  assert.deepEqual(host.listOpenPullRequests(), [{ number: 9, url: 'u9', title: '[sync] state after abc1234', head: 'sync/abc1234', base: 'main' }]);
  host.closePullRequest(9, '--delete-branch is text here');
  assert.deepEqual(ghCalls(calls).at(-1), ['pr', 'close', '9', '--comment=--delete-branch is text here']);
  assert.throws(() => host.closePullRequest(9, ' '), /comment must be non-empty/);
  assert.throws(() => host.closePullRequest(0, 'x'));
});

// P4/S-42, REQ-3.8, D-71, D-89: getCommit and getRun call the documented endpoints on the origin host
// and map the fields the journal rule reads.
test('getCommit reads the host verification of a commit from the origin host', () => {
  const sha = 'abc1234def5678abc1234def5678abc1234def56';
  const signed = hostWith(() => ({ sha, commit: { verification: { verified: true, reason: 'valid' } }, committer: { login: 'octocat' }, author: { login: 'someone' } }));
  assert.deepEqual(signed.host.getCommit(sha), { verified: true, signer: 'octocat' });
  assert.deepEqual(ghCalls(signed.calls), [['api', '--hostname', 'ghe.example.com', `repos/acme/demo/commits/${sha}`]]);

  const unsigned = hostWith(() => ({ sha, commit: { verification: { verified: false, reason: 'unsigned' } }, committer: { login: 'octocat' } }));
  assert.deepEqual(unsigned.host.getCommit(sha), { verified: false, signer: null });
  assert.throws(() => hostWith(() => ({ sha, commit: {} })).host.getCommit(sha), GitHostError);
  assert.throws(() => hostWith(() => ({})).host.getCommit('--all'));
});

test('getRun reads the name, head sha, actor and conclusion of a run from the origin host; a re-run keeps the actor', () => {
  const head = 'abc1234def5678abc1234def5678abc1234def56';
  const { host, calls } = hostWith(() => ({ id: 987654321, name: 'kitflow', head_sha: head, actor: { login: 'someone' }, triggering_actor: { login: 'octocat' }, conclusion: null }));
  assert.deepEqual(host.getRun('987654321'), { workflow: 'kitflow', headSha: head, actor: 'someone', conclusion: null });
  assert.deepEqual(ghCalls(calls), [['api', '--hostname', 'ghe.example.com', 'repos/acme/demo/actions/runs/987654321']]);

  const noTrigger = hostWith(() => ({ name: 'kitflow', head_sha: head, actor: { login: 'someone' }, conclusion: 'success' }));
  assert.deepEqual(noTrigger.host.getRun(5), { workflow: 'kitflow', headSha: head, actor: 'someone', conclusion: 'success' });
  assert.throws(() => hostWith(() => ({ head_sha: head })).host.getRun(5), GitHostError);
  assert.throws(() => hostWith(() => ({})).host.getRun('1/../2'), /run id must be/);
});
