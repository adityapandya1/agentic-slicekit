import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { buildContext } from './context.js';

const RULES_DIR = fileURLToPath(new URL('./rules/', import.meta.url));

// Every `*.js` in rules/, in file-name order. Later slices add a rule by adding a file; nothing
// here changes. A module that does not have the rule shape is kept, and fails when it runs.
async function loadRules() {
  if (!fs.existsSync(RULES_DIR)) return [];
  const names = fs.readdirSync(RULES_DIR).filter((n) => n.endsWith('.js')).sort();
  const out = [];
  for (const name of names) {
    const mod = await import(pathToFileURL(path.join(RULES_DIR, name)).href);
    const rule = mod.default && typeof mod.default === 'object' ? mod.default : mod;
    out.push({ ...rule, id: typeof rule.id === 'string' && rule.id !== '' ? rule.id : name.slice(0, -3) });
  }
  return out;
}

export const ALL_RULES = Object.freeze(await loadRules());

const isFinding = (f) =>
  typeof f === 'object' && f !== null && typeof f.file === 'string' && Number.isInteger(f.line) && typeof f.message === 'string';

// Runs one rule. Anything other than an array of well-formed findings is the rule crashing.
function runRule(rule, ctx) {
  if (typeof rule.run !== 'function') throw new Error('not a rule module (no run function)');
  const found = rule.run(ctx);
  if (!Array.isArray(found)) throw new Error('run did not return an array');
  return found.map((f, i) => {
    if (!isFinding(f)) throw new Error(`finding ${i} is not {file, line, message}`);
    return { ...f, rule: rule.id, bucket: typeof f.bucket === 'string' && f.bucket !== '' ? f.bucket : f.file };
  });
}

const limit = (baselines, rule, bucket) => {
  const n = baselines?.[rule]?.[bucket];
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// A ratchet rule fails a bucket whose count exceeds its baseline; a blocking rule that is not a
// ratchet fails on any finding; a rule that is neither only reports. A rule that crashes always
// blocks: the gate must never pass because a rule did not run.
export function check(root, { ci = false, env = process.env, rules = ALL_RULES } = {}) {
  const cfg = loadConfig(root);
  const ctx = buildContext(root, cfg, { ci, env });
  const findings = [];
  const counts = {};
  const lines = [];
  let over = 0;
  let blocking = 0;

  for (const rule of rules) {
    counts[rule.id] = {};
    let found;
    try {
      found = runRule(rule, ctx);
    } catch (e) {
      const f = { rule: rule.id, file: '-', line: 0, message: `rule ${rule.id} crashed: ${e?.message ?? e}`, bucket: '-' };
      findings.push(f);
      lines.push(`${f.rule} ${f.file}:${f.line} ${f.message}`);
      blocking += 1;
      continue;
    }
    for (const f of found) counts[rule.id][f.bucket] = (counts[rule.id][f.bucket] ?? 0) + 1;
    const atBaseline = new Set();
    if (rule.ratchet) {
      for (const [bucket, n] of Object.entries(counts[rule.id])) {
        const max = limit(ctx.baselines, rule.id, bucket);
        if (n > max) over += n - max;
        else atBaseline.add(bucket);
      }
    } else if (rule.blocking) {
      blocking += found.length;
    }
    for (const f of found) {
      findings.push(f);
      lines.push(`${atBaseline.has(f.bucket) ? '(baseline) ' : ''}${f.rule} ${f.file}:${f.line} ${f.message}`);
    }
  }

  lines.push(`check: ${findings.length} findings, ${over} over baseline, ${blocking} blocking`);
  return { findings, counts, exitCode: over > 0 || blocking > 0 ? 1 : 0, lines };
}
