import fs from 'node:fs';
import path from 'node:path';
import { parseSliceAddr } from '../../ids.js';
import { frontMatter, headings, isPathLike, refs, toSlashes } from '../../markdown.js';
import { findSliceFiles } from '../../slicefile.js';
import { readSlice } from '../../state/index.js';

export const id = 'references';
export const blocking = true;
export const ratchet = true;

const EXAMPLE = '<!-- slicekit:example -->';
const DONE = new Set(['merged', 'released']);

// Which `ctx.ids` set an id belongs to, by its prefix.
const KIND = [
  [/^REQ-/, 'req'],
  [/^P\d+\/S-/, 'slice'],
  [/^D-/, 'decision'],
  [/^G-/, 'gap'],
  [/^C-/, 'contract'],
];

const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// GitHub's heading anchor: lower-case, punctuation other than `-` and `_` dropped, each space a
// `-`; a repeated heading gains `-1`, `-2`.
export function slug(text) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

function slugs(text) {
  const seen = new Map();
  const out = new Set();
  for (const h of headings(text)) {
    const base = slug(h.text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

// The lines of an unmerged slice file whose code-span paths are promises: a `**Files:**` line, and
// every line under `## Expected changes` up to the next heading of level 1 or 2. Null for any
// other doc, and for a slice that is merged or released (its promises are due).
function promiseLines(ctx, doc, sliceIds) {
  const sliceId = sliceIds.get(doc.rel);
  if (!sliceId) return null;
  let state = 'todo';
  try {
    state = readSlice(ctx.root, ctx.cfg, sliceId).state;
  } catch {
    // An unreadable state file is another rule's finding; the slice is not merged.
  }
  if (DONE.has(state)) return null;
  const out = new Set();
  doc.lines.forEach((l, i) => {
    if (l.includes('**Files:**')) out.add(i + 1);
  });
  const hs = headings(doc.text);
  for (const [i, h] of hs.entries()) {
    if (h.level !== 2 || h.text.trim().toLowerCase() !== 'expected changes') continue;
    const next = hs.slice(i + 1).find((x) => x.level <= 2);
    const end = next ? next.line : doc.lines.length + 1;
    for (let n = h.line + 1; n < end; n++) out.add(n);
  }
  return out;
}

// Each slice file's address, keyed by its doc `rel`.
function sliceAddresses(ctx) {
  const out = new Map();
  let files = [];
  try {
    files = findSliceFiles(ctx.root, ctx.cfg);
  } catch {
    return out;
  }
  const byRel = new Map(ctx.docs.map((d) => [d.rel, d]));
  for (const f of files) {
    const rel = toSlashes(path.relative(ctx.root, f.path));
    const doc = byRel.get(rel);
    let addr = null;
    try {
      addr = doc ? parseSliceAddr(String(frontMatter(doc.text).data.slice ?? '')) : null;
    } catch {
      addr = null;
    }
    if (addr) out.set(rel, addr.id);
  }
  return out;
}

export function run(ctx) {
  const findings = [];
  const slugCache = new Map();
  const dirCache = new Map();
  const docByPath = new Map(ctx.docs.map((d) => [path.resolve(d.path), d]));
  const sliceIds = sliceAddresses(ctx);
  const root = path.resolve(ctx.root);

  const namesIn = (dir) => {
    if (!dirCache.has(dir)) {
      let names;
      try {
        names = new Set(fs.readdirSync(dir));
      } catch {
        names = new Set();
      }
      dirCache.set(dir, names);
    }
    return dirCache.get(dir);
  };

  // True when abs exists with exactly this spelling below the root, so a case-insensitive disk
  // gives the answer a case-sensitive one does. Outside the root only existence is checked.
  const existsExact = (abs) => {
    if (!fs.existsSync(abs)) return false;
    const rel = path.relative(root, abs);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return true;
    let dir = root;
    for (const seg of rel.split(path.sep)) {
      if (!namesIn(dir).has(seg)) return false;
      dir = path.join(dir, seg);
    }
    return true;
  };

  // The absolute path a target names, tried against the doc's directory and then the root; a
  // leading `/` is the root only. A trailing separator must name a directory. Null when none fits.
  const resolve = (doc, target) => {
    const rel = toSlashes(decode(target));
    const wantDir = rel.endsWith('/');
    const tries = rel.startsWith('/')
      ? [path.join(root, rel)]
      : [path.resolve(path.dirname(doc.path), rel), path.resolve(root, rel)];
    return tries.find((p) => existsExact(p) && (!wantDir || fs.statSync(p).isDirectory())) ?? null;
  };

  const slugsOf = (abs) => {
    if (!slugCache.has(abs)) {
      const text = docByPath.get(abs)?.text ?? fs.readFileSync(abs, 'utf8');
      slugCache.set(abs, slugs(text));
    }
    return slugCache.get(abs);
  };

  for (const doc of ctx.docs) {
    const seen = new Set();
    const promises = promiseLines(ctx, doc, sliceIds);
    const add = (line, message) => {
      const key = `${line} ${message}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({ rule: id, file: doc.rel, line, message, bucket: doc.rel });
    };
    for (const ref of refs(doc.text)) {
      if ((doc.lines[ref.line - 1] ?? '').includes(EXAMPLE)) continue;
      if (ref.kind === 'path') {
        if (ref.via === 'code' && promises?.has(ref.line)) continue;
        if (isPathLike(ref.value) && !resolve(doc, ref.value)) add(ref.line, `missing file ${ref.value}`);
      } else if (ref.kind === 'anchor') {
        if (!/\.md$/i.test(ref.file)) continue;
        const abs = resolve(doc, ref.file);
        if (!abs || !fs.statSync(abs).isFile()) continue;
        if (!slugsOf(path.resolve(abs)).has(decode(ref.value).toLowerCase())) {
          add(ref.line, `missing anchor #${ref.value} in ${ref.file}`);
        }
      } else if (ref.kind === 'id') {
        const kind = KIND.find(([re]) => re.test(ref.value))?.[1];
        if (kind && !ctx.ids[kind]?.has(ref.value)) add(ref.line, `unknown id ${ref.value}`);
      }
    }
  }
  return findings;
}

export default { id, blocking, ratchet, run };
