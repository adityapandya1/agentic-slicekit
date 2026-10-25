import { execFileSync } from 'node:child_process';

export class GitError extends Error {
  constructor(args, stderr) {
    super(`git ${args.join(' ')} failed: ${stderr}`);
    this.name = 'GitError';
    this.args = args;
    this.stderr = stderr;
  }
}

export function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    throw new GitError(args, String(e.stderr ?? e.message).trim());
  }
}

function succeeds(root, args) {
  try {
    git(root, args);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}

export const isRepo = (root) => succeeds(root, ['rev-parse', '--git-dir']);
export const hasCommits = (root) => succeeds(root, ['rev-parse', '--verify', 'HEAD']);
// HEAD's branch, or null when HEAD is detached. It reads the full ref and strips `refs/heads/`:
// `--short` gives `heads/main` when a tag `main` exists, which would slip past a protected check.
export function currentBranch(root) {
  let ref;
  try {
    ref = git(root, ['symbolic-ref', '-q', 'HEAD']);
  } catch (e) {
    // -q: a detached HEAD exits 1 with nothing on stderr; anything else is a real failure.
    if (e instanceof GitError && e.stderr === '') return null;
    throw e;
  }
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null;
}

export const headSha = (root) => git(root, ['rev-parse', 'HEAD']);

// Whether `sha` names a commit object in the repository at root.
export function commitExists(root, sha) {
  assertRef(sha);
  return succeeds(root, ['cat-file', '-e', `${sha}^{commit}`]);
}

// The full 40-hex SHA of the commit `sha` names, or null when the repository cannot resolve it
// (unknown, ambiguous, or not a commit).
export function resolveCommit(root, sha) {
  assertRef(sha);
  try {
    return git(root, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

// A ref from user input or config: never an option, never a range, never two words.
export function assertRef(name) {
  if (typeof name !== 'string' || name === '' || name.startsWith('-') || /\s/.test(name) || name.includes('..')) {
    throw new GitError(['assertRef', String(name)], `refusing ref '${name}': empty, option-shaped, spaced or a range`);
  }
  return name;
}

export function changedFiles(root, base) {
  assertRef(base);
  const out = git(root, ['diff', '--name-only', '--end-of-options', `${base}...HEAD`, '--']);
  return out === '' ? [] : out.split('\n');
}

// git's rule: trailers are the lines of the last paragraph, and only when every line is one.
export function parseTrailers(body) {
  const paragraphs = body.replace(/\r\n/g, '\n').trim().split(/\n\n+/);
  const last = paragraphs[paragraphs.length - 1].split('\n');
  const trailers = {};
  for (const line of last) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(.+)$/.exec(line);
    if (!m) return {};
    trailers[m[1]] = m[2].trim();
  }
  return trailers;
}

export function commitsOnBranch(root, base) {
  const range = base == null ? 'HEAD' : `${assertRef(base)}..HEAD`;
  const out = git(root, ['log', '--format=%H%x1f%s%x1f%b%x1e', '--end-of-options', range, '--']);
  return out
    .split('\x1e')
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec.trim() !== '')
    .map((rec) => {
      const [sha, subject, body = ''] = rec.split('\x1f');
      return { sha, subject, body: body.trim(), trailers: parseTrailers(body) };
    });
}

// The commands own git (D-19): these are the helpers they do it through. Each throws GitError.

// `git config user.name`, or null when it is unset or empty.
export function gitUser(root) {
  try {
    return git(root, ['config', 'user.name']) || null;
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

// No staged, unstaged or untracked change (ignored files do not count).
export const isClean = (root) => git(root, ['status', '--porcelain']) === '';

export const hasRemote = (root, name = 'origin') => git(root, ['remote']).split('\n').includes(name);

// Switches to `name`; with `create`, makes it from `from` (default HEAD) without an upstream, so a
// branch cut from origin/main never pushes to main. `track` sets `from` as the upstream instead:
// only for origin's copy of the same work branch. Without `create`, it never guesses a branch from
// a remote one.
export function switchBranch(root, name, { create = false, from, track = false } = {}) {
  assertRef(name);
  if (from !== undefined) assertRef(from);
  const upstream = track ? '--track' : '--no-track';
  if (create) git(root, ['switch', '-q', upstream, '-c', name, ...(from === undefined ? [] : [from])]);
  else git(root, ['switch', '-q', '--no-guess', name]);
}

// Stages `paths` (additions, changes and deletions) and commits only them. Null when none of them
// has a change to commit; otherwise the new commit's SHA.
export function commitPaths(root, paths, message) {
  if (!Array.isArray(paths) || paths.length === 0) throw new GitError(['commit'], 'no paths to commit');
  git(root, ['add', '-A', '--', ...paths]);
  if (succeeds(root, ['diff', '--cached', '--quiet', '--', ...paths])) return null;
  git(root, ['commit', '-q', '-m', message, '--', ...paths]);
  return headSha(root);
}

// The current branch's upstream as { remote, branch }, or null when it has none.
function upstreamOf(root, branch) {
  const get = (key) => {
    try {
      return git(root, ['config', '--get', `branch.${branch}.${key}`]);
    } catch (e) {
      if (e instanceof GitError) return '';
      throw e;
    }
  };
  const remote = get('remote');
  const merge = get('merge');
  if (remote === '' || !merge.startsWith('refs/heads/')) return null;
  return { remote, branch: merge.slice('refs/heads/'.length) };
}

function branchOrThrow(root, what) {
  const branch = currentBranch(root);
  if (branch === null) throw new GitError([what], 'HEAD is detached; work on a branch');
  return branch;
}

// Pushes HEAD to origin, always by explicit refspec `HEAD:refs/heads/<target>`: the target is the
// upstream branch on origin when there is one (a plain push refuses when the names differ under
// push.default=simple), else the current branch, and then `-u` sets the upstream. An explicit
// refspec also keeps a `remote.origin.push` mapping from redirecting the push. Refuses a target in
// `protectedBranches` or equal to `defaultBranch` before anything is sent; callers pass the config's
// values.
export function pushBranch(root, { protectedBranches = ['main'], defaultBranch } = {}) {
  const branch = branchOrThrow(root, 'push');
  const up = upstreamOf(root, branch);
  const tracked = up !== null && up.remote === 'origin';
  const target = tracked ? up.branch : branch;
  assertRef(target);
  if (protectedBranches.includes(target) || target === defaultBranch) {
    throw new GitError(['push'], `refusing to push to ${target}: it is protected; push from a work branch`);
  }
  const remoteRef = `refs/heads/${target}`;
  git(root, ['push', '-q', ...(tracked ? [] : ['-u']), 'origin', `HEAD:${remoteRef}`]);
  return { branch, remoteRef };
}

// The number of commits on the upstream that HEAD lacks, after fetching its remote; 0 without an
// upstream, or when the upstream branch is gone from the remote.
export function behindUpstream(root) {
  const branch = currentBranch(root);
  const up = branch === null ? null : upstreamOf(root, branch);
  if (up === null) return 0;
  // --prune drops the remote-tracking ref of a branch deleted on the remote, so it reads as gone.
  git(root, ['fetch', '--prune', '-q', up.remote]);
  if (!succeeds(root, ['rev-parse', '--verify', '--quiet', '@{u}'])) return 0;
  return Number(git(root, ['rev-list', '--count', 'HEAD..@{u}']));
}
