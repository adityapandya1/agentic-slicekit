import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runbook = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'runbook.md'), 'utf8');

function section(name) {
  const lines = runbook.split('\n');
  const start = lines.indexOf(`## ${name}`);
  assert.ok(start >= 0, `no ## ${name}`);
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

test('the runbook says how to release a preview and how to roll back a bad version', () => {
  const release = section('Releasing a preview');
  assert.match(release, /npm publish --dry-run/);
  assert.match(release, /npm publish\b(?! --dry-run)/);
  assert.match(release, /npm deprecate slicekit@0\.0\.1/);
  assert.match(release, /v<version>|v0\.1\.1/);
  const rollback = section('Rolling back a bad version on npm');
  assert.match(rollback, /72 hours/);
  assert.match(rollback, /never reused/);
  assert.match(rollback, /npm deprecate/);
  assert.doesNotMatch(section('Going public as a preview'), /until S-24/);
});
