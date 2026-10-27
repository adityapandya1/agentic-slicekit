// coverage (03 REQ-3.7, 02 REQ-2.5): once a program is at the plan stage, every REQ is named by at
// least one slice, every slice lists its expected changes and has a happy and a negative test, a
// phase's Order line names each of its groups once (D-38), and no two slices that run at the same
// time (one Order step, or one parallel group without an Order line) expect to change the same path.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from '../../fs.js';
import { re, stateFileName } from '../../ids.js';
import { headings, prose } from '../../markdown.js';
import { findSliceFiles, parseOrder, parseSliceFile, phaseOfDir } from '../../slicefile.js';
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

// Every `{a,b}` group is expanded, outermost first, until none is left: `src/cli/{state,status}.js`
// is two paths, `src/{a,b/{c,d}}.js` three and `src/{a,b}/{c,d}.js` four. A group is split on its
// own commas only, not on those of a group inside it. An unclosed `{` stays as written.
export function expand(p) {
  const open = p.indexOf('{');
  if (open === -1) return [p];
  const alts = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open; i < p.length; i++) {
    if (p[i] === '{') depth++;
    else if (p[i] === '}' && --depth === 0) {
      alts.push(p.slice(from, i));
      return alts.flatMap((alt) => expand(`${p.slice(0, open)}${alt.trim()}${p.slice(i + 1)}`));
    } else if (p[i] === ',' && depth === 1) {
      alts.push(p.slice(from, i));
      from = i + 1;
    }
  }
  return [p];
}

// Four shared roots are never an overlap: `.` (the repository itself), anything under `test/` (a
// slice may always add tests), `src/cli/index.js` (the command registration table every slice
// touches) and the runbook (every operational slice appends a section to it). The runbook is
// passed in as resolved from the config, because the docs root is the team's to choose.
const ALWAYS_SHARED = (n, runbook) => n === '' || n === '.' || n === 'test' || n.startsWith('test/') || n === 'src/cli/index.js' || n === runbook;
// The same test for one normalised repository-relative path (POSIX separators, no leading `./`), as
// `build pr`'s overlap stop asks it of a path two branches change.
export const isSharedRoot = (p, runbookRel) => ALWAYS_SHARED(p, runbookRel);

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

// Each phase directory's Order line (D-38), parsed, with its file and line, and the lines of any
// further Order line (`parseOrder` follows the first); phases without one are left out. The lines
// are found with the same pattern `parseOrder` uses, so the two cannot disagree.
function orderLines(ctx) {
  const out = new Map();
  if (!fs.existsSync(ctx.paths.phases)) return out;
  for (const dir of fs.readdirSync(ctx.paths.phases, { withFileTypes: true })) {
    const phase = phaseOfDir(dir.name);
    if (!dir.isDirectory() || !phase) continue;
    const file = path.join(ctx.paths.phases, dir.name, `${phase.id}.md`);
    const rel = toPosix(path.relative(ctx.root, file));
    const doc = ctx.docs.find((d) => d.rel === rel);
    if (!doc && !fs.existsSync(file)) continue;
    const text = doc ? doc.text : readText(file);
    const steps = parseOrder(text);
    if (!steps) continue;
    const at = [...prose(text)].filter(([l]) => /^\*\*Order:\*\*\s*(.+)$/.test(l)).map(([, n]) => n);
    out.set(phase.id, { rel, line: at[0] ?? 1, more: at.slice(1), steps: steps.map((s) => s.filter((g) => g !== '')).filter((s) => s.length > 0) });
  }
  return out;
}

// REQ-2.5 / D-38: an Order line names every group of its phase, each once, and no group no slice has.
function orderFindings(parsed, orders, out) {
  for (const [phaseId, order] of orders) {
    const groups = new Set(parsed.filter((p) => p.slice && p.phaseId === phaseId).map((p) => p.slice.group));
    const seen = new Set();
    const twice = new Set();
    for (const g of order.steps.flat()) (seen.has(g) ? twice : seen).add(g);
    const at = (message) => out.push({ file: order.rel, line: order.line, message: `phase ${phaseId} Order line ${message}` });
    for (const g of [...groups].sort()) if (!seen.has(g)) at(`does not name group ${g}`);
    for (const g of twice) at(`names group ${g} twice`);
    for (const g of seen) if (!groups.has(g)) at(`names group ${g}, which no slice has`);
    for (const line of order.more) out.push({ file: order.rel, line, message: `phase ${phaseId} has more than one Order line` });
  }
}

// The slices that run at the same time: with an Order line, those of one step (a group named in
// several steps is in each, so all its overlaps show; a group the line does not name is its own
// step, so its overlaps are still found); without one, those of one group.
function overlaps(parsed, orders, out, runbook) {
  const sets = new Map();
  for (const p of parsed) {
    if (!p.slice) continue;
    const order = orders.get(p.phaseId);
    const steps = order ? order.steps.filter((s) => s.includes(p.slice.group)) : [];
    // A Set, so a step written twice (`A; A`) does not put a slice beside itself.
    const labels = new Set(steps.length > 0 ? steps.map((s) => `step ${s.join(', ')}`) : [`group ${p.slice.group}`]);
    const member = { ...p, prefixes: prefixes(p.slice, runbook) };
    for (const label of labels) {
      const key = `${p.phaseId}\u0000${label}`;
      if (!sets.has(key)) sets.set(key, { label, members: [] });
      sets.get(key).members.push(member);
    }
  }
  for (const { label, members } of sets.values()) {
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
          out.push({ file: b.rel, line, message: `slices ${a.slice.id} and ${b.slice.id} in ${label} both expect ${where}` });
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
  // REQ-2.5: each slice's evaluation set has at least one happy and one negative test.
  for (const p of parsed) {
    if (!p.slice) continue;
    for (const kind of ['happy', 'negative']) {
      if (!p.slice.evaluation.some((e) => e.kind === kind)) out.push({ file: p.rel, line: 1, message: `slice ${p.slice.id} has no ${kind} test` });
    }
  }
  const orders = orderLines(ctx);
  orderFindings(parsed, orders, out);
  overlaps(parsed, orders, out, toPosix(path.relative(ctx.root, ctx.paths.runbook)));
  return out;
}

export default { id, blocking, ratchet, run };
