import { execFileSync } from 'node:child_process';
import { GitHostError, GitHostNotFound } from './errors.js';
import { assertDate, assertPrNumber, assertSha, filterMergedSince, mapPullRequest, reduceRuns } from './gh-json.js';

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

function gh(args, env) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
  } catch (e) {
    if (e.code === 'ENOENT') throw new GitHostError(GH_NOT_FOUND);
    if (typeof e.status !== 'number') throw new GitHostError(`gh could not be run: ${e.message}`);
    throw ghExitError(args, String(e.stderr ?? '').trim() || e.message);
  }
}

function ghJson(args, env) {
  const out = gh(args, env);
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new GitHostError(`gh ${args.slice(0, 2).join(' ')} printed something that is not JSON: ${e.message}`);
  }
}

export function githubHost(env = process.env) {
  return {
    kind: 'github',
    getPullRequest(n) {
      assertPrNumber(n);
      return mapPullRequest(ghJson(['pr', 'view', String(n), '--json', PR_FIELDS], env));
    },
    // `gh pr list` orders by creation, newest first, so the 200 window is the 200 most recently
    // created merged pull requests; one created earlier but merged after isoDate can fall outside it.
    listMergedSince(isoDate) {
      const since = assertDate(isoDate);
      const list = ghJson(['pr', 'list', '--state', 'merged', '--limit', '200', '--json', LIST_FIELDS], env);
      return filterMergedSince(list, since);
    },
    ciStatus(sha) {
      assertSha(sha);
      return reduceRuns(ghJson(['run', 'list', '--commit', sha, '--limit', '20', '--json', RUN_FIELDS], env));
    },
  };
}
