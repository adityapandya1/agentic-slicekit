// The workspace of a program repository (REQ-4.6, D-15, D-47): the file that lists the repositories
// a program spans, and which of them are on disk to be walked. The workspace file is the only list;
// config's repos is accepted and never read here.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { kitPaths } from '../paths.js';
import { defaultRef } from './git-walk.js';
import { GraphError } from './schema.js';

const posix = (p) => p.split(path.sep).join('/');
const NAME = /^[A-Za-z0-9._-]+$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)[^\s~^:?*[\\\0]+(?<![/.])$/;
const isText = (v) => typeof v === 'string' && v.trim() !== '';

export const workspaceRel = (root, cfg) => posix(path.relative(root, kitPaths(root, cfg).workspace));

// readWorkspace(root, cfg) -> {repos: [{name, path, url, defaultBranch}]}, or null when there is no
// workspace file. A file that cannot be read as one throws GraphError(1, `<rel>: <problem>`).
export function readWorkspace(root, cfg) {
  const file = kitPaths(root, cfg).workspace;
  const rel = workspaceRel(root, cfg);
  const fail = (problem) => {
    throw new GraphError(1, `${rel}: ${problem}`);
  };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    fail(`not valid JSON: ${e.message}`);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.repos)) fail('repos must be an array');
  const seen = new Set();
  const repos = data.repos.map((r, i) => {
    const at = `repos[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) fail(`${at} must be an object`);
    if (typeof r.name !== 'string' || !NAME.test(r.name) || r.name === '.' || r.name === '..') {
      fail(`${at}.name must be a name of letters, digits, . _ or -, and not .`);
    }
    if (seen.has(r.name)) fail(`${at}.name ${r.name} is listed twice`);
    seen.add(r.name);
    if (!isText(r.path) && !isText(r.url)) fail(`${at} gives neither path nor url`);
    if (typeof r.defaultBranch !== 'string' || !BRANCH.test(r.defaultBranch)) fail(`${at}.defaultBranch must be a branch name`);
    return { name: r.name, path: isText(r.path) ? r.path : null, url: isText(r.url) ? r.url : null, defaultBranch: r.defaultBranch };
  });
  return { repos };
}

// True when dir is the top of a git work tree (not a folder inside one).
function isRepoTop(dir) {
  try {
    const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return prefix.trim() === '';
  } catch {
    return false;
  }
}

// A host whose every call fails: a workspace repository with no fixture of its own. The graph asks
// a host for getPullRequest only.
const failingHost = (message) => ({
  kind: 'fixture',
  getPullRequest() {
    throw new GitHostError(message);
  },
});

// The git host of one workspace repository: getHost for its own root, so gh reads that repository.
// With SLICEKIT_GITHOST_FIXTURE set it is the fixture <fixture>/<name>, when that directory exists.
function hostFor(cfg, env, name, repoRoot) {
  const fixture = env.SLICEKIT_GITHOST_FIXTURE;
  try {
    if (fixture) {
      const dir = path.join(fixture, name);
      if (!fs.existsSync(dir)) return { host: failingHost(`no fixture for ${name}`), skipped: null };
      return { host: getHost(cfg, { ...env, SLICEKIT_GITHOST_FIXTURE: dir }, repoRoot), skipped: null };
    }
    return { host: getHost(cfg, env, repoRoot), skipped: null };
  } catch (e) {
    if (!(e instanceof GitHostError)) throw e;
    return { host: null, skipped: `pull requests of ${name} skipped: ${e.message}` };
  }
}

// reachRepos(root, cfg, workspace, env) -> {reached: [{name, root, defaultBranch, host, skipped}],
// unreached: [{name, reason}]}, both in the workspace file's order. `path` resolves against the
// program root; an entry with only a url is never cloned.
export function reachRepos(root, cfg, workspace, env = process.env) {
  const reached = [];
  const unreached = [];
  for (const r of workspace?.repos ?? []) {
    if (r.path === null) {
      unreached.push({ name: r.name, reason: `no path; ${r.url} is not on disk` });
      continue;
    }
    const abs = path.resolve(root, r.path);
    if (!fs.existsSync(abs)) {
      unreached.push({ name: r.name, reason: `${r.path} does not exist` });
      continue;
    }
    if (!fs.statSync(abs).isDirectory() || !isRepoTop(abs)) {
      unreached.push({ name: r.name, reason: `${r.path} is not a git repository` });
      continue;
    }
    try {
      defaultRef(abs, r.defaultBranch);
    } catch (e) {
      if (!(e instanceof GraphError)) throw e;
      unreached.push({ name: r.name, reason: `the default branch ${r.defaultBranch} is not present` });
      continue;
    }
    reached.push({ name: r.name, root: abs, defaultBranch: r.defaultBranch, ...hostFor(cfg, env, r.name, abs) });
  }
  return { reached, unreached };
}
