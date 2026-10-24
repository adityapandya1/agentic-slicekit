import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAll } from '../src/render/index.js';
import { mergeSettings } from '../src/render/settings.js';
import { extractManaged, markerStyle } from '../src/render/managed.js';
import { entriesForShape } from '../src/render/manifest.js';
import { SHAPES } from '../src/config.js';

const GOLDEN = fileURLToPath(new URL('./fixtures/golden/', import.meta.url));
const VERSION = '0.0.0-test';
const cfgFor = (shape) => ({ name: 'demo', shape, docsRoot: 'docs', cli: 'npx --no-install slicekit' });

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-render-'));
}
function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else out.push(r);
  }
  return out.sort();
}

test('backend renders no designer', () => {
  const root = tmp();
  renderAll(root, cfgFor('backend'), { version: VERSION });
  assert.equal(fs.existsSync(path.join(root, '.claude/agents/designer.md')), false);
  assert.ok(fs.existsSync(path.join(root, '.claude/agents/developer.md')));
});

test('fullstack renders designer', () => {
  const root = tmp();
  renderAll(root, cfgFor('fullstack'), { version: VERSION });
  assert.ok(fs.existsSync(path.join(root, '.claude/agents/designer.md')));
});

test('every rendered file has markers with the version', () => {
  const root = tmp();
  const results = renderAll(root, cfgFor('fullstack'), { version: VERSION });
  assert.ok(results.length > 0);
  for (const { dest } of results) {
    const text = fs.readFileSync(path.join(root, dest), 'utf8');
    const style = markerStyle(dest, text);
    const got = extractManaged(text, style);
    assert.ok(got, dest);
    if (style === 'frontmatter') assert.match(text, new RegExp(`^slicekit-managed: v${VERSION}$`, 'm'), dest);
    else if (style === 'html') assert.match(text, /^<!-- slicekit:managed:start v0\.0\.0-test -->$/m, dest);
    assert.equal(got.version, VERSION, dest);
    assert.doesNotMatch(text,/\{\{(version|name|docsRoot|cli)\}\}/, dest);
  }
  const again = renderAll(root, cfgFor('fullstack'), { version: VERSION });
  assert.ok(again.every((r) => r.action === 'unchanged'));
});

test('every rendered markdown file with front matter starts with ---', () => {
  const root = tmp();
  renderAll(root, cfgFor('fullstack'), { version: VERSION });
  let n = 0;
  for (const rel of walk(root, '.claude').filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.ok(text.startsWith('---\n'), rel);
    assert.doesNotMatch(text, /slicekit:managed/, rel);
    n++;
  }
  assert.ok(n >= 18);
});

for (const shape of SHAPES) {
  test(`golden files per shape: ${shape}`, () => {
    const root = tmp();
    renderAll(root, cfgFor(shape), { version: VERSION });
    const dir = path.join(GOLDEN, shape);
    const rendered = walk(root, '.claude');
    if (process.env.SLICEKIT_UPDATE_GOLDEN === '1') {
      fs.rmSync(dir, { recursive: true, force: true });
      for (const rel of rendered) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.copyFileSync(path.join(root, rel), path.join(dir, rel));
      }
    }
    assert.deepEqual(walk(dir), rendered);
    for (const rel of rendered) {
      assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), fs.readFileSync(path.join(dir, rel), 'utf8'), rel);
    }
  });
}

test('settings merge keeps the team\'s own hooks and permissions', () => {
  const ours = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'npx --no-install slicekit hook pre-bash' }] }] };
  const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo team' }] };
  const existing = {
    permissions: { allow: ['Bash(ls)'] },
    hooks: {
      PreToolUse: [foreign, { hooks: [{ type: 'command', command: 'slicekit hook old' }] }],
      Notification: [{ hooks: [{ type: 'command', command: 'say hi' }] }],
    },
  };
  const once = mergeSettings(existing, ours, { version: '1.2.3', cli: 'npx --no-install slicekit' });
  assert.deepEqual(once.permissions, existing.permissions);
  assert.deepEqual(once.hooks.Notification, existing.hooks.Notification);
  assert.deepEqual(once.hooks.PreToolUse, [foreign, ours.PreToolUse[0]]);
  assert.deepEqual(once._slicekit, { managed: true, version: '1.2.3', cli: 'npx --no-install slicekit' });
  const twice = mergeSettings(once, ours, { version: '1.2.3', cli: 'npx --no-install slicekit' });
  assert.deepEqual(twice, once);
  assert.equal(mergeSettings(undefined, ours, { version: '1' }).hooks.PreToolUse.length, 1);
});

test('renderAll merges into an existing settings.json and rejects invalid JSON', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude/settings.json'), '{"permissions":{"allow":["x"]}}');
  renderAll(root, cfgFor('backend'), { version: VERSION });
  const s = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(s.permissions, { allow: ['x'] });
  assert.ok(s.hooks.Stop);
  const bad = tmp();
  fs.mkdirSync(path.join(bad, '.claude'));
  fs.writeFileSync(path.join(bad, '.claude/settings.json'), '{nope');
  assert.throws(() => renderAll(bad, cfgFor('backend'), { version: VERSION }), /not valid JSON/);
  assert.equal(fs.existsSync(path.join(bad, '.claude/commands')), false);
});

test('reference copies are written under .slicekit/rendered/<version>', () => {
  const root = tmp();
  renderAll(root, cfgFor('backend'), { version: '1.0.0' });
  fs.mkdirSync(path.join(root, '.slicekit/rendered/0.9.0'), { recursive: true });
  renderAll(root, cfgFor('backend'), { version: '1.1.0' });
  for (const e of entriesForShape('backend')) {
    assert.equal(
      fs.readFileSync(path.join(root, '.slicekit/rendered/1.1.0', e.dest), 'utf8'),
      fs.readFileSync(path.join(root, e.dest), 'utf8'),
    );
  }
  assert.deepEqual(fs.readdirSync(path.join(root, '.slicekit/rendered')), ['1.1.0']);
});

test('an unmanaged existing dest is left untouched with a warning', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude/agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude/agents/developer.md'), 'mine\n');
  const results = renderAll(root, cfgFor('backend'), { version: VERSION });
  assert.equal(fs.readFileSync(path.join(root, '.claude/agents/developer.md'), 'utf8'), 'mine\n');
  const hit = results.find((r) => r.dest === '.claude/agents/developer.md');
  assert.equal(hit.action, 'skipped');
  assert.equal(hit.warning, '.claude/agents/developer.md exists and is not managed by slicekit; left untouched');
});

test('changing cli between renders leaves one slicekit entry per event', () => {
  const root = tmp();
  renderAll(root, cfgFor('backend'), { version: VERSION });
  renderAll(root, { ...cfgFor('backend'), cli: 'node ./bin/slicekit.js' }, { version: VERSION });
  const s = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
  for (const [event, entries] of Object.entries(s.hooks)) {
    const ours = entries.flatMap((e) => e.hooks).filter((h) => / hook /.test(h.command));
    assert.ok(ours.length >= 1, event);
    assert.ok(ours.every((h) => h.command.startsWith('node ./bin/slicekit.js hook ')), event);
  }
  assert.equal(s.hooks.Stop.length, 1);
});

test('an edited managed file is left untouched with a warning; a pristine one updates', () => {
  const root = tmp();
  renderAll(root, cfgFor('backend'), { version: VERSION });
  const edited = path.join(root, '.claude/agents/developer.md');
  fs.appendFileSync(edited, 'team note\n');
  const before = fs.readFileSync(edited, 'utf8');
  const results = renderAll(root, { ...cfgFor('backend'), name: 'renamed', cli: 'slicekit' }, { version: VERSION });
  assert.equal(fs.readFileSync(edited, 'utf8'), before);
  const hit = results.find((r) => r.dest === '.claude/agents/developer.md');
  assert.equal(hit.action, 'skipped');
  assert.equal(
    hit.warning,
    '.claude/agents/developer.md was edited since slicekit wrote it; left untouched (slicekit update --force overwrites)',
  );
  // Pristine files follow the template (cli changed), and the drift stays detected on the next run.
  assert.match(fs.readFileSync(path.join(root, '.claude/agents/reviewer.md'), 'utf8'), /^Brief: run `slicekit instructions/m);
  const again = renderAll(root, { ...cfgFor('backend'), cli: 'slicekit' }, { version: VERSION });
  assert.equal(again.find((r) => r.dest === '.claude/agents/developer.md').action, 'skipped');
  assert.equal(fs.readFileSync(edited, 'utf8'), before);
});
