// `slicekit branch <spec|gaps|plan|release> <slug>` (REQ-2.3..REQ-2.5, REQ-2.9, D-54): puts the session on the
// work branch of a document pull request, cut from the default branch as origin has it. The command owns git
// (D-19). A change to a tracked file (staged or not) is refused, so no edit is carried across;
// untracked files go along as git carries them, so a source dropped in for intake survives. The one
// change carried is the config as the migration writes it from the committed one (D-94): an earlier
// command on this branch, such as `release --dry-run`, wrote it, and `pr open` commits it.
// A `release/<slug>` branch that exists away from the default branch's tip is moved there or refused;
// one that holds its own commits is refused with its open pull request, read through the git host
// (C-1 pullRequestForBranch), or with the next free slug when the host says none is open.
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_PATH, ConfigError, loadConfig, migrateConfig } from '../config.js';
import { GitError, assertRef, currentBranch, git, hasRemote, switchBranch } from '../git.js';

const KINDS = ['spec', 'gaps', 'plan', 'release'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const USAGE = 'branch <spec|gaps|plan|release> <slug>';

const resolves = (root, ref) => {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
};

const CONFIG_FILE = CONFIG_PATH.split(path.sep).join('/');

// D-94: whether the only uncommitted change to a tracked file is the config, and the file holds
// exactly what the migration writes from the config the last commit holds. A config staged with
// one content and holding another in the working directory is not that change.
function onlyMigratedConfig(root) {
  const names = (args) => git(root, ['diff', '--name-only', '--no-renames', '-z', ...args]).split('\0').filter((f) => f !== '');
  const staged = names(['--cached', 'HEAD']);
  const unstaged = names([]);
  const changed = new Set([...staged, ...unstaged]);
  if (changed.size !== 1 || !changed.has(CONFIG_FILE)) return false;
  if (staged.length > 0 && unstaged.length > 0) return false;
  try {
    const committed = JSON.parse(git(root, ['show', `HEAD:${CONFIG_FILE}`]));
    const { cfg, from } = migrateConfig(committed);
    if (cfg === committed || from === cfg.configVersion) return false;
    return fs.readFileSync(path.join(root, CONFIG_PATH), 'utf8') === `${JSON.stringify(cfg, null, 2)}\n`;
  } catch (e) {
    if (e instanceof GitError || e instanceof ConfigError || e instanceof SyntaxError || e.code !== undefined) return false;
    throw e;
  }
}

async function run(args, io) {
  const [kind, slug, ...rest] = args;
  if (!KINDS.includes(kind) || slug === undefined || rest.length > 0) {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  if (!SLUG.test(slug)) {
    io.stderr(`slicekit: slug '${slug}' must be lowercase letters, digits and dashes, at most 60, not starting with a dash\n`);
    return 2;
  }
  const root = io.cwd;
  const target = `${kind}/${slug}`;
  try {
    const cfg = loadConfig(root);
    const base = assertRef(cfg.defaultBranch);
    const onTarget = currentBranch(root) === target;
    if (onTarget && kind !== 'release') {
      io.stdout(`${target}\n`);
      return 0;
    }
    const dirty = git(root, ['status', '--porcelain', '--untracked-files=no']) !== '' && !onlyMigratedConfig(root);
    if (dirty && !onTarget) {
      io.stderr('slicekit: commit or stash your changes first\n');
      return 1;
    }
    // The full ref: a tag named like the default branch must not be what the branch is cut from.
    let from = `refs/heads/${base}`;
    const origin = hasRemote(root, 'origin');
    let fetched = false;
    if (origin) {
      try {
        git(root, ['fetch', '-q', 'origin', base]);
        fetched = true;
        if (resolves(root, `refs/remotes/origin/${base}`)) from = `refs/remotes/origin/${base}`;
        // The work branch too, so one pushed from another clone is found; origin not having it is
        // the usual case for a new branch, not an error.
        try {
          git(root, ['fetch', '-q', 'origin', `+refs/heads/${target}:refs/remotes/origin/${target}`]);
        } catch (e) {
          if (!(e instanceof GitError)) throw e;
        }
      } catch (e) {
        if (!(e instanceof GitError)) throw e;
        const lines = e.stderr.split('\n');
        const reason = lines.find((l) => /^(fatal|error):/.test(l)) ?? (lines[0] || 'unknown reason');
        io.stderr(`slicekit: could not fetch origin (${reason}); branching from local ${base}\n`);
      }
    }
    // A work branch someone already pushed is taken up where it stands, tracking origin's copy;
    // only a new one is cut from the default branch.
    const remote = `refs/remotes/origin/${target}`;
    if (kind === 'release') {
      // `slicekit release` runs only at the default branch's tip. A release branch that stands
      // elsewhere, here or on origin, is moved to the tip when it holds no commit the default
      // branch lacks; one that does is refused: with its open pull request when the host has one,
      // else with the next free slug.
      const tip = git(root, ['rev-parse', '--verify', `${from}^{commit}`]);
      const copies = [`refs/heads/${target}`, remote].filter((ref) => resolves(root, ref));
      const stale = copies.filter((ref) => git(root, ['rev-parse', '--verify', `${ref}^{commit}`]) !== tip);
      if (stale.some((ref) => git(root, ['rev-list', '--count', `${from}..${ref}`]) !== '0')) {
        // The branch may be that of the phase's open release pull request; a second slug would then
        // open a second one beside it. A pull request needs its branch on origin, so the host is
        // asked unless a fetch that worked found no such branch there.
        if (origin && (!fetched || resolves(root, remote))) {
          let open;
          try {
            open = getHost(cfg, io.env ?? process.env, root).pullRequestForBranch(target, { base });
          } catch (e) {
            if (!(e instanceof GitHostError)) throw e;
            io.stderr(`slicekit: ${target} holds commits ${base} lacks, and the git host could not be asked for its open pull request (${e.message}); no branch is cut
`);
            return 1;
          }
          if (open) {
            io.stderr(`slicekit: ${target} is the branch of open pull request #${open.number} (${open.url}); the phase's release is already open
`);
            return 1;
          }
        }
        let n = 2;
        while (resolves(root, `refs/heads/${target}-${n}`) || resolves(root, `refs/remotes/origin/${target}-${n}`)) n += 1;
        io.stderr(`slicekit: ${target} holds commits ${base} lacks, so no release runs on it; run slicekit branch release ${slug}-${n}\n`);
        return 1;
      }
      if (onTarget && stale.length === 0) {
        io.stdout(`${target}\n`);
        return 0;
      }
      if (stale.length > 0) {
        if (dirty) {
          io.stderr('slicekit: commit or stash your changes first\n');
          return 1;
        }
        // -C makes the branch, or moves it, to stand at the tip; it held no commit of its own.
        git(root, ['switch', '-q', '--no-track', '-C', target, from]);
        io.stderr(`slicekit: ${target} was behind ${base}; moved to the tip of ${base}\n`);
        io.stdout(`${target}\n`);
        return 0;
      }
    }
    if (resolves(root, `refs/heads/${target}`)) switchBranch(root, target);
    else if (resolves(root, remote)) switchBranch(root, target, { create: true, from: remote, track: true });
    else switchBranch(root, target, { create: true, from });
    io.stdout(`${target}\n`);
    return 0;
  } catch (e) {
    if (e instanceof ConfigError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    if (e instanceof GitError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

export const branchCommand = { run, usage: USAGE, subcommands: KINDS };
