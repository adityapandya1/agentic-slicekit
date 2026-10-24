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
export const currentBranch = (root) => git(root, ['symbolic-ref', '--short', 'HEAD']);
export const headSha = (root) => git(root, ['rev-parse', 'HEAD']);

export function changedFiles(root, base) {
  const out = git(root, ['diff', '--name-only', `${base}...HEAD`]);
  return out === '' ? [] : out.split('\n');
}

function parseTrailers(body) {
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
  const range = base ? `${base}..HEAD` : 'HEAD';
  const out = git(root, ['log', '--format=%H%x1f%s%x1f%b%x1e', range]);
  return out
    .split('\x1e')
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec.trim() !== '')
    .map((rec) => {
      const [sha, subject, body = ''] = rec.split('\x1f');
      return { sha, subject, body: body.trim(), trailers: parseTrailers(body) };
    });
}
