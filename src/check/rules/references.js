import fs from 'node:fs';
import path from 'node:path';
import { headings, isPathLike, refs } from '../../markdown.js';

export const id = 'references';
export const blocking = true;
export const ratchet = true;

const EXAMPLE = '<!-- slicekit:example -->';

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

// The absolute path a target names, tried against the doc's directory and then the root; a
// leading `/` is the root only. Null when neither exists.
function resolve(ctx, doc, target) {
  const rel = decode(target);
  const tries = rel.startsWith('/') ? [path.join(ctx.root, rel)] : [path.resolve(path.dirname(doc.path), rel), path.resolve(ctx.root, rel)];
  return tries.find((p) => fs.existsSync(p)) ?? null;
}

export function run(ctx) {
  const findings = [];
  const slugCache = new Map();
  const docByPath = new Map(ctx.docs.map((d) => [path.resolve(d.path), d]));
  const slugsOf = (abs) => {
    if (!slugCache.has(abs)) {
      const text = docByPath.get(abs)?.text ?? fs.readFileSync(abs, 'utf8');
      slugCache.set(abs, slugs(text));
    }
    return slugCache.get(abs);
  };

  for (const doc of ctx.docs) {
    const seen = new Set();
    const add = (line, message) => {
      const key = `${line} ${message}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({ rule: id, file: doc.rel, line, message, bucket: doc.rel });
    };
    for (const ref of refs(doc.text)) {
      if ((doc.lines[ref.line - 1] ?? '').includes(EXAMPLE)) continue;
      if (ref.kind === 'path') {
        if (isPathLike(ref.value) && !resolve(ctx, doc, ref.value)) add(ref.line, `missing file ${ref.value}`);
      } else if (ref.kind === 'anchor') {
        if (!/\.md$/i.test(ref.file)) continue;
        const abs = resolve(ctx, doc, ref.file);
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
