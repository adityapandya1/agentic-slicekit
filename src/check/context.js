import fs from 'node:fs';
import path from 'node:path';
import { readBaselines } from '../baseline.js';
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
function tableIds(file, name) {
  const out = new Set();
  if (!exists(file)) return out;
  const idRe = new RegExp(`^${re(name).source}$`);
  for (const t of tables(readText(file))) {
    for (const row of t.rows) if (idRe.test(row[0] ?? '')) out.add(row[0]);
  }
  return out;
}

function collectIds(root, cfg, paths) {
  const ids = { req: new Set(), decision: new Set(), gap: new Set(), contract: new Set(), slice: new Set(), phase: new Set() };

  // `## REQ-` and `### REQ-` headings in the spec's own files (not contracts).
  if (exists(paths.spec)) {
    const reqRe = new RegExp(`^(${re('req').source})\\b`);
    for (const name of fs.readdirSync(paths.spec).sort()) {
      const file = path.join(paths.spec, name);
      if (!name.endsWith('.md') || !fs.statSync(file).isFile()) continue;
      for (const h of headings(readText(file))) {
        const m = (h.level === 2 || h.level === 3) && reqRe.exec(h.text);
        if (m) ids.req.add(m[1]);
      }
    }
  }

  ids.decision = tableIds(paths.decisions, 'decision');
  ids.gap = tableIds(paths.gaps, 'gap');

  if (exists(paths.contracts)) {
    const cRe = new RegExp(`^(${re('contract').source})-.*\\.md$`);
    for (const name of fs.readdirSync(paths.contracts)) {
      const m = cRe.exec(name);
      if (m) ids.contract.add(m[1]);
    }
  }

  // A malformed slice file is a finding for a rule, not a crash here: read only its address.
  for (const f of findSliceFiles(root, cfg)) {
    ids.phase.add(f.phaseId);
    let addr = null;
    try {
      addr = parseSliceAddr(String(frontMatter(readText(f.path)).data.slice ?? ''));
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
  return {
    root,
    cfg,
    paths,
    docs: collectDocs(root, paths),
    ids: collectIds(root, cfg, paths),
    git: gitFacts(root),
    baselines: readBaselines(root),
    ci,
    env,
  };
}
