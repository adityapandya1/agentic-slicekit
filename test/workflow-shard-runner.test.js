// REQ-3.11: runner labels and Java detection in the generated workflow (P4/S-43 round 3: H-3, H-4, Codex multiline runner labels).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, shardRunnerErrors, validateConfig } from '../src/config.js';
import { javaBuildTool } from '../src/workflow.js';

test('a command calling the tool inside quotes makes a Java repository', () => {
  assert.equal(javaBuildTool(null, ['sh -c "gradle test"']), 'gradle');
  assert.equal(javaBuildTool(null, ["sh -c 'mvn -B verify'"]), 'maven');
  assert.equal(javaBuildTool(null, ['echo "gradlew-like"']), null);
});

test('shardRunnerErrors accepts a shard key named by a ci.runsOn label', () => {
  assert.deepEqual(shardRunnerErrors({ runsOn: ['self-hosted', 'linux'], shards: { linux: 2 } }), []);
  assert.deepEqual(shardRunnerErrors({ runsOn: 'self-hosted', shards: { 'self-hosted': 3 } }), []);
  assert.deepEqual(shardRunnerErrors({ shards: { 'ubuntu-latest': 2 } }), []);
});

test('shardRunnerErrors refuses a shard key outside the runner labels', () => {
  const errors = shardRunnerErrors({ runsOn: ['self-hosted', 'linux'], shards: { 'ubuntu-latest': 2 } });
  assert.deepEqual(errors, ['ci.shards.ubuntu-latest: the test job runs only on the runner labelled self-hosted, linux']);
});

test('shardRunnerErrors refuses two label keys for one runner', () => {
  const errors = shardRunnerErrors({ runsOn: ['self-hosted', 'linux'], shards: { 'self-hosted': 2, linux: 2 } });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].startsWith('ci.shards: self-hosted, linux are labels of the one runner'), errors[0]);
});

test('validateConfig refuses a ci.runsOn label with a line break', () => {
  const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
  const withCi = (ci) => validateConfig({ ...cfg, ci: { ...cfg.ci, ...ci } });
  for (const bad of [['self-hosted\nlinux'], 'self-hosted\nlinux', ['linux', 'x64\r']]) {
    const errors = withCi({ runsOn: bad });
    assert.ok(errors.length > 0, `${JSON.stringify(bad)} refused`);
    assert.ok(errors.every((e) => e.startsWith('ci.runsOn: ')), errors.join('; '));
  }
});
