import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderAll } from '../src/render/index.js';
import { compareManaged } from '../src/render/compare.js';
import { applyUpdate, diffLines, planUpdate } from '../src/render/update.js';
import { wrapManaged } from '../src/render/managed.js';
import { runCli } from './helpers/run-cli.js';

const cfg = { name: 'demo', shape: 'backend', docsRoot: 'docs', cli: 'npx --no-install slicekit' };

function tmp(prefix = 'slicekit-update-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// No shipped template uses the html style, so these tests bring their own template directory.
function htmlKit(body) {
  const templates = tmp('slicekit-tpl-');
  fs.writeFileSync(path.join(templates, 'note.md'), body);
  return { templates, entries: [{ src: 'note.md', dest: 'docs/note.md', shapes: ['backend'] }] };
}

test('update rewrites only inside markers', () => {
  const root = tmp();
  const kit = htmlKit('first body\n');
  renderAll(root, cfg, { version: '1.0.0', ...kit });
  const file = path.join(root, 'docs/note.md');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, `team intro\n${original}team outro\n`);
  fs.writeFileSync(path.join(kit.templates, 'note.md'), 'second body\n');

  const plan = planUpdate(root, cfg, { version: '1.1.0', ...kit });
  assert.equal(plan.find((p) => p.dest === 'docs/note.md').status, 'changed');
  const written = applyUpdate(root, cfg, plan, { version: '1.1.0', ...kit });
  assert.ok(written.includes('docs/note.md'));
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    'team intro\n<!-- slicekit:managed:start v1.1.0 -->\nsecond body\n<!-- slicekit:managed:end -->\nteam outro\n',
  );
});

test('text outside markers survives update', () => {
  const root = tmp();
  const kit = htmlKit('body\n');
  renderAll(root, cfg, { version: '1.0.0', ...kit });
  const file = path.join(root, 'docs/note.md');
  fs.writeFileSync(file, `# my heading\n${fs.readFileSync(file, 'utf8')}my footer\n`);
  // An edit outside the block is the team's own, never drift.
  const same = planUpdate(root, cfg, { version: '1.0.0', ...kit });
  assert.equal(same.find((p) => p.dest === 'docs/note.md').status, 'same');
  fs.writeFileSync(path.join(kit.templates, 'note.md'), 'newer body\n');
  const plan = planUpdate(root, cfg, { version: '1.0.0', ...kit });
  applyUpdate(root, cfg, plan, { version: '1.0.0', ...kit });
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('# my heading\n'));
  assert.ok(text.endsWith('my footer\n'));
  assert.match(text, /newer body/);
});

test('an edit inside the block is drifted, and update leaves it unless forced', () => {
  const root = tmp();
  const kit = htmlKit('body\n');
  renderAll(root, cfg, { version: '1.0.0', ...kit });
  const file = path.join(root, 'docs/note.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('body', 'hand edited'));
  fs.writeFileSync(path.join(kit.templates, 'note.md'), 'newer body\n');
  const plan = planUpdate(root, cfg, { version: '1.0.0', ...kit });
  const entry = plan.find((p) => p.dest === 'docs/note.md');
  assert.equal(entry.status, 'drifted');
  assert.match(entry.diff, /^-hand edited$/m);
  assert.match(entry.diff, /^\+newer body$/m);
  applyUpdate(root, cfg, plan, { version: '1.0.0', ...kit });
  assert.match(fs.readFileSync(file, 'utf8'), /hand edited/);
  applyUpdate(root, cfg, plan, { version: '1.0.0', force: true, ...kit });
  assert.match(fs.readFileSync(file, 'utf8'), /newer body/);
});

test('a missing file is planned and restored; an unmanaged file is never touched', () => {
  const root = tmp();
  const kit = htmlKit('body\n');
  renderAll(root, cfg, { version: '1.0.0', ...kit });
  const file = path.join(root, 'docs/note.md');
  fs.rmSync(file);
  let plan = planUpdate(root, cfg, { version: '1.0.0', ...kit });
  assert.equal(plan.find((p) => p.dest === 'docs/note.md').status, 'missing');
  applyUpdate(root, cfg, plan, { version: '1.0.0', ...kit });
  assert.ok(fs.existsSync(file));
  fs.writeFileSync(file, 'all mine\n');
  plan = planUpdate(root, cfg, { version: '1.0.0', ...kit });
  assert.equal(plan.find((p) => p.dest === 'docs/note.md').status, 'unmanaged');
  applyUpdate(root, cfg, plan, { version: '1.0.0', force: true, ...kit });
  assert.equal(fs.readFileSync(file, 'utf8'), 'all mine\n');
});

test('diffLines shows added and removed lines with +/-', () => {
  const out = diffLines('a\nb\nc\n', 'a\nx\nc\n');
  assert.match(out, /^-b$/m);
  assert.match(out, /^\+x$/m);
  assert.match(out, /^ a$/m);
  assert.equal(diffLines('same\n', 'same\n'), '');
  assert.match(diffLines('', 'new\n'), /^\+new$/m);
});

test('compareManaged per style', () => {
  const html = (body, before = '', after = '') => `${before}${wrapManaged(body, { version: '1', style: 'html' })}${after}`;
  assert.equal(compareManaged({ dest: 'a.md', style: 'html', current: null, reference: html('x') }), 'missing');
  assert.equal(compareManaged({ dest: 'a.md', style: 'html', current: 'mine\n', reference: html('x') }), 'unmanaged');
  assert.equal(compareManaged({ dest: 'a.md', style: 'html', current: html('x', 'top\n', 'end\n'), reference: html('x') }), 'same');
  assert.equal(compareManaged({ dest: 'a.md', style: 'html', current: html('y'), reference: html('x') }), 'drifted');
  assert.equal(compareManaged({ dest: 'a.md', style: 'html', current: html('x') }), 'same');

  const hash = (body, before = '') => `${before}${wrapManaged(body, { version: '1', style: 'hash' })}`;
  assert.equal(compareManaged({ dest: 'f.yml', style: 'hash', current: hash('x', '# top\n'), reference: hash('x') }), 'same');
  assert.equal(compareManaged({ dest: 'f.yml', style: 'hash', current: hash('z'), reference: hash('x') }), 'drifted');
  assert.equal(compareManaged({ dest: 'f.yml', style: 'hash', current: 'plain\n', reference: hash('x') }), 'unmanaged');

  const fm = (desc) => wrapManaged(`---\ndescription: ${desc}\n---\nbody\n`, { version: '1', style: 'frontmatter' });
  assert.equal(compareManaged({ dest: 'a.md', style: 'frontmatter', current: fm('a'), reference: fm('a') }), 'same');
  assert.equal(compareManaged({ dest: 'a.md', style: 'frontmatter', current: `${fm('a')}tail\n`, reference: fm('a') }), 'drifted');
  assert.equal(compareManaged({ dest: 'a.md', style: 'frontmatter', current: '---\nx: 1\n---\n', reference: fm('a') }), 'unmanaged');

  const js = (v) => wrapManaged(JSON.stringify({ k: v }), { version: '1', style: 'json' });
  assert.equal(compareManaged({ dest: 'a.json', style: 'json', current: js(1), reference: js(1) }), 'same');
  assert.equal(compareManaged({ dest: 'a.json', style: 'json', current: js(2), reference: js(1) }), 'drifted');
  assert.equal(compareManaged({ dest: 'a.json', style: 'json', current: '{"k":1}', reference: js(1) }), 'unmanaged');
});

function initRepo() {
  const root = tmp('slicekit-update-cli-');
  const r = runCli(['init', '--shape', 'backend', '--name', 'demo'], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
  return root;
}
const DEV = '.claude/agents/developer.md';

test('--check reports a drifted managed block', () => {
  const root = initRepo();
  assert.equal(runCli(['update', '--check'], { cwd: root }).code, 0);
  const file = path.join(root, DEV);
  fs.appendFileSync(file, 'hand written line\n');
  const r = runCli(['update', '--check'], { cwd: root });
  assert.equal(r.code, 1);
  assert.match(r.stdout, new RegExp(`^drifted ${DEV.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(r.stdout, /hand written line/);
  assert.match(fs.readFileSync(file, 'utf8'), /hand written line/);
});

test('without --yes nothing is written', () => {
  const root = initRepo();
  const file = path.join(root, DEV);
  fs.rmSync(file);
  const r = runCli(['update'], { cwd: root });
  assert.equal(r.code, 0);
  assert.match(r.stdout, new RegExp(`^missing ${DEV.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(r.stdout, /run again with --yes to apply/);
  assert.equal(fs.existsSync(file), false);
  const applied = runCli(['update', '--yes'], { cwd: root });
  assert.equal(applied.code, 0, applied.stderr);
  assert.ok(fs.existsSync(file));
});

test('--force overwrites a drifted file and refreshes its reference', () => {
  const root = initRepo();
  const file = path.join(root, DEV);
  const pristine = fs.readFileSync(file, 'utf8');
  fs.appendFileSync(file, 'hand written line\n');
  const plain = runCli(['update', '--yes'], { cwd: root });
  assert.equal(plain.code, 0);
  assert.match(fs.readFileSync(file, 'utf8'), /hand written line/);
  const forced = runCli(['update', '--yes', '--force'], { cwd: root });
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), pristine);
  assert.equal(runCli(['update', '--check'], { cwd: root }).code, 0);
  const refs = fs.readdirSync(path.join(root, '.slicekit/rendered'));
  assert.equal(refs.length, 1);
  assert.equal(fs.readFileSync(path.join(root, '.slicekit/rendered', refs[0], DEV), 'utf8'), pristine);
});

test('update usage errors exit 2', () => {
  const root = initRepo();
  assert.equal(runCli(['update', '--bogus'], { cwd: root }).code, 2);
});
