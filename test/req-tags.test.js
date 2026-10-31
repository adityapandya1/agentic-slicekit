// REQ-4.3, REQ-5.5: every test file of the kit's own suite names a requirement the spec defines, so
// the graph links it to that requirement; a file whose tests check no requirement is allowlisted here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { buildContext } from '../src/check/context.js';
import { reqMentions, testFiles } from '../src/graph/tests.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The test files left untagged on purpose: one entry per file, with why its tests check no requirement.
const ALLOWLIST = Object.freeze({
  'test/fs.test.js': 'checks the file read and write helpers (atomic write, CRLF, BOM, listing), which no requirement states',
  'test/githooks-time.test.js': 'times a hooked and a plain commit and prints both; it asserts no requirement (D-42)',
});

// The REQ IDs the spec defines, read as `slicekit check` reads them.
function definedReqs(root) {
  return buildContext(root, loadConfig(root)).ids.req;
}

// The test files under test/ that `isTestFile` matches, repository-relative.
function suiteFiles(root) {
  return testFiles(root, loadConfig(root)).filter((p) => p.startsWith('test/'));
}

// True when `text` names at least one REQ ID that `defined` holds.
const namesDefined = (text, defined) => reqMentions(text).some((m) => defined.has(m.req));

// One message per problem: a file that names no defined requirement and is not allowlisted; an
// allowlisted file that is missing; an allowlisted file that names a defined requirement.
// `read(rel)` returns a file's text, or null when it does not exist.
function tagProblems({ files, read, defined, allow }) {
  const out = [];
  for (const rel of files) {
    if (Object.hasOwn(allow, rel)) continue;
    if (!namesDefined(read(rel) ?? '', defined)) out.push(`${rel} names no requirement the spec defines`);
  }
  for (const rel of Object.keys(allow).sort()) {
    const text = read(rel);
    if (text === null || !files.includes(rel)) out.push(`${rel} is allowlisted but missing`);
    else if (namesDefined(text, defined)) out.push(`${rel} is allowlisted but names a requirement; remove its entry`);
  }
  return out;
}

const readIn = (root) => (rel) => {
  const abs = path.join(root, ...rel.split('/'));
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
};

test('every test file under test/ names a requirement the spec defines, or is allowlisted', () => {
  const files = suiteFiles(repoRoot);
  assert.ok(files.length > 0, 'no test files found under test/');
  for (const [rel, why] of Object.entries(ALLOWLIST)) assert.ok(why.trim() !== '' && !why.includes('\n'), `${rel} needs a one-line reason`);
  const problems = tagProblems({ files, read: readIn(repoRoot), defined: definedReqs(repoRoot), allow: ALLOWLIST });
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('an allowlisted file that is missing, or that names a requirement, fails the test', () => {
  const defined = new Set(['REQ-4.3']);
  const texts = { 'test/a.test.js': '// REQ-4.3: tagged\n', 'test/b.test.js': '// no tag\n' };
  const read = (rel) => texts[rel] ?? null;
  const files = Object.keys(texts);
  const allow = {
    'test/a.test.js': 'reason',
    'test/b.test.js': 'reason',
    'test/gone.test.js': 'reason',
  };
  assert.deepEqual(tagProblems({ files, read, defined, allow }), [
    'test/a.test.js is allowlisted but names a requirement; remove its entry',
    'test/gone.test.js is allowlisted but missing',
  ]);
  assert.deepEqual(tagProblems({ files, read, defined, allow: { 'test/b.test.js': 'reason' } }), []);
});

test('a REQ ID the spec does not define does not count as a tag', () => {
  const defined = definedReqs(repoRoot);
  assert.ok(defined.has('REQ-4.3'));
  assert.ok(!defined.has('REQ-9.1'));
  const texts = {
    'test/fixture-ids.test.js': "// uses REQ-9.1 and REQ-9.2 as fixture IDs\ntest('x', () => {});\n",
    'test/real.test.js': '// REQ-4.3: names a real requirement\n',
  };
  const problems = tagProblems({ files: Object.keys(texts), read: (rel) => texts[rel] ?? null, defined, allow: {} });
  assert.deepEqual(problems, ['test/fixture-ids.test.js names no requirement the spec defines']);
});
