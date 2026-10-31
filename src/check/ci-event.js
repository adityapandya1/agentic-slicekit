// The pull request a `slicekit check --ci` run judges (03 REQ-3.11). In GitHub Actions it is read
// from the event file `GITHUB_EVENT_PATH` names; any other event (a push) has no pull request.
// Locally, with no event file, `SLICEKIT_PR_TITLE` / `SLICEKIT_PR_BODY` stand in for one.
import fs from 'node:fs';
import { DEFAULT_BOT_ACTORS } from '../config.js';
import { resolveCommit } from '../git.js';

// The pseudo-path the ci rules attach their findings to (line 0): the title and body live in the
// GitHub event, not in a file of the repository, and this reads clearly in CI output.
export const PR_FILE = '.github/pull_request';

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// `{title, body, number, headSha, labels, author}` or null when there is no pull request. An event file
// that is named but missing, unreadable or invalid throws: CI must never pass on a broken event.
export function readCiEvent(env = process.env) {
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
    if (pr === undefined || pr === null) return null;
    if (!isObject(pr)) throw new Error(`the GitHub event at ${file} has a pull_request that is not an object`);
    if (typeof pr.title !== 'string') throw new Error(`the pull request in ${file} has no title`);
    if (pr.body !== undefined && pr.body !== null && typeof pr.body !== 'string') throw new Error(`the pull request in ${file} has a body that is not text`);
    return {
      title: pr.title,
      body: pr.body ?? '',
      number: Number.isInteger(pr.number) ? pr.number : null,
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

// A `[spec] ` or `[plan] ` title: a spec or plan pull request, not a slice's.
export const EXEMPT_TITLE = /^\[(spec|plan)\] /;

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
