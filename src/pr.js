// Opening a pull request (02 REQ-2.10, REQ-2.1): the one path every command takes to put its work up
// for review. Everything that can refuse does so before anything is committed or pushed: the branch
// and where it would push, the base, the paths, the pull request already open for the branch (one
// per kind of change, so its title and base must match), and the body as the CI body rule judges it
// under that pull request's real title. A branch with an open pull request gets that pull request's
// body updated, never a second pull request.
import fs from 'node:fs';
import path from 'node:path';
import { EXEMPT_TITLE } from './check/ci-event.js';
import { assertRef, commitPaths, currentBranch, git, pushBranch, pushTarget } from './git.js';
import { prBodyProblems } from './prbody.js';

export class PrError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'PrError';
    this.code = code;
  }
}

// A slice pull request opens as a draft (the build loop marks it ready once review clears it); a
// `[spec] ` or `[plan] ` pull request opens ready for review. `draft: true` forces a draft.
export const opensAsDraft = (title) => !EXEMPT_TITLE.test(title);

const NOT_INSIDE = '--paths must name files or folders inside the repository, not the root';

// Each path, read from `root` as git reads it, must name something below the repository's top.
function assertInside(root, paths) {
  const real = (p) => fs.realpathSync.native(p);
  const top = real(git(root, ['rev-parse', '--show-toplevel']));
  const here = real(root);
  for (const p of paths) {
    const rel = path.relative(top, path.resolve(here, p));
    if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new PrError(NOT_INSIDE, 2);
  }
}

// -> { number, url, created, committed }. `commit: {message, paths}` commits only those paths;
// `committed` is the new commit's SHA, or null when they held nothing to commit. `base` defaults to
// the default branch; given, it must match an open pull request's base. Throws PrError (code 1 or
// 2), GitError or GitHostError.
export function openOrUpdate(root, cfg, host, { title, body, base, commit, draft } = {}) {
  if (typeof title !== 'string' || title.trim() === '' || /[\r\n]/.test(title)) throw new PrError('the title must be one non-empty line', 2);
  const baseGiven = base !== undefined;
  const into = assertRef(baseGiven ? base : cfg.defaultBranch);
  const branch = currentBranch(root);
  if (branch === null) throw new PrError('HEAD is detached; open a pull request from a work branch');
  const protectedBranches = cfg.protectedBranches ?? [];
  const isProtected = (b) => b === cfg.defaultBranch || protectedBranches.includes(b);
  const { target } = pushTarget(root);
  for (const b of [branch, target]) if (isProtected(b)) throw new PrError(`open a pull request from a work branch, not ${b}`);
  if (into === target) throw new PrError(`--base ${into} is the branch being pushed; name the branch it merges into`, 2);
  if (commit) assertInside(root, commit.paths);

  const open = host.pullRequestForBranch(target, { base: baseGiven ? into : undefined });
  let judged = title;
  if (open) {
    judged = host.getPullRequest(open.number).title;
    if (judged !== title) throw new PrError(`pull request #${open.number} is titled "${judged}"; open one per kind of change`);
    if (baseGiven && open.base && open.base !== into) throw new PrError(`pull request #${open.number} targets ${open.base}, not ${into}`);
  }
  const problems = prBodyProblems(judged, body, cfg);
  if (problems.length > 0) throw new PrError(problems.join('\n'));

  const committed = commit ? commitPaths(root, commit.paths, commit.message) : undefined;
  pushBranch(root, { protectedBranches, defaultBranch: cfg.defaultBranch });
  if (open) {
    host.updatePullRequestBody(open.number, body);
    return { number: open.number, url: open.url, created: false, committed };
  }
  const made = host.openPullRequest({ branch: target, base: into, title, body, draft: draft === true || opensAsDraft(title) });
  return { number: made.number, url: made.url, created: true, committed };
}
