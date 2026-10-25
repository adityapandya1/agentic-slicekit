// Decision rows (REQ-1.4): one row per decision in `<docsRoot>/decisions.md`, with an ID, a type,
// who answered and when. A row of the Open table is open, whatever its Type; settling moves it to
// the Settled table under the same ID. A settled row is never rewritten: a reversal is a new row
// that names the one it replaces.
import fs from 'node:fs';
import path from 'node:path';
import { exists, listFiles, readText } from './fs.js';
import { git } from './git.js';
import { headings, prose } from './markdown.js';
import { kitPaths } from './paths.js';

export const TYPES = ['Decision', 'Action', 'Information', 'Counsel', 'Open'];

// `code` 1: a file problem (missing file or table, a settled row). `code` 2: bad input.
export class DecisionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DecisionError';
    this.code = code;
  }
}

const SECTIONS = { settled: 'Settled', open: 'Open' };
const ID = /^D-(\d+)$/;

// Splits a table row on each `|` that is not escaped, then reads `\|` as `|`.
function cells(line) {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isDivider = (l) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(l);

// Each section's table: `{header, divider, rows: [{line, cells}], last}` with 1-based lines, `last`
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
      out[key] = { header: n, rows, last: m - 1 };
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
  const width = Math.max(1, ...rows.map((r) => r.id.length - 2));
  const high = Math.max(0, ...rows.map((r) => r.n));
  return { rows, next: `D-${String(high + 1).padStart(width, '0')}` };
}

const posix = (p) => p.split(path.sep).join('/');

function load(root, cfg) {
  const file = kitPaths(root, cfg).decisions;
  if (!exists(file)) throw new DecisionError(1, `${posix(path.relative(root, file))} is missing; run slicekit init`);
  return { file, text: fs.readFileSync(file, 'utf8') };
}

function oneLine(field, value) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') throw new DecisionError(2, `${field} must be text`);
  if (/[\r\n]/.test(value)) throw new DecisionError(2, `${field} must be one line`);
}

const escape = (s) => s.trim().replace(/\|/g, '\\|');
const row = (cs) => `| ${cs.map(escape).join(' | ')} |`;

function whoDefault(root) {
  try {
    return git(root, ['config', 'user.name']) || 'unknown';
  } catch {
    return 'unknown';
  }
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

// Inserts `line` after line `after` (1-based), keeping the file's line endings.
function insertAfter(text, after, line) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const all = text.split(/\r?\n/);
  all.splice(after, 0, line);
  return all.join(eol);
}

function removeLine(text, n) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const all = text.split(/\r?\n/);
  all.splice(n - 1, 1);
  return all.join(eol);
}

function table(found, key) {
  if (!found[key]) throw new DecisionError(1, `decisions.md has no ${SECTIONS[key]} table`);
  return found[key];
}

const SOURCE = /^\S+:\d+$/;

export function addDecision(root, cfg, opts) {
  const { type, question, answer, why, recommendation, replaces, iface, today } = opts;
  if (!TYPES.includes(type)) throw new DecisionError(2, `unknown type '${type}'; one of ${TYPES.join(', ')}`);
  for (const field of ['question', 'answer', 'why', 'recommendation', 'who', 'replaces', 'today']) oneLine(field, opts[field]);
  if (iface) {
    oneLine('interface', iface.name);
    oneLine('source', iface.source);
  }
  if (!question?.trim()) throw new DecisionError(2, 'question is required');
  if (type === 'Open') {
    if (!why?.trim() || !recommendation?.trim()) throw new DecisionError(2, 'an Open row needs why and recommendation');
    if (answer !== undefined) throw new DecisionError(2, 'an Open row takes why and recommendation, not answer');
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
  const { rows } = readDecisions(text);
  if (replaces !== undefined) {
    const m = ID.exec(replaces);
    if (!m || !rows.some((r) => r.n === Number(m[1]))) throw new DecisionError(2, `unknown decision ${replaces}`);
  }
  const key = type === 'Open' ? 'open' : 'settled';
  const target = table(sections(text), key);
  const { next: id } = readDecisions(text);

  let q = question.trim();
  if (replaces !== undefined) q = `Replaces ${replaces}. ${q}`;
  if (iface) q = `Interface: ${iface.name.trim()}. ${q}`;
  const named = iface?.source !== undefined ? ` Named at ${iface.source}.` : '';
  const cellsOut =
    type === 'Open'
      ? [id, type, q, `${why.trim()}${named}`, recommendation]
      : [id, type, q, `${answer.trim()}${named}`, `${(opts.who ?? whoDefault(root)).trim() || 'unknown'}, ${today ?? todayUtc()}`];
  fs.writeFileSync(file, insertAfter(text, target.last, row(cellsOut)));
  return { id };
}

const NAMED_AT = /\bNamed at (\S+:\d+)\.$/;

// Moves an Open-table row to Settled under the same ID, keeping its Type. A `Named at` source in
// the Why cell carries over to the answer, so an interface row keeps its source.
export function settleDecision(root, cfg, id, { answer, who, today } = {}) {
  oneLine('answer', answer);
  oneLine('who', who);
  oneLine('today', today);
  if (!answer?.trim()) throw new DecisionError(2, 'settle needs answer');
  const { file, text } = load(root, cfg);
  const m = ID.exec(id ?? '');
  const found = m ? readDecisions(text).rows.find((r) => r.n === Number(m[1])) : undefined;
  if (!found) throw new DecisionError(2, `unknown decision ${id}`);
  if (found.table === 'settled') {
    throw new DecisionError(1, `${found.id} is settled; a reversal is a new row (decide add --replaces ${found.id})`);
  }
  table(sections(text), 'settled');
  const source = NAMED_AT.exec(found.why);
  const kept = source && !NAMED_AT.test(answer.trim()) ? ` Named at ${source[1]}.` : '';
  const line = row([found.id, found.type, found.question, `${answer.trim()}${kept}`, `${(who ?? whoDefault(root)).trim() || 'unknown'}, ${today ?? todayUtc()}`]);
  const without = removeLine(text, found.line);
  fs.writeFileSync(file, insertAfter(without, table(sections(without), 'settled').last, line));
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
