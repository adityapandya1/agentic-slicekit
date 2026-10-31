// Pull requests in the graph (REQ-4.2, C-1): their numbers come from the local files and commit
// subjects; each answer is cached under the graph directory as {pr}, the host's answer alone. A
// merged answer is never fetched again; an open or closed one is fetched again whenever the host can
// be reached (a closed pull request can be reopened and merged, D-52), and the cached answer is used,
// marked stale, only when it cannot. An entry written by an
// earlier kit with a `key` still reads; the key is ignored (P3/S-34, issue #38).
import fs from 'node:fs';
import path from 'node:path';
import { GitHostError, GitHostNotFound } from '../adapters/githost/errors.js';
import { GH_NOT_FOUND } from '../adapters/githost/github.js';
import { cmp, nodeId } from './schema.js';

const MERGE = /^Merge pull request #(\d+) from /;
const SQUASH = /\(#(\d+)\)\s*$/;
// Only a merge is final: GitHub lets a closed pull request be reopened (P3/S-34 review H-1, D-52).
const FINAL = new Set(['MERGED']);

// number -> {at, slice, sliceAt, releases: [{id, at}]}; the state file's place first, then a commit's.
export function prNumbers(fragments, commits) {
  const refs = new Map();
  const get = (n) => {
    if (!refs.has(n)) refs.set(n, { at: null, slice: null, sliceAt: null, releases: [] });
    return refs.get(n);
  };
  const prRefs = fragments.flatMap((f) => f.prRefs ?? []).sort((a, b) => cmp(a.at, b.at));
  for (const r of prRefs.filter((x) => x.slice)) {
    const e = get(r.number);
    if (e.slice === null) Object.assign(e, { at: r.at, slice: r.slice, sliceAt: r.at });
  }
  for (const c of [...commits].sort((a, b) => cmp(a.sha, b.sha))) {
    const m = MERGE.exec(c.subject) ?? SQUASH.exec(c.subject);
    if (!m) continue;
    const e = get(Number(m[1]));
    if (e.at === null) e.at = c.sha;
  }
  for (const r of prRefs.filter((x) => x.release)) {
    const e = get(r.number);
    if (e.at === null) e.at = r.at;
    if (!e.releases.some((x) => x.id === r.release)) e.releases.push({ id: r.release, at: r.at });
  }
  return new Map([...refs].sort(([a], [b]) => a - b));
}

// A workspace repository's pull requests are cached apart from the program repository's (S-20).
const cacheFile = (dir, n, repo) => path.join(dir, repo ? `pr-${repo}-${n}.json` : `pr-${n}.json`);

function readCache(dir, n, repo) {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(dir, n, repo), 'utf8'));
    return c && typeof c === 'object' && c.pr ? c : null;
  } catch {
    return null;
  }
}

function writeCache(dir, n, repo, entry) {
  fs.mkdirSync(dir, { recursive: true });
  const file = cacheFile(dir, n, repo);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

const TITLE_SLICE = /\[(P\d+\/S-\d{2})\]/;

// A pull request of the program repository is pull-request:<n>; one of workspace repository <repo> is
// pull-request:<repo>#<n> and carries `repo` (S-20).
function prNode(n, ref, pr, stale, verdicts, repo) {
  const key = repo ? `${repo}#${n}` : `#${n}`;
  const id = nodeId('pull-request', repo ? key : n);
  const node = { id, kind: 'pull-request', label: pr.title ?? '', from: key, number: n, url: pr.url ?? null, state: pr.state ?? null, mergedAt: pr.mergedAt ?? null, headSha: pr.headSha ?? null };
  if (repo) node.repo = repo;
  if (stale) node.stale = true;
  const edges = [];
  const fromTitle = TITLE_SLICE.exec(pr.title ?? '')?.[1];
  const slice = fromTitle ? nodeId('slice', fromTitle) : ref.slice;
  const at = ref.at ?? key;
  if (slice) {
    edges.push({ kind: 'in', from: id, to: slice, at: ref.slice === slice && ref.sliceAt ? ref.sliceAt : at });
    for (const v of verdicts.get(slice) ?? []) edges.push({ kind: 'reviewed-by', from: id, to: v.id, at: v.from });
  }
  for (const r of ref.releases) edges.push({ kind: 'released-in', from: id, to: r.id, at: r.at });
  return { node, edges };
}

// refs from prNumbers -> {nodes, edges, notes, fetched, cached}. `host` null means no host could be
// made; `verdicts` maps a slice node id to its verdict nodes, for the reviewed-by edges; `repo` names
// the workspace repository the numbers belong to, null for the program repository.
export function pullRequestNodes(refs, { host, cacheDir, verdicts = new Map(), skipped = null, repo = null } = {}) {
  const nodes = [];
  const edges = [];
  const notes = [];
  let fetched = 0;
  let cached = 0;
  let stopped = host == null;
  if (skipped) notes.push(skipped);
  const add = (n, ref, pr, stale) => {
    const r = prNode(n, ref, pr, stale, verdicts, repo);
    nodes.push(r.node);
    edges.push(...r.edges);
  };
  for (const [n, ref] of refs) {
    const hit = readCache(cacheDir, n, repo);
    // A merged answer is final. An open or closed one is asked again whenever the host can be reached:
    // a merge does not move the recorded head, so no key would say it changed (S-17 review H-1), and a
    // closed pull request can be reopened (P3/S-34 review H-1).
    if (hit && FINAL.has(hit.pr.state)) {
      cached++;
      add(n, ref, hit.pr, false);
      continue;
    }
    if (!stopped) {
      try {
        const { body: _body, ...pr } = host.getPullRequest(n);
        writeCache(cacheDir, n, repo, { pr });
        fetched++;
        add(n, ref, pr, false);
        continue;
      } catch (e) {
        if (e instanceof GitHostNotFound) {
          notes.push(`pull request ${repo ?? ''}#${n} is not on the host`);
          continue;
        }
        if (!(e instanceof GitHostError)) throw e;
        stopped = true;
        const whose = repo ? ` of ${repo}` : '';
        notes.push(e.message === GH_NOT_FOUND ? `pull requests${whose} skipped: gh not found` : `pull requests${whose} from the cache: ${e.message}`);
      }
    }
    if (hit) {
      cached++;
      add(n, ref, hit.pr, true);
    }
  }
  return { nodes, edges, notes, fetched, cached };
}
