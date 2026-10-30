// history (REQ-4.5): newest first, the slices whose commits touched a path (a directory matches every
// file under it), each with its pull request, its last verdict and its release. Commits in no slice
// are not listed. Reads the index only.
import { normalisePath } from './load.js';
import { GraphError, cmp, keyOf, kindOf } from './schema.js';
import { timeOf } from './trace.js';

// The file nodes a path names: the file itself and every file under it as a directory.
function matching(index, p) {
  const want = normalisePath(p);
  if (want === '' || want === '.') return index.byKind('file');
  const dir = `${want}/`;
  return index.byKind('file').filter((f) => {
    const k = keyOf(f.id);
    return k === want || k.startsWith(dir);
  });
}

const newer = (c, cur) => !cur || timeOf(c.date) > timeOf(cur.date) || (timeOf(c.date) === timeOf(cur.date) && cmp(c.id, cur.id) < 0);

export function history(index, paths) {
  const commits = new Set();
  for (const p of paths) {
    const files = matching(index, p);
    if (files.length === 0) throw new GraphError(2, `${p} is not in the graph`);
    for (const f of files) for (const e of index.in(f.id, 'touched')) commits.add(e.from);
  }
  const newest = new Map();
  for (const cid of commits) {
    const c = index.node(cid);
    if (!c) continue;
    for (const e of index.out(cid, 'in')) {
      if (kindOf(e.to) === 'slice' && index.node(e.to) && newer(c, newest.get(e.to))) newest.set(e.to, c);
    }
  }
  const out = [];
  for (const [sid, c] of newest) {
    const ins = index.in(sid, 'in');
    const from = (kind) => ins.filter((e) => kindOf(e.from) === kind).map((e) => index.node(e.from)).filter(Boolean);
    const pr = from('pull-request').sort((a, b) => (b.number ?? 0) - (a.number ?? 0) || cmp(a.id, b.id))[0] ?? null;
    const verdict = from('verdict').sort((a, b) => (b.round ?? 0) - (a.round ?? 0) || cmp(a.id, b.id))[0] ?? null;
    const rel = pr ? index.out(pr.id, 'released-in').find((e) => kindOf(e.to) === 'release') : null;
    out.push({
      slice: keyOf(sid),
      pr: pr ? (pr.number ?? Number(keyOf(pr.id))) : null,
      // A workspace repository's pull request carries its repository (S-20 review H-4).
      ...(pr?.repo ? { prRepo: pr.repo } : {}),
      verdict: verdict?.verdict ?? null,
      release: rel ? keyOf(rel.to) : null,
      sha: keyOf(c.id),
      date: c.date ?? null,
    });
  }
  return out.sort((a, b) => timeOf(b.date) - timeOf(a.date) || cmp(a.sha, b.sha));
}

export const historyLine = (e) =>
  [e.slice, e.pr === null ? 'no pull request' : `PR ${e.prRepo ?? ''}#${e.pr}`, e.verdict ?? 'no verdict', e.release ? `released ${e.release}` : 'unreleased'].join('  ');
