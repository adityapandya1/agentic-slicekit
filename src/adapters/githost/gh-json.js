// gh's JSON shapes and the kit's view of them, shared by the GitHub host and the fixture host,
// so a fixture exercises the same mapping the real host does.
import { assertRef } from '../../git.js';

const OK_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

export function assertPrNumber(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`pull request number must be a positive integer, got ${n}`);
  return n;
}

// A label colour as gh takes it: six hex digits, no '#'.
export function assertLabelColor(color) {
  if (typeof color !== 'string' || !/^[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error(`label color must be six hex digits, got ${JSON.stringify(color)}`);
  }
  return color;
}

export function assertLabel(name) {
  if (typeof name !== 'string' || name.trim() === '' || /[\r\n]/.test(name)) {
    throw new Error(`label must be a non-empty single-line string, got ${JSON.stringify(name)}`);
  }
  return name;
}

// A branch name as gh's --head takes it: a ref, and never `owner:branch` (git forbids ':' in a branch
// name, and gh would read it as another repository's branch).
export function assertBranch(name) {
  assertRef(name);
  if (name.includes(':')) throw new Error(`branch must be a branch of this repository, got ${JSON.stringify(name)}`);
  return name;
}

// A pull request title as gh takes it: one non-empty line.
export function assertTitle(title) {
  if (typeof title !== 'string' || title.trim() === '' || /[\r\n]/.test(title)) {
    throw new Error(`pull request title must be a non-empty single line, got ${JSON.stringify(title)}`);
  }
  return title;
}

// The number and url gh prints for a pull request it made: the last line holding `/pull/<n>`.
export function parsePullRequestUrl(out) {
  const line = String(out ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .reverse()
    .find((l) => /^https?:\/\/\S+\/pull\/\d+$/.test(l));
  if (line === undefined) return null;
  return { number: Number(/\/pull\/(\d+)$/.exec(line)[1]), url: line };
}

// The fields `gh pr list --head` is asked for when finding a branch's pull request.
export const BRANCH_PR_FIELDS = 'number,url,isCrossRepository,baseRefName,headRefName';

// The open pull request of `branch` among `list` (open pull requests), as { number, url, base }, or
// null. A pull request from a fork has the same head name but is not this repository's branch, so it
// never matches. Of several, the one into `base` (when given) wins, else the newest.
export function pickBranchPullRequest(list, branch, base) {
  const same = (Array.isArray(list) ? list : [])
    .filter((p) => p && p.isCrossRepository !== true && p.headRefName === branch && Number.isInteger(p.number))
    .sort((a, b) => b.number - a.number);
  const pr = (base !== undefined && same.find((p) => p.baseRefName === base)) || same[0];
  return pr ? { number: pr.number, url: pr.url, base: pr.baseRefName ?? null } : null;
}

export function mapPullRequest(raw) {
  return {
    number: raw.number,
    url: raw.url,
    state: raw.state,
    mergedAt: raw.mergedAt || null,
    headSha: raw.headRefOid,
    headRef: raw.headRefName ?? null,
    draft: typeof raw.isDraft === 'boolean' ? raw.isDraft : null,
    title: raw.title,
    body: raw.body ?? '',
    labels: (raw.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)),
  };
}

// `since` is assertDate's result, checked by the host before it spends a call.
export function filterMergedSince(list, since) {
  return list
    .filter((p) => p.mergedAt && Date.parse(p.mergedAt) >= since)
    .map((p) => ({ number: p.number, mergedAt: p.mergedAt, headSha: p.headRefOid, title: p.title }));
}

// gh lists runs newest first. Any run still going → pending; any completed run that did not
// succeed (skipped and neutral count as success) → failure; all succeeded → success; none → unknown.
// The newest run of each workflow and event (REQ-2.6 step 9, issue #33): a run that a newer run of the
// same workflow and event replaced, often cancelled by the workflow's concurrency, is not the
// commit's answer. A workflow is known by its workflowDatabaseId when every run carries one, so two
// workflow files that declare one name are judged apart (issue #41), else by its name. Runs with
// neither, or with no event, are judged together, as before.
const hasId = (r) => r.workflowDatabaseId !== undefined && r.workflowDatabaseId !== null && r.workflowDatabaseId !== '';

// When a run last started: a re-run moves startedAt and leaves createdAt alone, so an older run
// re-run after a newer one is the newer answer (issue #42). createdAt for a run with no startedAt.
const startOf = (r) => String(r.startedAt || r.createdAt || '');

function newestPerWorkflow(runs) {
  const byId = runs.every(hasId);
  if (!byId && !runs.every((r) => r.workflowName && r.event)) return runs;
  const newest = new Map();
  for (const r of runs) {
    const key = JSON.stringify(byId ? ['id', r.workflowDatabaseId, r.event ?? null] : ['name', r.workflowName, r.event]);
    const held = newest.get(key);
    if (!held || startOf(r) > startOf(held)) newest.set(key, r);
  }
  return [...newest.values()];
}

export function reduceRuns(all) {
  if (!Array.isArray(all) || all.length === 0) return { status: 'unknown', url: null };
  const runs = newestPerWorkflow(all);
  const going = runs.find((r) => r.status !== 'completed');
  if (going) return { status: 'pending', url: going.url ?? null };
  const failed = runs.find((r) => !OK_CONCLUSIONS.has(r.conclusion));
  if (failed) return { status: 'failure', url: failed.url ?? null };
  return { status: 'success', url: runs[0].url ?? null };
}

// D-49: the generated workflow, as `gh run list --workflow` names its file and as its runs name it.
export const SLICEKIT_WORKFLOW = Object.freeze({ file: 'slicekit.yml', name: 'slicekit' });
export const SLICEKIT_RUN_FIELDS = 'databaseId,status,conclusion,createdAt,startedAt,workflowName,workflowDatabaseId,event,url';

// The slicekit run of a commit, shared by the GitHub host and the fixture host (issue #52): of gh's
// runs, the pull_request runs of the slicekit workflow newest first by start, the first whose team
// command jobs were decided, `passed` or `failed` by commandJobsVerdict, as { run, jobs }; null when
// none was. A run still in progress (on an `edited` event, the current one) is passed over without
// asking for its jobs, and so is one whose command jobs were all skipped or cancelled. `jobsOf(run)`
// is the host's `gh run view <id> --json jobs`, mapped; it refuses a run with no databaseId. Runs of
// any other workflow or event are never the answer, whatever gh was asked for.
export function decidedSlicekitRun(runs, jobsOf) {
  const mine = (Array.isArray(runs) ? runs : []).filter((r) => r && r.workflowName === SLICEKIT_WORKFLOW.name && r.event === 'pull_request');
  const newestFirst = mine.map((r, i) => ({ r, i })).sort((a, b) => (startOf(b.r) > startOf(a.r) ? 1 : startOf(b.r) < startOf(a.r) ? -1 : a.i - b.i));
  for (const { r: run } of newestFirst) {
    if (run.status !== 'completed') continue;
    const jobs = jobsOf(run);
    const verdict = commandJobsVerdict(run, jobs);
    if (verdict === 'passed' || verdict === 'failed') return { run, jobs };
  }
  return null;
}

// The jobs of `gh run view <id> --json jobs`, as { name, status, conclusion }.
export function mapJobs(view) {
  const jobs = view?.jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.map((j) => ({ name: String(j?.name ?? ''), status: j?.status ?? null, conclusion: j?.conclusion ?? null }));
}

// What a slicekit run says about the team command jobs (`cmd-*`) on its commit: `passed` when it
// completed and at least one ran and every one concluded success (a skipped one, as on a bookkeeping
// push, is not a pass); `failed` when one concluded anything other than success, skipped or
// cancelled; `pending` while it runs; `other` otherwise (skipped, cancelled, no command jobs).
export function commandJobsVerdict(run, jobs) {
  if (!run) return 'other';
  if (run.status !== 'completed') return 'pending';
  const commands = (jobs ?? []).filter((j) => j.name.startsWith('cmd-'));
  if (commands.some((j) => !['success', 'skipped', 'cancelled'].includes(j.conclusion))) return 'failed';
  if (commands.length > 0 && commands.every((j) => j.status === 'completed' && j.conclusion === 'success')) return 'passed';
  return 'other';
}
