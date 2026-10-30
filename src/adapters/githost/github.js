import { execFileSync } from 'node:child_process';
import { assertDate, assertSha } from '../../evidence.js';
import { redact } from '../../redact.js';
import { GitHostError, GitHostNotFound } from './errors.js';
import {
  assertBranch,
  assertLabel,
  assertLabelColor,
  assertPrNumber,
  assertTitle,
  BRANCH_PR_FIELDS,
  filterMergedSince,
  mapPullRequest,
  parsePullRequestUrl,
  pickBranchPullRequest,
  reduceRuns,
} from './gh-json.js';

// C-1 for GitHub through the `gh` CLI. This file owns only the spawn; the JSON mapping is gh-json.js.

export const GH_NOT_FOUND = 'gh not found; install GitHub CLI or set SLICEKIT_GITHOST_FIXTURE';

const PR_FIELDS = 'number,url,state,mergedAt,headRefOid,headRefName,isDraft,title,body,labels';
const LIST_FIELDS = 'number,mergedAt,headRefOid,title';
const RUN_FIELDS = 'status,conclusion,url,createdAt,workflowName,event';

// A non-zero gh exit, typed: "no such pull request" is a GitHostNotFound, anything else a GitHostError
// whose message carries the first line of gh's stderr, with any token shape masked.
export function ghExitError(args, stderr) {
  if (args[0] === 'pr' && args[1] === 'view' && /Could not resolve to a PullRequest/i.test(stderr)) {
    return new GitHostNotFound(`pull request ${args[2]} not found`, { stderr });
  }
  const first = stderr.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? '';
  return new GitHostError(`gh ${args.slice(0, 2).join(' ')} failed: ${redact(first)}`, { stderr });
}

// `input`, when given, is piped to gh's stdin (a body passed as `--body-file -`, never on the
// command line). Exported for the tracker adapter (C-2), which spawns gh the same way.
export function gh(exec, args, { input, ...opts } = {}) {
  const stdin = input === undefined ? 'ignore' : 'pipe';
  try {
    return exec('gh', args, { encoding: 'utf8', stdio: [stdin, 'pipe', 'pipe'], ...opts, ...(input === undefined ? {} : { input }) });
  } catch (e) {
    if (e.code === 'ENOENT') throw new GitHostError(GH_NOT_FOUND);
    if (typeof e.status !== 'number') throw new GitHostError(`gh could not be run: ${e.message}`);
    throw ghExitError(args, String(e.stderr ?? '').trim() || e.message);
  }
}

// gh picks the repository from its working directory, so every call runs in the project root.
// `exec` is the test seam; it defaults to execFileSync.
export function githubHost(env = process.env, root = process.cwd(), exec = execFileSync) {
  const ghJson = (args) => {
    const out = gh(exec, args, { env, cwd: root });
    try {
      return JSON.parse(out);
    } catch (e) {
      throw new GitHostError(`gh ${args.slice(0, 2).join(' ')} printed something that is not JSON: ${e.message}`);
    }
  };
  return {
    kind: 'github',
    getPullRequest(n) {
      assertPrNumber(n);
      return mapPullRequest(ghJson(['pr', 'view', String(n), '--json', PR_FIELDS]));
    },
    // The search narrows to pull requests merged on or after the instant's UTC day; the client-side
    // filter then keeps those merged at or after the instant itself.
    listMergedSince(isoDate) {
      const since = assertDate(isoDate);
      const day = new Date(since).toISOString().slice(0, 10);
      const args = ['pr', 'list', '--state', 'merged', '--search', `merged:>=${day}`, '--limit', '200', '--json', LIST_FIELDS];
      return filterMergedSince(ghJson(args), since);
    },
    ciStatus(sha) {
      assertSha(sha);
      return reduceRuns(ghJson(['run', 'list', '--commit', sha, '--limit', '20', '--json', RUN_FIELDS]));
    },
    // Adds the label when present is true, removes it otherwise. A label the repository does not
    // have is gh's error, reported as a GitHostError.
    setLabel(n, name, present) {
      assertPrNumber(n);
      assertLabel(name);
      gh(exec, ['pr', 'edit', String(n), present ? '--add-label' : '--remove-label', name], { env, cwd: root });
    },
    // Opens a pull request from `branch` into `base`; the body goes on stdin. gh prints the new
    // pull request's url, and its number is read from `/pull/<n>`. Each value is one `--flag=value`
    // argument, so a title starting with "-" is not read as a flag.
    openPullRequest({ branch, base, title, body, draft }) {
      assertBranch(branch);
      assertBranch(base);
      assertTitle(title);
      const args = ['pr', 'create', `--head=${branch}`, `--base=${base}`, `--title=${title}`, '--body-file', '-', ...(draft ? ['--draft'] : [])];
      const out = gh(exec, args, { env, cwd: root, input: String(body ?? '') });
      const made = parsePullRequestUrl(out);
      if (made === null) throw new GitHostError('gh pr create printed no pull request url');
      return made;
    },
    updatePullRequestBody(n, body) {
      assertPrNumber(n);
      gh(exec, ['pr', 'edit', String(n), '--body-file', '-'], { env, cwd: root, input: String(body ?? '') });
    },
    markReady(n) {
      assertPrNumber(n);
      gh(exec, ['pr', 'ready', String(n)], { env, cwd: root });
    },
    // Back to draft: a slice that returns to draft-pr after its pull request was marked ready.
    markDraft(n) {
      assertPrNumber(n);
      gh(exec, ['pr', 'ready', String(n), '--undo'], { env, cwd: root });
    },
    // The open pull request whose head is `branch` in this repository, as { number, url, base }, or
    // null. Every open one with that head name is listed (a fork's included), then filtered.
    pullRequestForBranch(branch, { base } = {}) {
      assertBranch(branch);
      const list = ghJson(['pr', 'list', '--head', branch, '--state', 'open', '--json', BRANCH_PR_FIELDS]);
      return pickBranchPullRequest(list, branch, base);
    },
    // Creates the label, or with --force updates its colour and description: safe to run every time.
    ensureLabel(name, { color, description }) {
      assertLabel(name);
      assertLabelColor(color);
      assertLabel(description);
      gh(exec, ['label', 'create', name, '--color', color, '--description', description, '--force'], { env, cwd: root });
    },
  };
}
