import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from '../fs.js';
import { headings, lines } from '../markdown.js';
import { kitPaths } from '../paths.js';
import { findSliceFiles, parsePhaseFile, parseSliceFile, phaseOfDir } from '../slicefile.js';
import { readSlice } from './index.js';

export const MARKER = '<!-- slicekit:generated:end -->';
const EXAMPLE_MARK = /\s*<!-- slicekit:example -->\s*$/;

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
    list.push({ slice, state: readSlice(root, cfg, slice.id) });
    slicesByPhase.set(f.phaseId, list);
  }

  const out = [TITLE, '', preamble(cfg)];
  for (const phase of found) {
    out.push('', `## Phase ${phase.n} — ${phase.name}`, '');
    out.push('| Slice | Name | Done when | Group | Status |', '|---|---|---|---|---|');
    for (const { slice, state } of slicesByPhase.get(phase.id) ?? []) {
      const short = slice.id.split('/')[1];
      // A slice file's example marker stays in the slice file, which is checked bullet by bullet.
      const done = slice.doneWhen.map((d) => d.replace(EXAMPLE_MARK, '').replace(/(?<!\.)\.$/, '')).join('; ');
      out.push(`| ${short} | ${cell(slice.name)} | ${cell(done)} | ${cell(slice.group)} | ${statusCell(state)} |`);
    }
    if (phase.order) out.push('', phase.order);
  }
  const generated = `${out.join('\n')}\n`;

  const { tail } = generatedRegion(existingText ?? '');
  const generatedPhases = new Set(found.map((p) => p.n));
  const rest = tail === null ? migratedTail(existingText ?? '', generatedPhases) : prunedTail(tail, generatedPhases);
  return `${generated}\n${MARKER}\n${rest}`;
}
