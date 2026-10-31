// The graph builder (REQ-4.1 to REQ-4.4, D-13, D-23, D-44): reads the docs, the kit's files, the
// test files' REQ lines and git; keeps one fragment per source in the index so a second run walks
// only new commits and reads only changed files; assembles, validates and writes graph.json.
// Deterministic: no clock, locale, absolute path or environment value reaches the graph.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { kitPaths } from '../paths.js';
import { docFragment, docsPrefix, intakeFragment, intakeKey, readsDoc } from './docs.js';
import { existing, reachable, refTips, walkCommits, webUrl } from './git-walk.js';
import { journalFragment, stateFragment, verdictFragment } from './kitfiles.js';
import { prNumbers, pullRequestNodes } from './prs.js';
import { GraphError, SCHEMA_VERSION, cmp, keyOf, nodeId, serializeGraph, validateGraph } from './schema.js';
import { reqMentions, testFiles } from './tests.js';

const INDEX_VERSION = 1;
const posix = (p) => p.split(path.sep).join('/');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export const graphDir = (root, cfg) => kitPaths(root, cfg).graph;
const indexFile = (root, cfg) => path.join(graphDir(root, cfg), 'index.json');
const cacheDir = (root, cfg) => path.join(graphDir(root, cfg), 'cache');

function readIndex(root, cfg) {
  try {
    const idx = JSON.parse(fs.readFileSync(indexFile(root, cfg), 'utf8'));
    if (idx?.version === INDEX_VERSION && idx.repos && idx.files) return idx;
  } catch {
    // absent or unreadable: a full build
  }
  return null;
}

function isRepoRoot(root) {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

// Tracked and untracked, not ignored: repository-relative POSIX paths.
function listedFiles(root) {
  const out = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 1024,
  });
  return [...new Set(out.split('\0').filter((p) => p !== ''))].sort(cmp);
}

// Every source file of the program repository: {rel, kind}, kind doc, intake, state, verdict,
// journal or test. Only these are ever opened, and an intake file is only named.
function sources(root, cfg) {
  const kp = kitPaths(root, cfg);
  const rel = (abs) => posix(path.relative(root, abs));
  const state = `${rel(kp.state)}/`;
  const reviews = `${rel(kp.kit)}/reviews/`;
  const journal = `${rel(kp.journalDir)}/`;
  const docs = docsPrefix(cfg);
  const out = new Map();
  for (const p of listedFiles(root)) {
    if (!fs.existsSync(path.join(root, ...p.split('/')))) continue;
    if (p.startsWith(state) && /^[^/]+\.json$/.test(p.slice(state.length))) out.set(p, 'state');
    else if (p.startsWith(reviews) && /^[^/]+\.md$/.test(p.slice(reviews.length))) out.set(p, 'verdict');
    else if (p.startsWith(journal) && /^[^/]+\.log$/.test(p.slice(journal.length))) out.set(p, 'journal');
    else if (p.startsWith(docs) && intakeKey(cfg, p) !== null) out.set(p, 'intake');
    else if (p.startsWith(docs) && readsDoc(cfg, p)) out.set(p, 'doc');
  }
  for (const p of testFiles(root, cfg)) if (!out.has(p) && fs.existsSync(path.join(root, ...p.split('/')))) out.set(p, 'test');
  return [...out].map(([rel, kind]) => ({ rel, kind })).sort((a, b) => cmp(a.rel, b.rel));
}

function testFragment(rel, text, prefix = '') {
  const p = `${prefix}${rel}`;
  const id = nodeId('test', p);
  const repo = nodeId('repo', prefix === '' ? '.' : prefix.slice(0, -1));
  const edges = [{ kind: 'in', from: id, to: repo, at: `${p}:1` }];
  for (const { req, line } of reqMentions(text)) edges.push({ kind: 'covers', from: id, to: nodeId('requirement', req), at: `${p}:${line}` });
  return { nodes: [{ id, kind: 'test', label: p, from: `${p}:1` }], edges };
}

function fragmentOf(root, cfg, { rel, kind }, text) {
  switch (kind) {
    case 'doc': return docFragment(root, cfg, rel, text);
    case 'intake': return intakeFragment(cfg, rel);
    case 'state': return stateFragment(rel, text);
    case 'verdict': return verdictFragment(rel, text);
    case 'journal': return journalFragment(rel, text);
    case 'test': return testFragment(rel, text);
    default: return { nodes: [], edges: [] };
  }
}

// The file fragments, reusing the index's for every file whose bytes hash the same.
function fileFragments(root, cfg, list, old, prefix = '') {
  const files = {};
  let read = 0;
  for (const s of list) {
    const key = `${prefix}${s.rel}`;
    let hash;
    let text;
    if (s.kind === 'intake') {
      hash = 'named';
    } else {
      const buf = fs.readFileSync(path.join(root, ...s.rel.split('/')));
      hash = sha256(buf);
      text = buf.toString('utf8');
    }
    const prev = old?.[key];
    if (prev && prev.hash === hash && prev.kind === s.kind) {
      files[key] = prev;
      continue;
    }
    read++;
    const fragment = s.kind === 'test' ? testFragment(s.rel, text, prefix) : fragmentOf(root, cfg, s, text);
    files[key] = { kind: s.kind, hash, fragment };
  }
  return { files, read };
}

// The commits of one repository, walked from its recorded tips on.
function repoCommits(repoRoot, defaultBranch, old, full) {
  const tips = refTips(repoRoot, defaultBranch);
  const recorded = full || !old ? [] : existing(repoRoot, [...new Set(old.tips.map((t) => t.sha))]);
  const known = full || !old ? {} : old.commits;
  const tipShas = [...new Set(tips.map((t) => t.sha))];
  const walked = walkCommits(repoRoot, { include: tipShas, exclude: recorded });
  const all = { ...known };
  for (const c of walked) all[c.sha] = c;
  const reach = reachable(repoRoot, tipShas);
  const fromDefault = reachable(repoRoot, [tips[0].sha]);
  const commits = {};
  for (const sha of Object.keys(all).sort(cmp)) if (reach.has(sha)) commits[sha] = all[sha];
  return { tips, commits, walked: walked.length, fromDefault, defaultSha: tips[0].sha };
}

const time = (c) => Date.parse(c.date);

// Commit, file and touched/in edges from the commits of one repository.
function commitPart(commits, fromDefault, prefix, repoId) {
  const nodes = [];
  const edges = [];
  const firstTouch = new Map();
  const ordered = Object.values(commits).sort((a, b) => time(a) - time(b) || cmp(a.sha, b.sha));
  for (const c of ordered) {
    const id = nodeId('commit', c.sha);
    nodes.push({ id, kind: 'commit', label: c.subject, from: c.sha, date: c.date, subject: c.subject, parents: c.parents, merge: c.parents.length > 1, default: fromDefault.has(c.sha) });
    for (const f of c.files) {
      const p = `${prefix}${f}`;
      if (!firstTouch.has(p)) firstTouch.set(p, c.sha);
      edges.push({ kind: 'touched', from: id, to: nodeId('file', p), at: c.sha });
    }
    for (const s of c.slices) edges.push({ kind: 'in', from: id, to: nodeId('slice', s), at: c.sha });
  }
  for (const [p, sha] of firstTouch) {
    nodes.push({ id: nodeId('file', p), kind: 'file', label: p, from: sha });
    edges.push({ kind: 'in', from: nodeId('file', p), to: repoId, at: sha });
  }
  return { nodes, edges };
}

// buildGraph(root, cfg, {host, full, repos, skipped}) -> {graph, report, index}. `host` null with
// `skipped` a note means no host could be made; `repos` (S-20) are the reached workspace
// repositories, [{name, root, defaultBranch, host?, skipped?}]: each is walked as the program
// repository is, its file and test nodes prefixed `<name>/`, its pull requests read from its own merge
// commit subjects and from the state files of the slices whose `repo` names it, keyed `<name>#<n>`.
export function buildGraph(root, cfg, { host = null, full = false, repos = [], skipped = null } = {}) {
  if (!isRepoRoot(root)) throw new GraphError(2, 'graph: not a git repository');
  const old = full ? null : readIndex(root, cfg);
  const warnings = [];

  const main = repoCommits(root, cfg.defaultBranch, old?.repos?.['.'], full);
  const list = sources(root, cfg);
  const { files, read: readMain } = fileFragments(root, cfg, list, old?.files);
  let read = readMain;
  let fileCount = list.length;
  let walked = main.walked;
  const indexRepos = { '.': { tips: main.tips, commits: main.commits } };
  const repoNodes = [{ id: nodeId('repo', '.'), kind: 'repo', label: '.', from: '.', ...(webUrl(root) ? { web: webUrl(root) } : {}) }];
  const parts = [commitPart(main.commits, main.fromDefault, '', nodeId('repo', '.'))];
  const repoShas = [{ name: '.', sha: main.defaultSha }];
  let allCommits = Object.values(main.commits);
  const reached = [];

  for (const r of [...repos].sort((a, b) => cmp(a.name, b.name))) {
    const prefix = `${r.name}/`;
    const w = repoCommits(r.root, r.defaultBranch, old?.repos?.[r.name], full);
    walked += w.walked;
    indexRepos[r.name] = { tips: w.tips, commits: w.commits };
    const tl = testFiles(r.root, cfg).map((rel) => ({ rel, kind: 'test' }));
    const f = fileFragments(r.root, cfg, tl, old?.files, prefix);
    Object.assign(files, f.files);
    read += f.read;
    fileCount += tl.length;
    repoNodes.push({ id: nodeId('repo', r.name), kind: 'repo', label: r.name, from: r.name, ...(webUrl(r.root) ? { web: webUrl(r.root) } : {}) });
    parts.push(commitPart(w.commits, w.fromDefault, prefix, nodeId('repo', r.name)));
    repoShas.push({ name: r.name, sha: w.defaultSha });
    reached.push({ repo: r, commits: Object.values(w.commits) });
  }

  const fragments = Object.keys(files).sort(cmp).map((k) => files[k].fragment);
  for (const f of fragments) warnings.push(...(f.warnings ?? []));

  // Nodes: whole nodes first (the first by `from` wins a duplicate), then patches merged in.
  const byId = new Map();
  const whole = fragments.flatMap((f) => f.nodes).filter((n) => !n.patch);
  for (const n of [...whole, ...parts.flatMap((p) => p.nodes), ...repoNodes]) {
    if (byId.has(n.id)) {
      warnings.push(`graph: ${n.from} defines ${keyOf(n.id)} again`);
      continue;
    }
    byId.set(n.id, { ...n });
  }
  for (const p of fragments.flatMap((f) => f.nodes).filter((n) => n.patch)) {
    const target = byId.get(p.id);
    if (!target) continue;
    const { id: _id, patch: _patch, ...attrs } = p;
    Object.assign(target, attrs);
  }

  // Pull requests, with reviewed-by edges to the verdicts of their slice.
  const verdicts = new Map();
  for (const n of [...byId.values()].filter((x) => x.kind === 'verdict').sort((a, b) => cmp(a.id, b.id))) {
    const slice = fragments.flatMap((f) => f.edges).find((e) => e.kind === 'in' && e.from === n.id)?.to;
    if (!slice) continue;
    if (!verdicts.has(slice)) verdicts.set(slice, []);
    verdicts.get(slice).push(n);
  }
  // A state file's pull request is its slice's, in the repository the slice names (S-20 B-1); a release
  // file's refs are the program's. A ref of a slice in a repository that was not reached is dropped.
  const repoOfSlice = new Map([...byId.values()].filter((n) => n.kind === 'slice').map((n) => [n.id, n.repo ?? '.']));
  const owner = (ref) => (ref.slice ? (repoOfSlice.get(ref.slice) ?? '.') : '.');
  const allRefs = fragments.flatMap((f) => f.prRefs ?? []);
  const refsOf = (name) => [{ prRefs: allRefs.filter((ref) => owner(ref) === name) }];
  const prs = pullRequestNodes(prNumbers(refsOf('.'), allCommits), { host, cacheDir: cacheDir(root, cfg), verdicts, skipped });
  for (const { repo: r, commits } of reached) {
    const sub = pullRequestNodes(prNumbers(refsOf(r.name), commits), { host: r.host ?? null, cacheDir: cacheDir(root, cfg), verdicts, skipped: r.skipped ?? null, repo: r.name });
    prs.nodes.push(...sub.nodes);
    prs.edges.push(...sub.edges);
    prs.notes.push(...sub.notes);
    prs.fetched += sub.fetched;
    prs.cached += sub.cached;
    allCommits = allCommits.concat(commits);
  }
  for (const n of prs.nodes) if (!byId.has(n.id)) byId.set(n.id, n);

  // Edges: deduplicated; one whose endpoint is not a node is dropped with a warning.
  const seen = new Set();
  const edges = [];
  for (const e of [...fragments.flatMap((f) => f.edges), ...parts.flatMap((p) => p.edges), ...prs.edges]) {
    const k = `${e.kind}\0${e.from}\0${e.to}\0${e.at}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const missing = !byId.has(e.to) ? e.to : !byId.has(e.from) ? e.from : null;
    if (missing) {
      warnings.push(`graph: ${e.at} names ${keyOf(missing)}, which is not in the graph`);
      continue;
    }
    edges.push(e);
  }

  const head = main.commits[main.defaultSha];
  const graph = {
    schemaVersion: SCHEMA_VERSION,
    builtAt: head?.date ?? null,
    defaultBranch: cfg.defaultBranch,
    sha: main.defaultSha,
    repos: repoShas,
    nodes: [...byId.values()].sort((a, b) => cmp(a.id, b.id)),
    edges,
  };
  const index = { version: INDEX_VERSION, repos: indexRepos, files };
  const report = {
    walked,
    commits: allCommits.length,
    read,
    files: fileCount,
    fetched: prs.fetched,
    cached: prs.cached,
    notes: [...new Set(prs.notes)],
    warnings: [...new Set(warnings)].sort(cmp),
  };
  return { graph, report, index };
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

// Refuses a graph with problems (nothing written); else writes graph.json and index.json through a
// temporary name and a rename -> the graph file's repository-relative path.
export function writeGraph(root, cfg, { graph, index }) {
  const problems = validateGraph(graph);
  if (problems.length > 0) throw new GraphError(1, `graph: schema: ${problems[0]}`);
  const dir = graphDir(root, cfg);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'graph.json');
  writeAtomic(file, serializeGraph(graph));
  if (index) writeAtomic(indexFile(root, cfg), `${JSON.stringify(index)}\n`);
  return posix(path.relative(root, file));
}
