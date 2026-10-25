// gh's JSON shapes and the kit's view of them, shared by the GitHub host and the fixture host,
// so a fixture exercises the same mapping the real host does.

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
export function reduceRuns(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return { status: 'unknown', url: null };
  const going = runs.find((r) => r.status !== 'completed');
  if (going) return { status: 'pending', url: going.url ?? null };
  const failed = runs.find((r) => !OK_CONCLUSIONS.has(r.conclusion));
  if (failed) return { status: 'failure', url: failed.url ?? null };
  return { status: 'success', url: runs[0].url ?? null };
}
