// `slicekit branch <spec|gaps|plan> <slug>` (REQ-2.3..REQ-2.5): puts the session on the work branch
// of a document pull request, cut from the default branch as origin has it. The command owns git
// (D-19); a clean tree is required so nothing is carried across.
import { ConfigError, loadConfig } from '../config.js';
import { GitError, assertRef, currentBranch, git, hasRemote, isClean, switchBranch } from '../git.js';

const KINDS = ['spec', 'gaps', 'plan'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const USAGE = 'branch <spec|gaps|plan> <slug>';

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
    if (currentBranch(root) === target) {
      io.stdout(`${target}\n`);
      return 0;
    }
    if (!isClean(root)) {
      io.stderr('slicekit: commit or stash your changes first\n');
      return 1;
    }
    let from = base;
    if (hasRemote(root, 'origin')) {
      try {
        git(root, ['fetch', '-q', 'origin', base]);
        if (resolves(root, `origin/${base}`)) from = `origin/${base}`;
      } catch (e) {
        if (!(e instanceof GitError)) throw e;
        const reason = e.stderr.split('\n')[0] || 'unknown reason';
        io.stderr(`slicekit: could not fetch origin (${reason}); branching from local ${base}\n`);
      }
    }
    if (resolves(root, `refs/heads/${target}`)) switchBranch(root, target);
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
