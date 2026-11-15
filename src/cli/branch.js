// `slicekit branch <spec|gaps|plan|release> <slug>` (REQ-2.3..REQ-2.5, REQ-2.9, D-54): puts the session on the
// work branch of a document pull request, cut from the default branch as origin has it. The command owns git
// (D-19). A change to a tracked file (staged or not) is refused, so no edit is carried across;
// untracked files go along as git carries them, so a source dropped in for intake survives.
// A `release/<slug>` branch that exists away from the default branch's tip is moved there or refused.
import { ConfigError, loadConfig } from '../config.js';
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
    const dirty = git(root, ['status', '--porcelain', '--untracked-files=no']) !== '';
    if (dirty && !onTarget) {
      io.stderr('slicekit: commit or stash your changes first\n');
      return 1;
    }
    // The full ref: a tag named like the default branch must not be what the branch is cut from.
    let from = `refs/heads/${base}`;
    if (hasRemote(root, 'origin')) {
      try {
        git(root, ['fetch', '-q', 'origin', base]);
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
      // branch lacks; one that does is refused, and the line names the next free slug.
      const tip = git(root, ['rev-parse', '--verify', `${from}^{commit}`]);
      const copies = [`refs/heads/${target}`, remote].filter((ref) => resolves(root, ref));
      const stale = copies.filter((ref) => git(root, ['rev-parse', '--verify', `${ref}^{commit}`]) !== tip);
      if (stale.some((ref) => git(root, ['rev-list', '--count', `${from}..${ref}`]) !== '0')) {
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
