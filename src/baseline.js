import fs from 'node:fs';
import path from 'node:path';
import { readText, writeText } from './fs.js';

const dirOf = (root) => path.join(root, '.slicekit', 'baselines');
const fileOf = (root, rule) => path.join(dirOf(root), `${rule}.json`);

const count = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);

// A baseline file is `{ "<bucket>": n }`. Anything unreadable reads as `{}` (every bucket at zero,
// the strictest reading) and is reported in `problems`, so a damaged file can only make the gate
// fail, never pass. A value that is not a non-negative integer reads as zero.
function readFile(file) {
  let data;
  try {
    data = JSON.parse(readText(file));
  } catch {
    return { buckets: {}, damaged: true };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { buckets: {}, damaged: true };
  const buckets = {};
  for (const [k, v] of Object.entries(data)) buckets[k] = count(v);
  return { buckets, damaged: false };
}

// `{ baselines: { [rule]: { [bucket]: n } }, problems: string[] }` for every `*.json` in the folder.
export function readBaselinesWithProblems(root) {
  const dir = dirOf(root);
  const baselines = {};
  const problems = [];
  if (!fs.existsSync(dir)) return { baselines, problems };
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const { buckets, damaged } = readFile(path.join(dir, name));
    baselines[name.slice(0, -'.json'.length)] = buckets;
    if (damaged) problems.push(`baseline ${name} is not valid JSON`);
  }
  return { baselines, problems };
}

export function readBaselines(root) {
  return readBaselinesWithProblems(root).baselines;
}

const sortedJson = (buckets) => {
  const out = {};
  for (const k of Object.keys(buckets).sort()) out[k] = buckets[k];
  return `${JSON.stringify(out, null, 2)}\n`;
};

// Baselines only go down. For each rule in `counts`, a bucket whose new count is at or below its
// baseline is kept at the new count; one that is higher is refused and keeps its old value; one
// that no longer appears is now zero and is removed. A bucket with no baseline reads as zero, so a
// new bucket with findings is refused too: it would raise the count from zero.
export function updateBaselines(root, counts) {
  const written = [];
  const refused = [];
  for (const rule of Object.keys(counts ?? {}).sort()) {
    const file = fileOf(root, rule);
    const old = fs.existsSync(file) ? readFile(file).buckets : {};
    const next = {};
    const mine = [];
    for (const bucket of new Set([...Object.keys(old), ...Object.keys(counts[rule])])) {
      const from = count(old[bucket]);
      const to = count(counts[rule][bucket]);
      if (to > from) {
        refused.push({ rule, bucket, from, to });
        if (bucket in old) next[bucket] = old[bucket];
      } else {
        if (to > 0) next[bucket] = to;
        if (to !== from) mine.push({ rule, bucket, from, to });
      }
    }
    const changed = mine.length > 0 || Object.keys(next).length !== Object.keys(old).length;
    if (changed) writeText(file, sortedJson(next));
    written.push(...mine);
  }
  const byKey = (a, b) => (a.rule + '\0' + a.bucket < b.rule + '\0' + b.bucket ? -1 : 1);
  return { written: written.sort(byKey), refused: refused.sort(byKey) };
}
