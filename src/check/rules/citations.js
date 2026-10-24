// citations (03 REQ-3.7): every requirement has the shape of 01 REQ-1.3 and cites a decision or an
// intake file that exists; every slice file (REQ-1.5) names only requirements and decisions that
// exist, and every test in its evaluation set covers a requirement; no D or REQ id is defined twice
// (REQ-1.4).
import fs from 'node:fs';
import path from 'node:path';
import { re } from '../../ids.js';
import { headings, tables } from '../../markdown.js';
import { findSliceFiles, parseSliceFile } from '../../slicefile.js';

export const id = 'citations';
export const blocking = true;
export const ratchet = false;

const FENCE = /^\s*(```|~~~)/;
const LIST = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?/;
const toPosix = (p) => p.split(path.sep).join('/');

// True for every line (0-based) inside a fenced block, fence lines included.
function fencedLines(lines) {
  let inFence = false;
  return lines.map((l) => {
    if (FENCE.test(l)) {
      inFence = !inFence;
      return true;
    }
    return inFence;
  });
}

// The label a line starts with once list markers are stripped, e.g. `- Cites: D-01` → `Cites:`.
const startsWith = (line, label) => line.replace(LIST, '').startsWith(label);

// The tokens of one line of a `Cites:` entry, stripped of markdown punctuation. A continuation
// line has no `Cites:` key to skip.
function citedTokens(line, continuation = false) {
  const rest = continuation ? line : line.replace(LIST, '').slice('Cites:'.length);
  return rest
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^[`'"([*_]+/, '').replace(/[`'")\]*_.:]+$/, ''))
    .filter((t) => t !== '');
}

// Each `Cites:` line with the lines wrapped under it: indented, not blank, carrying no `Key:`.
// Returns one array of [line, number] per entry.
function citesEntries(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (!startsWith(body[i][0], 'Cites:')) continue;
    const parts = [body[i]];
    const wrapped = (l) => /^\s+\S/.test(l) && !/^\s*[A-Z][\w ]*:/.test(l);
    while (i + 1 < body.length && wrapped(body[i + 1][0])) parts.push(body[++i]);
    out.push(parts);
  }
  return out;
}

const DECISION = new RegExp(`^${re('decision').source}$`);
const DATED = /^\d{4}-\d{2}-\d{2}-.+\.[A-Za-z0-9]+$/;

// The intake file a token names, or null: `intake/<file>` anywhere in it, or a bare dated name.
// A bare `intake/` names no file and is not an intake token.
function intakeName(token) {
  const i = token.lastIndexOf('intake/');
  if (i !== -1) {
    const name = token.slice(i + 'intake/'.length).replace(/[)\]]+$/, '');
    return name === '' ? null : name;
  }
  return DATED.test(token) ? token : null;
}

function intakeExists(ctx, name) {
  if (name === '' || name.split('/').includes('..')) return false;
  const file = path.join(ctx.paths.intake, ...name.split('/'));
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

function checkReqBlock(ctx, doc, h, end, fenced, out) {
  const reqId = re('req').exec(h.text)[0];
  const at = (message, line = h.line) => out.push({ file: doc.rel, line, message });
  const body = [];
  for (let i = h.line; i < end; i++) if (!fenced[i]) body.push([doc.lines[i], i + 1]);

  if (!body.some(([l]) => /\bSHALL\b/.test(l))) at(`${reqId} has no SHALL`);
  if (!body.some(([l]) => startsWith(l, 'Scenario:'))) at(`${reqId} has no Scenario`);

  const entries = citesEntries(body);
  if (entries.length === 0) at(`${reqId} has no Cites line`);
  for (const parts of entries) {
    let named = 0;
    const first = parts[0][1];
    const tokens = parts.flatMap(([line, ln], k) => citedTokens(line, k > 0).map((t) => [t, ln]));
    for (const [token, n] of tokens) {
      if (DECISION.test(token)) {
        named += 1;
        if (!ctx.ids.decision.has(token)) at(`${reqId} cites unknown ${token}`, n);
        continue;
      }
      const name = intakeName(token);
      if (name === null) continue;
      named += 1;
      if (!intakeExists(ctx, name)) at(`${reqId} cites missing intake ${name}`, n);
    }
    if (named === 0) at(`${reqId} Cites line names no decision or intake file`, first);
  }

  if (!body.some(([l]) => startsWith(l, 'Enforced by:'))) at(`${reqId} has no Enforced by line`);
}

// The spec's own files (not contracts), as the context collected them.
function specDocs(ctx) {
  const dir = toPosix(path.relative(ctx.root, ctx.paths.spec)) || '.';
  return ctx.docs.filter((d) => path.posix.dirname(d.rel) === dir);
}

function checkRequirements(ctx, defs, out) {
  const reqHead = new RegExp(`^${re('req').source}\\b`);
  for (const doc of specDocs(ctx)) {
    const fenced = fencedLines(doc.lines);
    const hs = headings(doc.text);
    hs.forEach((h, i) => {
      if ((h.level !== 2 && h.level !== 3) || !reqHead.test(h.text)) return;
      // A block ends at the next heading of its own level or higher, or at the next REQ heading of
      // any level, so a nested REQ never lends its lines to the one above it.
      const next = hs.slice(i + 1).find((o) => o.level <= h.level || reqHead.test(o.text));
      const end = next ? next.line - 1 : doc.lines.length;
      defs.push({ id: re('req').exec(h.text)[0], file: doc.rel, line: h.line });
      checkReqBlock(ctx, doc, h, end, fenced, out);
    });
  }
}

function decisionDefs(ctx, defs) {
  const rel = toPosix(path.relative(ctx.root, ctx.paths.decisions));
  const doc = ctx.docs.find((d) => d.rel === rel);
  if (!doc) return;
  for (const t of tables(doc.text)) {
    t.rows.forEach((row, i) => {
      if (DECISION.test(row[0] ?? '')) defs.push({ id: row[0], file: doc.rel, line: t.line + 2 + i });
    });
  }
}

function checkDuplicates(defs, out) {
  const first = new Map();
  for (const d of defs) {
    const seen = first.get(d.id);
    if (!seen) {
      first.set(d.id, d);
      continue;
    }
    out.push({
      file: d.file,
      line: d.line,
      message: `duplicate id ${d.id} (${seen.file}:${seen.line} and ${d.file}:${d.line})`,
    });
  }
}

const lineOf = (lines, needle) => {
  const i = lines.findIndex((l) => l.includes(needle));
  return i === -1 ? 1 : i + 1;
};

function checkSlices(ctx, out) {
  for (const f of findSliceFiles(ctx.root, ctx.cfg)) {
    const rel = toPosix(path.relative(ctx.root, f.path));
    const doc = ctx.docs.find((d) => d.rel === rel);
    if (!doc) continue;
    let s;
    try {
      s = parseSliceFile(doc.text, f.path);
    } catch (e) {
      out.push({ file: rel, line: 1, message: `slice file cannot be read: ${e.message}` });
      continue;
    }
    const at = (message, needle) => out.push({ file: rel, line: lineOf(doc.lines, needle), message });
    for (const r of s.requirements) if (!ctx.ids.req.has(r)) at(`slice ${s.id} names unknown ${r}`, r);
    for (const d of s.decisions) if (!ctx.ids.decision.has(d)) at(`slice ${s.id} names unknown ${d}`, d);
    for (const row of s.evaluation) {
      const name = row.test.replace(/^`(.*)`$/, '$1');
      if (row.covers.length === 0) {
        at(`slice ${s.id} test "${name}" covers no requirement`, row.test);
        continue;
      }
      // Covers names requirements only; a decision or anything else there is unknown.
      for (const c of row.covers) if (!ctx.ids.req.has(c)) at(`slice ${s.id} names unknown ${c}`, row.test);
    }
  }
}

export function run(ctx) {
  const out = [];
  const defs = [];
  checkRequirements(ctx, defs, out);
  decisionDefs(ctx, defs);
  checkDuplicates(defs, out);
  checkSlices(ctx, out);
  return out;
}

export default { id, blocking, ratchet, run };
