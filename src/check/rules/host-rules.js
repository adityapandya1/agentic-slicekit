// host-rules (03 REQ-3.14, D-77, D-81, D-84): the repository rulesets that apply to the default
// branch, read through C-1, hold every rule the kit relies on: a pull request before merge, at least
// one approving review (from a code owner when the repository has a CODEOWNERS file), the kit's CI
// checks required, and force push refused. Each rule missing is one finding. Rulesets only: a branch
// on classic branch protection alone is told to move to a ruleset (D-84).
//
// When the host cannot be read (no network, no token, a token that may not read the rules), the rule
// fails under --ci and otherwise reports a note, "host rules not checked", that does not block (D-81).
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
// The jobs of the generated workflow that judge a pull request. ready-label and sync are not checks
// a merge waits on.
const CHECK_JOB = /^(gate|cmd-[A-Za-z0-9_-]+|obs-\d+)$/;

const unquote = (v) => (v.startsWith("'") && v.endsWith("'") && v.length >= 2 ? v.slice(1, -1).replace(/''/g, "'") : v);

// The check names GitHub gives the pull request jobs of a rendered workflow: the job's `name:` or its
// id, followed by its matrix values in parentheses, `cmd-test (windows-latest, 1/3)`.
export function workflowCheckNames(text) {
  const jobs = [];
  let inJobs = false;
  let job = null;
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
    if (m) {
      job = { id: m[1], name: null, include: [], os: null };
      jobs.push(job);
      continue;
    }
    if (!job) continue;
    if ((m = /^ {4}name: (.+)$/.exec(line))) job.name = unquote(m[1].trim());
    else if ((m = /^ {10}- os: (\S+)\s*$/.exec(line))) job.include.push([m[1]]);
    else if ((m = /^ {12}shard: (.+)$/.exec(line)) && job.include.length > 0) job.include.at(-1).push(unquote(m[1].trim()));
    else if ((m = /^ {8}os: \[(.*)\]\s*$/.exec(line))) job.os = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return jobs
    .filter((j) => CHECK_JOB.test(j.id))
    .flatMap((j) => {
      const base = j.name ?? j.id;
      if (j.include.length > 0) return j.include.map((values) => `${base} (${values.join(', ')})`);
      if (j.os) return j.os.map((os) => `${base} (${os})`);
      return [base];
    });
}

// The checks a merge into the default branch must wait on: the jobs renderWorkflow writes.
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
  return found.map((message) => ({ file: '-', line: 0, message }));
}

export default { id, blocking, ratchet, run };
