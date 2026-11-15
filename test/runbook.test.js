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
  // D-90: each sync pull request adds its version's section on top, so the list ends with the versions
  // up to 0.3.0 and its newest section is the version in package.json.
  assert.deepEqual(versions.slice(-5), ['0.3.0', '0.2.1', '0.2.0', '0.1.2', '0.1.1']);
  const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
  assert.equal(versions[0], pkg.version);
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

// P5/S-21, REQ-2.9, D-21, D-54: the runbook says how a phase's release is recorded, and its Rollback
// section, which every release record quotes, says what to do.
test('the runbook says how to record a release, and its Rollback section is filled', () => {
  const recording = section('Recording a release').replace(/\s+/g, ' ');
  assert.match(recording, /slicekit release P<n>/);
  assert.match(recording, /\/slicekit release P<n>/);
  assert.match(recording, /slicekit branch release <slug>/);
  assert.match(recording, /\[release\] P<n>/);
  // What it refuses, and that merging the pull request is the release.
  assert.match(recording, /not merged/);
  assert.match(recording, /no operational change/);
  assert.match(recording, /Merging the `\[release\] P<n>` pull request is the release/);
  assert.match(recording, /deploys nothing/);
  const rollback = section('Rollback');
  assert.doesNotMatch(rollback, /Not yet known/i);
  assert.ok(rollback.trim().split('\n').length >= 3, rollback);
  assert.match(rollback, /revert/i);
  assert.match(rollback, /Rolling back a bad version on npm/);
});

// P6/S-51, REQ-3.11, D-80, issue #127: a sync pull request carries a `pull_request` run that waits
// for approval. No change to the workflow keeps that run from being created, so the runbook says it
// is expected, which run the ruleset reads, and that the waiting run is left as it is.
test('the runbook says the waiting pull request run on a sync pull request is expected', () => {
  const sync = section('The state sync pull request').replace(/\s+/g, ' ');
  // The run that waits: a `pull_request` run in `action_required`.
  assert.match(sync, /`pull_request` run/);
  assert.match(sync, /`action_required`/);
  assert.match(sync, /expected/);
  // The run the ruleset reads is the `workflow_dispatch` one.
  assert.match(sync, /`workflow_dispatch` run is the one the ruleset reads/);
  // Nobody approves, cancels or re-runs the waiting run.
  assert.match(sync, /waiting run is left as it is/);
});
