// REQ-2.6, D-50: `slicekit build config <id>` commits the worktree's changed .slicekit/config.json
// alone, as `chore(slicekit): <id> config`, for a slice that names the config in its Expected changes;
// `build commit` accepts that commit and still never commits the config itself (issue #51).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { git, parseTrailers } from '../src/git.js';
import { GREEN, IMPORTING, cli, commitAll, commitWorkCli, project, write } from './helpers/build-flow.js';

const SLICE_FILE = 'docs/phases/P1-x/S-01-thing-1.md';
const CONFIG = '.slicekit/config.json';

// Slice P1/S-01 past red, its worktree started from a main where the slice file names the config in
// its Expected changes when `names` is true.
async function slice({ names }) {
  const p = project({ slices: [{ n: 1, group: 'A', evalFile: 'a.test.js' }], commands: { test: 'node --test' }, init: true });
  if (names) {
    const file = path.join(p.root, ...SLICE_FILE.split('/'));
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.includes('`src/t1.js`.'), text);
    fs.writeFileSync(file, text.replace('`src/t1.js`.', '`src/t1.js`, `.slicekit/config.json`.'));
    commitAll(p.root, 'the slice names the config');
  }
  const started = await cli(p.root, ['build', 'start', 'P1/S-01']);
  assert.equal(started.code, 0, started.stderr);
  const wt = started.stdout.split('\n')[0];
  write(wt, 'test/a.test.js', IMPORTING);
  const r = await cli(p.root, ['build', 'red', 'P1/S-01', '--tests', 'test/a.test.js']);
  assert.equal(r.code, 0, r.stderr);
  return { ...p, wt };
}

// The worktree's config with commands.lint set: a change a slice makes to the kit's own config.
function changeConfig(wt) {
  const file = path.join(wt, ...CONFIG.split('/'));
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...cfg, commands: { ...cfg.commands, lint: 'node -e 0' } }, null, 2)}\n`);
}

const configCli = (p) => cli(p.root, ['build', 'config', 'P1/S-01']);
const filesOf = (wt, sha) => git(wt, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', sha]).split('\n').filter(Boolean);

test('build config commits the config alone when the slice names it, and build commit accepts it', async () => {
  const p = await slice({ names: true });
  try {
    const none = await configCli(p);
    assert.equal(none.code, 0, none.stderr);
    assert.equal(none.stdout, 'nothing to commit\n');

    changeConfig(p.wt);
    // build commit still never commits the config, and says which step does.
    const refused = await commitWorkCli(p, '--message', 'x');
    assert.equal(refused.code, 1, refused.stdout);
    assert.ok(refused.stderr.trimEnd().endsWith('; run slicekit build config P1/S-01'), refused.stderr);
    assert.ok(refused.stderr.includes(CONFIG), refused.stderr);

    const made = await configCli(p);
    assert.equal(made.code, 0, made.stderr);
    const sha = git(p.wt, ['rev-parse', 'HEAD']);
    assert.equal(made.stdout, `${sha.slice(0, 7)} config\n`);
    assert.equal(git(p.wt, ['log', '-1', '--format=%s', sha]), 'chore(slicekit): P1/S-01 config');
    assert.equal(parseTrailers(git(p.wt, ['log', '-1', '--format=%B', sha])).Slice, 'P1/S-01');
    assert.deepEqual(filesOf(p.wt, sha), [CONFIG]);
    assert.equal(git(p.wt, ['status', '--porcelain']), '');

    // The config commit is the kit's: the next build commit passes the kit-file guard.
    write(p.wt, 'src/t1.js', GREEN);
    const done = await commitWorkCli(p, '--message', 'feat(P1/S-01): x', '--require-green');
    assert.equal(done.code, 0, done.stderr);
    assert.equal(git(p.wt, ['status', '--porcelain']), '');
  } finally {
    p.cleanup();
  }
});

test('build config refuses a slice that does not name the config, and a config that does not load', async () => {
  const p = await slice({ names: false });
  try {
    changeConfig(p.wt);
    const before = git(p.wt, ['rev-parse', 'HEAD']);
    const r = await configCli(p);
    assert.equal(r.code, 1, r.stdout);
    assert.equal(r.stderr, 'slicekit: slice P1/S-01 does not name .slicekit/config.json in its Expected changes\n');
    assert.equal(git(p.wt, ['rev-parse', 'HEAD']), before);

    // A hand commit dressed as build config's is refused: the slice file at that commit names no config.
    git(p.wt, ['add', CONFIG]);
    execFileSync('git', ['commit', '-q', '--no-verify', '-m', 'chore(slicekit): P1/S-01 config\n\nSlice: P1/S-01'], { cwd: p.wt, stdio: ['ignore', 'pipe', 'pipe'] });
    write(p.wt, 'src/t1.js', GREEN);
    const forged = await commitWorkCli(p, '--message', 'feat(P1/S-01): x');
    assert.equal(forged.code, 1, forged.stdout);
    assert.match(forged.stderr, /\.slicekit\/config\.json was changed in [0-9a-f]{7} outside the kit/);
  } finally {
    p.cleanup();
  }

  const q = await slice({ names: true });
  try {
    write(q.wt, CONFIG, '{not json\n');
    const before = git(q.wt, ['rev-parse', 'HEAD']);
    const r = await configCli(q);
    assert.equal(r.code, 1, r.stdout);
    assert.ok(r.stderr.startsWith('slicekit: .slicekit/config.json: '), r.stderr);
    assert.match(r.stderr, /not valid JSON/);
    assert.equal(git(q.wt, ['rev-parse', 'HEAD']), before);
  } finally {
    q.cleanup();
  }
});
