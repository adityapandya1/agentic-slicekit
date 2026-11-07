// REQ-3.12: the rendered settings.json keeps one slicekit hook entry per event and the team's own hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings } from '../../src/render/settings.js';

const hookFor = (cli, name) => ({
  matcher: 'Bash',
  hooks: [{ type: 'command', command: `${cli} hook ${name}` }],
});

test('settings » a changed cli leaves exactly one slicekit entry per event', () => {
  const a = 'npx --no-install slicekit';
  const b = 'node ./bin/slicekit.js';
  const first = mergeSettings(undefined, { PreToolUse: [hookFor(a, 'pre-bash')] }, { version: '1', cli: a });
  assert.equal(first._slicekit.cli, a);
  const second = mergeSettings(first, { PreToolUse: [hookFor(b, 'pre-bash')] }, { version: '1', cli: b });
  assert.deepEqual(second.hooks.PreToolUse, [hookFor(b, 'pre-bash')]);
  assert.equal(second._slicekit.cli, b);
});

test('settings » a team hook sharing our matcher group survives', () => {
  const cli = 'slicekit';
  const existing = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: './team.sh' },
            { type: 'command', command: 'slicekit hook pre-bash' },
          ],
        },
        { hooks: [{ type: 'command', command: 'slicekit hook only-ours' }] },
      ],
    },
  };
  const out = mergeSettings(existing, { PreToolUse: [hookFor(cli, 'pre-bash')] }, { version: '1', cli });
  assert.deepEqual(out.hooks.PreToolUse, [
    { matcher: 'Bash', hooks: [{ type: 'command', command: './team.sh' }] },
    hookFor(cli, 'pre-bash'),
  ]);
});

// P4/S-39 (REQ-3.13, D-72)
test("settings » agents.denyPaths renders Read and Edit deny rules and keeps the team's own", () => {
  const cli = 'slicekit';
  const hooks = { PreToolUse: [hookFor(cli, 'pre-bash')] };
  const existing = {
    permissions: { allow: ['Bash(npm test)'], deny: ['Bash(curl:*)', 'Read(./.env)'] },
    hooks: { PreToolUse: [hookFor(cli, 'pre-bash')] },
  };
  const first = mergeSettings(existing, hooks, { version: '1', cli, denyPaths: ['data/**', '**/*.pem'] });
  assert.deepEqual(first.permissions.allow, ['Bash(npm test)']);
  assert.deepEqual(first.permissions.deny, [
    'Bash(curl:*)', 'Read(./.env)',
    'Read(data/**)', 'Edit(data/**)', 'Read(**/*.pem)', 'Edit(**/*.pem)',
  ]);
  assert.deepEqual(first._slicekit.deny, ['Read(data/**)', 'Edit(data/**)', 'Read(**/*.pem)', 'Edit(**/*.pem)']);

  // A pattern dropped from the list drops its rules; the team's own entries stay.
  const second = mergeSettings(first, hooks, { version: '1', cli, denyPaths: ['secrets/'] });
  assert.deepEqual(second.permissions.deny, ['Bash(curl:*)', 'Read(./.env)', 'Read(secrets/)', 'Edit(secrets/)']);

  // A team entry the list repeats stays the team's: emptying the list leaves it.
  const team = { ...existing, permissions: { deny: ['Read(data/**)'] } };
  const repeated = mergeSettings(team, hooks, { version: '1', cli, denyPaths: ['data/**'] });
  assert.deepEqual(repeated.permissions.deny, ['Read(data/**)', 'Edit(data/**)']);
  const emptied = mergeSettings(repeated, hooks, { version: '1', cli, denyPaths: [] });
  assert.deepEqual(emptied.permissions.deny, ['Read(data/**)']);
  assert.equal(emptied._slicekit.deny, undefined);

  // With the list empty or absent, the settings carry nothing they do not carry today.
  for (const denyPaths of [[], undefined]) {
    const plain = mergeSettings(undefined, hooks, { version: '1', cli, denyPaths });
    assert.deepEqual(plain, { hooks, _slicekit: { managed: true, version: '1', cli } });
    const kept = mergeSettings(existing, hooks, { version: '1', cli, denyPaths });
    assert.deepEqual(kept.permissions, existing.permissions);
  }
});
