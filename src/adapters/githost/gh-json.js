// gh's JSON shapes and the kit's view of them, shared by the GitHub host and the fixture host,
// so a fixture exercises the same mapping the real host does.

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

// `since` is assertDate's result, checked by the host before it spends a call.
export function filterMergedSince(list, since) {
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
