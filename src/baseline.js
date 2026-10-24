import fs from 'node:fs';
import path from 'node:path';
import { readText, writeText } from './fs.js';

const dirOf = (root) => path.join(root, '.slicekit', 'baselines');
const RULE_ID = /^[a-z0-9-]+$/;

function fileOf(root, rule) {
  if (typeof rule !== 'string' || !RULE_ID.test(rule)) throw new Error(`baseline: rule id '${rule}' must match ${RULE_ID}`);
  return path.join(dirOf(root), `${rule}.json`);
}

const count = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);

// A catalogue bucket (`catalogue` or `catalogue:<file>`) says the filler list itself lost a seed
// phrase (REQ-3.10). It is fixed in the list, never adopted, so no baseline may raise it.
const isCatalogue = (bucket) => bucket === 'catalogue' || bucket.startsWith('catalogue:');

// A baseline file is `{ "<bucket>": n }`. Anything unreadable reads as `{}` (every bucket at zero,
// the strictest reading) and a value that is not a non-negative integer reads as zero; each is
// reported in `problems` ({file, problem, damaged}), so a damaged file can only make the gate fail.
function readFile(file) {
  const name = path.basename(file);
  let data;
  try {
    data = JSON.parse(readText(file));
  } catch {
    return { buckets: {}, problems: [{ file: name, problem: 'is not valid JSON', damaged: true }] };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { buckets: {}, problems: [{ file: name, problem: 'is not a JSON object of counts', damaged: true }] };
  }
  const buckets = {};
  const problems = [];
  for (const [k, v] of Object.entries(data)) {
    buckets[k] = count(v);
    if (!(Number.isInteger(v) && v >= 0)) {
      problems.push({ file: name, problem: `${k} is not a non-negative integer (read as 0)`, damaged: false });
    }
  }
  return { buckets, problems };
}

// `{ baselines: { [rule]: { [bucket]: n } }, problems: [{file, problem, damaged}] }` for every `*.json`.
export function readBaselinesWithProblems(root) {
  const dir = dirOf(root);
  const baselines = {};
  const problems = [];
  if (!fs.existsSync(dir)) return { baselines, problems };
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const r = readFile(path.join(dir, name));
    baselines[name.slice(0, -'.json'.length)] = r.buckets;
    problems.push(...r.problems);
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
// that no longer appears is now zero and is removed (reported with to: 0). A bucket with no
// baseline reads as zero, so a new bucket with findings is refused too. With `adopt` (a first
// adoption, from a developer machine) a higher count is written and returned in `adopted`, and a
// damaged or invalid file is rewritten from the counts and returned in `rewrote`.
export function updateBaselines(root, counts, { adopt = false } = {}) {
  const written = [];
  const refused = [];
  const adopted = [];
  const rewrote = [];
  for (const rule of Object.keys(counts ?? {}).sort()) {
    const file = fileOf(root, rule);
    const read = fs.existsSync(file) ? readFile(file) : { buckets: {}, problems: [] };
    const old = read.buckets;
    const next = {};
    const mine = [];
    for (const bucket of new Set([...Object.keys(old), ...Object.keys(counts[rule])])) {
      const from = count(old[bucket]);
      const to = count(counts[rule][bucket]);
      if (to > from && isCatalogue(bucket)) {
        refused.push({ rule, bucket, from, to, reason: 'catalogue buckets are never adopted' });
        if (bucket in old) next[bucket] = old[bucket];
      } else if (to > from && !adopt) {
        refused.push({ rule, bucket, from, to });
        if (bucket in old) next[bucket] = old[bucket];
      } else {
        if (to > 0) next[bucket] = to;
        if (to > from) adopted.push({ rule, bucket, from, to });
        else if (to !== from) mine.push({ rule, bucket, from, to });
      }
    }
    const fix = adopt && read.problems.length > 0;
    if (fix) rewrote.push({ rule, file: path.basename(file), problem: read.problems[0].problem });
    const changed = fix || mine.length > 0 || adopted.some((a) => a.rule === rule) || Object.keys(next).length !== Object.keys(old).length;
    if (changed) writeText(file, sortedJson(next));
    written.push(...mine);
  }
  const byKey = (a, b) => (a.rule + '\0' + a.bucket < b.rule + '\0' + b.bucket ? -1 : 1);
  return { written: written.sort(byKey), refused: refused.sort(byKey), adopted: adopted.sort(byKey), rewrote };
}
