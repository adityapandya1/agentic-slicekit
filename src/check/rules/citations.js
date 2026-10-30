// citations (03 REQ-3.7): every requirement has the shape of 01 REQ-1.3 (a ## or ### heading) and
// cites a decision or an intake file that exists; every slice file (REQ-1.5) names only requirements and decisions that
// exist, and every test in its evaluation set covers a requirement; no D or REQ id is defined twice
// (REQ-1.4). On a slice branch, each test file (testFiles, D-46) the branch adds or modifies names a
// REQ ID at the branch tip (REQ-4.3); deleted files and the default branch are not judged.
import fs from 'node:fs';
import path from 'node:path';
import { re, sliceFromBranch } from '../../ids.js';
import { headings, tables } from '../../markdown.js';
import { findSliceFiles, parseSliceFile } from '../../slicefile.js';
import { assertRef, git, GitError } from '../../git.js';
import { isTestFile, reqMentions } from '../../graph/tests.js';
import { branchTip } from '../ci-event.js';

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

// Each `Cites:` line with the lines wrapped under it: indented, not blank, not a list item and
// carrying no `Key:`. A list item is a new entry (`  - Enforced by: …`), never a continuation.
// Returns one array of [line, number] per entry.
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
function citesEntries(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (!startsWith(body[i][0], 'Cites:')) continue;
    const parts = [body[i]];
    const wrapped = (l) => /^\s+\S/.test(l) && !LIST_ITEM.test(l) && !/^\s*[A-Z][\w ]*:/.test(l);
    while (i + 1 < body.length && wrapped(body[i + 1][0])) parts.push(body[++i]);
    out.push(parts);
  }
  return out;
}

const DECISION = new RegExp(`^${re('decision').source}$`);
const DATED = /^\d{4}-\d{2}-\d{2}-.+\.[A-Za-z0-9]+$/;

// The intake file a token names, or null: `intake/<file>` anywhere in it, or a bare dated name.
// A bare `intake/` names no file and is not an intake token. Backslashes count as `/`.
function intakeName(raw) {
  const token = raw.replace(/\\/g, '/');
  const i = token.lastIndexOf('intake/');
  if (i !== -1) {
    const name = token.slice(i + 'intake/'.length).replace(/[)\]]+$/, '');
    return name === '' ? null : name;
  }
  return DATED.test(token) ? token : null;
}

// True when `name` (from intakeName) is a file under the intake folder.
export function intakeExists(intakeDir, name) {
  if (name === '' || name.split('/').includes('..')) return false;
  const file = path.join(intakeDir, ...name.split('/'));
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

// Every decision and intake reference on the `Cites:` entries among `lines` ([text, number]
// pairs outside fences): `{token, kind, name, line}`, `name` the decision ID or the intake file.
// `check` and `spec verify` both resolve citations through this.
export function citedRefs(lines) {
  const out = [];
  for (const parts of citesEntries(lines)) {
    for (const [line, n] of parts.flatMap(([l, ln], k) => citedTokens(l, k > 0).map((t) => [t, ln]))) {
      if (DECISION.test(line)) {
        out.push({ token: line, kind: 'decision', name: line, line: n });
        continue;
      }
      const name = intakeName(line);
      if (name !== null) out.push({ token: line, kind: 'intake', name, line: n });
    }
  }
  return out;
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
    const found = citedRefs(parts);
    for (const r of found) {
      if (r.kind === 'decision' && !ctx.ids.decision.has(r.name)) at(`${reqId} cites unknown ${r.name}`, r.line);
      if (r.kind === 'intake' && !intakeExists(ctx.paths.intake, r.name)) at(`${reqId} cites missing intake ${r.name}`, r.line);
    }
    if (found.length === 0) at(`${reqId} Cites line names no decision or intake file`, parts[0][1]);
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
      if (!reqHead.test(h.text)) return;
      if (h.level !== 2 && h.level !== 3) {
        const reqId = re('req').exec(h.text)[0];
        out.push({ file: doc.rel, line: h.line, message: `${reqId} heading is level ${h.level}; a requirement is ## or ### (REQ-1.3)` });
        return;
      }
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
      // A known requirement the slice's `requirements` does not name is a gap in the record.
      for (const c of row.covers) {
        if (!ctx.ids.req.has(c)) at(`slice ${s.id} names unknown ${c}`, row.test);
        else if (!s.requirements.includes(c)) at(`slice ${s.id} test "${name}" covers ${c}, which the slice does not name`, row.test);
      }
    }
  }
}

const tryGit = (root, args) => {
  try {
    return git(root, args);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
};

export const TEST_FILE_MESSAGE = 'test file names no requirement (REQ-4.3)';

// REQ-4.3: the test files a slice branch adds or modifies against its merge base with the default
// branch (local, else origin's), judged at the branch tip.
export function testFileFindings(ctx) {
  const at = branchTip(ctx);
  if (!at || !sliceFromBranch(at.branch)) return [];
  const { root, cfg } = ctx;
  const def = assertRef(cfg.defaultBranch ?? 'main');
  const base = tryGit(root, ['merge-base', at.tip, `refs/heads/${def}`]) || tryGit(root, ['merge-base', at.tip, `refs/remotes/origin/${def}`]);
  if (!base) return [];
  const diff = tryGit(root, ['-c', 'core.quotePath=false', 'diff', '-z', '--name-status', '--no-renames', base, at.tip, '--']);
  if (!diff) return [];
  const parts = diff.split('\0');
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i].trim();
    const rel = parts[i + 1];
    if ((status !== 'A' && status !== 'M') || !isTestFile(rel, cfg)) continue;
    const text = tryGit(root, ['show', `${at.tip}:${rel}`]);
    if (text === null || reqMentions(text).length > 0) continue;
    out.push({ file: rel, line: 1, message: TEST_FILE_MESSAGE });
  }
  return out;
}

export function run(ctx) {
  const out = [];
  const defs = [];
  checkRequirements(ctx, defs, out);
  decisionDefs(ctx, defs);
  checkDuplicates(defs, out);
  checkSlices(ctx, out);
  out.push(...testFileFindings(ctx));
  return out;
}

export default { id, blocking, ratchet, run };
