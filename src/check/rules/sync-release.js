// sync-release (05 REQ-5.5, D-43, D-89, D-90, D-92): under --ci on a sync pull request (a `sync/<short sha>`
// branch), the files the release step writes (package.json, CHANGELOG.md and the rendered files) must
// equal what CI computes for the merge the branch names: a fresh checkout of that merge in a temporary
// worktree, synced from the git host and given the version, section and render the sync step would
// write there. So package.json may change only in its version field, CHANGELOG.md only by the one new
// section, and a rendered file only to its fresh render at that version. The rendered files of each
// folder under examples/ that holds them are judged the same way (D-95): the sync step renders each
// example at that version, so an example file is accepted only where it equals that render. One
// finding per file that differs, naming it. The version is computed by the function the sync step
// runs, so the rule of D-96 holds here too: a phase whose line a CHANGELOG.md section at the merge
// holds has had its minor version, and a sync pull request that carries a second one for it is one
// finding on package.json and one on CHANGELOG.md (issue #174). A sync branch whose merge the checkout cannot resolve is the journal rule's
// finding. Silent outside CI and on any other branch, and when the config has no release.auto and the
// branch changes none of those files.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getHost } from '../../adapters/githost/index.js';
import { GitHostError } from '../../adapters/githost/errors.js';
import { ConfigError, loadConfig } from '../../config.js';
import { git, resolveCommit } from '../../git.js';
import { EXAMPLES, PACKAGE, ReleaseError, applyRelease, isKitRoot, isReleasePath } from '../../release-version.js';
import { syncFromHost } from '../../state/sync.js';
import { SYNC_BRANCH, branchTip } from '../ci-event.js';

export const id = 'sync-release';
export const blocking = true;
export const ratchet = false;

const nul = (out) => out.split('\0').filter((l) => l !== '');

export function run(ctx) {
  if (!ctx.ci) return [];
  const { root, cfg } = ctx;
  const at = branchTip(ctx);
  if (at === null || !SYNC_BRANCH.test(at.branch)) return [];
  const merge = resolveCommit(root, at.branch.slice('sync/'.length));
  if (merge === null) return [];
  // The release paths with the examples this checkout holds; below, those the merge holds are
  // added, so an example the branch adds or removes is judged against the merge's render too.
  const ownsHere = isReleasePath(cfg, root);
  let owns = ownsHere;
  const changed = nul(git(root, ['diff', '--name-only', '--no-renames', '-z', merge, at.tip])).filter(owns);
  if (cfg.release?.auto !== true && changed.length === 0) return [];
  const example = (file) => file.startsWith(`${EXAMPLES}/`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-sync-release-'));
  const wt = path.join(tmp, 'merge');
  try {
    git(root, ['worktree', 'add', '--quiet', '--detach', wt, merge]);
    const ownsMerge = isReleasePath(cfg, wt);
    owns = (f) => ownsHere(f) || ownsMerge(f);
    let expected;
    try {
      expected = expectedFiles(root, ctx, wt, owns);
    } catch (e) {
      if (!(e instanceof GitHostError || e instanceof ConfigError || e instanceof ReleaseError)) throw e;
      return [{ file: PACKAGE, line: 0, message: `the version for the merge ${merge.slice(0, 7)} could not be computed (${e.message}); a sync pull request carries only what CI computes` }];
    }
    const out = [];
    for (const file of [...new Set([...changed, ...expected.keys()])].sort()) {
      const want = expected.has(file) ? expected.get(file) : read(wt, file);
      const got = blob(root, at.tip, file);
      if (same(want, got)) continue;
      const how = example(file)
        ? 'a sync pull request changes an example file only to its fresh render at the version it sets (slicekit update --yes in that folder)'
        : "a sync pull request changes it only as the sync step does (package.json's version, one new CHANGELOG.md section, the render at that version)";
      out.push({ file, line: 0, message: `${file} differs from what CI computes for the merge ${merge.slice(0, 7)}; ${how}` });
    }
    return out;
  } finally {
    try {
      git(root, ['worktree', 'remove', '--force', wt]);
    } catch {
      // Left for git worktree prune.
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const same = (a, b) => (a === null ? b === null : b !== null && a.equals(b));

function read(dir, file) {
  const abs = path.join(dir, ...file.split('/'));
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? fs.readFileSync(abs) : null;
}

// The file at `rev` as a Buffer, or null when the commit does not hold it.
function blob(root, rev, file) {
  const listed = git(root, ['ls-tree', '--name-only', rev, '--', file]);
  if (listed === '') return null;
  return execFileSync('git', ['cat-file', 'blob', `${rev}:${file}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Runs the sync step in the merge's worktree and returns the release paths it changed, with their
// new content (null for a removed file). The version comes from the function the sync job runs
// (applyRelease): the merged slices no changelog section at the merge names (D-92).
function expectedFiles(root, ctx, wt, owns) {
  const cfg = loadConfig(wt);
  const host = getHost(cfg, ctx.env ?? process.env, root);
  syncFromHost(wt, cfg, host);
  applyRelease(wt, cfg, { merge: 'HEAD', isKit: isKitRoot(root) });
  const tracked = nul(git(wt, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']));
  const untracked = nul(git(wt, ['ls-files', '--others', '--exclude-standard', '-z']));
  const out = new Map();
  for (const f of [...new Set([...tracked, ...untracked])].filter(owns)) out.set(f, read(wt, f));
  return out;
}

export default { id, blocking, ratchet, run };
