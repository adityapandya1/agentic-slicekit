import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { GitHostNotFound } from '../adapters/githost/errors.js';
import { SLICEKIT_WORKFLOW } from '../adapters/githost/gh-json.js';
import { SYNC_BRANCH, SYNC_TITLE } from '../check/ci-event.js';
import { GitError, currentBranch, git, switchBranch } from '../git.js';
import { kitPaths } from '../paths.js';
import { prBodyProblems } from '../prbody.js';
import { listSlices, setState } from './index.js';
import { isDate } from '../evidence.js';
import { HOST_MERGE_FROM } from './transitions.js';

// Before a pull request exists in the state machine: a merged pull request recorded here means the
// record is wrong, and a human should look rather than the sync guess.
const BEFORE_DRAFT = ['todo', 'tests-red', 'building'];

// Moves every slice in a pre-merge state (draft-pr through ready) whose pull request the host
// reports merged to `merged`, recording the real previous state and `by: 'sync'`. A slice before
// draft-pr with a merged pull request is warned, not moved. Returns
// { changes: [{ id, from, to, pr }], warnings: [string] }.
//
// A pull request the host cannot find, an answer about another pull request, and a merge time that
// is not a date are each warned and skipped. Any other error stops the sync; it
// carries what was already written as `error.partial = { changes, warnings }`, so a caller can
// report every change that reached disk before the failure.
export function syncFromHost(root, cfg, host) {
  const changes = [];
  const warnings = [];
  try {
    for (const { state } of listSlices(root, cfg)) {
      const from = state.state;
      const syncable = HOST_MERGE_FROM.includes(from);
      if (!syncable && !BEFORE_DRAFT.includes(from)) continue;
      const number = state.pr?.number;
      if (!Number.isInteger(number) || number < 1) {
        if (syncable) warnings.push(`${state.slice} is ${from} but has no valid pull request number recorded; skipped`);
        continue;
      }
      let pr;
      try {
        pr = host.getPullRequest(number);
      } catch (e) {
        if (!(e instanceof GitHostNotFound)) throw e;
        warnings.push(`${state.slice}: pull request ${number} could not be fetched: ${e.message}; skipped`);
        continue;
      }
      if (pr.number !== number) {
        warnings.push(`${state.slice}: the host answered pull request ${number} with pull request ${pr.number}; skipped`);
        continue;
      }
      if (!pr.mergedAt) continue;
      if (!isDate(pr.mergedAt)) {
        warnings.push(`${state.slice}: pull request ${number} has a merge time that is not a date ('${pr.mergedAt}'); skipped`);
        continue;
      }
      if (!syncable) {
        warnings.push(`${state.slice} is ${from} but pull request ${number} is merged; its record needs a human; skipped`);
        continue;
      }
      const evidence = { number };
      if (pr.url) evidence.url = pr.url;
      if (pr.headSha) evidence.headSha = pr.headSha;
      setState(root, cfg, state.slice, 'merged', { mergedAt: pr.mergedAt, pr: evidence, source: 'host' });
      changes.push({ id: state.slice, from, to: 'merged', pr: number });
    }
  } catch (e) {
    if (e && typeof e === 'object') e.partial = { changes, warnings };
    throw e;
  }
  return { changes, warnings };
}

// `slicekit sync open` (03 REQ-3.11, D-78, D-80): after status --sync --write on the default branch's
// merge commit, the state change goes up for review instead of onto the default branch. The paths it
// may carry are the state directory, BUILD.md and the journal heads log; nothing else is staged. When
// none of them changed it opens nothing. Otherwise it commits them on `sync/<short sha>` (a new branch
// from the merge commit), pushes that branch alone, opens `[sync] state after <short sha>` into the
// default branch through C-1, and starts the kit's workflow on the branch with workflow_dispatch, since
// a pull request opened with the workflow's own token starts no run. An open pull request for that
// branch means a run already did this: nothing is opened a second time. The commit is made with
// ALLOW_PROTECTED_COMMIT removed from its environment, so the git hooks guard it as any other.
// Returns { outcome: 'unchanged' } | { outcome: 'open', branch, number, url } |
// { outcome: 'opened', branch, number, url, files }, each with `closed`, the older [sync] pull requests
// it closed as superseded. Throws SyncOpenError, GitError or GitHostError.
export class SyncOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SyncOpenError';
  }
}

export const SYNC_BRANCH_PREFIX = 'sync/';
export const syncTitle = (short) => `[sync] state after ${short}`;

const posix = (p) => p.split(path.sep).join('/');

// The paths a sync commit may carry, relative to the repository root.
export function syncPaths(root, cfg) {
  const p = kitPaths(root, cfg);
  return [p.build, p.state, path.join(p.kit, 'journal-heads.log')].map((f) => posix(path.relative(root, f)));
}

// git with ALLOW_PROTECTED_COMMIT taken out of the environment (REQ-3.11: the sync never sets it).
function gitGuarded(root, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'ALLOW_PROTECTED_COMMIT') delete env[k];
  try {
    return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new GitError(args, String(e.stderr ?? e.message).trim());
  }
}

// The files under `paths` that differ from HEAD, untracked ones included, as POSIX paths.
function changedUnder(root, paths) {
  const out = gitGuarded(root, ['--literal-pathspecs', 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--', ...paths]);
  return out
    .split('\0')
    .filter((e) => e.length > 3)
    .map((e) => e.slice(3))
    .sort();
}

export function syncBody(short, defaultBranch, files) {
  const list = files.map((f) => `\`${f}\``).join(', ');
  return [
    `**Done when:** the slice state that \`slicekit status --sync --write\` recorded after ${short} is on ${defaultBranch}: ${list}`,
    `**Proof:** \`slicekit status --sync --write\` on ${short} changed ${files.length} file${files.length === 1 ? '' : 's'}; the checks run on this branch through workflow_dispatch`,
    '**Decisions:** none',
    '',
  ].join('\n');
}

// Pushes the sync branch, and only a `sync/<short sha>` branch, with a lease on what origin holds
// for it now: none, or the commit a run that stopped before its pull request left there. A re-run
// makes a new commit (its committer time differs), so a plain push would be refused; the lease
// replaces only the ref read a moment before and never touches any other branch.
function pushSyncBranch(root, cfg, branch) {
  if (!SYNC_BRANCH.test(branch) || branch === cfg.defaultBranch || (cfg.protectedBranches ?? []).includes(branch)) {
    throw new SyncOpenError(`sync open pushes only a sync/<short sha> branch, not ${branch}`);
  }
  const ref = `refs/heads/${branch}`;
  const listed = gitGuarded(root, ['ls-remote', '--heads', 'origin', ref]).trim();
  const held = listed.split('\n').map((l) => l.split(/\s+/)).find(([, name]) => name === ref)?.[0] ?? '';
  gitGuarded(root, ['push', '-q', `--force-with-lease=${ref}:${held}`, 'origin', `HEAD:${ref}`]);
}

// Closes every other open `[sync]` pull request on a `sync/<short sha>` branch into the default
// branch, with a comment naming the one that supersedes it. The sync state is cumulative from the
// default branch's tip, so the newest sync pull request carries every change an older one did.
// Returns the numbers closed.
function closeSuperseded(host, cfg, keep) {
  const closed = [];
  for (const pr of host.listOpenPullRequests()) {
    if (pr.number === keep.number || pr.head === keep.branch) continue;
    if (!SYNC_BRANCH.test(pr.head) || !SYNC_TITLE.test(pr.title) || (pr.base !== null && pr.base !== cfg.defaultBranch)) continue;
    host.closePullRequest(pr.number, `Superseded by #${keep.number} (${keep.url}): the sync state is cumulative from ${cfg.defaultBranch}'s tip, so #${keep.number} carries every change this pull request did.`);
    closed.push(pr.number);
  }
  return closed;
}

export function openSyncPullRequest(root, cfg, host) {
  const start = currentBranch(root);
  if (start !== cfg.defaultBranch) {
    throw new SyncOpenError(`sync open runs on ${cfg.defaultBranch}, at the merge commit; HEAD is ${start === null ? 'detached' : `on ${start}`}`);
  }
  const files = changedUnder(root, syncPaths(root, cfg));
  if (files.length === 0) return { outcome: 'unchanged' };
  const short = git(root, ['rev-parse', '--short', 'HEAD']);
  const branch = `${SYNC_BRANCH_PREFIX}${short}`;
  const open = host.pullRequestForBranch(branch, { base: cfg.defaultBranch });
  if (open) {
    // A re-run of the job: the pull request is there, but the first run may have stopped before its
    // dispatch, so start the workflow on the branch again; a second run of the checks is harmless.
    const closed = closeSuperseded(host, cfg, { number: open.number, url: open.url, branch });
    host.dispatchWorkflow(SLICEKIT_WORKFLOW.file, branch);
    return { outcome: 'open', branch, number: open.number, url: open.url, closed };
  }

  const title = syncTitle(short);
  const body = syncBody(short, cfg.defaultBranch, files);
  const problems = prBodyProblems(title, body, cfg);
  if (problems.length > 0) throw new SyncOpenError(problems.join('\n'));

  switchBranch(root, branch, { create: true });
  try {
    gitGuarded(root, ['--literal-pathspecs', 'add', '-A', '--', ...files]);
    gitGuarded(root, ['--literal-pathspecs', 'commit', '-q', '-m', `chore(slicekit): sync state after ${short}`, '--', ...files]);
    pushSyncBranch(root, cfg, branch);
  } finally {
    // Back to where it started; the change lives on the sync branch.
    git(root, ['switch', '-q', start]);
  }
  const made = host.openPullRequest({ branch, base: cfg.defaultBranch, title, body, draft: false });
  // Closed only once the new one is open, so a failed open leaves the older one standing.
  const closed = closeSuperseded(host, cfg, { number: made.number, url: made.url, branch });
  host.dispatchWorkflow(SLICEKIT_WORKFLOW.file, branch);
  return { outcome: 'opened', branch, number: made.number, url: made.url, files, closed };
}
