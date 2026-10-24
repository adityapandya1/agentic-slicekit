import { execFileSync } from 'node:child_process';
import { assertDate, assertSha } from '../../evidence.js';
import { GitHostError, GitHostNotFound } from './errors.js';
import { assertPrNumber, filterMergedSince, mapPullRequest, reduceRuns } from './gh-json.js';

// C-1 for GitHub through the `gh` CLI. This file owns only the spawn; the JSON mapping is gh-json.js.

export const GH_NOT_FOUND = 'gh not found; install GitHub CLI or set SLICEKIT_GITHOST_FIXTURE';

const PR_FIELDS = 'number,url,state,mergedAt,headRefOid,title,body,labels';
const LIST_FIELDS = 'number,mergedAt,headRefOid,title';
const RUN_FIELDS = 'status,conclusion,url,createdAt';

// A non-zero gh exit, typed: "no such pull request" is a GitHostNotFound, anything else a GitHostError.
export function ghExitError(args, stderr) {
  if (args[0] === 'pr' && args[1] === 'view' && /Could not resolve to a PullRequest/i.test(stderr)) {
    return new GitHostNotFound(`pull request ${args[2]} not found`, { stderr });
  }
  return new GitHostError(`gh ${args.slice(0, 2).join(' ')} failed: ${stderr}`, { stderr });
}

function gh(exec, args, opts) {
  try {
    return exec('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
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
  };
}
