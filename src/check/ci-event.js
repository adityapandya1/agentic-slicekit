// The pull request a `slicekit check --ci` run judges (03 REQ-3.11). In GitHub Actions it is read
// from the event file `GITHUB_EVENT_PATH` names. A workflow_dispatch run (D-80: the sync job starts
// the workflow on its sync branch that way) has no pull request in its event, so the open pull
// request for the run's branch is read through C-1 pullRequestForBranch. Any other event (a push)
// has no pull request.
// Locally, with no event file, `SLICEKIT_PR_TITLE` / `SLICEKIT_PR_BODY` stand in for one.
import fs from 'node:fs';
import { getHost } from '../adapters/githost/index.js';
import { DEFAULT_BOT_ACTORS } from '../config.js';
import { resolveCommit } from '../git.js';

// The pseudo-path the ci rules attach their findings to (line 0): the title and body live in the
// GitHub event, not in a file of the repository, and this reads clearly in CI output.
export const PR_FILE = '.github/pull_request';

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// The open pull request of a workflow_dispatch run's branch, read from the host, or null when the run
// is not on a branch or the branch has none. A host that cannot answer throws, as a broken event does.
function dispatchedPullRequest(env, event, { cfg, root } = {}) {
  const ref = typeof env.GITHUB_REF === 'string' && env.GITHUB_REF !== '' ? env.GITHUB_REF : event.ref;
  if (typeof ref !== 'string' || !ref.startsWith('refs/heads/')) return null;
  const branch = ref.slice('refs/heads/'.length);
  const host = getHost(cfg, env, root ?? process.cwd());
  const open = host.pullRequestForBranch(branch, { base: cfg?.defaultBranch });
  if (!open) return null;
  const pr = host.getPullRequest(open.number);
  if (typeof pr.title !== 'string') throw new Error(`pull request ${open.number} of ${branch} has no title`);
  return {
    title: pr.title,
    body: typeof pr.body === 'string' ? pr.body : '',
    number: open.number,
    branch,
    headSha: typeof pr.headSha === 'string' ? pr.headSha : null,
    labels: Array.isArray(pr.labels) ? pr.labels.filter((n) => typeof n === 'string') : [],
    author: null,
  };
}

// `{title, body, number, branch, headSha, labels, author}` or null when there is no pull request. An event file
// that is named but missing, unreadable or invalid throws: CI must never pass on a broken event.
// `ctx` ({cfg, root}) names the host a workflow_dispatch run asks.
export function readCiEvent(env = process.env, ctx = {}) {
  const file = env.GITHUB_EVENT_PATH;
  if (typeof file === 'string' && file !== '') {
    let event;
    try {
      event = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`cannot read the GitHub event at ${file}: ${e.message}`);
    }
    if (!isObject(event)) throw new Error(`the GitHub event at ${file} is not an object`);
    const pr = event.pull_request;
    if (pr === undefined || pr === null) return env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? dispatchedPullRequest(env, event, ctx) : null;
    if (!isObject(pr)) throw new Error(`the GitHub event at ${file} has a pull_request that is not an object`);
    if (typeof pr.title !== 'string') throw new Error(`the pull request in ${file} has no title`);
    if (pr.body !== undefined && pr.body !== null && typeof pr.body !== 'string') throw new Error(`the pull request in ${file} has a body that is not text`);
    return {
      title: pr.title,
      body: pr.body ?? '',
      number: Number.isInteger(pr.number) ? pr.number : null,
      branch: typeof pr.head?.ref === 'string' ? pr.head.ref : null,
      headSha: typeof pr.head?.sha === 'string' ? pr.head.sha : null,
      labels: Array.isArray(pr.labels) ? pr.labels.map((l) => l?.name).filter((n) => typeof n === 'string') : [],
      author: typeof pr.user?.login === 'string' ? pr.user.login : null,
    };
  }
  const title = env.SLICEKIT_PR_TITLE;
  const body = env.SLICEKIT_PR_BODY;
  if (title === undefined && body === undefined) return null;
  return { title: title ?? '', body: body ?? '', number: null, headSha: null, labels: [], author: null };
}

// D-37: whether the pull request was opened by an actor in ci.botActors (absent: the default list).
export function isBotAuthor(cfg, pr) {
  const bots = cfg?.ci?.botActors ?? DEFAULT_BOT_ACTORS;
  return typeof pr?.author === 'string' && bots.includes(pr.author);
}

// A `[spec] `, `[plan] ` or `[sync] ` title: a spec, plan or state sync pull request, not a slice's.
export const EXEMPT_TITLE = /^\[(spec|plan|sync)\] /;

// A `[sync] ` title: the state sync pull request, which belongs on a `sync/<short sha>` branch only.
export const SYNC_TITLE = /^\[sync\] /;
export const SYNC_BRANCH = /^sync\/[0-9a-f]{7,40}$/;

// The branch a rule judges and the tip it judges it at, or null with no repository, no commits or no
// branch (moved from the trailer rule in P3/S-18, so trailer and citations share it). Under --ci on
// a pull request, actions/checkout leaves a detached merge commit whose first parent is the base: the
// branch is GITHUB_HEAD_REF and the tip the pull request's head, from the event's head sha (or the
// merge commit's second parent when the event has none). Otherwise the current branch and HEAD.
export function branchTip(ctx) {
  if (!ctx.git?.isRepo || !ctx.git.hasCommits) return null;
  const ref = ctx.env?.GITHUB_HEAD_REF;
  if (ctx.ci && typeof ref === 'string' && ref !== '') {
    const headSha = readCiEvent(ctx.env)?.headSha;
    const tip = (headSha && /^[0-9a-f]{7,40}$/.test(headSha) && resolveCommit(ctx.root, headSha)) || resolveCommit(ctx.root, 'HEAD^2') || 'HEAD';
    return { branch: ref, tip };
  }
  return ctx.git.branch ? { branch: ctx.git.branch, tip: 'HEAD' } : null;
}
