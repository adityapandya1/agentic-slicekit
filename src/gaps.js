// Gap rows (REQ-2.4): one `G-<n>` row per gap in `<docsRoot>/spec/gaps.md`, of one of five classes,
// open until its `Closed by` cell names a settled decision row or a REQ changed on this branch. The
// gap-scan stage (`src/stage.js`) refuses while any row has that cell empty.
import fs from 'node:fs';
import path from 'node:path';
import { citedRefs } from './check/rules/citations.js';
import { insertAfter, interfacesWithoutContract, nextId, posix, readDecisions, row, save, split } from './decisions.js';
import { exists, readText } from './fs.js';
import { GitError, git } from './git.js';
import { headings, lines, prose, tables } from './markdown.js';
import { kitPaths } from './paths.js';
import { reqBlocks, reqBlocksIn } from './stage.js';

export const CLASSES = ['missing', 'unsupported', 'contradiction', 'unknown', 'unrequested'];

// `code` 1: a file problem (missing file or table, a row with no G id, a closed row). `code` 2: bad
// input or an unknown ID.
export class GapError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GapError';
    this.code = code;
  }
}

// The columns of the table, as `templates/docs/spec/gaps.md` writes them.
const COLUMNS = ['#', 'Class', 'Where', 'What', 'Closed by'];
const CLOSED = COLUMNS.indexOf('Closed by');
const ID = /^G-(\d+)$/;
const sameColumns = (header) => header.length === COLUMNS.length && header.every((h, i) => h === COLUMNS[i]);

// The gaps table: `{rows: [{line, cells}], last}`, 1-based lines, `last` the line after which a new
// row goes. Null when no table has the template's columns.
function gapTable(text) {
  const t = tables(text).find((x) => sameColumns(x.header));
  if (!t) return null;
  const rows = t.rows.map((cells, i) => ({ line: t.line + 2 + i, cells }));
  return { rows, last: t.line + 1 + t.rows.length };
}

// `{rows, next}`, with `next` numbered as `readDecisions` numbers decision rows. A row whose first
// cell is not a G id is left out here; `addGap` and `closeGap` refuse the file instead.
export function readGaps(text) {
  const rows = [];
  for (const { line, cells: c } of gapTable(text)?.rows ?? []) {
    const m = ID.exec(c[0] ?? '');
    if (!m) continue;
    rows.push({ id: c[0], n: Number(m[1]), cls: c[1] ?? '', where: c[2] ?? '', what: c[3] ?? '', closedBy: c[CLOSED] ?? '', line });
  }
  return { rows, next: nextId('G', rows) };
}

// The gap-scan stage counts every row with a first cell, so a row the command cannot read is
// refused here rather than skipped.
function load(root, cfg) {
  const file = kitPaths(root, cfg).gaps;
  const rel = posix(path.relative(root, file));
  if (!exists(file)) throw new GapError(1, `${rel} is missing; run slicekit init`);
  const text = fs.readFileSync(file, 'utf8');
  const table = gapTable(text);
  if (!table) throw new GapError(1, `${rel} has no table with columns ${COLUMNS.join(' | ')}`);
  const bad = table.rows.find((r) => !ID.test(r.cells[0] ?? ''));
  if (bad) throw new GapError(1, `gaps table row ${bad.line} has no G id`);
  return { file, text, table };
}

function field(name, value) {
  if (typeof value !== 'string') throw new GapError(2, `${name} is required`);
  if (/[\r\n]/.test(value)) throw new GapError(2, `${name} must be one line`);
  if (value.trim() === '') throw new GapError(2, `${name} is required`);
  return value.trim();
}

function replaceLine(text, n, line) {
  const parts = split(text);
  const eol = /\r?\n$/.exec(parts[n - 1])?.[0] ?? '';
  parts[n - 1] = line + eol;
  return parts.join('');
}

const byNumber = (rows, id, re) => {
  const m = re.exec(id ?? '');
  return m ? rows.find((r) => r.n === Number(m[1])) : undefined;
};

// Appends a gap row and returns its ID. A row with the same class, where and what is not written
// again: its ID comes back with `added: false`, so a repeated scan adds nothing.
export function addGap(root, cfg, { cls, where, what } = {}) {
  if (!CLASSES.includes(cls)) throw new GapError(2, `unknown class '${cls}'; one of ${CLASSES.join(', ')}`);
  const w = field('where', where);
  const t = field('what', what);
  const { file, text, table } = load(root, cfg);
  const { rows, next } = readGaps(text);
  const same = rows.find((r) => r.cls === cls && r.where === w && r.what === t);
  if (same) return { id: same.id, added: false };
  save(file, insertAfter(text, table.last, row([next, cls, w, t, ''])));
  return { id: next, added: true };
}

// The commit this branch forked from the default branch, or null when there is none to compare with.
function mergeBase(root, cfg) {
  for (const ref of [cfg.defaultBranch, `origin/${cfg.defaultBranch}`]) {
    try {
      return git(root, ['merge-base', 'HEAD', ref]);
    } catch (e) {
      if (!(e instanceof GitError)) throw e;
    }
  }
  return null;
}

// A REQ closes a gap only when its block differs from the same REQ at the merge base: the REQ
// change REQ-2.4 asks for. A REQ new since the base, or in a file new since it, counts as changed.
function assertReqChanged(root, cfg, now) {
  const base = mergeBase(root, cfg);
  if (!base) throw new GapError(2, `${now.id} has no merge base with ${cfg.defaultBranch} to compare with; change it on a branch first`);
  let then;
  try {
    then = reqBlocksIn(git(root, ['show', `${base}:${now.file}`])).find((r) => r.id === now.id);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
  }
  if (then && then.block.trim() === now.block.trim()) {
    throw new GapError(2, `${now.id} is unchanged from ${base.slice(0, 7)}; change it first`);
  }
}

// Writes a decision ID or a REQ ID into the row's `Closed by` cell, keeping every other cell. The
// decision must be a settled row of decisions.md; the REQ a heading of the spec changed since the
// merge base. A closed row is not closed again.
export function closeGap(root, cfg, id, { decision, req } = {}) {
  if ((decision === undefined) === (req === undefined)) throw new GapError(2, 'close needs exactly one of decision and req');
  const by = field(decision !== undefined ? 'decision' : 'req', decision ?? req);
  const { file, text, table } = load(root, cfg);
  const gap = byNumber(readGaps(text).rows, id, ID);
  if (!gap) throw new GapError(2, `unknown gap ${id}`);
  let closedBy;
  let reqNow;
  if (decision !== undefined) {
    const p = kitPaths(root, cfg).decisions;
    const rows = exists(p) ? readDecisions(fs.readFileSync(p, 'utf8')).rows : [];
    const d = byNumber(rows, by, /^D-(\d+)$/);
    if (!d) throw new GapError(2, `unknown decision ${by}`);
    if (d.table === 'open') throw new GapError(2, `${d.id} is open; settle it first (slicekit decide settle ${d.id})`);
    closedBy = d.id;
  } else {
    reqNow = reqBlocks(root, cfg).find((r) => r.id === by);
    if (!reqNow) throw new GapError(2, `unknown requirement ${by}`);
    closedBy = by;
  }
  if (gap.closedBy !== '') throw new GapError(1, `${gap.id} is closed by ${gap.closedBy}`);
  if (reqNow) assertReqChanged(root, cfg, reqNow);
  const cells = [...table.rows.find((r) => r.line === gap.line).cells];
  while (cells.length <= CLOSED) cells.push('');
  cells[CLOSED] = closedBy;
  save(file, replaceLine(text, gap.line, row(cells)));
  return { id: gap.id, closedBy };
}

const NOT_YET_KNOWN = /^not yet known\.?$/i;

// Each `##` section of the platform, observability and runbook files whose body is the one line
// `Not yet known` (REQ-1.11), at its heading line.
function notYetKnown(root, cfg) {
  const p = kitPaths(root, cfg);
  const out = [];
  for (const file of [p.platform, p.observability, p.runbook]) {
    if (!exists(file)) continue;
    const text = readText(file);
    const all = lines(text);
    const hs = headings(text);
    hs.forEach((h, i) => {
      if (h.level !== 2) return;
      const next = hs.slice(i + 1).find((n) => n.level <= 2);
      const body = all.slice(h.line, next ? next.line - 1 : all.length).filter((l) => l.trim() !== '');
      if (body.length !== 1 || !NOT_YET_KNOWN.test(body[0].trim())) return;
      out.push({ cls: 'unknown', where: `${posix(path.relative(root, file))}:${h.line}`, what: `${h.text} not yet known` });
    });
  }
  return out;
}

// Each Open decision row (REQ-1.4), each REQ whose `Cites:` names one, and each interface named at
// intake that no contract cites.
function fromDecisions(root, cfg) {
  const p = kitPaths(root, cfg);
  if (!exists(p.decisions)) return [];
  const where = posix(path.relative(root, p.decisions));
  const open = readDecisions(readText(p.decisions)).rows.filter((r) => r.table === 'open');
  const openIds = new Set(open.map((r) => r.id));
  const out = open.map((r) => ({ cls: 'unknown', where: `${where}:${r.line}`, what: `${r.id} is open: ${r.question}` }));
  for (const { id, file, line, block } of reqBlocks(root, cfg)) {
    const cited = citedRefs([...prose(block)].map(([l, n]) => [l, n + line]));
    const names = [...new Set(cited.filter((r) => r.kind === 'decision' && openIds.has(r.name)).map((r) => r.name))];
    for (const d of names) out.push({ cls: 'unknown', where: `${file}:${line}`, what: `${id} rests on open ${d}` });
  }
  for (const i of interfacesWithoutContract(root, cfg)) {
    out.push({ cls: 'missing', where: i.source ?? `${where}:${i.line}`, what: `interface ${i.name} named at intake has no contract` });
  }
  return out;
}

// Writes a row for each gap a script can find, through `addGap`, so a second run adds nothing.
// Judgement classes (contradiction, unrequested, and missing beyond named interfaces) are the
// auditor's. Returns `[{id, added, cls, where, what}]` in candidate order.
export function scanGaps(root, cfg) {
  return [...notYetKnown(root, cfg), ...fromDecisions(root, cfg)].map((c) => ({ ...addGap(root, cfg, c), ...c }));
}
