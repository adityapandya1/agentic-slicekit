// The kit's own test command (D-49, P3/S-32): `node scripts/test-shard.js`. With SLICEKIT_SHARD unset
// it runs every test file. With SLICEKIT_SHARD=<k>/<n> it runs shard k of n, where the shards are
// balanced by measured weight rather than by file order (node --test --test-shard splits by file
// order, so the heaviest files landed together). Every file runs whole in one shard: the two heaviest
// files were split into three files each (P3/S-33, issue #55), so no shard waits on one of them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Seconds of test time per file on windows-latest, summed from run 41110115390 (2026-10-30). A file
// not listed weighs DEFAULT_WEIGHT. Only the order of magnitude matters. The review files are a third
// each of the old review.test.js (791) and review-loop.test.js (593) they were split from.
export const WEIGHTS = {
  'test/commands/review-1.test.js': 264,
  'test/commands/review-2.test.js': 264,
  'test/commands/review-3.test.js': 263,
  'test/commands/review-loop-1.test.js': 198,
  'test/commands/review-loop-2.test.js': 198,
  'test/commands/review-loop-3.test.js': 197,
  'test/commands/build.test.js': 217,
  'test/commands/build-parallel.test.js': 178,
  'test/loop-guards.test.js': 65,
  'test/state.test.js': 63,
  'test/init.test.js': 55,
  'test/commands/intake.test.js': 40,
  'test/hooks/pre-bash.test.js': 39,
  'test/build-amend.test.js': 37,
  'test/walkthrough.test.js': 36,
  'test/check/coverage.test.js': 34,
  'test/commands/gaps.test.js': 31,
  'test/githooks.test.js': 31,
  'test/branch.test.js': 31,
  'test/ci-bookkeeping.test.js': 29,
  'test/check/trailer.test.js': 28,
  'test/stage.test.js': 26,
  'test/journal.test.js': 24,
  'test/pr.test.js': 24,
  'test/build-pr-head.test.js': 24,
  'test/ready-label.test.js': 23,
  'test/update.test.js': 22,
  'test/hooks/session-start.test.js': 20,
  'test/check/commands.test.js': 20,
  'test/package.test.js': 19,
};
export const DEFAULT_WEIGHT = 10;

// Every *.test.js under test/, as sorted POSIX paths relative to root.
export function testFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.test.js')) out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  walk(path.join(root, 'test'));
  return out.sort();
}

export function parseShard(text) {
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(String(text).trim());
  if (!m || Number(m[1]) > Number(m[2])) throw new Error(`SLICEKIT_SHARD must be <k>/<n> with 1 <= k <= n, got ${JSON.stringify(text)}`);
  return { k: Number(m[1]), n: Number(m[2]) };
}

// The n shards as lists of { file, weight }: heaviest file first onto the lightest shard (ties to the
// lower shard), so every shard computes the same plan and each file lands in exactly one shard.
// Ordering by weight then name, never by the file system, keeps the plan the same on every system.
export function assign(files, n, { weights = WEIGHTS } = {}) {
  const units = files.map((file) => ({ file, weight: weights[file] ?? DEFAULT_WEIGHT }));
  units.sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const shards = Array.from({ length: n }, () => ({ load: 0, units: [] }));
  for (const u of units) {
    const lightest = shards.reduce((best, s) => (s.load < best.load ? s : best));
    lightest.units.push(u);
    lightest.load += u.weight;
  }
  return shards.map((s) => s.units);
}

// The files of one shard, sorted.
export function shardPlan(units) {
  return { files: units.map((u) => u.file).sort() };
}

function main() {
  const shard = process.env.SLICEKIT_SHARD;
  let args;
  if (!shard) {
    args = ['--test', 'test/**/*.test.js'];
  } else {
    let k;
    let n;
    try {
      ({ k, n } = parseShard(shard));
    } catch (e) {
      console.error(e.message);
      return 2;
    }
    const plan = shardPlan(assign(testFiles(), n)[k - 1]);
    if (plan.files.length === 0) {
      console.log(`shard ${k}/${n} has no test files`);
      return 0;
    }
    args = ['--test', ...plan.files];
    console.log(`shard ${k}/${n}: ${plan.files.length} files`);
  }
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  return r.status === null ? 1 : r.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main();
