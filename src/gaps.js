// Gap rows (REQ-2.4): one `G-<n>` row per gap in `<docsRoot>/spec/gaps.md`, of one of five classes,
// open until its `Closed by` cell names a decision row or a REQ. The gap-scan stage (`src/stage.js`)
// refuses while any row has that cell empty.
import fs from 'node:fs';
import path from 'node:path';
import { readDecisions } from './decisions.js';
import { exists } from './fs.js';
import { tables } from './markdown.js';
import { kitPaths } from './paths.js';
import { reqBlocks } from './stage.js';

export const CLASSES = ['missing', 'unsupported', 'contradiction', 'unknown', 'unrequested'];

// `code` 1: a file problem (missing file or table, a closed row). `code` 2: bad input or an unknown ID.
export class GapError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GapError';
    this.code = code;
  }
}

// The columns of the table, as `templates/docs/spec/gaps.md` writes them.
const COLUMNS = ['#', 'Class', 'Where', 'What', 'Closed by'];
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

// `{rows, next}`. `next` is the highest number plus one, zero-padded to the widest ID already used.
export function readGaps(text) {
  const rows = [];
  for (const { line, cells: c } of gapTable(text)?.rows ?? []) {
    const m = ID.exec(c[0] ?? '');
    if (!m) continue;
    rows.push({ id: c[0], n: Number(m[1]), cls: c[1] ?? '', where: c[2] ?? '', what: c[3] ?? '', closedBy: c[4] ?? '', line });
  }
  const width = Math.max(1, ...rows.map((r) => r.id.length - 2));
  const high = Math.max(0, ...rows.map((r) => r.n));
  return { rows, next: `G-${String(high + 1).padStart(width, '0')}` };
}

const posix = (p) => p.split(path.sep).join('/');

function load(root, cfg) {
  const file = kitPaths(root, cfg).gaps;
  const rel = posix(path.relative(root, file));
  if (!exists(file)) throw new GapError(1, `${rel} is missing; run slicekit init`);
  const text = fs.readFileSync(file, 'utf8');
  const table = gapTable(text);
  if (!table) throw new GapError(1, `${rel} has no table with columns ${COLUMNS.join(' | ')}`);
  return { file, text, table };
}

// Writes a temporary file in the same directory, then renames it over the file, so a reader never
// sees half a file.
function save(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function field(name, value) {
  if (typeof value !== 'string') throw new GapError(2, `${name} is required`);
  if (/[\r\n]/.test(value)) throw new GapError(2, `${name} must be one line`);
  if (value.trim() === '') throw new GapError(2, `${name} is required`);
  return value.trim();
}

const escape = (s) => s.trim().replace(/\|/g, '\\|');
const row = (cs) => `| ${cs.map(escape).join(' | ')} |`;

// The file's lines, each with its own ending. A new line takes the first line's ending; a last line
// with no ending gets one when a line follows it.
const split = (text) => text.split(/(?<=\n)/);

function insertAfter(text, after, line) {
  const parts = split(text);
  const eol = parts[0]?.endsWith('\r\n') ? '\r\n' : '\n';
  const prev = parts[after - 1];
  if (prev !== undefined && !prev.endsWith('\n')) parts[after - 1] = prev + eol;
  parts.splice(after, 0, line + eol);
  return parts.join('');
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

// Writes a decision ID or a REQ ID into the row's `Closed by` cell. The decision must be a row of
// decisions.md and the REQ a heading of the spec; a closed row is not closed again.
export function closeGap(root, cfg, id, { decision, req } = {}) {
  if ((decision === undefined) === (req === undefined)) throw new GapError(2, 'close needs exactly one of decision and req');
  const by = field(decision !== undefined ? 'decision' : 'req', decision ?? req);
  const { file, text } = load(root, cfg);
  const gap = byNumber(readGaps(text).rows, id, ID);
  if (!gap) throw new GapError(2, `unknown gap ${id}`);
  let closedBy;
  if (decision !== undefined) {
    const p = kitPaths(root, cfg).decisions;
    const rows = exists(p) ? readDecisions(fs.readFileSync(p, 'utf8')).rows : [];
    const d = byNumber(rows, by, /^D-(\d+)$/);
    if (!d) throw new GapError(2, `unknown decision ${by}`);
    closedBy = d.id;
  } else {
    if (!reqBlocks(root, cfg).some((r) => r.id === by)) throw new GapError(2, `unknown requirement ${by}`);
    closedBy = by;
  }
  if (gap.closedBy !== '') throw new GapError(1, `${gap.id} is closed by ${gap.closedBy}`);
  save(file, replaceLine(text, gap.line, row([gap.id, gap.cls, gap.where, gap.what, closedBy])));
  return { id: gap.id, closedBy };
}
