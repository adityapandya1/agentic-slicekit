// queue (01 REQ-1.6, 03 REQ-3.7): BUILD.md is a view of the slice files and their state, so its
// generated region must read exactly as `slicekit status --write` would write it. The text below
// the marker is the team's and is never compared.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from '../../fs.js';
import { lines } from '../../markdown.js';
import { findSliceFiles } from '../../slicefile.js';
import { generatedRegion, renderBuild, MARKER } from '../../state/build.js';

export const id = 'queue';
export const blocking = true;
export const ratchet = false;

const toPosix = (p) => p.split(path.sep).join('/');
const PHASE = /^##\s+Phase\s+(\d+)\b/;
const ROW = /^\|\s*(S-\d+)\s*\|/;

// The cells of a table row, split on unescaped pipes.
const cells = (line) =>
  line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((c) => c.trim());

// The generated region split into slice rows keyed `P<n>/S-<m>` and every other line. A row
// outside a phase section, or a second row for one slice, stays an other line, so it is a
// difference outside the rows.
function parse(generated) {
  const out = { rows: new Map(), phases: new Map(), other: [] };
  let phase = null;
  lines(generated).forEach((raw, i) => {
    const line = raw.trimEnd();
    const p = PHASE.exec(line);
    if (p) {
      phase = Number(p[1]);
      if (!out.phases.has(phase)) out.phases.set(phase, i + 1);
    }
    const r = ROW.exec(line);
    const key = r && phase !== null ? `P${phase}/${r[1]}` : null;
    if (key && !out.rows.has(key)) out.rows.set(key, { line: i + 1, cells: cells(line) });
    else out.other.push(line);
  });
  while (out.other.length > 0 && out.other[out.other.length - 1] === '') out.other.pop();
  return out;
}

// Nothing to check before the first plan: no state written and no slice file yet.
function unplanned(ctx) {
  const dir = ctx.paths.state;
  const states = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json')) : [];
  return states.length === 0 && findSliceFiles(ctx.root, ctx.cfg).length === 0;
}

export function run(ctx) {
  if (unplanned(ctx)) return [];
  const file = toPosix(path.relative(ctx.root, ctx.paths.build));
  const at = (line, message) => ({ file, line, message });
  if (!fs.existsSync(ctx.paths.build)) return [at(0, `${file} is missing; run slicekit status --write`)];
  const doc = ctx.docs.find((d) => d.rel === file);
  const text = doc ? doc.text : readText(ctx.paths.build);
  if (!lines(text).some((l) => l.trim() === MARKER)) {
    return [at(1, `${file} has no generated region marker; run slicekit status --write`)];
  }
  let rendered;
  try {
    // Warnings (a phase without a phase file) are printed by `status`, not reported here.
    rendered = renderBuild(ctx.root, ctx.cfg, text);
  } catch (e) {
    return [at(1, `${file} cannot be rendered from the slice files and state: ${e.message}`)];
  }
  const have = parse(generatedRegion(text).generated);
  const want = parse(generatedRegion(rendered).generated);

  const out = [];
  if (have.other.join('\n') !== want.other.join('\n')) out.push(at(1, `${file} is stale; run slicekit status --write`));
  for (const [key, row] of have.rows) {
    const expected = want.rows.get(key);
    if (!expected) {
      out.push(at(row.line, `${file} row for ${key} has no slice file`));
      continue;
    }
    const [hs, ws] = [row.cells.at(-1), expected.cells.at(-1)];
    if (hs !== ws) out.push(at(row.line, `${file} row for ${key} says "${hs}", state says "${ws}"`));
    else if (row.cells.join('\u0000') !== expected.cells.join('\u0000')) {
      out.push(at(row.line, `${file} row for ${key} is stale; run slicekit status --write`));
    }
  }
  for (const key of want.rows.keys()) {
    if (have.rows.has(key)) continue;
    const phase = Number(/^P(\d+)\//.exec(key)[1]);
    out.push(at(have.phases.get(phase) ?? 1, `${file} lacks a row for ${key}; run slicekit status --write`));
  }
  return out.sort((a, b) => a.line - b.line);
}

export default { id, blocking, ratchet, run };
