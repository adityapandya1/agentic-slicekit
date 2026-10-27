// `build decline` (REQ-2.6 step 8): a should-have the implementer declines becomes one tracker issue
// (C-2) and one line in the pull request body's "Should-haves declined". A finding ID names one
// finding for the whole slice, so a second decline finds the issue already filed, open or closed, and
// opens no other; a closed one is never reopened. The body never lists a URL twice.
import fs from 'node:fs';
import path from 'node:path';
import { getSection, setSection } from '../prbody.js';
import { readSlice } from '../state/index.js';
import { parseVerdict } from '../verdict.js';
import { BuildError, findWorktree } from './worktree.js';

const SECTION = 'Should-haves declined';
// GitHub's issue title limit.
export const TITLE_MAX = 256;

const MENTION = /(^|[^\w`])@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9_.-]+)?)/g;

// Every `@name` outside a code span wrapped in backticks, so text an agent wrote never notifies a
// real user. An address like a@b.com is left alone.
export function quoteMentions(text) {
  return String(text)
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(MENTION, '$1`@$2`')))
    .join('');
}

// `<prefix><what>`, with `what` cut so the whole is at most TITLE_MAX characters and ends with "…".
// A cut never leaves a code span open, which would let a mention it wrapped out again.
export function issueTitle(prefix, what) {
  const chars = Array.from(what);
  const room = TITLE_MAX - Array.from(prefix).length;
  if (chars.length <= room) return `${prefix}${what}`;
  let kept = chars.slice(0, Math.max(room - 1, 0)).join('');
  if ((kept.match(/`/g) ?? []).length % 2 === 1) kept = kept.slice(0, kept.lastIndexOf('`'));
  return `${prefix}${kept}…`;
}

// The verdict of the highest round the state records, or null when none is recorded.
function latestVerdict(state) {
  return (state.verdicts ?? []).reduce((best, v) => (best === null || v.round > best.round ? v : best), null);
}

function issueBody(f, v) {
  const q = quoteMentions;
  return [`What is wrong: ${q(f.wrong)}`, `Why it matters: ${q(f.why)}`, `How verified: ${q(f.verified)}`, '', `Verdict: ${v.path} at ${v.headSha}`, ''].join('\n');
}

// The section's text with `url` added: in place of `none`, else on a line of its own.
function withUrl(current, url) {
  const t = (current ?? '').trim();
  if (t === '' || /^none\.?$/i.test(t)) return url;
  return `${t}\n${url}`;
}

// -> {url, created, state}: state is the filed issue's, `open` or `closed`; a new issue is open.
export function declineFinding(root, cfg, host, tracker, id, finding, { worktree } = {}) {
  const wt = findWorktree(root, id, { worktree }).path;
  const state = readSlice(wt, cfg, id);
  const v = latestVerdict(state);
  if (v === null) throw new BuildError(`${id} has no recorded verdict`, 2);
  let text;
  try {
    text = fs.readFileSync(path.resolve(wt, v.path), 'utf8');
  } catch (e) {
    throw new BuildError(`cannot read the verdict ${v.path}: ${e.code ?? e.message}`);
  }
  const f = parseVerdict(text, v.path).findings.find((x) => x.id === finding && x.kind === 'should-have');
  if (!f) throw new BuildError(`${finding} is not a should-have of round ${v.round}`, 2);
  const number = state.pr?.number;
  if (!Number.isInteger(number)) throw new BuildError(`${id} has no pull request to list the declined should-have on`);

  const filed = tracker.find(id, finding);
  const issue = filed ?? tracker.open({ title: issueTitle(`[${id}] ${finding}: `, quoteMentions(f.wrong)), body: issueBody(f, v), slice: id });

  const body = host.getPullRequest(number).body;
  const current = getSection(body, SECTION);
  if (!(current ?? '').split(/\s+/).includes(issue.url)) {
    host.updatePullRequestBody(number, setSection(body, SECTION, withUrl(current, issue.url)));
  }
  return { url: issue.url, created: filed === null, state: filed?.state ?? 'open' };
}
