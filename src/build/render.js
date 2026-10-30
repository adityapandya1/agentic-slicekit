// `build render` (REQ-2.6, D-43): a slice that changes the kit's version lands the re-render that
// `slicekit update --yes` makes, in the slice worktree, as one commit of only the files update writes:
// `chore(slicekit): <id> render`. `build commit` accepts that commit when its files equal a fresh
// render of the commit before it, made by the kit that runs the check; any other file in it, or a
// rendered file that differs, is a kit file changed by hand.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigError, loadConfig } from '../config.js';
import { GitError, commitPaths, git } from '../git.js';
import { RENDERED, SETTINGS, kitVersion } from '../render/index.js';
import { entriesForShape } from '../render/manifest.js';
import { applyUpdate, planUpdate } from '../render/update.js';
import { readSlice } from '../state/index.js';
import { BuildError, findWorktree } from './worktree.js';

// The states a render is committed from: the states `build commit` commits from, and draft-pr
// (build pr then records the moved head).
const RENDER_FROM = ['building', 'draft-pr', 'in-review', 'changes-requested', 'ci-green', 'ready'];
const CONFIG = '.slicekit/config.json';
const lines = (out) => out.split('\0').filter((l) => l !== '');

export const renderSubject = (id) => `chore(slicekit): ${id} render`;

// The paths `update` may write for this config: each manifest entry, the settings file, and the
// reference copies under .slicekit/rendered/.
function owner(cfg) {
  const dests = new Set([...entriesForShape(cfg.shape).map((e) => e.dest), SETTINGS]);
  return (f) => dests.has(f) || f.startsWith(`${RENDERED}/`);
}

// Every changed path in the worktree (tracked against HEAD, and untracked), POSIX.
function changedPaths(wt) {
  const tracked = lines(git(wt, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']));
  const untracked = lines(git(wt, ['ls-files', '--others', '--exclude-standard', '-z']));
  return [...new Set([...tracked, ...untracked])];
}

// -> { sha, files }: the render commit, or sha null when the worktree already holds this kit's render.
export function renderSlice(root, rootCfg, id, { worktree } = {}) {
  const wt = findWorktree(root, id, { worktree }).path;
  const current = readSlice(wt, rootCfg, id);
  if (!RENDER_FROM.includes(current.state)) throw new BuildError(`${id} is ${current.state}; render runs from ${RENDER_FROM.join(', ')}`);
  // The worktree's own config: the one the slice commits and CI renders against.
  const cfg = loadConfig(wt);
  const owns = owner(cfg);
  // Uncommitted work elsewhere (a template fix the render picks up) stays as it is; a change to a
  // file update writes, or to the config, would be committed as the kit's.
  const before = changedPaths(wt);
  const blocked = before.filter((f) => owns(f) || f === CONFIG);
  if (blocked.length > 0) throw new BuildError(`the worktree has uncommitted changes to ${blocked.slice(0, 5).join(', ')}; build render writes those files`);
  const version = kitVersion();
  const plan = planUpdate(wt, cfg, { version });
  // A drifted file is the team's edit: update leaves it, so the render would be partial.
  const edited = plan.filter((p) => p.status === 'drifted');
  if (edited.length > 0) {
    throw new BuildError(`${edited.map((p) => p.dest).join(', ')} ${edited.length === 1 ? 'was' : 'were'} edited since slicekit wrote ${edited.length === 1 ? 'it' : 'them'}; build render does not overwrite an edit`);
  }
  applyUpdate(wt, cfg, plan, { version });
  const files = changedPaths(wt).filter((f) => !before.includes(f));
  if (files.length === 0) return { sha: null, files: [] };
  const stray = files.find((f) => !owns(f));
  if (stray) throw new BuildError(`update wrote ${stray}, which is not a file it renders`);
  const sha = commitPaths(wt, files, `${renderSubject(id)}\n\nran: slicekit update --yes (${version})\n\nSlice: ${id}`);
  return { sha, files };
}

// Commit `sha` changes only files `update` writes, for the config of the commit before it.
export function renderPathsOnly(wt, sha) {
  const config = blob(wt, `${sha}^`, CONFIG);
  if (config === null) return false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-render-'));
  try {
    fs.mkdirSync(path.join(tmp, '.slicekit'), { recursive: true });
    fs.writeFileSync(path.join(tmp, ...CONFIG.split('/')), config);
    const owns = owner(loadConfig(tmp));
    const changed = lines(git(wt, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', sha]));
    return changed.length > 0 && changed.every(owns);
  } catch (e) {
    if (e instanceof GitError || e instanceof ConfigError) return false;
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The bytes of `rev:file`, or null when the file is not in that commit.
function blob(wt, rev, file) {
  try {
    return execFileSync('git', ['cat-file', 'blob', `${rev}:${file}`], { cwd: wt, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function tree(wt, rev) {
  return lines(git(wt, ['ls-tree', '-r', '-z', '--name-only', rev]));
}

function walk(dir, base = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base === '' ? e.name : `${base}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

// The first file `update` writes that, in commit `rev`, is not what a fresh render from the running
// kit writes, or null when every one is: `update --check` of that commit, made in a scratch copy of the
// files it reads. A file the team edited (drift), a missing one, a changed one, or a reference copy
// that `update --yes` would rewrite is named; a file slicekit does not manage is not.
export function freshAt(wt, rev) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-render-'));
  try {
    const config = blob(wt, rev, CONFIG);
    if (config === null) return CONFIG;
    fs.mkdirSync(path.join(tmp, '.slicekit'), { recursive: true });
    fs.writeFileSync(path.join(tmp, ...CONFIG.split('/')), config);
    let cfg;
    try {
      cfg = loadConfig(tmp);
    } catch (e) {
      if (e instanceof ConfigError) return CONFIG;
      throw e;
    }
    const owns = owner(cfg);
    const held = tree(wt, rev).filter(owns);
    for (const f of held) {
      const abs = path.join(tmp, ...f.split('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, blob(wt, rev, f));
    }
    const version = kitVersion();
    const plan = planUpdate(tmp, cfg, { version });
    const off = plan.find((p) => p.status !== 'same' && p.status !== 'unmanaged');
    if (off) return off.dest;
    applyUpdate(tmp, cfg, plan, { version });
    const written = new Set(walk(tmp).filter(owns));
    for (const f of [...new Set([...written, ...held])]) {
      const want = written.has(f) ? fs.readFileSync(path.join(tmp, ...f.split('/'))) : null;
      const got = blob(wt, rev, f);
      if (want === null || got === null ? want !== got : !want.equals(got)) return f;
    }
    return null;
  } catch (e) {
    if (e instanceof GitError) return CONFIG;
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
