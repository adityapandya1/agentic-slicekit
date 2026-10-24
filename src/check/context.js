import fs from 'node:fs';
import path from 'node:path';
import { readBaselinesWithProblems } from '../baseline.js';
import { exists, listFiles, readText } from '../fs.js';
import { currentBranch, hasCommits, isRepo } from '../git.js';
import { parseSliceAddr, re } from '../ids.js';
import { frontMatter, headings, lines, tables } from '../markdown.js';
import { kitPaths } from '../paths.js';
import { findSliceFiles, phaseOfDir } from '../slicefile.js';

const toPosix = (p) => p.split(path.sep).join('/');

// Every markdown file a rule may read: the docs root, BUILD.md, README.md, review verdicts and the
// rendered agent files. Keyed by the POSIX path relative to root, so a docs root of `.` lists once.
function collectDocs(root, paths) {
  const found = new Map();
  const addTree = (dir) => {
    if (!exists(dir) || !fs.statSync(dir).isDirectory()) return;
    for (const rel of listFiles(dir, { ext: '.md' })) addFile(path.join(dir, ...rel.split('/')));
  };
  const addFile = (abs) => {
    if (!exists(abs) || !fs.statSync(abs).isFile()) return;
    const rel = toPosix(path.relative(root, abs));
    if (found.has(rel)) return;
    const text = readText(abs);
    found.set(rel, { path: abs, rel, text, lines: lines(text) });
  };
  addTree(paths.docs);
  addFile(paths.build);
  addFile(path.join(root, 'README.md'));
  addTree(path.join(paths.kit, 'reviews'));
  addTree(paths.claude);
  return [...found.values()].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

// The ids in the first cell of a table row, e.g. `| D-01 | ... |`.
function tableIds(doc, name) {
  const out = new Set();
  if (!doc) return out;
  const idRe = new RegExp(`^${re(name).source}$`);
  for (const t of tables(doc.text)) {
    for (const row of t.rows) if (idRe.test(row[0] ?? '')) out.add(row[0]);
  }
  return out;
}

// Every id is read from the docs already collected (indexed by rel), so no file is read twice.
function collectIds(root, cfg, paths, docs) {
  const relOf = (abs) => toPosix(path.relative(root, abs));
  const byRel = new Map(docs.map((d) => [d.rel, d]));
  const inDir = (dirAbs) => {
    const dir = relOf(dirAbs);
    return docs.filter((d) => path.posix.dirname(d.rel) === (dir === '' ? '.' : dir));
  };
  const ids = { req: new Set(), decision: new Set(), gap: new Set(), contract: new Set(), slice: new Set(), phase: new Set() };

  // `## REQ-` and `### REQ-` headings in the spec's own files (not contracts).
  const reqRe = new RegExp(`^(${re('req').source})\\b`);
  for (const doc of inDir(paths.spec)) {
    for (const h of headings(doc.text)) {
      const m = (h.level === 2 || h.level === 3) && reqRe.exec(h.text);
      if (m) ids.req.add(m[1]);
    }
  }

  ids.decision = tableIds(byRel.get(relOf(paths.decisions)), 'decision');
  ids.gap = tableIds(byRel.get(relOf(paths.gaps)), 'gap');

  const cRe = new RegExp(`^(${re('contract').source})-.*\\.md$`);
  for (const doc of inDir(paths.contracts)) {
    const m = cRe.exec(path.posix.basename(doc.rel));
    if (m) ids.contract.add(m[1]);
  }

  // A malformed slice file is a finding for a rule, not a crash here: read only its address.
  for (const f of findSliceFiles(root, cfg)) {
    ids.phase.add(f.phaseId);
    const doc = byRel.get(relOf(f.path));
    let addr = null;
    try {
      addr = doc ? parseSliceAddr(String(frontMatter(doc.text).data.slice ?? '')) : null;
    } catch {
      addr = null;
    }
    if (addr) ids.slice.add(addr.id);
  }
  if (exists(paths.phases)) {
    for (const dir of fs.readdirSync(paths.phases, { withFileTypes: true })) {
      const phase = dir.isDirectory() ? phaseOfDir(dir.name) : null;
      if (phase) ids.phase.add(phase.id);
    }
  }
  return ids;
}

function gitFacts(root) {
  const repo = isRepo(root);
  if (!repo) return { isRepo: false, hasCommits: false, branch: null };
  return { isRepo: true, hasCommits: hasCommits(root), branch: currentBranch(root) };
}

export function buildContext(root, cfg, { ci = false, env = process.env } = {}) {
  const paths = kitPaths(root, cfg);
  const docs = collectDocs(root, paths);
  const baselinesRead = readBaselinesWithProblems(root);
  return {
    root,
    cfg,
    paths,
    docs,
    ids: collectIds(root, cfg, paths, docs),
    git: gitFacts(root),
    baselines: baselinesRead.baselines,
    baselineProblems: baselinesRead.problems,
    ci,
    env,
  };
}

// True for a doc under the intake directory. Intake files are frozen source material, pinned by
// their sidecar's sha256 (REQ-1.2): no rule reports on them, because none may be rewritten to pass.
export function isIntake(ctx, doc) {
  const rel = path.relative(path.resolve(ctx.paths.intake), path.resolve(doc.path));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
