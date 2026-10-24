import path from 'node:path';
import { exists, readText } from '../fs.js';
import { entriesForShape } from './manifest.js';
import { compareManaged, managedPart } from './compare.js';
import { markerStyle, wrapManaged } from './managed.js';
import { loadReference, renderAll, substitute, TEMPLATES } from './index.js';

const CONTEXT = 3;

// Minimal unified-style diff by line LCS: '-' removed, '+' added, ' ' context, '@@' between far hunks.
export function diffLines(a, b) {
  const split = (s) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'));
  const x = split(a);
  const y = split(b);
  const lcs = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      ops.push([' ', x[i]]);
      i++;
      j++;
    } else if (j < y.length && (i === x.length || lcs[i][j + 1] >= lcs[i + 1][j])) ops.push(['+', y[j++]]);
    else ops.push(['-', x[i++]]);
  }
  const keep = ops.map(() => false);
  ops.forEach(([sign], k) => {
    if (sign === ' ') return;
    for (let n = Math.max(0, k - CONTEXT); n <= Math.min(ops.length - 1, k + CONTEXT); n++) keep[n] = true;
  });
  const out = [];
  let skipped = false;
  ops.forEach(([sign, line], k) => {
    if (!keep[k]) {
      skipped = out.length > 0;
      return;
    }
    if (skipped) out.push('@@');
    skipped = false;
    out.push(`${sign}${line}`);
  });
  return out.length === 0 ? '' : `${out.join('\n')}\n`;
}

// opts.entries and opts.templates render from another manifest (tests, future renderers).
export function planUpdate(root, cfg, { version, entries = entriesForShape(cfg.shape), templates = TEMPLATES }) {
  const vars = { version, name: cfg.name, docsRoot: cfg.docsRoot, cli: cfg.cli };
  return entries.map(({ src, dest }) => {
    const rendered = substitute(readText(path.join(templates, src)), vars);
    const style = markerStyle(dest, rendered);
    const fresh = wrapManaged(rendered, { version, style });
    const file = path.join(root, dest);
    const current = exists(file) ? readText(file) : null;
    const verdict = compareManaged({ dest, current, reference: loadReference(root, dest), style });
    if (verdict === 'missing' || verdict === 'unmanaged') return { dest, status: verdict, diff: '' };
    const have = managedPart(current, style);
    const want = managedPart(fresh, style);
    if (verdict === 'drifted') return { dest, status: 'drifted', diff: diffLines(have, want) };
    if (have === want) return { dest, status: 'same', diff: '' };
    return { dest, status: 'changed', diff: diffLines(have, want) };
  });
}

// Writes changed and missing files; drifted ones only with force; never an unmanaged one.
// The plan says what to expect; renderAll applies the same comparison and refreshes the reference copies and settings.json.
export function applyUpdate(root, cfg, _plan, { version, force = false, entries, templates }) {
  const options = { version, force };
  if (entries) options.entries = entries;
  if (templates) options.templates = templates;
  return renderAll(root, cfg, options)
    .filter((r) => r.action === 'created' || r.action === 'updated')
    .map((r) => r.dest);
}
