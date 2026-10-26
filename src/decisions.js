// Decision rows (REQ-1.4): one row per decision in `<docsRoot>/decisions.md`, with an ID, a type,
// who answered and when. A row of the Open table is open, whatever its Type; settling moves it to
// the Settled table under the same ID. A settled row is never rewritten: a reversal is a new row
// that names the one it replaces.
import fs from 'node:fs';
import path from 'node:path';
import { exists, listFiles, readText } from './fs.js';
import { git } from './git.js';
import { headings, prose, tableCells as cells } from './markdown.js';
import { kitPaths } from './paths.js';

export const TYPES = ['Decision', 'Action', 'Information', 'Counsel', 'Open'];

// `code` 1: a file problem (missing file or table, wrong columns, a settled row). `code` 2: bad input.
export class DecisionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DecisionError';
    this.code = code;
  }
}

const SECTIONS = { settled: 'Settled', open: 'Open' };
// The columns of each table, as `templates/docs/decisions.md` writes them.
const COLUMNS = {
  settled: ['#', 'Type', 'Question', 'Answer', 'Who, when'],
  open: ['#', 'Type', 'Question', 'Why it matters', 'Recommendation'],
};
const ID = /^D-(\d+)$/;

const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isDivider = (l) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(l);

// Each section's table: `{header: [cells], rows: [{line, cells}], last}` with 1-based lines, `last`
// the line after which a new row goes. Null for a section or table that is absent.
function sections(text) {
  const all = text.replace(/^﻿/, '').split(/\r?\n/);
  const hs = headings(text);
  const inProse = new Set([...prose(text)].map(([, n]) => n));
  const out = { settled: null, open: null };
  for (const [key, name] of Object.entries(SECTIONS)) {
    const i = hs.findIndex((h) => h.level === 2 && h.text.toLowerCase() === name.toLowerCase());
    if (i === -1) continue;
    const start = hs[i].line + 1;
    const end = i + 1 < hs.length ? hs[i + 1].line - 1 : all.length;
    for (let n = start; n < end; n++) {
      if (!inProse.has(n) || !isRow(all[n - 1]) || !isDivider(all[n] ?? '')) continue;
      const rows = [];
      let m = n + 2;
      while (m <= end && inProse.has(m) && isRow(all[m - 1])) {
        rows.push({ line: m, cells: cells(all[m - 1]) });
        m++;
      }
      out[key] = { header: cells(all[n - 1]), rows, last: m - 1 };
      break;
    }
  }
  return out;
}

// `{rows, next}`. `next` is the highest number plus one, zero-padded to the widest ID already used.
export function readDecisions(text) {
  const rows = [];
  const found = sections(text);
  for (const table of ['settled', 'open']) {
    for (const { line, cells: c } of found[table]?.rows ?? []) {
      const m = ID.exec(c[0] ?? '');
      if (!m) continue;
      const base = { id: c[0], n: Number(m[1]), table, type: c[1] ?? '', question: c[2] ?? '', line };
      rows.push(
        table === 'settled'
          ? { ...base, answer: c[3] ?? '', who: c[4] ?? '', why: null, recommendation: null }
          : { ...base, answer: null, who: null, why: c[3] ?? '', recommendation: c[4] ?? '' },
      );
    }
  }
  return { rows, next: nextId('D', rows) };
}

// The next ID after `rows` (each `{id, n}`): the highest number plus one, zero-padded to the widest
// ID already used. `gaps.md` numbers its rows the same way.
export function nextId(prefix, rows) {
  const width = Math.max(1, ...rows.map((r) => r.id.length - prefix.length - 1));
  const high = Math.max(0, ...rows.map((r) => r.n));
  return `${prefix}-${String(high + 1).padStart(width, '0')}`;
}

export const posix = (p) => p.split(path.sep).join('/');

function load(root, cfg) {
  const file = kitPaths(root, cfg).decisions;
  if (!exists(file)) throw new DecisionError(1, `${posix(path.relative(root, file))} is missing; run slicekit init`);
  return { file, text: fs.readFileSync(file, 'utf8') };
}

// Writes a temporary file in the same directory, then renames it over the file, so a reader never
// sees half a file.
export function save(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function oneLine(field, value) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') throw new DecisionError(2, `${field} must be text`);
  if (/[\r\n]/.test(value)) throw new DecisionError(2, `${field} must be one line`);
}

export const escape = (s) => s.trim().replace(/\|/g, '\\|');
export const row = (cs) => `| ${cs.map(escape).join(' | ')} |`;

function whoDefault(root) {
  try {
    return git(root, ['config', 'user.name']) || 'unknown';
  } catch {
    return 'unknown';
  }
}

const todayUtc = () => new Date().toISOString().slice(0, 10);
const whoWhen = (root, who, today) => `${(who ?? whoDefault(root)).trim() || 'unknown'}, ${today ?? todayUtc()}`;

// The file's lines, each with its own ending. A new line takes the first line's ending; no other
// line's ending changes, except that a last line with no ending gets one when a line follows it.
export const split = (text) => text.split(/(?<=\n)/);

export function insertAfter(text, after, line) {
  const parts = split(text);
  const eol = parts[0]?.endsWith('\r\n') ? '\r\n' : '\n';
  const prev = parts[after - 1];
  if (prev !== undefined && !prev.endsWith('\n')) parts[after - 1] = prev + eol;
  parts.splice(after, 0, line + eol);
  return parts.join('');
}

function removeLine(text, n) {
  const parts = split(text);
  parts.splice(n - 1, 1);
  return parts.join('');
}

// The table under `## <name>`, refused when absent or when its columns are not the template's.
function table(found, key) {
  const t = found[key];
  if (!t) throw new DecisionError(1, `decisions.md has no ${SECTIONS[key]} table`);
  const want = COLUMNS[key];
  if (t.header.length !== want.length || t.header.some((h, i) => h !== want[i])) {
    throw new DecisionError(1, `decisions table ${SECTIONS[key]} has columns ${t.header.join(' | ')}; expected ${want.join(' | ')}`);
  }
  return t;
}

function byNumber(rows, id) {
  const m = ID.exec(id ?? '');
  return m ? rows.find((r) => r.n === Number(m[1])) : undefined;
}

const SOURCE = /^\S+:\d+$/;

// `open: true`, or type Open, puts the row in the Open table, where it keeps its real Type.
export function addDecision(root, cfg, opts) {
  const { question, answer, why, recommendation, replaces, iface, today } = opts;
  const open = Boolean(opts.open) || opts.type === 'Open';
  const type = opts.type ?? (open ? 'Open' : undefined);
  if (!TYPES.includes(type)) throw new DecisionError(2, `unknown type '${type}'; one of ${TYPES.join(', ')}`);
  for (const field of ['question', 'answer', 'why', 'recommendation', 'who', 'replaces', 'today']) oneLine(field, opts[field]);
  if (iface) {
    oneLine('interface', iface.name);
    oneLine('source', iface.source);
  }
  if (!question?.trim()) throw new DecisionError(2, 'question is required');
  if (open) {
    if (!why?.trim() || !recommendation?.trim()) throw new DecisionError(2, 'an open row needs why and recommendation');
    if (answer !== undefined) throw new DecisionError(2, 'an open row takes why and recommendation, not answer');
  } else {
    if (!answer?.trim()) throw new DecisionError(2, `a ${type} row needs answer`);
    if (why !== undefined || recommendation !== undefined) throw new DecisionError(2, `a ${type} row takes answer, not why or recommendation`);
  }
  if (iface) {
    if (!iface.name?.trim()) throw new DecisionError(2, 'interface needs a name');
    if (/\.( |$)/.test(iface.name.trim())) throw new DecisionError(2, 'interface name must not hold ". " or end in "."');
    if (iface.source !== undefined && !SOURCE.test(iface.source)) throw new DecisionError(2, 'source must be <file>:<line>');
  }

  const { file, text } = load(root, cfg);
  const { rows, next: id } = readDecisions(text);
  let replaced;
  if (replaces !== undefined) {
    replaced = byNumber(rows, replaces);
    if (!replaced) throw new DecisionError(2, `unknown decision ${replaces}`);
    if (replaced.table === 'open') throw new DecisionError(2, `${replaced.id} is still open; settle it instead`);
  }
  const target = table(sections(text), open ? 'open' : 'settled');

  let q = question.trim();
  if (replaced) q = `Replaces ${replaced.id}. ${q}`;
  if (iface) q = `Interface: ${iface.name.trim()}. ${q}`;
  const named = iface?.source !== undefined ? ` Named at ${iface.source}.` : '';
  const cellsOut = open
    ? [id, type, q, `${why.trim()}${named}`, recommendation]
    : [id, type, q, `${answer.trim()}${named}`, whoWhen(root, opts.who, today)];
  save(file, insertAfter(text, target.last, row(cellsOut)));
  return { id };
}

const NAMED_AT = /\s*\bNamed at (\S+:\d+)\.$/;
const sentence = (s) => (s ?? '').trim().replace(/\.+$/, '');

// The Settled answer of a settled open row: the answer, then the open row's reasons in brackets
// (an empty part left out), then the `Named at` source, so an interface row keeps it.
function settledAnswer(answer, why, recommendation) {
  const source = NAMED_AT.exec(why);
  const parts = [];
  const reason = sentence(why.replace(NAMED_AT, ''));
  if (reason) parts.push(`Asked because: ${reason}.`);
  if (sentence(recommendation)) parts.push(`Recommended: ${sentence(recommendation)}.`);
  const own = NAMED_AT.exec(answer.trim());
  let out = answer.trim().replace(NAMED_AT, '');
  if (parts.length > 0) out += ` (${parts.join(' ')})`;
  const where = own ?? source;
  return where ? `${out} Named at ${where[1]}.` : out;
}

// Moves an Open-table row to Settled under the same ID. A row whose Type is Open (or not a known
// Type) needs `type`, one of the other Types; any other row keeps its Type, and a different
// `type` is refused.
export function settleDecision(root, cfg, id, { answer, who, today, type } = {}) {
  for (const [field, value] of Object.entries({ answer, who, today, type })) oneLine(field, value);
  if (!answer?.trim()) throw new DecisionError(2, 'settle needs answer');
  const settledTypes = TYPES.filter((t) => t !== 'Open');
  if (type !== undefined && !settledTypes.includes(type)) {
    throw new DecisionError(2, `settle --type must be one of ${settledTypes.join(', ')}`);
  }
  const { file, text } = load(root, cfg);
  const found = byNumber(readDecisions(text).rows, id);
  if (!found) throw new DecisionError(2, `unknown decision ${id}`);
  if (found.table === 'settled') {
    throw new DecisionError(1, `${found.id} is settled; a reversal is a new row (decide add --replaces ${found.id})`);
  }
  const known = settledTypes.includes(found.type);
  if (!known && type === undefined) throw new DecisionError(2, `${found.id} has Type ${found.type || '(empty)'}; settle with --type`);
  if (known && type !== undefined && type !== found.type) {
    throw new DecisionError(2, `${found.id} has Type ${found.type}; settle keeps it`);
  }
  const found2 = sections(text);
  table(found2, 'open');
  table(found2, 'settled');
  const line = row([found.id, known ? found.type : type, found.question, settledAnswer(answer, found.why, found.recommendation), whoWhen(root, who, today)]);
  const without = removeLine(text, found.line);
  save(file, insertAfter(without, table(sections(without), 'settled').last, line));
  return { id: found.id };
}

const INTERFACE = /^Interface: (.+?)\.(?: |$)/;

function interfaceRows(text) {
  return readDecisions(text)
    .rows.map((r) => {
      const m = INTERFACE.exec(r.question);
      if (!m) return null;
      const s = NAMED_AT.exec(r.answer ?? r.why ?? '');
      return { id: r.id, name: m[1], source: s ? s[1] : null, line: r.line };
    })
    .filter(Boolean);
}

// The rows whose question begins `Interface: `, with the `Named at` source or null.
export const interfacesNamed = (text) => interfaceRows(text).map(({ id, name, source }) => ({ id, name, source }));

// Each interface row that no contract under `<docsRoot>/spec/contracts/` names on its `Cites:` line.
export function interfacesWithoutContract(root, cfg) {
  const { text } = load(root, cfg);
  const dir = kitPaths(root, cfg).contracts;
  const cited = new Set();
  const files = exists(dir) ? listFiles(dir, { ext: '.md' }).map((f) => path.join(dir, f)) : [];
  for (const f of files) {
    for (const [l] of prose(readText(f))) {
      if (!/^\s*Cites:/.test(l)) continue;
      for (const m of l.matchAll(/\bD-(\d+)\b/g)) cited.add(Number(m[1]));
    }
  }
  return interfaceRows(text).filter((i) => !cited.has(Number(ID.exec(i.id)[1])));
}
