// Opening a pull request (02 REQ-2.10, REQ-2.1): the one path every command takes to put its work up
// for review. The body is judged by the CI body rule before anything is committed or pushed, so a
// body CI would fail never leaves the machine. A branch with an open pull request gets that pull
// request's body updated, never a second pull request.
import { EXEMPT_TITLE } from './check/ci-event.js';
import { assertRef, commitPaths, currentBranch, pushBranch } from './git.js';
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

// -> { number, url, created }. `commit: {message, paths}` commits only those paths first. Throws
// PrError (code 1 or 2), GitError or GitHostError.
export function openOrUpdate(root, cfg, host, { title, body, base = cfg.defaultBranch, commit, draft } = {}) {
  if (typeof title !== 'string' || title.trim() === '' || /[\r\n]/.test(title)) throw new PrError('the title must be one non-empty line', 2);
  assertRef(base);
  const branch = currentBranch(root);
  if (branch === null) throw new PrError('HEAD is detached; open a pull request from a work branch');
  const protectedBranches = cfg.protectedBranches ?? [];
  if (branch === cfg.defaultBranch || protectedBranches.includes(branch)) {
    throw new PrError(`open a pull request from a work branch, not ${branch}`);
  }
  const problems = prBodyProblems(title, body, cfg);
  if (problems.length > 0) throw new PrError(problems.join('\n'));
  if (commit) commitPaths(root, commit.paths, commit.message);
  const { remoteRef } = pushBranch(root, { protectedBranches });
  const head = remoteRef.slice('refs/heads/'.length);
  const open = host.pullRequestForBranch(head);
  if (open) {
    host.updatePullRequestBody(open.number, body);
    return { number: open.number, url: open.url, created: false };
  }
  const made = host.openPullRequest({ branch: head, base, title, body, draft: draft === true || opensAsDraft(title) });
  return { number: made.number, url: made.url, created: true };
}
