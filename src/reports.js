// The reports of `/slicekit ops` and `/slicekit audit` (REQ-2.13, REQ-2.14, D-57, D-58): where the
// next one goes, and how a check reads one. A report lives under .slicekit/reports, which init's
// ignore rules cover, so writing one changes no tracked file.
import fs from 'node:fs';
import path from 'node:path';
import { lines } from './markdown.js';
import { kitPaths } from './paths.js';

const posix = (p) => p.split(path.sep).join('/');
const FENCE = /^\s*(```|~~~)/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The next free report of `kind`, relative to the root with forward slashes:
// `.slicekit/reports/<kind>-<k>.md`, `k` one above the highest of that kind there, else 1. The path
// is reserved by creating the empty file with the exclusive flag, moving to the next `k` while
// another run holds it, so two runs at once never get one path. Nothing else is written.
export function nextReport(root, cfg, kind) {
  const dir = kitPaths(root, cfg).reports;
  fs.mkdirSync(dir, { recursive: true });
  const name = new RegExp(`^${escapeRe(kind)}-(\\d+)\\.md$`);
  let k = 1;
  for (const entry of fs.readdirSync(dir)) {
    const m = name.exec(entry);
    if (m && Number(m[1]) >= k) k = Number(m[1]) + 1;
  }
  for (;;) {
    const file = path.join(dir, `${kind}-${k}.md`);
    try {
      fs.closeSync(fs.openSync(file, 'wx'));
      return posix(path.relative(root, file));
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      k++;
    }
  }
}

// The `##` sections of a report outside fenced blocks: lower-case heading -> {line, lines}, `line`
// the heading's 1-based line and `lines` every line after it, as {text, line}, up to the next `#` or
// `##` heading. The first section of a name wins.
export function reportSections(text) {
  const out = new Map();
  let fenced = false;
  let current = null;
  lines(text).forEach((raw, i) => {
    if (FENCE.test(raw)) {
      fenced = !fenced;
    } else if (!fenced) {
      const m = /^(#{1,2})\s+(.*?)\s*#*\s*$/.exec(raw);
      if (m) {
        current = null;
        const key = m[2].toLowerCase();
        if (m[1].length === 2 && !out.has(key)) {
          current = { line: i + 1, lines: [] };
          out.set(key, current);
        }
        return;
      }
    }
    if (current) current.lines.push({ text: raw, line: i + 1 });
  });
  return out;
}

export const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
export const isDivider = (l) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(l);
// A row's cells; a `\|` is a pipe inside its cell.
export const cellsOf = (row) =>
  row
    .replace(/^\s*\|/, '')
    .replace(/(?<!\\)\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

// The first table of the section `heading`: {header: {cells, line}, rows: [{cells, line}]}, or null
// when the section is missing or holds no table.
export function sectionTable(text, heading) {
  const section = reportSections(text).get(heading.toLowerCase());
  if (!section) return null;
  const ls = section.lines;
  for (let i = 0; i + 1 < ls.length; i++) {
    if (!isRow(ls[i].text) || !isDivider(ls[i + 1].text)) continue;
    const rows = [];
    for (let j = i + 2; j < ls.length && isRow(ls[j].text); j++) rows.push({ cells: cellsOf(ls[j].text), line: ls[j].line });
    return { header: { cells: cellsOf(ls[i].text), line: ls[i].line }, rows };
  }
  return null;
}

// The rows of the first table of the section `heading`, the header row dropped: [{cells, line}].
export function reportTable(text, heading) {
  return sectionTable(text, heading)?.rows ?? [];
}

// Whether `<file>:<line>` names a line that exists: a file under the root with at least that many lines.
export function lineExists(root, file, line) {
  const abs = path.resolve(root, file);
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  let text;
  try {
    if (!fs.statSync(abs).isFile()) return false;
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return false;
  }
  const all = text.split('\n');
  const count = all.at(-1) === '' ? all.length - 1 : all.length;
  return Number.isInteger(line) && line >= 1 && line <= count;
}

// One `<rel>:<line> <message>` per closing line the report lacks: `Skipped:` and `Not checked:`, each
// at the start of its own line.
export function footerProblems(rel, text) {
  const all = lines(text);
  const last = Math.max(1, all.at(-1) === '' ? all.length - 1 : all.length);
  return ['Skipped:', 'Not checked:'].filter((label) => !all.some((l) => l.startsWith(label))).map((label) => `${rel}:${last} no "${label}" line`);
}

// The text of a report named on the command line, with its path as the messages print it. A path
// that is no file is `null` text.
export function readReport(root, given) {
  const abs = path.resolve(root, given);
  const rel = posix(path.relative(root, abs));
  try {
    return { rel, text: fs.readFileSync(abs, 'utf8').replace(/^﻿/, '') };
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') return { rel, text: null };
    throw e;
  }
}
