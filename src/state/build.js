import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from '../fs.js';
import { git, GitError } from '../git.js';
import { headings, lines } from '../markdown.js';
import { kitPaths } from '../paths.js';
import { findSliceFiles, parsePhaseFile, parseSliceFile, phaseOfDir } from '../slicefile.js';
import { readSlice } from './index.js';

export const MARKER = '<!-- slicekit:generated:end -->';

// The merge driver of REQ-1.6 (D-100): `.gitattributes` names it for BUILD.md, and init sets its
// command in the clone's git config. git runs the command with %O %A %B on a local merge.
export const BUILD_MERGE_DRIVER = 'slicekit-build';
export const BUILD_MERGE_RULE = `BUILD.md merge=${BUILD_MERGE_DRIVER}`;
export const mergeDriverCommand = (cli) => `${cli} status --merge-driver %O %A %B`;

const TEMPLATE = fileURLToPath(new URL('../../templates/docs/BUILD.md', import.meta.url));
const TITLE = '# BUILD — the queue';
const PHASE_HEADING = /^Phase\s+(\d+)\b/;
const IN_PROGRESS = new Set(['tests-red', 'building']);
const OPEN_PR = new Set(['draft-pr', 'in-review', 'changes-requested', 'ci-green', 'ready']);
const DONE = new Set(['merged', 'released']);

export function statusCell(state) {
  if (DONE.has(state.state)) return 'Done';
  if (OPEN_PR.has(state.state)) return `PR ${state.pr?.number != null ? `#${state.pr.number}` : '-'}`;
  if (IN_PROGRESS.has(state.state)) return 'Todo (in progress)';
  return 'Todo';
}

const posixRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const cell = (s) => String(s).replace(/\s*\n\s*/g, ' ').replace(/(?<!\\)\|/g, '\\|');

// The text under a level-2 heading, up to the next level-2 heading, trimmed; null when absent.
function section(text, title) {
  const hs = headings(text).filter((h) => h.level === 2);
  const i = hs.findIndex((h) => h.text.toLowerCase() === title.toLowerCase());
  if (i === -1) return null;
  const all = lines(text);
  const end = i + 1 < hs.length ? hs[i + 1].line - 1 : all.length;
  const body = all.slice(hs[i].line, end).join('\n').trim();
  return body === '' ? null : body;
}

// Phase directories that carry a phase file, in phase order: [{ n, id, name, dir, order }].
function phases(root, cfg) {
  const dir = kitPaths(root, cfg).phases;
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const phase = phaseOfDir(d.name);
    if (!d.isDirectory() || !phase) continue;
    const phaseDir = path.join(dir, d.name);
    const own = `${phase.id}.md`;
    const candidates = fs
      .readdirSync(phaseDir)
      .filter((f) => f.endsWith('.md') && !/^S-\d+/.test(f))
      .sort((a, b) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b)));
    for (const f of candidates) {
      const text = readText(path.join(phaseDir, f));
      const parsed = parsePhaseFile(text);
      if (parsed && parsed.id === phase.id) {
        out.push({ n: phase.n, id: parsed.id, name: parsed.name, dir: phaseDir, order: section(text, 'Order') });
        break;
      }
    }
  }
  return out.sort((a, b) => a.n - b.n);
}

// Every phase that has a phase file or a slice file. A phase with slices and no phase file takes
// its heading from the directory name, so its slices still reach BUILD.md, and is warned.
function allPhases(root, cfg, sliceFiles, onWarning) {
  const byId = new Map(phases(root, cfg).map((p) => [p.id, p]));
  for (const f of sliceFiles) {
    if (byId.has(f.phaseId)) continue;
    const dirPhase = phaseOfDir(path.basename(f.phaseDir));
    byId.set(f.phaseId, { n: dirPhase.n, id: dirPhase.id, name: dirPhase.name, dir: f.phaseDir, order: null });
    onWarning(`phase ${f.phaseId} has no phase file; heading taken from the directory`);
  }
  return [...byId.values()].sort((a, b) => a.n - b.n);
}

function preamble(cfg) {
  const text = readText(TEMPLATE).replace(/\{\{docsRoot\}\}/g, cfg.docsRoot);
  const all = lines(text);
  const start = all.findIndex((l) => l.trim() === TITLE);
  return all.slice(start + 1).join('\n').trim();
}

// Splits BUILD.md at the marker. Without a marker the whole text is generated and tail is null.
export function generatedRegion(text) {
  const all = lines(text);
  const i = all.findIndex((l) => l.trim() === MARKER);
  if (i === -1) return { generated: all.join('\n'), tail: null };
  return { generated: all.slice(0, i).join('\n') + (i > 0 ? '\n' : ''), tail: all.slice(i + 1).join('\n') };
}

// A BUILD.md written before the marker existed: keep every level-2 section except the generated
// phases; drop the title and preamble above the first section.
function migratedTail(text, generatedPhases) {
  const all = lines(text);
  const hs = headings(text).filter((h) => h.level === 2);
  const kept = [];
  hs.forEach((h, i) => {
    const m = PHASE_HEADING.exec(h.text);
    if (m && generatedPhases.has(Number(m[1]))) return;
    const end = i + 1 < hs.length ? hs[i + 1].line - 1 : all.length;
    kept.push(all.slice(h.line - 1, end).join('\n').trim());
  });
  return kept.length === 0 ? '' : `\n${kept.join('\n\n')}\n`;
}

// The text below the marker, verbatim, less any `## Phase <n>` section whose phase is now generated.
function prunedTail(text, generatedPhases) {
  const all = lines(text);
  const hs = headings(text).filter((h) => h.level === 2);
  const drop = new Set();
  hs.forEach((h, i) => {
    const m = PHASE_HEADING.exec(h.text);
    if (!m || !generatedPhases.has(Number(m[1]))) return;
    const end = i + 1 < hs.length ? hs[i + 1].line - 1 : all.length;
    for (let j = h.line - 1; j < end; j++) drop.add(j);
  });
  if (drop.size === 0) return text;
  const kept = all.filter((_, j) => !drop.has(j));
  if (all[all.length - 1] === '' && kept[kept.length - 1] !== '') kept.push('');
  return kept.join('\n');
}

// `onWarning` receives each problem that does not stop the render, such as a phase without a phase file.
export function renderBuild(root, cfg, existingText = '', { onWarning = () => {} } = {}) {
  const sliceFiles = findSliceFiles(root, cfg);
  const found = allPhases(root, cfg, sliceFiles, onWarning);
  const slicesByPhase = new Map();
  for (const f of sliceFiles) {
    const slice = parseSliceFile(readText(f.path), f.path);
    const list = slicesByPhase.get(f.phaseId) ?? [];
    list.push({ slice, state: readSlice(root, cfg, slice.id), rel: posixRel(root, f.path) });
    slicesByPhase.set(f.phaseId, list);
  }

  // A phase whose slices are all merged or released is one line under "Merged phases"; every other
  // phase has its table, one row per slice with a link to its slice file and no Done when (D-105).
  const merged = (phase) => {
    const list = slicesByPhase.get(phase.id) ?? [];
    return list.length > 0 && list.every(({ state }) => DONE.has(state.state));
  };
  const folded = found.filter(merged);
  const out = [TITLE, '', preamble(cfg)];
  if (folded.length > 0) {
    out.push('', '## Merged phases', '');
    for (const phase of folded) {
      const count = slicesByPhase.get(phase.id).length;
      const folder = posixRel(root, phase.dir);
      out.push(`- Phase ${phase.n} — ${phase.name}: ${count} ${count === 1 ? 'slice' : 'slices'}, all merged; slice files in \`${folder}/\`.`);
    }
  }
  for (const phase of found) {
    if (merged(phase)) continue;
    out.push('', `## Phase ${phase.n} — ${phase.name}`, '');
    out.push('| Slice | Name | Group | Slice file | Status |', '|---|---|---|---|---|');
    for (const { slice, state, rel } of slicesByPhase.get(phase.id) ?? []) {
      const short = slice.id.split('/')[1];
      const link = `[${cell(path.posix.basename(rel))}](${rel})`;
      out.push(`| ${short} | ${cell(slice.name)} | ${cell(slice.group)} | ${link} | ${statusCell(state)} |`);
    }
    if (phase.order) out.push('', phase.order);
  }
  const generated = `${out.join('\n')}\n`;

  const { tail } = generatedRegion(existingText ?? '');
  const generatedPhases = new Set(found.map((p) => p.n));
  const rest = tail === null ? migratedTail(existingText ?? '', generatedPhases) : prunedTail(tail, generatedPhases);
  return `${generated}\n${MARKER}\n${rest}`;
}

// The other side of the merge git is running: `git merge` names each merged head in a
// GITHEAD_<sha> variable of the driver's environment. Null when there is not exactly one.
function otherHead(env) {
  const heads = Object.keys(env)
    .map((k) => /^GITHEAD_([0-9a-f]{40}|[0-9a-f]{64})$/i.exec(k)?.[1])
    .filter(Boolean);
  return heads.length === 1 ? heads[0] : null;
}

// path → blob id of every file under `dirs` in `commit`; an empty map for no commit.
function blobs(root, commit, dirs) {
  const out = new Map();
  if (!commit) return out;
  const listed = git(root, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', ...dirs]);
  for (const entry of listed.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [, type, sha] = entry.slice(0, tab).split(' ');
    if (type === 'blob') out.set(entry.slice(tab + 1), sha);
  }
  return out;
}

// The content of each blob id, read by one `git cat-file --batch`.
function readBlobs(root, shas) {
  const out = new Map();
  if (shas.length === 0) return out;
  const raw = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: `${shas.join('\n')}\n`, maxBuffer: 1 << 28 });
  let at = 0;
  while (at < raw.length) {
    const nl = raw.indexOf(10, at);
    const [sha, , size] = raw.subarray(at, nl).toString('utf8').split(' ');
    const start = nl + 1;
    out.set(sha, raw.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }
  return out;
}

const tryGit = (root, args) => {
  try {
    return git(root, args);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
};

// BUILD.md for a local merge (the driver of REQ-1.6, D-100): `ancestor`, `current` and `other` are
// the texts of %O, %A and %B. The slice files and state files are merged path by path, the way git
// merges them (a side that left a file as the merge base had it takes the other side's), into a
// temporary tree, and BUILD.md is rendered from it. The text below the marker is the side's that
// changed it, else this side's. With no other head to read, BUILD.md is rendered from the working tree.
export function mergeBuild(root, cfg, { ancestor = '', current = '', other = '', env = process.env } = {}) {
  const changedTail = generatedRegion(current).tail !== generatedRegion(ancestor).tail;
  const existing = changedTail ? current : other;
  const theirs = otherHead(env);
  const head = tryGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!theirs || !head || !tryGit(root, ['rev-parse', '--verify', '--quiet', `${theirs}^{commit}`])) {
    return renderBuild(root, cfg, existing);
  }
  const paths = kitPaths(root, cfg);
  const dirs = [paths.state, paths.phases].map((d) => posixRel(root, d));
  const base = tryGit(root, ['merge-base', head, theirs]);
  const [o, a, b] = [base, head, theirs].map((c) => blobs(root, c, dirs));
  const chosen = new Map();
  for (const file of new Set([...a.keys(), ...b.keys()])) {
    const [was, ours, them] = [o.get(file), a.get(file), b.get(file)];
    const pick = ours === was ? them : ours;
    if (pick) chosen.set(file, pick);
  }
  const content = readBlobs(root, [...new Set(chosen.values())]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-build-merge-'));
  try {
    for (const [file, sha] of chosen) {
      const abs = path.join(tmp, ...file.split('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content.get(sha));
    }
    return renderBuild(tmp, cfg, existing);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
