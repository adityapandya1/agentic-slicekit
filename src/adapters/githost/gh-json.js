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

// A workflow as `gh workflow run` takes it: a file name under .github/workflows/, nothing else.
export function assertWorkflowFile(file) {
  if (typeof file !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9._-]*\.ya?ml$/.test(file)) {
    throw new Error(`workflow must be a .yml file name, got ${JSON.stringify(file)}`);
  }
  return file;
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

// REQ-3.14, D-84: the rules of the repository rulesets that apply to a branch, as
// `GET repos/{owner}/{repo}/rules/branches/{branch}` prints them (one entry per rule per ruleset),
// folded into one view: the strictest value any ruleset sets. `branch` is what
// `GET repos/{owner}/{repo}/branches/{branch}` prints, or null; its `protection.enabled` is true when
// classic branch protection is on, which the kit does not read beyond that flag.
export function mapBranchRules(rules, branch = null) {
  if (!Array.isArray(rules)) throw new Error('branch rules: expected an array of rules');
  const of = (type) => rules.filter((r) => r?.type === type);
  const pr = of('pull_request').map((r) => r.parameters ?? {});
  const counts = pr.map((p) => (Number.isInteger(p.required_approving_review_count) ? p.required_approving_review_count : 0));
  const checks = of('required_status_checks').flatMap((r) => r.parameters?.required_status_checks ?? []);
  return {
    pullRequest: pr.length > 0,
    approvals: counts.length > 0 ? Math.max(...counts) : 0,
    codeOwnerReview: pr.some((p) => p.require_code_owner_review === true),
    requiredChecks: [...new Set(checks.map((c) => c?.context).filter((c) => typeof c === 'string' && c !== ''))],
    refuseForcePush: of('non_fast_forward').length > 0,
    classic: branch?.protection?.enabled === true,
    ruleCount: rules.length,
  };
}

// The name of the one ruleset `slicekit init --protect` writes.
export const RULESET_NAME = 'slicekit';

// The rules to set, in the shape mapBranchRules reads, as GitHub ruleset rules. `set` holds only the
// keys to set: pullRequest, approvals and codeOwnerReview (any of them gives one pull_request rule,
// with at least one approval), requiredChecks (names) and refuseForcePush.
export function rulesetRules(set) {
  const out = [];
  if (set.pullRequest || set.approvals !== undefined || set.codeOwnerReview) {
    out.push({
      type: 'pull_request',
      parameters: {
        required_approving_review_count: Math.max(1, Number.isInteger(set.approvals) ? set.approvals : 1),
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: set.codeOwnerReview === true,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    });
  }
  if (Array.isArray(set.requiredChecks) && set.requiredChecks.length > 0) {
    out.push({
      type: 'required_status_checks',
      parameters: { strict_required_status_checks_policy: false, required_status_checks: set.requiredChecks.map((context) => ({ context })) },
    });
  }
  if (set.refuseForcePush) out.push({ type: 'non_fast_forward' });
  return out;
}

// An existing slicekit ruleset's rules with `add` folded in: the strictest pull_request rule, the union
// of required checks, and any other rule type kept once.
export function mergeRulesetRules(existing, add) {
  const byType = new Map();
  for (const r of [...(existing ?? []), ...add]) {
    const prev = byType.get(r.type);
    if (!prev) {
      byType.set(r.type, { type: r.type, ...(r.parameters ? { parameters: { ...r.parameters } } : {}) });
    } else if (r.type === 'pull_request') {
      const a = prev.parameters;
      const b = r.parameters ?? {};
      a.required_approving_review_count = Math.max(a.required_approving_review_count ?? 0, b.required_approving_review_count ?? 0);
      a.require_code_owner_review = a.require_code_owner_review === true || b.require_code_owner_review === true;
    } else if (r.type === 'required_status_checks') {
      const seen = new Set(prev.parameters.required_status_checks.map((c) => c.context));
      for (const c of r.parameters?.required_status_checks ?? []) if (!seen.has(c.context)) prev.parameters.required_status_checks.push(c);
    }
  }
  return [...byType.values()];
}

// The ruleset body for `branch`: one active branch ruleset named slicekit.
export function rulesetBody(branch, rules) {
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } },
    rules,
  };
}

// The paths GitHub reads CODEOWNERS from, in the order it looks; the first one present counts.
export const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

// A remote URL as { host, owner, repo }, or null when it names no host (a local path, file://).
// Takes https://host[:port]/owner/repo(.git), ssh://[user@]host[:port]/owner/repo(.git) and
// [user@]host:owner/repo(.git).
export function parseRemoteUrl(url) {
  const text = String(url ?? '').trim();
  let host;
  let rest;
  let m = /^(?:https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(text);
  if (m) [, host, rest] = m;
  else if ((m = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(text))) [, host, rest] = m;
  else if ((m = /^(?:[^@/]+@)?([A-Za-z0-9.-]+):(?!\/)(.+)$/.exec(text)) && m[1].includes('.')) [, host, rest] = m;
  else return null;
  const parts = rest.replace(/\/+$/, '').replace(/\.git$/i, '').split('/');
  const name = /^[A-Za-z0-9_.-]+$/;
  if (parts.length !== 2 || !parts.every((p) => name.test(p) && p !== '.' && p !== '..')) return null;
  if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) return null;
  return { host: host.toLowerCase(), owner: parts[0], repo: parts[1] };
}

// The slicekit ruleset's rules with every required check not in `kitChecks` taken out (03 REQ-3.14):
// a check the generated workflow no longer writes would hold every pull request waiting. A
// required_status_checks rule left with no check is dropped. Returns { rules, removed }.
export function pruneRulesetChecks(rules, kitChecks) {
  if (!Array.isArray(kitChecks)) return { rules, removed: [] };
  const keep = new Set(kitChecks);
  const removed = [];
  const out = [];
  for (const r of rules ?? []) {
    if (r.type !== 'required_status_checks') {
      out.push(r);
      continue;
    }
    const checks = (r.parameters?.required_status_checks ?? []).filter((c) => {
      if (keep.has(c.context)) return true;
      removed.push(c.context);
      return false;
    });
    if (checks.length > 0) out.push({ ...r, parameters: { ...r.parameters, required_status_checks: checks } });
  }
  return { rules: out, removed };
}

// The fields `gh pr list` prints for listOpenPullRequests.
export const OPEN_PR_FIELDS = 'number,url,title,isCrossRepository,baseRefName,headRefName';

// listOpenPullRequests's answer from what `gh pr list --state open --json OPEN_PR_FIELDS` prints:
// [{ number, url, title, head, base }], this repository's own branches only (a fork's dropped).
export function mapOpenPullRequests(list) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => p && p.isCrossRepository !== true && Number.isInteger(p.number) && typeof p.headRefName === 'string')
    .map((p) => ({ number: p.number, url: p.url ?? null, title: typeof p.title === 'string' ? p.title : '', head: p.headRefName, base: p.baseRefName ?? null }))
    .sort((a, b) => a.number - b.number);
}

// A comment as `gh pr close --comment` takes it: non-empty text.
export function assertComment(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error(`comment must be non-empty text, got ${JSON.stringify(text)}`);
  return text;
}

// readWorkflowPermissions's answer from what `gh api repos/{o}/{r}/actions/permissions/workflow`
// prints: { canCreatePullRequests, defaultPermissions }. `can_approve_pull_request_reviews` is the
// repository setting "Allow GitHub Actions to create and approve pull requests". Returns null for an
// answer without it, which the caller reports as not read.
export function mapWorkflowPermissions(raw) {
  if (raw === null || typeof raw !== 'object' || typeof raw.can_approve_pull_request_reviews !== 'boolean') return null;
  return {
    canCreatePullRequests: raw.can_approve_pull_request_reviews,
    defaultPermissions: typeof raw.default_workflow_permissions === 'string' ? raw.default_workflow_permissions : null,
  };
}
