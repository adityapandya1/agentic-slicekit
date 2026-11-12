// REQ-5.8: the kit's own runbook, and the changelog its release steps name.
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

test('the release deprecates both placeholders', () => {
  const release = section('Releasing a preview');
  assert.match(release, /npm deprecate slicekit@0\.0\.0-stage/);
  assert.match(release, /npm deprecate slicekit@0\.0\.1/);
});

// P3/S-35: the changelog entry is written in the release slice, so it is on main before anyone publishes.
test('the release steps write the changelog entry before publishing', () => {
  const release = section('Releasing a preview');
  const changelog = release.indexOf('CHANGELOG.md');
  const publish = release.search(/`npm publish`/);
  assert.ok(changelog >= 0, release);
  assert.ok(publish >= 0, release);
  assert.ok(changelog < publish, 'the changelog step comes before npm publish');
  assert.match(release.replace(/\s+/g, ' '), /CHANGELOG\.md[^.]*release slice/);
  const log = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md'), 'utf8');
  const versions = log.split('\n').filter((l) => /^## /.test(l)).map((l) => l.replace(/^## /, '').split(/\s/)[0]);
  assert.deepEqual(versions, ['0.2.1', '0.2.0', '0.1.2', '0.1.1']);
});

// P5/S-48, REQ-5.5, D-62, D-91: a version reaches npm from CI when its sync pull request merges, after
// the author approves the deployment to the environment `npm`; the attestation is checked on npm.
test("the release steps name the environment's approval, the attestation check and the rollback", () => {
  const release = section('Releasing a version').replace(/\s+/g, ' ');
  // The merge publishes: the sync pull request that sets the version, then the publish workflow.
  assert.match(release, /sync pull request/);
  assert.match(release, /publish\.yml/);
  // The environment's approval.
  assert.match(release, /environment `npm`|`npm` environment/);
  assert.match(release, /approv/i);
  // The attestation check.
  assert.match(release, /npm view slicekit@<version> dist\.attestations/);
  // The rollback.
  assert.match(release, /Rolling back a bad version on npm/);
  // Nobody publishes by hand any more.
  assert.doesNotMatch(release, /npm login/);
  assert.doesNotMatch(release, /no CI job publishes/);
  const rollback = section('Rolling back a bad version on npm');
  assert.match(rollback, /npm deprecate/);
  assert.match(rollback, /Releasing a version/);
  assert.doesNotMatch(rollback, /Releasing a preview/);
  // The author's one-time settings (D-62, D-91).
  const deps = section('Dependencies and their owners').replace(/\s+/g, ' ');
  assert.match(deps, /trusted publish/i);
  for (const want of ['adityapandya1', 'agentic-slicekit', 'publish.yml']) assert.ok(deps.includes(want), want);
  assert.match(deps, /environment `npm`|`npm` environment/);
  assert.match(deps, /required reviewer/);
  assert.match(deps, /default branch|`main`/);
});
