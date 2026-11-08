// host-rules (03 REQ-3.14, D-77, D-81, D-84): the repository rulesets that apply to the default
// branch, read through C-1, hold every rule the kit relies on: a pull request before merge, at least
// one approving review (from a code owner when the repository has a CODEOWNERS file), the kit's CI
// checks required, and force push refused. Each rule missing is one finding. Rulesets only: a branch
// on classic branch protection alone is told to move to a ruleset (D-84).
//
// When the host cannot be read (no network, no token, a token that may not read the rules), the rule
// fails under --ci and otherwise reports a note, "host rules not checked", that does not block (D-81).
// When the generated workflow has a sync job, the rule also reads the repository's Actions workflow
// permissions through C-1: the sync job opens its [sync] pull request with the workflow's own token
// (REQ-3.11), which GitHub refuses while "Allow GitHub Actions to create and approve pull requests" is
// off. Off fails under --ci and is a note otherwise. The workflow's own token cannot read that setting
// (it needs administration read), so a read the host refuses is a note in both, never a failure: under
// D-81 it would fail every CI run, which no setting a human can change would fix.
// A repository with no origin remote names no host: nothing to judge. The rule never writes a host
// setting; `slicekit init --protect` is the one place that does, and shares missingRules.
import { getHost } from '../../adapters/githost/index.js';
import { GitHostError } from '../../adapters/githost/errors.js';
import { hasRemote } from '../../git.js';
import { renderWorkflow } from '../../workflow.js';

export const id = 'host-rules';
export const blocking = true;
export const ratchet = false;

const PROTECT = 'run slicekit init --protect as an admin';

// Where a human turns on the setting the sync job needs; slicekit never changes it (D-77).
export const ACTIONS_PR_SETTING = 'Settings, Actions, General, Workflow permissions, "Allow GitHub Actions to create and approve pull requests"';
export const ACTIONS_PR_OFF = `GitHub Actions may not create pull requests, so the sync job cannot open its [sync] pull request; a human turns on ${ACTIONS_PR_SETTING} (approvals still need a human under the ruleset)`;

// Whether the workflow renderWorkflow writes for `cfg` has a sync job.
export const hasSyncJob = (cfg) => /^jobs:\s*$[\s\S]*^ {2}sync:\s*$/m.test(renderWorkflow(cfg).replace(/\r\n/g, '\n'));

// The sync job's Actions setting: 'on', 'off', 'unknown' (the host does not say) or { error } when
// the host refused the read.
export function actionsPullRequestSetting(cfg, env, root) {
  try {
    const got = getHost(cfg, env, root).readWorkflowPermissions();
    if (got === null) return 'unknown';
    return got.canCreatePullRequests ? 'on' : 'off';
  } catch (e) {
    if (!(e instanceof GitHostError)) throw e;
    return { error: e.message };
  }
}
// The jobs of the generated workflow a merge waits on: the gate, and the checks job, which needs every
// command and observability job and passes when each passed or was skipped for bookkeeping. A command
// job's matrix names are never required: a job skipped by its own if reports one check under its id
// and none of them (D-49), so a bookkeeping head would never satisfy them.
const CHECK_JOB = /^(gate|checks)$/;

const unquote = (v) => (v.startsWith("'") && v.endsWith("'") && v.length >= 2 ? v.slice(1, -1).replace(/''/g, "'") : v);

// The check names GitHub gives the gate and checks jobs of a rendered workflow: each job's `name:` or
// its id. Neither job has a matrix.
export function workflowCheckNames(text) {
  const jobs = [];
  let inJobs = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line)) {
      inJobs = false;
      continue;
    }
    let m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) jobs.push({ id: m[1], name: null });
    else if ((m = /^ {4}name: (.+)$/.exec(line)) && jobs.length > 0) jobs.at(-1).name = unquote(m[1].trim());
  }
  return jobs.filter((j) => CHECK_JOB.test(j.id)).map((j) => j.name ?? j.id);
}

// The checks a merge into the default branch must wait on: the gate and checks jobs renderWorkflow writes.
export const requiredChecks = (cfg) => workflowCheckNames(renderWorkflow(cfg));

// Each rule `rules` (C-1 readBranchRules) lacks, as { key, value, missing, set }: `value` is what the
// ruleset write takes for `key`, `missing` the finding's text and `set` what init --protect prints.
export function missingRules(cfg, rules, codeowners) {
  const out = [];
  if (!rules.pullRequest) {
    out.push({ key: 'pullRequest', value: true, missing: 'a pull request is not required before merge', set: 'a pull request is required before merge' });
  }
  if (!(rules.approvals >= 1)) {
    out.push({ key: 'approvals', value: 1, missing: 'no approving review is required', set: 'one approving review is required' });
  }
  if (codeowners && !rules.codeOwnerReview) {
    out.push({
      key: 'codeOwnerReview',
      value: true,
      missing: `the approving review is not required to come from a code owner (${codeowners.path})`,
      set: `the approving review must come from a code owner (${codeowners.path})`,
    });
  }
  const have = new Set(rules.requiredChecks ?? []);
  const lacking = requiredChecks(cfg).filter((c) => !have.has(c));
  if (lacking.length > 0) {
    out.push({
      key: 'requiredChecks',
      value: lacking,
      missing: `the kit's CI checks are not required: ${lacking.join(', ')}`,
      set: `the kit's CI checks are required: ${lacking.join(', ')}`,
    });
  }
  if (!rules.refuseForcePush) {
    out.push({ key: 'refuseForcePush', value: true, missing: 'force push is not refused', set: 'force push is refused' });
  }
  return out;
}

// What the host says about the default branch: { rules, codeowners }. Throws GitHostError when it
// cannot say.
export function readHostRules(cfg, env, root) {
  const host = getHost(cfg, env, root);
  const rules = host.readBranchRules(cfg.defaultBranch);
  return { rules, codeowners: host.readCodeowners() };
}

export function run(ctx) {
  const { root, cfg, env = process.env, ci } = ctx;
  if (!ctx.git?.isRepo || typeof cfg?.defaultBranch !== 'string') return [];
  if (!env.SLICEKIT_GITHOST_FIXTURE && !hasRemote(root)) return [];
  const branch = cfg.defaultBranch;
  let read;
  try {
    read = readHostRules(cfg, env, root);
  } catch (e) {
    if (!(e instanceof GitHostError)) throw e;
    if (ci) return [{ file: '-', line: 0, message: `${branch}: host rules not checked: ${e.message}` }];
    return [{ file: '-', line: 0, message: `host rules not checked: ${e.message}`, note: true }];
  }
  const found = [];
  if (read.rules.classic && read.rules.ruleCount === 0) {
    found.push(`${branch}: protected by classic branch protection only; move to a repository ruleset, the protection slicekit reads (D-84), or ${PROTECT}`);
  }
  for (const m of missingRules(cfg, read.rules, read.codeowners)) found.push(`${branch}: ${m.missing}; ${PROTECT}`);
  const out = found.map((message) => ({ file: '-', line: 0, message }));
  if (hasSyncJob(cfg)) {
    const setting = actionsPullRequestSetting(cfg, env, root);
    if (setting === 'off') out.push({ file: '-', line: 0, message: ACTIONS_PR_OFF, ...(ci ? {} : { note: true }) });
    else if (typeof setting === 'object') out.push({ file: '-', line: 0, message: `the Actions pull request setting not checked: ${setting.error}`, note: true });
  }
  return out;
}

export default { id, blocking, ratchet, run };
