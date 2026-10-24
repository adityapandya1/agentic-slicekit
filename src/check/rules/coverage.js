// coverage (03 REQ-3.7, 02 REQ-2.5): once a program is planned, every REQ is named by at least one
// slice, and no two slices in one parallel group of one phase expect to change the same path.
import path from 'node:path';
import { readText } from '../../fs.js';
import { re } from '../../ids.js';
import { headings } from '../../markdown.js';
import { findSliceFiles, parseSliceFile } from '../../slicefile.js';
import { programStage } from '../../stage.js';
import { readSlice } from '../../state/index.js';

export const id = 'coverage';
export const blocking = true;
export const ratchet = false;

const toPosix = (p) => p.split(path.sep).join('/');

// Every slice file, parsed or with the error that stopped it, in phase and slice order.
function readSlices(ctx) {
  return findSliceFiles(ctx.root, ctx.cfg).map((f) => {
    const rel = toPosix(path.relative(ctx.root, f.path));
    const doc = ctx.docs.find((d) => d.rel === rel);
    try {
      return { rel, phaseId: f.phaseId, slice: parseSliceFile(doc ? doc.text : readText(f.path), f.path) };
    } catch (e) {
      return { rel, phaseId: f.phaseId, error: e.message };
    }
  });
}

const beyondTodo = (ctx, s) => {
  try {
    return readSlice(ctx.root, ctx.cfg, s.id).state !== 'todo';
  } catch {
    return false;
  }
};

// Planned means the stage reader proves `plan` complete, or some slice is already past `todo`. The
// second is needed because a program that is building is past planning even when the stage reader
// cannot prove `plan` merged (the kit itself has no intake sidecar, so it never gets past intake).
// Note the stage reader's `plan` already requires every REQ to be named, so for an uncovered REQ
// only the second condition ever lets this rule speak; the first still lets it report overlaps.
function planned(ctx, slices) {
  if (slices.some((s) => s.slice && beyondTodo(ctx, s.slice))) return true;
  return programStage(ctx.root, ctx.cfg, { upTo: 'plan' }).complete;
}

// The REQ headings of the spec's own files (not contracts), first definition only.
function reqHeadings(ctx) {
  const dir = toPosix(path.relative(ctx.root, ctx.paths.spec)) || '.';
  const reqHead = new RegExp(`^(${re('req').source})\\b`);
  const out = new Map();
  for (const doc of ctx.docs) {
    if (path.posix.dirname(doc.rel) !== dir) continue;
    for (const h of headings(doc.text)) {
      const m = (h.level === 2 || h.level === 3) && reqHead.exec(h.text);
      if (m && !out.has(m[1])) out.set(m[1], { file: doc.rel, line: h.line });
    }
  }
  return out;
}

// Three paths are never an overlap: `.` (the repository itself), anything under `test/` (a slice
// may always add tests) and `src/cli/index.js` (the command registration table every slice touches).
function normalise(p) {
  const n = p
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '');
  if (n === '' || n === '.' || n === 'test' || n.startsWith('test/') || n === 'src/cli/index.js') return null;
  return n;
}

// The path both slices would change, when one prefix contains the other by whole segments.
function overlap(a, b) {
  if (a === b || b.startsWith(`${a}/`)) return b;
  if (a.startsWith(`${b}/`)) return a;
  return null;
}

function overlaps(parsed, out) {
  const groups = new Map();
  for (const p of parsed) {
    if (!p.slice) continue;
    const key = `${p.phaseId}\u0000${p.slice.group}`;
    const prefixes = [...new Set(p.slice.expectedChanges.map(normalise).filter((n) => n !== null))];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...p, prefixes });
  }
  for (const members of groups.values()) {
    for (let j = 1; j < members.length; j++) {
      for (let i = 0; i < j; i++) {
        const [a, b] = [members[i], members[j]];
        const shared = new Set();
        for (const x of a.prefixes) for (const y of b.prefixes) {
          const hit = overlap(x, y);
          if (hit !== null) shared.add(hit);
        }
        for (const where of shared) {
          out.push({
            file: b.rel,
            line: 1,
            message: `slices ${a.slice.id} and ${b.slice.id} in group ${b.slice.group} both expect ${where}`,
          });
        }
      }
    }
  }
}

export function run(ctx) {
  const parsed = readSlices(ctx);
  if (!planned(ctx, parsed)) return [];
  const out = [];
  for (const p of parsed) {
    if (p.error) out.push({ file: p.rel, line: 1, message: `slice file cannot be read: ${p.error}` });
  }
  const named = new Set(parsed.flatMap((p) => (p.slice ? p.slice.requirements : [])));
  const heads = reqHeadings(ctx);
  for (const reqId of ctx.ids.req) {
    if (named.has(reqId)) continue;
    const at = heads.get(reqId) ?? { file: toPosix(path.relative(ctx.root, ctx.paths.spec)), line: 1 };
    out.push({ file: at.file, line: at.line, message: `${reqId} is named by no slice` });
  }
  overlaps(parsed, out);
  return out;
}

export default { id, blocking, ratchet, run };
