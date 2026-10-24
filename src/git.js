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
export function currentBranch(root) {
  try {
    return git(root, ['symbolic-ref', '--short', 'HEAD']);
  } catch (e) {
    if (e instanceof GitError && /not a symbolic ref/.test(e.stderr)) return null;
    throw e;
  }
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
