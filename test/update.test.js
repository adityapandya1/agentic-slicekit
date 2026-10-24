import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderAll } from '../src/render/index.js';
import { compareManaged } from '../src/render/compare.js';
import { applyUpdate, diffLines, planUpdate } from '../src/render/update.js';
import { wrapManaged } from '../src/render/managed.js';
import { TEMPLATES, installedVersion } from '../src/render/entry.js';
import { runCli } from './helpers/run-cli.js';

const cfg = { name: 'demo', shape: 'backend', docsRoot: 'docs', cli: 'npx --no-install slicekit' };

function tmp(prefix = 'slicekit-update-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// No shipped template uses the html style, so these tests bring their own template directory.
function htmlKit(body) {
  const templates = tmp('slicekit-tpl-');
  fs.writeFileSync(path.join(templates, 'note.md'), body);
  fs.copyFileSync(path.join(TEMPLATES, 'hooks.json'), path.join(templates, 'hooks.json'));
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
  const { written } = applyUpdate(root, cfg, plan, { version: '1.1.0' });
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
  assert.equal(compareManaged({style: 'html', current: null, reference: html('x') }), 'missing');
  assert.equal(compareManaged({style: 'html', current: 'mine\n', reference: html('x') }), 'unmanaged');
  assert.equal(compareManaged({style: 'html', current: html('x', 'top\n', 'end\n'), reference: html('x') }), 'same');
  assert.equal(compareManaged({style: 'html', current: html('y'), reference: html('x') }), 'drifted');
  assert.equal(compareManaged({style: 'html', current: html('x') }), 'same');

  const hash = (body, before = '') => `${before}${wrapManaged(body, { version: '1', style: 'hash' })}`;
  assert.equal(compareManaged({style: 'hash', current: hash('x', '# top\n'), reference: hash('x') }), 'same');
  assert.equal(compareManaged({style: 'hash', current: hash('z'), reference: hash('x') }), 'drifted');
  assert.equal(compareManaged({style: 'hash', current: 'plain\n', reference: hash('x') }), 'unmanaged');

  const fm = (desc) => wrapManaged(`---\ndescription: ${desc}\n---\nbody\n`, { version: '1', style: 'frontmatter' });
  assert.equal(compareManaged({style: 'frontmatter', current: fm('a'), reference: fm('a') }), 'same');
  assert.equal(compareManaged({style: 'frontmatter', current: `${fm('a')}tail\n`, reference: fm('a') }), 'drifted');
  assert.equal(compareManaged({style: 'frontmatter', current: '---\nx: 1\n---\n', reference: fm('a') }), 'unmanaged');

  const js = (v) => wrapManaged(JSON.stringify({ k: v }), { version: '1', style: 'json' });
  assert.equal(compareManaged({style: 'json', current: js(1), reference: js(1) }), 'same');
  assert.equal(compareManaged({style: 'json', current: js(2), reference: js(1) }), 'drifted');
  assert.equal(compareManaged({style: 'json', current: '{"k":1}', reference: js(1) }), 'unmanaged');
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
  assert.equal(plain.code, 1);
  assert.match(plain.stderr, /was edited since slicekit wrote it/);
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

const SETTINGS = '.claude/settings.json';

test('settings.json is in the plan: a removed slicekit hook is drifted, --force restores it', () => {
  const root = initRepo();
  const file = path.join(root, SETTINGS);
  const pristine = fs.readFileSync(file, 'utf8');
  const obj = JSON.parse(pristine);
  delete obj.hooks.SessionStart;
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
  const r = runCli(['update', '--check'], { cwd: root });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^drifted \.claude\/settings\.json$/m);
  assert.match(r.stdout, /^\+.*SessionStart/m);
  const plain = runCli(['update', '--yes'], { cwd: root });
  assert.equal(plain.code, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.SessionStart, undefined);
  const forced = runCli(['update', '--yes', '--force'], { cwd: root });
  assert.equal(forced.code, 0, forced.stderr);
  // The restored event lands last, so compare the hook, not the byte order.
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.SessionStart, JSON.parse(pristine).hooks.SessionStart);
  assert.equal(runCli(['update', '--check'], { cwd: root }).code, 0);
});

test('a settings.json that only lacks a hook event slicekit never wrote is changed, not drifted', () => {
  const root = initRepo();
  const refFile = path.join(root, '.slicekit/rendered', fs.readdirSync(path.join(root, '.slicekit/rendered'))[0], SETTINGS);
  const ref = JSON.parse(fs.readFileSync(refFile, 'utf8'));
  delete ref.hooks.SessionStart;
  fs.writeFileSync(refFile, JSON.stringify(ref));
  const file = path.join(root, SETTINGS);
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete obj.hooks.SessionStart;
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
  const r = runCli(['update', '--check'], { cwd: root });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^changed \.claude\/settings\.json$/m);
});

test('with no reference copy an edited file is drifted and kept', () => {
  const root = initRepo();
  const file = path.join(root, DEV);
  const pristine = fs.readFileSync(file, 'utf8');
  fs.rmSync(path.join(root, '.slicekit/rendered'), { recursive: true, force: true });
  fs.appendFileSync(file, 'team edit\n');
  const check = runCli(['update', '--check'], { cwd: root });
  assert.equal(check.code, 1);
  assert.match(check.stdout, /^drifted \.claude\/agents\/developer\.md$/m);
  const kept = runCli(['update', '--yes'], { cwd: root });
  assert.equal(kept.code, 1);
  assert.match(fs.readFileSync(file, 'utf8'), /team edit/);
  const forced = runCli(['update', '--yes', '--force'], { cwd: root });
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), pristine);
});

test('update --yes reports every drifted file it skipped and exits 1', () => {
  const root = initRepo();
  fs.appendFileSync(path.join(root, DEV), 'edit\n');
  const r = runCli(['update', '--yes'], { cwd: root });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /developer\.md was edited since slicekit wrote it/);
  const clean = initRepo();
  assert.equal(runCli(['update', '--yes'], { cwd: clean }).code, 0);
});

test('applyUpdate returns what it wrote and what it skipped', () => {
  const root = tmp();
  const kit = htmlKit('body\n');
  renderAll(root, cfg, { version: '1.0.0', ...kit });
  const file = path.join(root, 'docs/note.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('body', 'mine'));
  const plan = planUpdate(root, cfg, { version: '1.0.0', ...kit });
  const res = applyUpdate(root, cfg, plan, { version: '1.0.0' });
  assert.deepEqual(res.written, []);
  assert.equal(res.skipped.length, 1);
  assert.equal(res.skipped[0].dest, 'docs/note.md');
  assert.match(res.skipped[0].warning, /edited since slicekit wrote it/);
});

test('the hint to run with --yes appears only when something would be written', () => {
  const clean = initRepo();
  assert.doesNotMatch(runCli(['update'], { cwd: clean }).stdout, /run again/);
  const root = initRepo();
  fs.appendFileSync(path.join(root, DEV), 'edit\n');
  assert.doesNotMatch(runCli(['update'], { cwd: root }).stdout, /run again/);
  assert.match(runCli(['update', '--force'], { cwd: root }).stdout, /run again with --yes to apply/);
});

test('diffLines prints - before + for a replaced line and marks a missing final newline', () => {
  assert.equal(diffLines('a\nb\n', 'a\nx\n'), ' a\n-b\n+x\n');
  const note = '\\ No newline at end of file\n';
  assert.equal(diffLines('a\nb', 'a\nb\n'), `-b\n${note}+b\n`);
  assert.equal(diffLines('a\nb\n', 'a\nb'), `-b\n+b\n${note}`);
});

test('compareManaged with no reference judges against the fresh render', () => {
  const html = (body) => wrapManaged(body, { version: '1', style: 'html' });
  assert.equal(compareManaged({ style: 'html', current: html('x'), fresh: html('x') }), 'same');
  assert.equal(compareManaged({ style: 'html', current: html('y'), fresh: html('x') }), 'drifted');
});

test('an invalid recorded version is no installed version', () => {
  const dir = tmp();
  assert.equal(installedVersion(dir, { _slicekit: { version: '../../x' } }), null);
  fs.mkdirSync(path.join(dir, '1.2.3-rc.1'));
  assert.equal(installedVersion(dir, { _slicekit: { version: '../../x' } }), '1.2.3-rc.1');
  assert.equal(installedVersion(dir, { _slicekit: { version: '1.2.3-rc.1' } }), '1.2.3-rc.1');
});

test('renderAll reads hooks.json from the injected templates directory', () => {
  const root = tmp();
  const kit = htmlKit('body\n');
  fs.writeFileSync(path.join(kit.templates, 'hooks.json'), '{"Stop":[{"hooks":[{"type":"command","command":"{{cli}} hook custom-stop"}]}]}');
  renderAll(root, cfg, { version: '1.0.0', ...kit });
  const s = JSON.parse(fs.readFileSync(path.join(root, SETTINGS), 'utf8'));
  assert.deepEqual(Object.keys(s.hooks), ['Stop']);
  assert.match(s.hooks.Stop[0].hooks[0].command, /hook custom-stop$/);
});

test('an edited timeout on a slicekit hook is drifted; --yes leaves it, --force restores it', () => {
  const root = initRepo();
  const file = path.join(root, SETTINGS);
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(obj.hooks.Stop[0].hooks[0].timeout, 120);
  obj.hooks.Stop[0].hooks[0].timeout = 5;
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
  const check = runCli(['update', '--check'], { cwd: root });
  assert.equal(check.code, 1);
  assert.match(check.stdout, /^drifted \.claude\/settings\.json$/m);
  const kept = runCli(['update', '--yes'], { cwd: root });
  assert.equal(kept.code, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.Stop[0].hooks[0].timeout, 5);
  const forced = runCli(['update', '--yes', '--force'], { cwd: root });
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.Stop[0].hooks[0].timeout, 120);
  assert.equal(runCli(['update', '--check'], { cwd: root }).code, 0);
});

test('an edited matcher on a slicekit hook is drifted', () => {
  const root = initRepo();
  const file = path.join(root, SETTINGS);
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  obj.hooks.PreToolUse[0].matcher = 'Nothing';
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
  assert.equal(runCli(['update', '--check'], { cwd: root }).code, 1);
});

const statusOf = (plan, dest) => plan.find((p) => p.dest === dest).status;

test('a drifted settings.json across two version bumps leaves exactly one drifted file and updates the rest', () => {
  const root = tmp();
  renderAll(root, cfg, { version: '1.0.0' });
  const file = path.join(root, SETTINGS);
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete obj.hooks.SessionStart;
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
  for (const version of ['1.1.0', '1.2.0']) {
    const plan = planUpdate(root, cfg, { version });
    const drifted = plan.filter((p) => p.status === 'drifted').map((p) => p.dest);
    assert.deepEqual(drifted, [SETTINGS], version);
    const changed = plan.filter((p) => p.status === 'changed');
    assert.ok(changed.length >= 17, `${version}: ${changed.length} changed`);
    const { written, skipped } = applyUpdate(root, cfg, plan, { version });
    assert.equal(written.length, changed.length, version);
    assert.deepEqual(skipped.map((s) => s.dest), [SETTINGS], version);
  }
});

test('settings reference copy survives a version bump and a cli change', () => {
  const other = { ...cfg, cli: 'node ./bin/slicekit.js' };
  const noDrift = (plan) => plan.every((p) => p.status !== 'drifted' && p.status !== 'missing');

  // first install: no file at all
  const first = tmp();
  assert.equal(statusOf(planUpdate(first, cfg, { version: '1.0.0' }), SETTINGS), 'missing');

  // clean bump
  const bump = tmp();
  renderAll(bump, cfg, { version: '1.0.0' });
  assert.equal(statusOf(planUpdate(bump, cfg, { version: '1.1.0' }), SETTINGS), 'changed');
  applyUpdate(bump, cfg, planUpdate(bump, cfg, { version: '1.1.0' }), { version: '1.1.0' });
  assert.ok(planUpdate(bump, cfg, { version: '1.1.0' }).every((p) => p.status === 'same'));

  // cli change with a reference copy: slicekit's own commands move, nothing is drifted
  const withRef = tmp();
  renderAll(withRef, cfg, { version: '1.0.0' });
  const planRef = planUpdate(withRef, other, { version: '1.0.0' });
  assert.equal(statusOf(planRef, SETTINGS), 'changed');
  applyUpdate(withRef, other, planRef, { version: '1.0.0' });
  assert.doesNotMatch(fs.readFileSync(path.join(withRef, SETTINGS), 'utf8'), /npx --no-install/);
  assert.ok(noDrift(planUpdate(withRef, other, { version: '1.0.0' })));

  // cli change without a reference copy: cannot prove it is ours alone, so drifted until forced
  const noRef = tmp();
  renderAll(noRef, cfg, { version: '1.0.0' });
  fs.rmSync(path.join(noRef, '.slicekit/rendered'), { recursive: true, force: true });
  const planNo = planUpdate(noRef, other, { version: '1.0.0' });
  assert.equal(statusOf(planNo, SETTINGS), 'drifted');
  applyUpdate(noRef, other, planNo, { version: '1.0.0', force: true });
  assert.ok(noDrift(planUpdate(noRef, other, { version: '1.0.0' })));
  assert.equal(statusOf(planUpdate(noRef, other, { version: '1.0.0' }), SETTINGS), 'same');
});

test('installedVersion prefers the recorded version but only when its reference directory exists', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '1.1.0'));
  fs.mkdirSync(path.join(dir, '1.2.0'));
  assert.equal(installedVersion(dir, { _slicekit: { version: '1.1.0' } }), '1.1.0');
  assert.equal(installedVersion(dir, { _slicekit: { version: '1.0.0' } }), '1.2.0');
  assert.equal(installedVersion(dir, undefined), '1.2.0');
});

for (const cli of ['node C:\tools\slicekit\bin\slicekit.js', 'node "C:/Program Files/slicekit/bin/slicekit.js"']) {
  test(`a cli with a backslash or a quote renders valid settings: ${cli}`, () => {
    const root = tmp();
    const c = { ...cfg, cli };
    renderAll(root, c, { version: '1.0.0' });
    const s = JSON.parse(fs.readFileSync(path.join(root, SETTINGS), 'utf8'));
    const commands = Object.values(s.hooks).flatMap((entries) => entries.flatMap((e) => e.hooks.map((h) => h.command)));
    assert.ok(commands.length >= 8);
    for (const command of commands) assert.ok(command.startsWith(`${cli} hook `), command);
    assert.equal(s._slicekit.cli, cli);
    assert.ok(planUpdate(root, c, { version: '1.0.0' }).every((p) => p.status === 'same'));
  });
}

test('with no reference copy the drift warning says it cannot tell a kit change from an edit', () => {
  const root = tmp();
  renderAll(root, cfg, { version: '1.0.0' });
  fs.rmSync(path.join(root, '.slicekit/rendered'), { recursive: true, force: true });
  fs.appendFileSync(path.join(root, DEV), 'team edit\n');
  const hit = renderAll(root, cfg, { version: '1.0.0' }).find((r) => r.dest === DEV);
  assert.equal(hit.action, 'skipped');
  assert.equal(hit.warning, `no reference copy for ${DEV}; cannot tell a kit change from an edit; slicekit update --force overwrites`);
});

test('update --check hints when .slicekit/rendered/ is missing', () => {
  const root = initRepo();
  assert.doesNotMatch(runCli(['update', '--check'], { cwd: root }).stdout, /rendered\/ is missing/);
  fs.rmSync(path.join(root, '.slicekit/rendered'), { recursive: true, force: true });
  fs.appendFileSync(path.join(root, DEV), 'team edit\n');
  const r = runCli(['update', '--check'], { cwd: root });
  assert.equal(r.code, 1);
  const hints = r.stdout.split('\n').filter((l) => l === '.slicekit/rendered/ is missing; commit it so drift can be told from kit changes');
  assert.equal(hints.length, 1);
  const kept = runCli(['update', '--yes'], { cwd: root });
  assert.match(kept.stderr, /no reference copy for \.claude\/agents\/developer\.md; cannot tell a kit change from an edit; slicekit update --force overwrites/);
});

test('applyUpdate writes the new reference directory before pruning the old ones', () => {
  const root = tmp();
  renderAll(root, cfg, { version: '1.0.0' });
  const plan = planUpdate(root, cfg, { version: '1.1.0' });
  assert.throws(
    () => applyUpdate(root, cfg, plan, { version: '1.1.0', prune: () => { throw new Error('interrupted'); } }),
    /interrupted/,
  );
  for (const item of plan) {
    assert.ok(fs.existsSync(path.join(root, '.slicekit/rendered/1.1.0', item.dest)), item.dest);
  }
  assert.ok(fs.existsSync(path.join(root, '.slicekit/rendered/1.0.0')));
});

test('a template root without hooks.json renders files only', () => {
  const root = tmp();
  const templates = tmp('slicekit-tpl-');
  fs.writeFileSync(path.join(templates, 'note.md'), 'body\n');
  const kit = { templates, entries: [{ src: 'note.md', dest: 'docs/note.md', shapes: ['backend'] }] };
  const plan = planUpdate(root, cfg, { version: '1.0.0', ...kit });
  assert.deepEqual(plan.map((p) => p.dest), ['docs/note.md']);
  const results = renderAll(root, cfg, { version: '1.0.0', ...kit });
  assert.deepEqual(results.map((r) => r.dest), ['docs/note.md']);
  assert.equal(fs.existsSync(path.join(root, SETTINGS)), false);
  assert.equal(fs.existsSync(path.join(root, '.claude')), false);
});

test('SessionStart has no matcher, so every source fires', () => {
  const root = tmp();
  renderAll(root, cfg, { version: '1.0.0' });
  const s = JSON.parse(fs.readFileSync(path.join(root, SETTINGS), 'utf8'));
  assert.equal(s.hooks.SessionStart.length, 1);
  assert.equal(Object.hasOwn(s.hooks.SessionStart[0], 'matcher'), false);
});

test('installedVersion picks the newest by semver, a prerelease before its release', () => {
  const pick = (dirs) => {
    const dir = tmp();
    for (const d of dirs) fs.mkdirSync(path.join(dir, d));
    return installedVersion(dir, undefined);
  };
  assert.equal(pick(['1.9.0', '1.10.0', '1.10.0-rc.1']), '1.10.0');
  assert.equal(pick(['1.10.0-rc.1', '1.9.9']), '1.10.0-rc.1');
  assert.equal(pick(['2.0.0-rc.2', '2.0.0-rc.10']), '2.0.0-rc.10');
  assert.equal(pick(['2.0.0-alpha', '2.0.0-1']), '2.0.0-alpha');
  assert.equal(pick(['2.0.0-rc', '2.0.0-rc.1']), '2.0.0-rc.1');
});
