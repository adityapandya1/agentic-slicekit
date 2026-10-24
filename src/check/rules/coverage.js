// coverage (03 REQ-3.7, 02 REQ-2.5): once a program is at the plan stage, every REQ is named by at
// least one slice, every slice lists its expected changes, and no two slices in one parallel group
// of one phase expect to change the same path.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from '../../fs.js';
import { re, stateFileName } from '../../ids.js';
import { headings } from '../../markdown.js';
import { findSliceFiles, parseSliceFile } from '../../slicefile.js';
import { programStage } from '../../stage.js';

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

// One pass over the parsed slices' state files: whether any is past `todo`, and the state files
// that do not parse. A missing state file is `todo`. A corrupt one is a finding and counts as past
// `todo`: an unreadable state must never close the gate. (`listSlices` would throw on the first
// corrupt file or unparseable slice file, so this reads the files itself.)
function sliceStates(ctx, parsed) {
  const corrupt = [];
  let beyondTodo = false;
  for (const p of parsed) {
    if (!p.slice) continue;
    const file = path.join(ctx.paths.state, stateFileName(p.slice.id));
    if (!fs.existsSync(file)) continue;
    let stored;
    try {
      stored = JSON.parse(readText(file));
    } catch {
      corrupt.push(toPosix(path.relative(ctx.root, file)));
      beyondTodo = true;
      continue;
    }
    if ((stored?.state ?? 'todo') !== 'todo') beyondTodo = true;
  }
  return { beyondTodo, corrupt };
}

// Planned means the first stage that is not complete is `plan` or later, so the plan branch is
// checked before it merges. Stopping the stage reader at `plan` gives exactly that: it reports
// `plan` both when plan is the first incomplete stage and when it is complete. A slice past `todo`
// also counts: a program that is building is past planning even when its earlier stages cannot be
// proven (the kit itself has no intake sidecar, so its stage reader stops at intake).
function planned(ctx, beyondTodo) {
  return beyondTodo || programStage(ctx.root, ctx.cfg, { upTo: 'plan' }).stage === 'plan';
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

// One level of `{a,b}` is expanded: `src/cli/{state,status}.js` is two paths.
function expand(p) {
  const m = /^(.*?)\{([^{}]*)\}(.*)$/.exec(p);
  return m ? m[2].split(',').map((alt) => `${m[1]}${alt.trim()}${m[3]}`) : [p];
}

// Four shared roots are never an overlap: `.` (the repository itself), anything under `test/` (a
// slice may always add tests), `src/cli/index.js` (the command registration table every slice
// touches) and the runbook (every operational slice appends a section to it). The runbook is
// passed in as resolved from the config, because the docs root is the team's to choose.
const ALWAYS_SHARED = (n, runbook) => n === '' || n === '.' || n === 'test' || n.startsWith('test/') || n === 'src/cli/index.js' || n === runbook;

function normalise(p, runbook) {
  return expand(p)
    .map((one) =>
      one
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .replace(/^(\.\/)+/, '')
        .replace(/\/+$/, ''),
    )
    .filter((n) => !ALWAYS_SHARED(n, runbook));
}

// The path both slices would change, when one prefix contains the other by whole segments.
function overlap(a, b) {
  if (a === b || b.startsWith(`${a}/`)) return b;
  if (a.startsWith(`${b}/`)) return a;
  return null;
}

// Each slice's normalised prefixes, each with the file line of the first entry that gave it.
function prefixes(slice, runbook) {
  const out = new Map();
  slice.expectedChanges.forEach((c, k) => {
    for (const n of normalise(c, runbook)) if (!out.has(n)) out.set(n, slice.expectedChangeLines[k] ?? 1);
  });
  return out;
}

function overlaps(parsed, out, runbook) {
  const groups = new Map();
  for (const p of parsed) {
    if (!p.slice) continue;
    const key = `${p.phaseId}\u0000${p.slice.group}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...p, prefixes: prefixes(p.slice, runbook) });
  }
  for (const members of groups.values()) {
    for (let j = 1; j < members.length; j++) {
      for (let i = 0; i < j; i++) {
        const [a, b] = [members[i], members[j]];
        const shared = new Map();
        for (const x of a.prefixes.keys()) {
          for (const [y, line] of b.prefixes) {
            const hit = overlap(x, y);
            if (hit !== null && !shared.has(hit)) shared.set(hit, line);
          }
        }
        for (const [where, line] of shared) {
          out.push({
            file: b.rel,
            line,
            message: `slices ${a.slice.id} and ${b.slice.id} in group ${b.slice.group} both expect ${where}`,
          });
        }
      }
    }
  }
}

export function run(ctx) {
  const parsed = readSlices(ctx);
  const states = sliceStates(ctx, parsed);
  if (!planned(ctx, states.beyondTodo)) return [];
  const out = [];
  for (const rel of states.corrupt) out.push({ file: rel, line: 1, message: `state file ${rel} is not valid JSON` });
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
  // REQ-1.5: a slice file lists its expected changes; an empty list would pass every overlap check.
  for (const p of parsed) {
    if (p.slice && p.slice.expectedChanges.length === 0) {
      out.push({ file: p.rel, line: p.slice.expectedChangesLine ?? 1, message: `slice ${p.slice.id} lists no expected changes` });
    }
  }
  overlaps(parsed, out, toPosix(path.relative(ctx.root, ctx.paths.runbook)));
  return out;
}

export default { id, blocking, ratchet, run };
