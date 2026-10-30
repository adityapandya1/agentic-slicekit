// Which files are tests (D-46, REQ-4.3) and the REQ IDs their lines name. The kit never knows the
// language (D-11): a test file is a path that matches a pattern, and only its lines are read.
import { execFileSync } from 'node:child_process';
import { cmp } from './schema.js';

// A name with test or spec after a dot, underscore or dash before its extension (a.test.js,
// a_test.go, a-spec.ts); a name starting test_ (test_a.py); a name ending Test or Tests before its
// extension (BillingTest.java, BillingTests.cs).
export const DEFAULT_TEST_FILES = Object.freeze([
  '(^|/)[^/]*[._-](test|spec)\.[^/.]+$',
  '(^|/)test_[^/]*$',
  '(^|/)[^/]*Tests?\.[^/.]+$',
]);

const compiled = new Map();
function patterns(cfg) {
  const list = cfg?.testFiles ?? DEFAULT_TEST_FILES;
  const key = JSON.stringify(list);
  if (!compiled.has(key)) compiled.set(key, list.map((s) => new RegExp(s)));
  return compiled.get(key);
}

export const isTestFile = (rel, cfg) => patterns(cfg).some((r) => r.test(rel));

const REQ = /REQ-\d+\.\d+/g;

// Every REQ ID on each line, 1-based lines counted on \n (a CRLF file numbers the same).
export function reqMentions(text) {
  const out = [];
  String(text).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(REQ)) out.push({ req: m[0], line: i + 1 });
  });
  return out;
}

// The tracked files that match testFiles, repository-relative POSIX paths, sorted.
export function testFiles(repoRoot, cfg) {
  const out = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
  return out.split('\0').filter((p) => p !== '' && isTestFile(p, cfg)).sort(cmp);
}
