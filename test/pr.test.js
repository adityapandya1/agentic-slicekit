import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../src/config.js';
import { main } from '../src/cli/index.js';
import { GitError, git, switchBranch } from '../src/git.js';
import { GitHostError } from '../src/adapters/githost/errors.js';
import { fixtureHost } from '../src/adapters/githost/fixture.js';
import { githubHost } from '../src/adapters/githost/github.js';
import { REQUIRED_SECTIONS, renderPrBody } from '../src/prbody.js';
import { commit, makeRemote, makeRepo } from './helpers/tmp-repo.js';

const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
const SPEC_BODY = '**Done when:** the spec is written\n**Proof:** node bin/slicekit.js check: 0 findings\n**Decisions:** none\n';

// A repository with a committed config on main, a bare origin holding main, and an empty fixture
// directory for the git host.
async function withRepo(fn) {
  const repo = makeRepo({ files: { '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n` } });
  git(repo.root, ['add', '-A']);
  commit(repo.root, 'config');
  const origin = makeRemote(repo.root);
  git(repo.root, ['push', '-q', 'origin', 'main']);
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-githost-'));
  const bodies = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-body-'));
  try {
    return await fn({ root: repo.root, remote: origin.remote, fixture, bodies });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(bodies, { recursive: true, force: true });
    origin.cleanup();
    repo.cleanup();
  }
}

async function cli(root, fixture, args) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, env: { SLICEKIT_GITHOST_FIXTURE: fixture }, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

const bodyFile = (dir, name, text) => {
  const file = path.join(dir, `${name}.md`);
  fs.writeFileSync(file, text);
  return file;
};
const calls = (fixture) => {
  const file = path.join(fixture, 'pr-calls.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : null;
};
const remoteHas = (remote, branch) => {
  try {
    return git(remote, ['rev-parse', '--verify', `refs/heads/${branch}`]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
};
const readPr = (fixture, n) => JSON.parse(fs.readFileSync(path.join(fixture, `pr-${n}.json`), 'utf8'));

// REQ-2.10: the kit opens the pull request itself, and a second run updates it.
test('open pushes and opens the pull request through the fixture host', async () => {
  await withRepo(async ({ root, remote, fixture, bodies }) => {
    switchBranch(root, 'spec/demo', { create: true, from: 'main' });
    commit(root, 'spec');
    const file = bodyFile(bodies, 'spec', SPEC_BODY);
    const r = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', file]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '#1 https://example.test/pull/1\n');
    assert.equal(remoteHas(remote, 'spec/demo'), git(root, ['rev-parse', 'HEAD']));
    const made = calls(fixture);
    assert.equal(made.length, 1);
    assert.deepEqual(made[0], { op: 'openPullRequest', branch: 'spec/demo', base: 'main', title: '[spec] demo', body: SPEC_BODY, draft: false });
    assert.equal(readPr(fixture, 1).isDraft, false);
    assert.equal(readPr(fixture, 1).headRefName, 'spec/demo');

    commit(root, 'more spec');
    const again = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', bodyFile(bodies, 'spec2', SPEC_BODY.replace('none', 'D-01'))]);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, 'updated #1 https://example.test/pull/1\n');
    assert.equal(remoteHas(remote, 'spec/demo'), git(root, ['rev-parse', 'HEAD']));
    assert.deepEqual(calls(fixture).slice(1).map((c) => c.op), ['updatePullRequestBody']);
    assert.match(readPr(fixture, 1).body, /D-01/);

    // A slice pull request opens as a draft.
    git(root, ['switch', '-q', 'main']);
    switchBranch(root, 'slice/P1-S-01-thing', { create: true, from: 'main' });
    commit(root, 'slice');
    const sections = Object.fromEntries(REQUIRED_SECTIONS.map((n) => [n, `text for ${n}`]));
    const sliceBody = renderPrBody({ slice: 'P1/S-01', name: 'Thing', sections });
    const s = await cli(root, fixture, ['pr', 'open', '--title', '[P1/S-01] Thing', '--body-file', bodyFile(bodies, 'slice', sliceBody)]);
    assert.equal(s.code, 0, s.stderr);
    assert.equal(s.stdout, '#2 https://example.test/pull/2\n');
    assert.equal(calls(fixture).at(-1).draft, true);
  });
});

// REQ-2.10: a body CI would fail never leaves the machine.
test('a body missing a section is refused before anything is pushed', async () => {
  await withRepo(async ({ root, remote, fixture, bodies }) => {
    switchBranch(root, 'spec/demo', { create: true, from: 'main' });
    commit(root, 'spec');
    const file = bodyFile(bodies, 'bad', SPEC_BODY.replace(/\*\*Proof:\*\*.*\n/, ''));
    const r = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', file]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /pull request body is missing "Proof"/);
    assert.equal(remoteHas(remote, 'spec/demo'), null);
    assert.equal(calls(fixture), null);
  });
});

test('--commit with --paths commits only the listed paths, then pushes', async () => {
  await withRepo(async ({ root, remote, fixture, bodies }) => {
    switchBranch(root, 'spec/demo', { create: true, from: 'main' });
    fs.writeFileSync(path.join(root, 'a.md'), 'a\n');
    fs.writeFileSync(path.join(root, 'b.md'), 'b\n');
    const file = bodyFile(bodies, 'spec', SPEC_BODY);
    const r = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', file, '--commit', 'docs(spec): demo', '--paths', 'a.md']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(git(root, ['show', '--name-only', '--format=', 'HEAD']), 'a.md');
    assert.equal(git(root, ['log', '-1', '--format=%s']), 'docs(spec): demo');
    // A spec branch is not a slice branch: no Slice trailer, and the trailer rule does not judge it.
    assert.equal(git(root, ['log', '-1', '--format=%(trailers:key=Slice,valueonly)']), '');
    assert.equal(git(root, ['status', '--porcelain']), '?? b.md');
    assert.equal(remoteHas(remote, 'spec/demo'), git(root, ['rev-parse', 'HEAD']));

    const half = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', file, '--commit', 'x']);
    assert.equal(half.code, 2);
  });
});

test('open refuses the default branch, and a host refusal is exit 1', async () => {
  await withRepo(async ({ root, remote, fixture, bodies }) => {
    const before = remoteHas(remote, 'main');
    commit(root, 'on main');
    const file = bodyFile(bodies, 'spec', SPEC_BODY);
    const r = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', file]);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'slicekit: open a pull request from a work branch, not main\n');
    assert.equal(remoteHas(remote, 'main'), before);

    switchBranch(root, 'plan/p2', { create: true, from: 'main' });
    fs.writeFileSync(path.join(fixture, 'pr-create-error.txt'), 'GraphQL: Base ref must be a branch\n');
    const refused = await cli(root, fixture, ['pr', 'open', '--title', '[plan] P2', '--body-file', file]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /gh pr create failed: GraphQL: Base ref must be a branch/);
    const usage = await cli(root, fixture, ['pr', 'open', '--title', '[plan] P2']);
    assert.equal(usage.code, 2);
    const missing = await cli(root, fixture, ['pr', 'open', '--title', '[plan] P2', '--body-file', path.join(bodies, 'nope.md')]);
    assert.equal(missing.code, 2);
  });
});

test('the GitHub host passes the body on stdin and reads the number from the url', () => {
  const seen = [];
  let answer = '';
  const exec = (cmd, args, opts) => {
    seen.push({ cmd, args, opts });
    return answer;
  };
  const host = githubHost({ X: '1' }, '/the/project', exec);
  answer = 'Creating pull request for spec/demo into main\n\nhttps://github.com/o/r/pull/42\n';
  assert.deepEqual(host.openPullRequest({ branch: 'spec/demo', base: 'main', title: '-[spec] demo', body: 'the body', draft: true }), {
    number: 42,
    url: 'https://github.com/o/r/pull/42',
  });
  const create = seen[0];
  assert.equal(create.cmd, 'gh');
  assert.deepEqual(create.args, ['pr', 'create', '--head=spec/demo', '--base=main', '--title=-[spec] demo', '--body-file', '-', '--draft']);
  assert.equal(create.opts.input, 'the body');
  assert.equal(create.opts.stdio[0], 'pipe');
  assert.equal(create.opts.cwd, '/the/project');
  assert.deepEqual(create.opts.env, { X: '1' });

  answer = 'https://github.com/o/r/pull/43\n';
  host.openPullRequest({ branch: 'spec/demo', base: 'main', title: 't', body: 'b', draft: false });
  assert.ok(!seen[1].args.includes('--draft'));

  answer = '';
  host.updatePullRequestBody(42, 'new body');
  assert.deepEqual(seen[2].args, ['pr', 'edit', '42', '--body-file', '-']);
  assert.equal(seen[2].opts.input, 'new body');
  host.markReady(42);
  assert.deepEqual(seen[3].args, ['pr', 'ready', '42']);
  assert.equal(seen[3].opts.stdio[0], 'ignore');

  answer = '[]';
  assert.equal(host.pullRequestForBranch('spec/demo'), null);

  answer = 'no url here\n';
  assert.throws(() => host.openPullRequest({ branch: 'spec/demo', base: 'main', title: 't', body: 'b', draft: false }), GitHostError);
  assert.throws(() => host.openPullRequest({ branch: '-x', base: 'main', title: 't', body: 'b', draft: false }));

  const failing = githubHost({}, '/p', () => {
    const e = new Error('Command failed');
    e.status = 1;
    e.stderr = 'pull request create failed: GraphQL: No commits between main and spec/demo\nsecond line\n';
    throw e;
  });
  assert.throws(
    () => failing.openPullRequest({ branch: 'spec/demo', base: 'main', title: 't', body: 'b', draft: false }),
    (e) => e instanceof GitHostError && e.message === 'gh pr create failed: pull request create failed: GraphQL: No commits between main and spec/demo',
  );
});

test('getPullRequest reads the head branch and the draft flag', () => {
  const host = githubHost({}, '/p', (cmd, args) => {
    assert.match(args[args.indexOf('--json') + 1], /headRefName,isDraft/);
    return JSON.stringify({ number: 5, url: 'u', state: 'OPEN', headRefOid: 'abc', headRefName: 'spec/x', isDraft: true, title: 't', body: 'b', labels: [] });
  });
  const pr = host.getPullRequest(5);
  assert.equal(pr.headRef, 'spec/x');
  assert.equal(pr.draft, true);
});

test('the fixture host marks a pull request ready and records it', async () => {
  await withRepo(async ({ fixture }) => {
    const host = fixtureHost(fixture);
    assert.equal(host.pullRequestForBranch('slice/x'), null);
    assert.deepEqual(host.openPullRequest({ branch: 'slice/x', base: 'main', title: 't', body: 'b', draft: true }), { number: 1, url: 'https://example.test/pull/1' });
    host.markReady(1);
    const pr = host.getPullRequest(1);
    assert.deepEqual([pr.draft, pr.headRef, pr.state], [false, 'slice/x', 'OPEN']);
    assert.deepEqual(host.pullRequestForBranch('slice/x'), { number: 1, url: 'https://example.test/pull/1', base: 'main' });
    assert.deepEqual(calls(fixture).map((c) => c.op), ['openPullRequest', 'markReady']);
    assert.throws(() => host.markReady(9), /not found/);
  });
});

test('markDraft returns a pull request to draft on both hosts', async () => {
  const seen = [];
  githubHost({}, '/p', (cmd, args, opts) => {
    seen.push({ args, opts });
    return '';
  }).markDraft(42);
  assert.deepEqual(seen[0].args, ['pr', 'ready', '42', '--undo']);
  assert.equal(seen[0].opts.cwd, '/p');
  await withRepo(async ({ fixture }) => {
    const host = fixtureHost(fixture);
    host.openPullRequest({ branch: 'slice/x', base: 'main', title: 't', body: 'b', draft: true });
    host.markReady(1);
    host.markDraft(1);
    assert.equal(host.getPullRequest(1).draft, true);
    assert.deepEqual(calls(fixture).map((c) => c.op), ['openPullRequest', 'markReady', 'markDraft']);
    assert.deepEqual(calls(fixture).at(-1), { op: 'markDraft', number: 1 });
    assert.throws(() => host.markDraft(9), /not found/);
  });
});

// Fix round 1.
const sliceBody = () => renderPrBody({ slice: 'P1/S-01', name: 'Thing', sections: Object.fromEntries(REQUIRED_SECTIONS.map((n) => [n, `text for ${n}`])) });

test('a branch whose open pull request has another title is refused before the body is judged (I-3)', async () => {
  await withRepo(async ({ root, fixture, bodies }) => {
    switchBranch(root, 'slice/P1-S-01-thing', { create: true, from: 'main' });
    commit(root, 'slice');
    const first = await cli(root, fixture, ['pr', 'open', '--title', '[P1/S-01] Thing', '--body-file', bodyFile(bodies, 'slice', sliceBody())]);
    assert.equal(first.code, 0, first.stderr);
    const r = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', bodyFile(bodies, 'spec', SPEC_BODY)]);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'slicekit: pull request #1 is titled "[P1/S-01] Thing"; open one per kind of change\n');
    assert.deepEqual(calls(fixture).map((c) => c.op), ['openPullRequest']);
    assert.equal(readPr(fixture, 1).body, sliceBody());
    // The same title judges the body as the pull request's own kind: a three-section body fails.
    const short = await cli(root, fixture, ['pr', 'open', '--title', '[P1/S-01] Thing', '--body-file', bodyFile(bodies, 'spec', SPEC_BODY)]);
    assert.equal(short.code, 1);
    assert.match(short.stderr, /missing "Runbook"/);
  });
});

test('a --base other than the open pull request base is refused, and so is the branch itself (M-1, M-3)', async () => {
  await withRepo(async ({ root, remote, fixture, bodies }) => {
    switchBranch(root, 'spec/demo', { create: true, from: 'main' });
    commit(root, 'spec');
    const file = bodyFile(bodies, 'spec', SPEC_BODY);
    assert.equal((await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', file])).code, 0);
    const r = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', file, '--base', 'dev']);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'slicekit: pull request #1 targets main, not dev\n');
    switchBranch(root, 'plan/p2', { create: true, from: 'main' });
    const self = await cli(root, fixture, ['pr', 'open', '--title', '[plan] P2', '--body-file', file, '--base', 'plan/p2']);
    assert.equal(self.code, 2);
    assert.match(self.stderr, /--base plan\/p2 is the branch being pushed/);
    assert.equal(remoteHas(remote, 'plan/p2'), null);
  });
});

test('a fork pull request with the same head name is not this branch pull request (I-4)', async () => {
  await withRepo(async ({ root, fixture, bodies }) => {
    const fork = { number: 1, url: 'https://example.test/pull/1', state: 'OPEN', isDraft: false, isCrossRepository: true, headRefName: 'spec/demo', baseRefName: 'main', title: '[spec] demo', body: 'x', headRefOid: null, labels: [] };
    fs.writeFileSync(path.join(fixture, 'pr-1.json'), JSON.stringify(fork));
    switchBranch(root, 'spec/demo', { create: true, from: 'main' });
    commit(root, 'spec');
    const r = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', bodyFile(bodies, 'spec', SPEC_BODY)]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '#2 https://example.test/pull/2\n');
    assert.equal(readPr(fixture, 1).body, 'x');
  });
});

test('--paths is literal and never the root; unrelated and staged files stay out (I-2)', async () => {
  for (const [paths, code] of [['.', 2], ['sub/..', 2], ['../outside.txt', 2], [':/', 1], ['*.txt', 1]]) {
    await withRepo(async ({ root, remote, fixture, bodies }) => {
      switchBranch(root, 'spec/demo', { create: true, from: 'main' });
      fs.writeFileSync(path.join(root, 'unrelated.txt'), 'u');
      fs.writeFileSync(path.join(root, 'staged.txt'), 's');
      git(root, ['add', 'staged.txt']);
      const head = git(root, ['rev-parse', 'HEAD']);
      const r = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', bodyFile(bodies, 'spec', SPEC_BODY), '--commit', 'm', '--paths', paths]);
      assert.equal(r.code, code, `${paths}: ${r.stderr}`);
      if (code === 2) assert.equal(r.stderr, 'slicekit: --paths must name files or folders inside the repository, not the root\n', paths);
      assert.equal(git(root, ['rev-parse', 'HEAD']), head, paths);
      assert.equal(git(root, ['status', '--porcelain']), 'A  staged.txt\n?? unrelated.txt', paths);
      assert.equal(remoteHas(remote, 'spec/demo'), null, paths);
    });
  }
});

test('--commit with nothing to commit says so and still pushes', async () => {
  await withRepo(async ({ root, remote, fixture, bodies }) => {
    switchBranch(root, 'spec/demo', { create: true, from: 'main' });
    commit(root, 'spec');
    const r = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', bodyFile(bodies, 'spec', SPEC_BODY), '--commit', 'm', '--paths', '.slicekit/config.json']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, 'slicekit: nothing to commit for .slicekit/config.json\n');
    assert.equal(r.stdout, '#1 https://example.test/pull/1\n');
    assert.equal(remoteHas(remote, 'spec/demo'), git(root, ['rev-parse', 'HEAD']));
  });
});

test('a work branch that pushes to the default branch is refused before any commit (M-2)', async () => {
  await withRepo(async ({ root, remote, fixture, bodies }) => {
    switchBranch(root, 'feat', { create: true, from: 'origin/main', track: true });
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    const head = git(root, ['rev-parse', 'HEAD']);
    const before = remoteHas(remote, 'main');
    const r = await cli(root, fixture, ['pr', 'open', '--title', '[spec] x', '--body-file', bodyFile(bodies, 'spec', SPEC_BODY), '--commit', 'm', '--paths', 'a.txt']);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'slicekit: open a pull request from a work branch, not main\n');
    assert.equal(git(root, ['rev-parse', 'HEAD']), head);
    assert.equal(remoteHas(remote, 'main'), before);
    assert.equal(calls(fixture), null);
  });
});

test('a body file that is not UTF-8 is exit 2 (M-4), and a host refusal never prints a token (M-5)', async () => {
  await withRepo(async ({ root, remote, fixture, bodies }) => {
    switchBranch(root, 'spec/demo', { create: true, from: 'main' });
    const latin1 = path.join(bodies, 'latin1.md');
    fs.writeFileSync(latin1, Buffer.concat([Buffer.from(SPEC_BODY), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])]));
    const r = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', latin1]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /body file is not UTF-8/);
    assert.equal(remoteHas(remote, 'spec/demo'), null);

    fs.writeFileSync(path.join(fixture, 'pr-create-error.txt'), 'HTTP 401: Bad credentials (token ghp_abcdefghijklmnopqrstuvwxyz0123)\n');
    const refused = await cli(root, fixture, ['pr', 'open', '--title', '[spec] demo', '--body-file', bodyFile(bodies, 'spec', SPEC_BODY)]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /Bad credentials/);
    assert.doesNotMatch(refused.stderr, /ghp_/);
  });
});

test('the GitHub host finds the branch pull request among same-repository ones only (I-4)', () => {
  const seen = [];
  let answer = '[]';
  const host = githubHost({}, '/p', (cmd, args) => {
    seen.push(args);
    return answer;
  });
  const pr = (number, extra = {}) => ({ number, url: `https://github.com/o/r/pull/${number}`, isCrossRepository: false, baseRefName: 'main', headRefName: 'spec/demo', ...extra });
  answer = JSON.stringify([pr(9, { isCrossRepository: true })]);
  assert.equal(host.pullRequestForBranch('spec/demo'), null);
  assert.deepEqual(seen[0], ['pr', 'list', '--head', 'spec/demo', '--state', 'open', '--json', 'number,url,isCrossRepository,baseRefName,headRefName']);
  answer = JSON.stringify([pr(7, { baseRefName: 'dev' }), pr(5), pr(9, { isCrossRepository: true })]);
  assert.deepEqual(host.pullRequestForBranch('spec/demo'), { number: 7, url: 'https://github.com/o/r/pull/7', base: 'dev' });
  assert.deepEqual(host.pullRequestForBranch('spec/demo', { base: 'main' }), { number: 5, url: 'https://github.com/o/r/pull/5', base: 'main' });
  assert.throws(() => host.pullRequestForBranch('o:spec/demo'), /branch of this repository/);
  answer = JSON.stringify([pr(4, { headRefName: 'other' })]);
  assert.equal(host.pullRequestForBranch('spec/demo'), null);
});
