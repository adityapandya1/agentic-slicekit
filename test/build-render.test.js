// P2/S-29 Done when 1: `slicekit build render <id>` runs `update --yes` in the slice worktree and
// commits only the files update writes, as `chore(slicekit): <id> render`; `build commit` accepts that
// commit when its files equal a fresh render, and refuses one holding any other file or a rendered
// file that differs from a fresh render.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git, parseTrailers } from '../src/git.js';
import { kitVersion } from '../src/render/index.js';
import { GREEN, IMPORTING, cli, commitAll, commitWorkCli, project, red1, write } from './helpers/build-flow.js';

const OLD = '0.0.1';
const SETTINGS = '.claude/settings.json';
const RENDERED = '.slicekit/rendered';
const VERSION = kitVersion();

// The kit installed by an older version: settings.json records 0.0.1 and the reference copies sit
// under .slicekit/rendered/0.0.1, so `update --yes` with this kit rewrites settings.json and the
// reference directory, as a slice that bumps the kit's version does.
function olderInstall(root) {
  const file = path.join(root, ...SETTINGS.split('/'));
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...settings, _slicekit: { ...settings._slicekit, version: OLD } }, null, 2)}\n`);
  fs.renameSync(path.join(root, ...RENDERED.split('/'), VERSION), path.join(root, ...RENDERED.split('/'), OLD));
  commitAll(root, 'kit installed at 0.0.1');
}

// One slice past red for the whole file, its worktree on the older install.
let p;
before(async () => {
  const proj = project({ slices: [{ n: 1, group: 'A', evalFile: 'a.test.js' }], commands: { test: 'node --test' }, init: true });
  olderInstall(proj.root);
  const started = await cli(proj.root, ['build', 'start', 'P1/S-01']);
  assert.equal(started.code, 0, started.stderr);
  const wt = started.stdout.split('\n')[0];
  write(wt, 'test/a.test.js', IMPORTING);
  p = { ...proj, wt };
  const r = await red1(p, 'test/a.test.js');
  assert.equal(r.code, 0, r.stderr);
});
after(() => p?.cleanup());

// `build render` once; -> the render commit's SHA.
let renderSha = null;
async function render() {
  if (renderSha) return renderSha;
  const r = await cli(p.root, ['build', 'render', 'P1/S-01']);
  assert.equal(r.code, 0, `build render: ${r.stdout}${r.stderr}`);
  renderSha = git(p.wt, ['rev-parse', 'HEAD']);
  return renderSha;
}

const filesOf = (sha) => git(p.wt, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', sha]).split('\n').filter(Boolean);

// The render commit amended by hand with `change` applied, keeping its subject and trailer.
function forgeRender(change) {
  change();
  git(p.wt, ['add', '-A']);
  git(p.wt, ['commit', '-q', '--amend', '--no-edit']);
}

test('a render commit with another file in it is refused by build commit', async () => {
  const sha = await render();
  try {
    forgeRender(() => write(p.wt, 'src/extra.js', 'export const z = 3;\n'));
    const extra = await commitWorkCli(p, '--message', 'x');
    assert.equal(extra.code, 1, extra.stdout);
    assert.match(extra.stderr, /outside the kit/);
    git(p.wt, ['reset', '-q', '--hard', sha]);

    // A rendered file that differs from a fresh render is not the kit's either.
    forgeRender(() => fs.appendFileSync(path.join(p.wt, ...RENDERED.split('/'), VERSION, ...SETTINGS.split('/')), '\n'));
    const differs = await commitWorkCli(p, '--message', 'x');
    assert.equal(differs.code, 1, differs.stdout);
    assert.match(differs.stderr, /outside the kit/);
  } finally {
    git(p.wt, ['reset', '-q', '--hard', sha]);
  }
});

test("build render commits a version's re-render and build commit accepts it", async () => {
  const sha = await render();
  assert.equal(git(p.wt, ['log', '-1', '--format=%s', sha]), 'chore(slicekit): P1/S-01 render');
  assert.equal(parseTrailers(git(p.wt, ['log', '-1', '--format=%B', sha])).Slice, 'P1/S-01');
  // Only what update wrote: settings.json and the reference copies, old and new.
  const files = filesOf(sha);
  assert.ok(files.includes(SETTINGS), files.join(', '));
  assert.ok(files.some((f) => f.startsWith(`${RENDERED}/${VERSION}/`)), files.join(', '));
  assert.ok(files.every((f) => f === SETTINGS || f.startsWith(`${RENDERED}/`)), files.join(', '));
  assert.equal(git(p.wt, ['status', '--porcelain']), '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(p.wt, ...SETTINGS.split('/')), 'utf8'))._slicekit.version, VERSION);

  write(p.wt, 'src/t1.js', GREEN);
  const done = await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green');
  assert.equal(done.code, 0, done.stderr);
  assert.equal(git(p.wt, ['status', '--porcelain']), '');
});
