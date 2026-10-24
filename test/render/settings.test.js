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
