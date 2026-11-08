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
