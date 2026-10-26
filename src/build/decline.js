// `build decline` (REQ-2.6 step 8): a should-have the implementer declines becomes one tracker issue
// (C-2) and one line in the pull request body's "Should-haves declined". A second decline of the same
// finding finds the issue it opened and opens no other; the body never lists a URL twice.
import fs from 'node:fs';
import path from 'node:path';
import { getSection, setSection } from '../prbody.js';
import { readSlice } from '../state/index.js';
import { parseVerdict } from '../verdict.js';
import { BuildError, findWorktree } from './worktree.js';

const SECTION = 'Should-haves declined';

// The verdict of the highest round the state records, or null when none is recorded.
function latestVerdict(state) {
  return (state.verdicts ?? []).reduce((best, v) => (best === null || v.round > best.round ? v : best), null);
}

function issueBody(f, v) {
  return [`What is wrong: ${f.wrong}`, `Why it matters: ${f.why}`, `How verified: ${f.verified}`, '', `Verdict: ${v.path} at ${v.headSha}`, ''].join('\n');
}

// The section's text with `url` added: in place of `none`, else on a line of its own.
function withUrl(current, url) {
  const t = (current ?? '').trim();
  if (t === '' || /^none\.?$/i.test(t)) return url;
  return `${t}\n${url}`;
}

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

  const open = tracker.find(id, finding);
  const issue = open ?? tracker.open({ title: `[${id}] ${finding}: ${f.wrong}`, body: issueBody(f, v), slice: id });

  const body = host.getPullRequest(number).body;
  const current = getSection(body, SECTION);
  if (!(current ?? '').split(/\s+/).includes(issue.url)) {
    host.updatePullRequestBody(number, setSection(body, SECTION, withUrl(current, issue.url)));
  }
  return { url: issue.url, created: open === null };
}
