import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { buildContext } from './context.js';

const RULES_DIR = fileURLToPath(new URL('./rules/', import.meta.url));

// Stands in for a rule file that cannot be imported: it crashes when run, so `check` reports it and
// fails, while every other command (which imports this module through the CLI) keeps working.
const brokenRule = (id, file, error) => ({
  id,
  file,
  blocking: true,
  ratchet: false,
  run() {
    throw new Error(`import failed: ${error?.message ?? error}`);
  },
});

// Every `*.js` in dir, in file-name order. Later slices add a rule by adding a file; nothing here
// changes. A module without the rule shape is kept, and fails when it runs. A missing directory
// is itself a blocking finding: zero rules must never look like a clean repository.
export async function loadRules(dir = RULES_DIR) {
  if (!fs.existsSync(dir)) {
    return [
      {
        id: 'loader',
        synthetic: true,
        blocking: true,
        ratchet: false,
        run: () => [{ file: '-', line: 0, message: `rule loader: rules directory missing at ${dir}` }],
      },
    ];
  }
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.js')).sort();
  const out = [];
  for (const name of names) {
    const fallback = name.slice(0, -'.js'.length);
    let mod;
    try {
      mod = await import(pathToFileURL(path.join(dir, name)).href);
    } catch (e) {
      out.push(brokenRule(fallback, name, e));
      continue;
    }
    const rule = mod.default && typeof mod.default === 'object' ? mod.default : mod;
    out.push({ ...rule, file: name, id: typeof rule.id === 'string' && rule.id !== '' ? rule.id : fallback });
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
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

// A ratchet rule fails a bucket whose count exceeds its baseline; a blocking rule that is not a
// ratchet fails on any finding; a rule that is neither only reports. A rule that crashes, or whose
// id another rule already took, always blocks: the gate must never pass because a rule did not run.
export function check(root, { ci = false, env = process.env, rules = ALL_RULES } = {}) {
  const cfg = loadConfig(root);
  const ctx = buildContext(root, cfg, { ci, env });
  const findings = [];
  const counts = {};
  const lines = [];
  const seen = new Map();
  let over = 0;
  let blocking = 0;
  const block = (f) => {
    findings.push(f);
    lines.push(`${f.rule} ${f.file}:${f.line} ${f.message}`);
    blocking += 1;
  };

  for (const rule of rules) {
    if (seen.has(rule.id)) {
      const first = seen.get(rule.id).file ?? '<injected>';
      block({ rule: rule.id, file: '-', line: 0, message: `rule ${rule.id} defined twice (${first}, ${rule.file ?? '<injected>'})`, bucket: '-' });
      continue;
    }
    seen.set(rule.id, rule);
    counts[rule.id] = {};
    let found;
    try {
      found = runRule(rule, ctx);
    } catch (e) {
      block({ rule: rule.id, file: '-', line: 0, message: `rule ${rule.id} crashed: ${e?.message ?? e}`, bucket: '-' });
      continue;
    }
    for (const f of found) counts[rule.id][f.bucket] = (counts[rule.id][f.bucket] ?? 0) + 1;
    const atBaseline = new Set();
    // A ratchet rule is judged by its baselines alone; its `blocking` flag has no effect.
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

  const ruleCount = rules.filter((r) => !r.synthetic).length;
  lines.push(`check: ${findings.length} findings, ${over} over baseline, ${blocking} blocking, ${ruleCount} rules`);
  return { findings, counts, exitCode: over > 0 || blocking > 0 ? 1 : 0, lines, rules: ruleCount };
}
