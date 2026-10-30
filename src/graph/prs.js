// Pull requests in the graph (REQ-4.2, C-1): their numbers come from the local files and commit
// subjects; each is fetched once through the host and cached under the graph directory. A final
// answer (MERGED, CLOSED) is never fetched again; an OPEN one is fetched again when its key moves.
import fs from 'node:fs';
import path from 'node:path';
import { GitHostError, GitHostNotFound } from '../adapters/githost/errors.js';
import { GH_NOT_FOUND } from '../adapters/githost/github.js';
import { cmp, nodeId } from './schema.js';

const MERGE = /^Merge pull request #(\d+) from /;
const SQUASH = /\(#(\d+)\)\s*$/;
const FINAL = new Set(['MERGED', 'CLOSED']);

// number -> {key, at, slice, releases: [{id, at}]}; the state's key first, then a commit's.
export function prNumbers(fragments, commits) {
  const refs = new Map();
  const get = (n) => {
    if (!refs.has(n)) refs.set(n, { key: null, at: null, slice: null, sliceAt: null, releases: [] });
    return refs.get(n);
  };
  const prRefs = fragments.flatMap((f) => f.prRefs ?? []).sort((a, b) => cmp(a.at, b.at));
  for (const r of prRefs.filter((x) => x.slice)) {
    const e = get(r.number);
    if (e.slice === null) Object.assign(e, { key: r.key, at: r.at, slice: r.slice, sliceAt: r.at });
  }
  for (const c of [...commits].sort((a, b) => cmp(a.sha, b.sha))) {
    const m = MERGE.exec(c.subject) ?? SQUASH.exec(c.subject);
    if (!m) continue;
    const e = get(Number(m[1]));
    if (e.key === null) e.key = c.sha;
    if (e.at === null) e.at = c.sha;
  }
  for (const r of prRefs.filter((x) => x.release)) {
    const e = get(r.number);
    if (e.at === null) e.at = r.at;
    if (!e.releases.some((x) => x.id === r.release)) e.releases.push({ id: r.release, at: r.at });
  }
  return new Map([...refs].sort(([a], [b]) => a - b));
}

const cacheFile = (dir, n) => path.join(dir, `pr-${n}.json`);

function readCache(dir, n) {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(dir, n), 'utf8'));
    return c && typeof c === 'object' && c.pr ? c : null;
  } catch {
    return null;
  }
}

function writeCache(dir, n, entry) {
  fs.mkdirSync(dir, { recursive: true });
  const file = cacheFile(dir, n);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

const TITLE_SLICE = /\[(P\d+\/S-\d{2})\]/;

function prNode(n, ref, pr, stale, verdicts) {
  const id = nodeId('pull-request', n);
  const node = { id, kind: 'pull-request', label: pr.title ?? '', from: `#${n}`, number: n, url: pr.url ?? null, state: pr.state ?? null, mergedAt: pr.mergedAt ?? null, headSha: pr.headSha ?? null };
  if (stale) node.stale = true;
  const edges = [];
  const fromTitle = TITLE_SLICE.exec(pr.title ?? '')?.[1];
  const slice = fromTitle ? nodeId('slice', fromTitle) : ref.slice;
  const at = ref.at ?? `#${n}`;
  if (slice) {
    edges.push({ kind: 'in', from: id, to: slice, at: ref.slice === slice && ref.sliceAt ? ref.sliceAt : at });
    for (const v of verdicts.get(slice) ?? []) edges.push({ kind: 'reviewed-by', from: id, to: v.id, at: v.from });
  }
  for (const r of ref.releases) edges.push({ kind: 'released-in', from: id, to: r.id, at: r.at });
  return { node, edges };
}

// refs from prNumbers -> {nodes, edges, notes, fetched, cached}. `host` null means no host could be
// made; `verdicts` maps a slice node id to its verdict nodes, for the reviewed-by edges.
export function pullRequestNodes(refs, { host, cacheDir, verdicts = new Map(), skipped = null } = {}) {
  const nodes = [];
  const edges = [];
  const notes = [];
  let fetched = 0;
  let cached = 0;
  let stopped = host == null;
  if (skipped) notes.push(skipped);
  const add = (n, ref, pr, stale) => {
    const r = prNode(n, ref, pr, stale, verdicts);
    nodes.push(r.node);
    edges.push(...r.edges);
  };
  for (const [n, ref] of refs) {
    const hit = readCache(cacheDir, n);
    if (hit && (FINAL.has(hit.pr.state) || (hit.pr.state === 'OPEN' && hit.key === ref.key))) {
      cached++;
      add(n, ref, hit.pr, false);
      continue;
    }
    if (!stopped) {
      try {
        const { body: _body, ...pr } = host.getPullRequest(n);
        writeCache(cacheDir, n, { key: ref.key, pr });
        fetched++;
        add(n, ref, pr, false);
        continue;
      } catch (e) {
        if (e instanceof GitHostNotFound) {
          notes.push(`pull request #${n} is not on the host`);
          continue;
        }
        if (!(e instanceof GitHostError)) throw e;
        stopped = true;
        notes.push(e.message === GH_NOT_FOUND ? 'pull requests skipped: gh not found' : `pull requests from the cache: ${e.message}`);
      }
    }
    if (hit) {
      cached++;
      add(n, ref, hit.pr, true);
    }
  }
  return { nodes, edges, notes, fetched, cached };
}
