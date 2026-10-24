import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/check/context.js';
import { renderAll, kitVersion, TEMPLATES } from '../../src/render/index.js';
import managed from '../../src/check/rules/managed.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const DEST = '.claude/agents/reviewer.md';

function withInstall(fn) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'npx --no-install slicekit' });
    const run = () => managed.run(buildContext(repo.root, loadConfig(repo.root)));
    return fn({ root: repo.root, run, file: path.join(repo.root, ...DEST.split('/')) });
  } finally {
    repo.cleanup();
  }
}

test('the rule is blocking and not a ratchet', () => {
  assert.equal(managed.id, 'managed');
  assert.equal(managed.blocking, true);
  assert.equal(managed.ratchet, false);
});

test('edited managed block is a finding', () => {
  withInstall(({ run, file }) => {
    // The agent files are managed whole (front-matter style): any body edit is inside the block.
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /follow it\./);
    fs.writeFileSync(file, text.replace('follow it.', 'follow it, by hand.'));
    assert.deepEqual(run(), [
      { file: DEST, line: 1, message: `${DEST}: managed block edited since slicekit wrote it; run slicekit update --force or revert` },
    ]);
  });
});

test('an edit with no reference copy says it cannot tell a kit change from an edit', () => {
  withInstall(({ root, run, file }) => {
    fs.rmSync(path.join(root, '.slicekit', 'rendered', kitVersion(), ...DEST.split('/')));
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('follow it.', 'follow it, by hand.'));
    assert.deepEqual(run(), [
      { file: DEST, line: 1, message: `${DEST}: no reference copy; cannot tell a kit change from an edit; slicekit update --force overwrites` },
    ]);
  });
});

test('an edited timeout on a slicekit hook in settings.json is a finding', () => {
  withInstall(({ root, run }) => {
    const settings = path.join(root, '.claude', 'settings.json');
    const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    const ours = parsed.hooks.SessionStart[0].hooks[0];
    assert.match(ours.command, /hook session-start$/);
    ours.timeout = 999;
    fs.writeFileSync(settings, `${JSON.stringify(parsed, null, 2)}\n`);
    assert.deepEqual(run(), [
      {
        file: '.claude/settings.json',
        line: 1,
        message: '.claude/settings.json: managed block edited since slicekit wrote it; run slicekit update --force or revert',
      },
    ]);
  });
});

test('missing managed file is a finding', () => {
  withInstall(({ run, file }) => {
    fs.rmSync(file);
    assert.deepEqual(run(), [{ file: DEST, line: 1, message: `${DEST}: managed file missing; run slicekit update` }]);
  });
});

test('unmanaged dest is a finding', () => {
  withInstall(({ run, file }) => {
    fs.writeFileSync(file, 'all mine\n');
    assert.deepEqual(run(), [
      { file: DEST, line: 1, message: `${DEST}: exists but is not managed by slicekit; move it or run slicekit update --force` },
    ]);
  });
});

test('a kit template change is not a finding', () => {
  withInstall(({ root, run }) => {
    // Render from an older copy of the templates: the shipped ones are then newer, which is
    // `update`'s business (status changed), never drift.
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-tpl-'));
    try {
      fs.cpSync(TEMPLATES, old, { recursive: true });
      const src = path.join(old, 'agents', 'reviewer.md');
      fs.writeFileSync(src, `${fs.readFileSync(src, 'utf8')}\nan older line\n`);
      const cfg = loadConfig(root);
      renderAll(root, cfg, { version: '0.0.0', templates: old, force: true });
      assert.match(fs.readFileSync(path.join(root, ...DEST.split('/')), 'utf8'), /an older line/);
      assert.deepEqual(run(), []);
    } finally {
      fs.rmSync(old, { recursive: true, force: true });
    }
  });
});

test('a planning failure is one blocking finding', () => {
  withInstall(({ root }) => {
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{ not json');
    const found = managed.run(buildContext(root, loadConfig(root)));
    assert.equal(found.length, 1);
    // No file and no line: the finding is about the plan, not about one file in it.
    assert.equal(found[0].file, '-');
    assert.equal(found[0].line, 0);
    assert.match(found[0].message, /^managed: cannot plan an update: /);
  });
});

test('a clean install is silent', () => {
  withInstall(({ run }) => {
    assert.ok(kitVersion());
    assert.deepEqual(run(), []);
  });
});
