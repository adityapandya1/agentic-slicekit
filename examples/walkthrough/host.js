#!/usr/bin/env node
// A stand-in for the two steps of the walkthrough that only GitHub does: CI reporting on the pull
// request's head, and the merge. It works on the fixture git host the kit reads when
// SLICEKIT_GITHOST_FIXTURE is set (src/adapters/githost/fixture.js), and on the repository's bare
// `origin`. It writes nothing else: the merge is made in a temporary clone inside the fixture
// directory, removed afterwards, and the reader's checkout is never touched.
//
//   node examples/walkthrough/host.js ci <n> <success|failure>
//   node examples/walkthrough/host.js merge <n>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const USAGE = 'usage: node examples/walkthrough/host.js ci <n> <success|failure> | merge <n>';

class Stop extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Stop(`cannot read ${file}: ${e.code ?? e.message}`);
  }
}
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// The pull request as the fixture holds it, with the file it lives in.
function pullRequest(dir, n) {
  const file = path.join(dir, `pr-${n}.json`);
  if (!fs.existsSync(file)) throw new Stop(`no pull request #${n} in ${dir}`);
  return { file, pr: readJson(file) };
}

// The bare repository the reader's checkout pushes to.
function origin() {
  try {
    return git(['remote', 'get-url', 'origin'], process.cwd());
  } catch {
    throw new Stop('this directory has no git remote named origin');
  }
}

// The commit `branch` points at in origin, read without fetching into the reader's checkout.
function tip(remote, branch) {
  const line = git(['ls-remote', remote, `refs/heads/${branch}`]).split('\n')[0] ?? '';
  const sha = line.split(/\s+/)[0];
  if (!/^[0-9a-f]{40,64}$/.test(sha ?? '')) throw new Stop(`origin has no branch ${branch}`);
  return sha;
}

function mustBeOpen(n, pr) {
  if (pr.state !== 'OPEN') throw new Stop(`pull request #${n} is ${String(pr.state).toLowerCase()}, not open`);
}

// CI reports on the pull request's head: the head is set to origin's tip of its branch, as GitHub
// does on a push, and one completed run with that conclusion is recorded for it.
function ci(dir, n, status) {
  const { file, pr } = pullRequest(dir, n);
  mustBeOpen(n, pr);
  const sha = tip(origin(), pr.headRefName);
  writeJson(file, { ...pr, headRefOid: sha });
  const run = { name: 'slicekit', status: 'completed', conclusion: status, headSha: sha, url: `https://example.test/runs/${n}` };
  writeJson(path.join(dir, `ci-${sha}.json`), [run]);
  return `ci #${n} ${status} ${sha.slice(0, 7)}`;
}

// The pull request's branch merged into its base in origin with a merge commit, as GitHub's merge
// button does, then the pull request marked merged and listed among the merged ones.
function merge(dir, n) {
  const { file, pr } = pullRequest(dir, n);
  mustBeOpen(n, pr);
  if (pr.isDraft === true) throw new Stop(`pull request #${n} is a draft; GitHub refuses to merge it`);
  const remote = origin();
  const base = pr.baseRefName || 'main';
  const head = tip(remote, pr.headRefName);
  const clone = fs.mkdtempSync(path.join(dir, '.merge-'));
  let merged;
  try {
    git(['clone', '-q', '--branch', base, remote, clone]);
    // Identity and hooks are given for these commands only; no git config is written.
    const as = ['-c', 'user.name=slicekit host', '-c', 'user.email=host@example.test', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(clone, '.no-hooks')}`];
    try {
      git([...as, 'merge', '-q', '--no-ff', '-m', `Merge pull request #${n} from ${pr.headRefName}`, head], clone);
    } catch (e) {
      // A conflict leaves unmerged paths in the clone, which is thrown away: origin is unchanged.
      if (git(['diff', '--name-only', '--diff-filter=U'], clone) !== '') throw new Stop(`merge #${n} conflicts with ${base}; nothing was changed`);
      throw e;
    }
    merged = git(['rev-parse', 'HEAD'], clone);
    git([...as, 'push', '-q', 'origin', `HEAD:refs/heads/${base}`], clone);
  } finally {
    fs.rmSync(clone, { recursive: true, force: true });
  }
  const mergedAt = new Date().toISOString();
  writeJson(file, { ...pr, state: 'MERGED', isDraft: false, headRefOid: head, mergedAt });
  const since = path.join(dir, 'merged-since.json');
  const list = readJson(since, []);
  if (!Array.isArray(list)) throw new Stop(`${since} is not a list`);
  writeJson(since, [...list, { number: n, url: pr.url, title: pr.title, headRefOid: head, mergedAt }]);
  return `merged #${n} ${merged.slice(0, 7)}`;
}

function main(argv, env) {
  const dir = env.SLICEKIT_GITHOST_FIXTURE;
  if (!dir) throw new Stop('host.js stands in for GitHub only with SLICEKIT_GITHOST_FIXTURE set', 2);
  const [op, num, status, ...rest] = argv;
  const n = /^[1-9]\d*$/.test(num ?? '') ? Number(num) : null;
  if (n !== null && op === 'ci' && (status === 'success' || status === 'failure') && rest.length === 0) return ci(dir, n, status);
  if (n !== null && op === 'merge' && status === undefined) return merge(dir, n);
  throw new Stop(USAGE, 2);
}

try {
  process.stdout.write(`${main(process.argv.slice(2), process.env)}\n`);
} catch (e) {
  const message = e instanceof Stop ? e.message : `host.js: ${(e.stderr ? String(e.stderr).trim() : '') || e.message}`;
  process.stderr.write(`${message}\n`);
  process.exitCode = e instanceof Stop ? e.code : 1;
}
