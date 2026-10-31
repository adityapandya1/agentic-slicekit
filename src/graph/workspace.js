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
const fold = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);

// The first segment of every tracked path of the program repository that holds a slash, lower-cased:
// a workspace name that is one of them would share its file nodes (S-20 review H-1). A top-level file,
// or a git submodule (one gitlink, the node file:<name>), shares none (P3/S-34, issue #62), the rule
// historyCollision keeps. Untracked paths make no file node, so a workspace repository cloned inside
// the program and not ignored is not one (H-7); a folder only in the program's history is caught
// after the walk, by historyCollision (H-5).
function topLevel(root) {
  try {
    const out = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 1024 });
    return new Set(out.split('\0').filter((p) => p.includes('/')).map((p) => p.split('/')[0].toLowerCase()));
  } catch {
    return new Set();
  }
}

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
    fail(`cannot be read: ${e.code ?? e.message}`);
  }
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    fail(`not valid JSON: ${e.message}`);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.repos)) fail('repos must be an array');
  // Names are compared ignoring case: the cache files of Orders and orders would be one file on
  // Windows and macOS.
  const seen = new Set();
  const top = topLevel(root);
  const repos = data.repos.map((r, i) => {
    const at = `repos[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) fail(`${at} must be an object`);
    if (typeof r.name !== 'string' || !NAME.test(r.name) || r.name === '.' || r.name === '..') {
      fail(`${at}.name must be a name of letters, digits, . _ or -, and not .`);
    }
    if (seen.has(r.name.toLowerCase())) fail(`${at}.name ${r.name} is listed twice`);
    seen.add(r.name.toLowerCase());
    // Tracked paths only: a nested clone the program tracks nothing under is no collision (H-7, H-9).
    if (top.has(r.name.toLowerCase())) fail(`${at}.name ${r.name} is also a top-level path of the program repository`);
    if (!isText(r.path) && !isText(r.url)) fail(`${at} gives neither path nor url`);
    if (typeof r.defaultBranch !== 'string' || !BRANCH.test(r.defaultBranch)) fail(`${at}.defaultBranch must be a branch name`);
    return { name: r.name, path: isText(r.path) ? r.path : null, url: isText(r.url) ? r.url : null, defaultBranch: r.defaultBranch };
  });
  return { repos };
}

// The real path of a repository's common git directory: one for a repository and all its worktrees
// (S-20 review H-6).
function commonDir(dir) {
  const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return fold(fs.realpathSync.native(path.resolve(dir, out)));
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

// reachRepos(root, cfg, workspace, env) -> {reached: [{name, index, root, defaultBranch, host, skipped}],
// unreached: [{name, reason}]}, both in the workspace file's order. `path` resolves against the
// program root; an entry with only a url is never cloned.
//
// Two entries on one repository, or an entry on the program repository (a worktree of it included),
// throw GraphError(1, `<rel>: <problem>`): they would walk the same commits twice (S-20 review H-1, H-6).
export function reachRepos(root, cfg, workspace, env = process.env) {
  const reached = [];
  const unreached = [];
  if (!workspace || workspace.repos.length === 0) return { reached, unreached };
  const rel = workspaceRel(root, cfg);
  let program;
  try {
    program = commonDir(root);
  } catch {
    throw new GraphError(2, 'graph: not a git repository');
  }
  const tops = new Map([[program, null]]);
  for (const [i, r] of (workspace?.repos ?? []).entries()) {
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
    const top = commonDir(abs);
    if (tops.has(top)) {
      const j = tops.get(top);
      throw new GraphError(1, `${rel}: repos[${i}].path ${r.path} is ${j === null ? 'the program repository' : `the repository of repos[${j}]`}`);
    }
    tops.set(top, i);
    try {
      defaultRef(abs, r.defaultBranch);
    } catch (e) {
      if (!(e instanceof GraphError)) throw e;
      unreached.push({ name: r.name, reason: `the default branch ${r.defaultBranch} is not present` });
      continue;
    }
    reached.push({ name: r.name, index: i, root: abs, defaultBranch: r.defaultBranch, ...hostFor(cfg, env, r.name, abs) });
  }
  return { reached, unreached };
}

// After the walk: a reached workspace name that is the first segment of a program file or test node
// (one only in the program's history included) throws GraphError(1, `<rel>: <problem>`), since the two
// repositories' nodes would be merged (S-20 review H-5).
export function historyCollision(root, cfg, graph, reached) {
  if (reached.length === 0) return;
  const segments = new Set();
  for (const e of graph.edges) {
    if (e.kind !== 'in' || e.to !== 'repo:.') continue;
    const m = /^(?:file|test):([^/]+)\//.exec(e.from);
    if (m) segments.add(m[1].toLowerCase());
  }
  for (const r of reached) {
    if (segments.has(r.name.toLowerCase())) {
      throw new GraphError(1, `${workspaceRel(root, cfg)}: repos[${r.index}].name ${r.name} is also a top-level path of the program repository`);
    }
  }
}
