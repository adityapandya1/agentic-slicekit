import fs from 'node:fs';
import path from 'node:path';
import { exists, readText, writeText } from '../fs.js';
import { entriesForShape } from './manifest.js';
import { managedPart } from './compare.js';
import { RENDERED, SETTINGS, TEMPLATES, renderEntry, loadHooks, loadReference, varsFor } from './entry.js';
import { mergeSettings, ourEntries, ourPrefixes, readSettings } from './settings.js';

const CONTEXT = 3;
const NO_EOL = '\\ No newline at end of file';

// Minimal unified-style diff by line LCS: '-' removed, '+' added, ' ' context, '@@' between far hunks.
export function diffLines(a, b) {
  if (a === b) return '';
  const split = (s) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'));
  const x = split(a);
  const y = split(b);
  if (x.join('\n') === y.join('\n')) {
    // Only the trailing newline differs.
    const last = x[x.length - 1];
    return `-${last}\n${a.endsWith('\n') ? '' : `${NO_EOL}\n`}+${last}\n${b.endsWith('\n') ? '' : `${NO_EOL}\n`}`;
  }
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
    } else if (j < y.length && (i === x.length || lcs[i][j + 1] > lcs[i + 1][j])) ops.push(['+', y[j++]]);
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

function fileItem(root, cfg, entry, opts) {
  const { dest, current, reference, verdict, next, fresh, style } = renderEntry(root, cfg, entry, opts);
  // With no reference copy the verdict was taken against the fresh render.
  const base = { dest, next, current, reference, refText: next, noReference: reference === null };
  if (verdict === 'missing' || verdict === 'unmanaged') return { ...base, status: verdict, diff: '' };
  const diff = diffLines(managedPart(current, style), managedPart(fresh, style));
  if (verdict === 'drifted') return { ...base, status: 'drifted', diff };
  return { ...base, status: next === current ? 'same' : 'changed', diff };
}

// settings.json is judged by its slicekit hook entries: those are the gate, so a removed or altered
// one is drift. A version bump or a newly added event is an ordinary change. The reference copy is
// the hooks slicekit last wrote.
function settingsItem(root, cfg, { version, templates }) {
  const hooks = loadHooks(templates, varsFor(cfg, version));
  const existing = readSettings(root);
  const next = `${JSON.stringify(mergeSettings(existing, hooks, { version, cli: cfg.cli }), null, 2)}\n`;
  const file = path.join(root, SETTINGS);
  const current = exists(file) ? readText(file) : null;
  const refText = `${JSON.stringify({ hooks }, null, 2)}\n`;
  const reference = loadReference(root, SETTINGS);
  const base = { dest: SETTINGS, next, current, reference, refText, noReference: reference === null };
  if (current === null) return { ...base, status: 'missing', diff: '' };
  if (current === next) return { ...base, status: 'same', diff: '' };
  const diff = diffLines(current, next);
  if (!existing?._slicekit) return { ...base, status: 'changed', diff };
  const prefixes = ourPrefixes(existing, cfg.cli);
  let baseline;
  try {
    baseline = reference === null ? { hooks } : JSON.parse(reference);
  } catch {
    baseline = { hooks };
  }
  const drifted = JSON.stringify(ourEntries(existing, prefixes)) !== JSON.stringify(ourEntries(baseline, prefixes));
  return { ...base, status: drifted ? 'drifted' : 'changed', diff };
}

// opts.entries and opts.templates render from another manifest (tests, future renderers).
// The settings item is planned only when the template root holds hooks.json (or opts.settings is true):
// a template root without hooks.json renders files only and never touches .claude/settings.json.
// Each item carries { dest, status, diff } plus what applyUpdate needs to write it.
export function planUpdate(root, cfg, { version, entries = entriesForShape(cfg.shape), templates = TEMPLATES, settings }) {
  const opts = { version, templates };
  const items = entries.map((entry) => fileItem(root, cfg, entry, opts));
  if (settings ?? exists(path.join(templates, 'hooks.json'))) items.push(settingsItem(root, cfg, opts));
  return items;
}

const WARNING = {
  drifted: (dest) => `${dest} was edited since slicekit wrote it; left untouched (slicekit update --force overwrites)`,
  noReference: (dest) => `no reference copy for ${dest}; cannot tell a kit change from an edit; slicekit update --force overwrites`,
  unmanaged: (dest) => `${dest} exists and is not managed by slicekit; left untouched`,
};

// Every reference directory except the current version's.
function pruneReferences(renderedRoot, version) {
  for (const entry of fs.readdirSync(renderedRoot)) {
    if (entry !== version) fs.rmSync(path.join(renderedRoot, entry), { recursive: true, force: true });
  }
}

// Writes exactly the entries the plan marked changed or missing, and drifted ones only with force.
// Then writes the new reference directory whole, and only after that prunes the old ones, so an
// interrupted run leaves a complete reference behind. opts.prune replaces the prune step (tests).
// Returns { written: [dest], skipped: [{dest, status, warning}] }.
export function applyUpdate(root, cfg, plan, { version, force = false, prune = pruneReferences }) {
  const written = [];
  const skipped = [];
  const copies = [];
  for (const item of plan) {
    const writable = item.status === 'changed' || item.status === 'missing' || (item.status === 'drifted' && force);
    if (writable) {
      writeText(path.join(root, item.dest), item.next);
      written.push(item.dest);
      copies.push([item.dest, item.refText]);
    } else if (item.status === 'same') {
      copies.push([item.dest, item.dest === SETTINGS ? item.refText : item.current]);
    } else {
      const kind = item.status === 'drifted' && item.noReference ? 'noReference' : item.status;
      skipped.push({ dest: item.dest, status: item.status, warning: WARNING[kind](item.dest) });
      // Carry the old reference forward so the edit is still seen next time.
      if (item.status === 'drifted' && item.reference !== null) copies.push([item.dest, item.reference]);
    }
  }
  const renderedRoot = path.join(root, RENDERED);
  for (const [dest, text] of copies) writeText(path.join(renderedRoot, version, dest), text);
  if (exists(renderedRoot)) prune(renderedRoot, version);
  return { written, skipped };
}
