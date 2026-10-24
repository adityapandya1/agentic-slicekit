import { execFileSync } from 'node:child_process';

// C-1 for GitHub through the `gh` CLI. The mappers are shared with the fixture host, which stores
// gh's own JSON, so a fixture exercises the same field mapping the real host does.

export const GH_NOT_FOUND = 'gh not found; install GitHub CLI or set SLICEKIT_GITHOST_FIXTURE';

const PR_FIELDS = 'number,url,state,mergedAt,headRefOid,title,body,labels';
const LIST_FIELDS = 'number,mergedAt,headRefOid,title';
const RUN_FIELDS = 'status,conclusion,url,createdAt';
const OK_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

export function assertPrNumber(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`pull request number must be a positive integer, got ${n}`);
  return n;
}

export function assertSha(sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(sha)) {
    throw new Error(`commit sha must be 7 to 40 lowercase hex characters, got '${sha}'`);
  }
  return sha;
}

export function assertDate(isoDate) {
  if (typeof isoDate !== 'string' || Number.isNaN(Date.parse(isoDate))) {
    throw new Error(`listMergedSince needs an ISO date, got '${isoDate}'`);
  }
  return Date.parse(isoDate);
}

export function mapPullRequest(raw) {
  return {
    number: raw.number,
    url: raw.url,
    state: raw.state,
    mergedAt: raw.mergedAt || null,
    headSha: raw.headRefOid,
    title: raw.title,
    body: raw.body ?? '',
    labels: (raw.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)),
  };
}

export function filterMergedSince(list, isoDate) {
  const since = assertDate(isoDate);
  return list
    .filter((p) => p.mergedAt && Date.parse(p.mergedAt) >= since)
    .map((p) => ({ number: p.number, mergedAt: p.mergedAt, headSha: p.headRefOid, title: p.title }));
}

// gh lists runs newest first. Any run still going → pending; any completed run that did not
// succeed (skipped and neutral count as success) → failure; all succeeded → success; none → unknown.
export function reduceRuns(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return { status: 'unknown', url: null };
  const going = runs.find((r) => r.status !== 'completed');
  if (going) return { status: 'pending', url: going.url ?? null };
  const failed = runs.find((r) => !OK_CONCLUSIONS.has(r.conclusion));
  if (failed) return { status: 'failure', url: failed.url ?? null };
  return { status: 'success', url: runs[0].url ?? null };
}

function gh(args, env) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(GH_NOT_FOUND);
    const stderr = String(e.stderr ?? '').trim() || e.message;
    const err = new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${stderr}`);
    err.stderr = stderr;
    throw err;
  }
}

const ghJson = (args, env) => JSON.parse(gh(args, env));

export function githubHost(env = process.env) {
  return {
    kind: 'github',
    getPullRequest(n) {
      assertPrNumber(n);
      return mapPullRequest(ghJson(['pr', 'view', String(n), '--json', PR_FIELDS], env));
    },
    listMergedSince(isoDate) {
      assertDate(isoDate);
      const list = ghJson(['pr', 'list', '--state', 'merged', '--limit', '200', '--json', LIST_FIELDS], env);
      return filterMergedSince(list, isoDate);
    },
    ciStatus(sha) {
      assertSha(sha);
      return reduceRuns(ghJson(['run', 'list', '--commit', sha, '--limit', '20', '--json', RUN_FIELDS], env));
    },
  };
}
