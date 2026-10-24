import { ID } from './ids.js';

export function lines(text) {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
}

const FENCE = /^\s*(```|~~~)/;

// Yields [line, number] for every line outside fenced code blocks (1-based).
function* prose(text) {
  let inFence = false;
  const all = lines(text);
  for (let i = 0; i < all.length; i++) {
    if (FENCE.test(all[i])) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) yield [all[i], i + 1];
  }
}

export function headings(text) {
  const out = [];
  for (const [line, n] of prose(text)) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], line: n });
  }
  return out;
}

export function frontMatter(text) {
  const all = lines(text);
  const plain = all.join('\n');
  if (all[0] !== '---') return { data: {}, body: plain };
  const end = all.indexOf('---', 1);
  if (end === -1) return { data: {}, body: plain };
  const data = {};
  let listKey = null;
  for (const line of all.slice(1, end)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(item[1].trim());
      continue;
    }
    const kv = /^([^:\s][^:]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === '') {
      listKey = key;
      data[key] = [];
    } else {
      listKey = null;
      const list = /^\[(.*)\]$/.exec(value.trim());
      data[key] = list ? list[1].split(',').map((s) => s.trim()).filter((s) => s !== '') : value.trim();
    }
  }
  return { data, body: all.slice(end + 1).join('\n') };
}

const cells = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isDivider = (l) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(l);

export function tables(text) {
  const all = lines(text);
  const fenced = [];
  let inFence = false;
  for (const l of all) {
    if (FENCE.test(l)) {
      inFence = !inFence;
      fenced.push(true);
    } else {
      fenced.push(inFence);
    }
  }
  const out = [];
  for (let i = 0; i < all.length - 1; i++) {
    if (!fenced[i] && !fenced[i + 1] && isRow(all[i]) && isDivider(all[i + 1])) {
      const rows = [];
      let j = i + 2;
      while (j < all.length && !fenced[j] && isRow(all[j])) rows.push(cells(all[j++]));
      out.push({ line: i + 1, header: cells(all[i]), rows });
      i = j - 1;
    }
  }
  return out;
}

// A link target: one level of balanced parentheses (`a(b).md`), then an optional title.
const LINK = /\[[^\]]*\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const CODE_SPAN = /`[^`]*`/g;

// A target the reader cannot resolve to one file: a URL, a `<placeholder>` or a glob.
export function isPathLike(target) {
  return !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.includes('://') && !/[<>*?{}]/.test(target);
}

// Paths, anchors and ids outside fenced code. A link written inside a code span is not a link; a
// reference-style link (`[t][ref]`) is not followed. An anchor carries the file it points into.
export function refs(text) {
  const out = [];
  const idRe = new RegExp(
    `\\b(?:${ID.req}|${ID.sliceAddr}|${ID.decision}|${ID.gap}|${ID.contract})\\b`,
    'g',
  );
  for (const [line, n] of prose(text)) {
    const outsideCode = line.replace(CODE_SPAN, (m) => ' '.repeat(m.length));
    for (const m of outsideCode.matchAll(LINK)) {
      const target = m[1];
      if (target.startsWith('#') || !isPathLike(target)) continue;
      const hash = target.indexOf('#');
      const file = hash === -1 ? target : target.slice(0, hash);
      const anchor = hash === -1 ? '' : target.slice(hash + 1);
      if (file) out.push({ kind: 'path', value: file, line: n });
      if (file && anchor) out.push({ kind: 'anchor', value: anchor, file, line: n });
    }
    for (const m of line.matchAll(/`([^`\s]+)`/g)) {
      const token = m[1];
      if (token.includes('/') && (token.endsWith('/') || /\.[A-Za-z0-9]+$/.test(token)) && isPathLike(token)) {
        out.push({ kind: 'path', value: token, line: n });
      }
    }
    for (const m of line.matchAll(idRe)) out.push({ kind: 'id', value: m[0], line: n });
  }
  return out;
}
