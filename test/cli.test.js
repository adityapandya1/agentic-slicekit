// REQ-1.1, REQ-5.1: the command line the install layout puts on PATH, whose entry dispatches each subcommand; its help, its usage and its exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_VERSION, ConfigNewerError, defaultConfig, migrateConfig, migrateConfigFile, validateConfig } from '../src/config.js';
import { main, COMMANDS } from '../src/cli/index.js';
import { runCli } from './helpers/run-cli.js';
import { makeRepo } from './helpers/tmp-repo.js';

test('unknown subcommand exits 2 with usage', () => {
  const r = runCli(['nope'], { cwd: os.tmpdir() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: slicekit <command>/);
  assert.match(r.stderr, /slicekit: unknown command 'nope'/);
});

test('no arguments exits 2 with usage', () => {
  const r = runCli([], { cwd: os.tmpdir() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: slicekit <command>/);
});

test('--version prints package version', () => {
  const r = runCli(['--version'], { cwd: os.tmpdir() });
  assert.equal(r.code, 0);
  const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(r.stdout.trim(), version);
});

// P3/S-35: the help is the answer, so it goes to standard output and `slicekit --help | less` shows it.
test('--help prints the usage on standard output and exits 0', () => {
  const r = runCli(['--help'], { cwd: os.tmpdir() });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^usage: slicekit <command>/);
  assert.match(r.stdout, /\ncommands:\n/);
  assert.equal(r.stderr, '');
});

test('an unknown command prints the usage on standard error and exits 2', () => {
  const r = runCli(['nope'], { cwd: os.tmpdir() });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^usage: slicekit <command>/);
  assert.match(r.stderr, /\ncommands:\n/);
  assert.match(r.stderr, /slicekit: unknown command 'nope'\n$/);
});

// Each line of the commands list is `<name> <syntax>`: no `slicekit ` prefix, no description after it.
test("every usage line begins with its command's name", () => {
  const r = runCli(['--help'], { cwd: os.tmpdir() });
  const lines = r.stdout.split('\n');
  const start = lines.indexOf('commands:');
  assert.ok(start >= 0, r.stdout);
  const end = lines.indexOf('', start);
  const listed = lines.slice(start + 1, end);
  const expected = Object.keys(COMMANDS)
    .sort()
    .flatMap((name) => COMMANDS[name].usage.split('\n').map((l) => ({ name, line: l.trim() })));
  assert.deepEqual(listed, expected.map(({ line }) => `  ${line}`));
  for (const { name, line } of expected) {
    assert.ok(line === name || line.startsWith(`${name} `), `${name}: ${line}`);
    assert.doesNotMatch(line, /^slicekit /, line);
    assert.doesNotMatch(line, /\S {2,}\S/, `a description after the syntax: ${line}`);
  }
  for (const name of Object.keys(COMMANDS)) assert.ok(listed.some((l) => l.startsWith(`  ${name}`)), name);
});

// P3/S-36 (issue #77): `slicekit <command> --help` is the answer too, on standard output.
test("every command's --help prints its usage on standard output and exits 0", () => {
  for (const name of Object.keys(COMMANDS).sort()) {
    const r = runCli([name, '--help'], { cwd: os.tmpdir() });
    const lines = COMMANDS[name].usage.split('\n').map((l) => `  slicekit ${l.trim()}`);
    assert.equal(r.code, 0, `${name}: ${r.stderr}`);
    assert.equal(r.stdout, `usage:\n${lines.join('\n')}\n`, name);
    assert.equal(r.stderr, '', name);
  }
});

test('a --help after -- reaches the command as an argument', async () => {
  const calls = [];
  const out = [];
  COMMANDS.tmp = { usage: 'tmp [--x]', run: async (args) => { calls.push(args); return 3; } };
  try {
    const io = { stdout: (s) => out.push(s), stderr: (s) => out.push(s) };
    assert.equal(await main(['tmp', '--', '--help'], io), 3);
    assert.deepEqual(calls, [['--', '--help']]);
    assert.deepEqual(out, []);
    assert.equal(await main(['tmp', '--help'], io), 0);
    assert.deepEqual(calls, [['--', '--help']], 'the command does not run for its own --help');
    assert.deepEqual(out, ['usage:\n  slicekit tmp [--x]\n']);
  } finally {
    delete COMMANDS.tmp;
  }
});

test('main dispatches to a registered command with its args and io', async () => {
  const io = { marker: true };
  let received;
  COMMANDS.tmp = { usage: 'tmp', run: async (args, ioArg) => { received = { args, ioArg }; return 7; } };
  try {
    const code = await main(['tmp', 'a', 'b'], io);
    assert.equal(code, 7);
    assert.deepEqual(received.args, ['a', 'b']);
    assert.equal(received.ioArg, io);
  } finally {
    delete COMMANDS.tmp;
  }
});

// ---- P5/S-24 (REQ-5.6, D-60, D-93): the migration runs before the command, init included ----

// A repository whose config a version 1 kit wrote: today's defaults at configVersion 1, holding repos.
function repoWithConfig(change) {
  const repo = makeRepo({ commits: 1 });
  const file = path.join(repo.root, '.slicekit', 'config.json');
  fs.mkdirSync(path.dirname(file));
  const cfg = { ...defaultConfig({ name: 'demo', shape: 'backend' }), ...change };
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return { ...repo, file };
}

test('init rerun on an older config migrates it first', () => {
  const repo = repoWithConfig({ configVersion: 1, repos: [] });
  try {
    const r = runCli(['init', '--shape', 'backend'], { cwd: repo.root });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /^config: migrated \.slicekit\/config\.json from configVersion 1 to 2$/m);
    assert.ok(r.stderr.split(/\r?\n/).includes('  - removed repos, unread since D-47'), r.stderr);
    const text = fs.readFileSync(repo.file, 'utf8');
    assert.ok(text.includes('\n  "configVersion": 2,\n'), text);
    assert.ok(!('repos' in JSON.parse(text)), text);
  } finally {
    repo.cleanup();
  }
});

// Review r1, H-1: a slice or review worktree holds no change a build step cannot commit, so there an
// older config is read migrated and left as it is; the slice that names the config is the one that writes.
test('on a slice branch or its review branch an older config is read migrated and not written', () => {
  const told = /^config: \.slicekit\/config\.json is at configVersion 1 and is read as 2 here, unwritten; it is migrated on the default branch or on a plan branch$/m;
  const sliceFile = (changes) =>
    `---\nslice: P1/S-01\nname: Zone\nrepo: .\ngroup: A\nrunbook: no\nrequirements: [REQ-1.1]\ndecisions: [D-01]\n---\n\n## Done when\n\n1. It works.\n\n## Evaluation set\n\n| Test | Kind | Covers |\n|---|---|---|\n| \`a.test.js » works\` | happy | REQ-1.1 |\n\n## Expected changes\n\n${changes}\n`;
  const repo = repoWithConfig({ configVersion: 1, repos: [] });
  const sliceMd = path.join(repo.root, 'docs', 'phases', 'P1-x', 'S-01-zone.md');
  fs.mkdirSync(path.dirname(sliceMd), { recursive: true });
  const on = (branch) => execFileSync('git', ['switch', '-q', '-C', branch], { cwd: repo.root, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const before = fs.readFileSync(repo.file);
    for (const [branch, changes] of [
      ['slice/P1-S-01-zone', '`src/x/a.js`.'],
      ['slice/P1-S-01-review', '`src/x/a.js`.'],
    ]) {
      fs.writeFileSync(sliceMd, sliceFile(changes));
      on(branch);
      for (let run = 1; run <= 2; run += 1) {
        const r = runCli(['status'], { cwd: repo.root });
        assert.ok(fs.readFileSync(repo.file).equals(before), `${branch}: the config was rewritten`);
        assert.match(r.stderr, told, branch);
        assert.equal(r.stderr.match(/^config: /gm).length, 1, r.stderr);
        assert.doesNotMatch(r.stderr, /config: migrated|configVersion: must be/, branch);
      }
    }

    // The slice whose Expected changes name the config writes it: build config commits it (D-53).
    fs.writeFileSync(sliceMd, sliceFile('`src/x/a.js`, `.slicekit/config.json`.'));
    on('slice/P1-S-01-zone');
    const named = runCli(['status'], { cwd: repo.root });
    assert.match(named.stderr, /^config: migrated \.slicekit\/config\.json from configVersion 1 to 2$/m);
    assert.doesNotMatch(named.stderr, told);
    assert.equal(JSON.parse(fs.readFileSync(repo.file, 'utf8')).configVersion, 2);

    // Review r3, B-1 (D-94): the review branch of that slice is written as its slice branch is.
    fs.writeFileSync(repo.file, before);
    on('slice/P1-S-01-review');
    const reviewed = runCli(['status'], { cwd: repo.root });
    assert.match(reviewed.stderr, /^config: migrated \.slicekit\/config\.json from configVersion 1 to 2$/m);
    assert.ok(reviewed.stderr.split(/\r?\n/).includes('  - removed repos, unread since D-47'), reviewed.stderr);
    assert.doesNotMatch(reviewed.stderr, told);
    assert.equal(JSON.parse(fs.readFileSync(repo.file, 'utf8')).configVersion, 2);

    // Any other branch writes as before: a plan branch is where a team commits the migration.
    fs.writeFileSync(repo.file, before);
    on('plan/config-2');
    const plan = runCli(['status'], { cwd: repo.root });
    assert.match(plan.stderr, /^config: migrated \.slicekit\/config\.json from configVersion 1 to 2$/m);
    assert.doesNotMatch(plan.stderr, told);
    assert.equal(JSON.parse(fs.readFileSync(repo.file, 'utf8')).configVersion, 2);
  } finally {
    repo.cleanup();
  }
});

// Review r2, H-3 (D-93): `slicekit branch` refuses a changed tracked file, so it never writes the
// migration; the branch is cut first and the next command writes the migration on it.
test('branch plan on the default branch leaves an older config unwritten, and the next command writes it on the plan branch', () => {
  const told = /^config: \.slicekit\/config\.json is at configVersion 1 and is read as 2 here, unwritten; slicekit branch writes nothing, and the next command writes it on the branch it runs on$/m;
  const repo = repoWithConfig({ configVersion: 1, repos: ['api'] });
  const gitOut = (args) => execFileSync('git', args, { cwd: repo.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    gitOut(['add', '-A']);
    gitOut(['commit', '-q', '-m', 'config']);
    const before = fs.readFileSync(repo.file);

    const cut = runCli(['branch', 'plan', 'config-2'], { cwd: repo.root });
    assert.equal(cut.code, 0, cut.stdout + cut.stderr);
    assert.equal(cut.stdout, 'plan/config-2\n');
    assert.ok(fs.readFileSync(repo.file).equals(before), 'branch plan rewrote the config');
    assert.match(cut.stderr, told);
    assert.equal(cut.stderr.match(/^config: /gm).length, 1, cut.stderr);
    assert.doesNotMatch(cut.stderr, /config: migrated|commit or stash/);
    assert.equal(gitOut(['rev-parse', '--abbrev-ref', 'HEAD']), 'plan/config-2');

    const next = runCli(['status'], { cwd: repo.root });
    assert.match(next.stderr, /^config: migrated \.slicekit\/config\.json from configVersion 1 to 2$/m);
    const lines = next.stderr.split(/\r?\n/);
    assert.ok(lines.includes('  - removed repos, unread since D-47'), next.stderr);
    assert.ok(lines.includes('  - repos held api; list them in .slicekit/workspace.json'), next.stderr);
    assert.doesNotMatch(next.stderr, told);
    const after = JSON.parse(fs.readFileSync(repo.file, 'utf8'));
    assert.equal(after.configVersion, 2);
    assert.ok(!('repos' in after));
    assert.equal(gitOut(['rev-parse', '--abbrev-ref', 'HEAD']), 'plan/config-2');
  } finally {
    repo.cleanup();
  }
});

// Review r3, H-3 (D-94): a command that ran on the default branch first, such as `release --dry-run`,
// wrote the migration there. `slicekit branch` cuts the branch and carries that one change; any other
// uncommitted change to a tracked file is refused as before.
test('branch plan cuts the branch when the only uncommitted change is the config as the migration writes it', () => {
  const repo = repoWithConfig({ configVersion: 1, repos: ['api'] });
  const other = path.join(repo.root, 'notes.md');
  fs.writeFileSync(other, 'one\n');
  const gitOut = (args) => execFileSync('git', args, { cwd: repo.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const refused = (what) => {
    const r = runCli(['branch', 'plan', 'config-2'], { cwd: repo.root });
    assert.equal(r.code, 1, `${what}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /^slicekit: commit or stash your changes first$/m, what);
    assert.equal(gitOut(['rev-parse', '--abbrev-ref', 'HEAD']), 'main', what);
  };
  try {
    gitOut(['add', '-A']);
    gitOut(['commit', '-q', '-m', 'config']);
    const committed = fs.readFileSync(repo.file);

    const first = runCli(['status'], { cwd: repo.root });
    assert.match(first.stderr, /^config: migrated \.slicekit\/config\.json from configVersion 1 to 2$/m);
    const migrated = fs.readFileSync(repo.file);
    assert.equal(JSON.parse(migrated.toString('utf8')).configVersion, 2);

    // Another tracked file changed as well: refused, and nothing is carried.
    fs.writeFileSync(other, 'two\n');
    refused('the config and another tracked file');
    fs.writeFileSync(other, 'one\n');

    // A config at the newer version that is not what the migration writes: refused.
    fs.writeFileSync(repo.file, `${JSON.stringify({ ...JSON.parse(migrated.toString('utf8')), name: 'other' }, null, 2)}\n`);
    refused('a config changed by hand');
    fs.writeFileSync(repo.file, migrated);

    const cut = runCli(['branch', 'plan', 'config-2'], { cwd: repo.root });
    assert.equal(cut.code, 0, cut.stdout + cut.stderr);
    assert.equal(cut.stdout, 'plan/config-2\n');
    assert.doesNotMatch(cut.stderr, /commit or stash|^config: /m);
    assert.equal(gitOut(['rev-parse', '--abbrev-ref', 'HEAD']), 'plan/config-2');
    assert.ok(fs.readFileSync(repo.file).equals(migrated), 'the migrated config was not carried to the plan branch');
    assert.equal(gitOut(['diff', '--name-only', 'HEAD']), '.slicekit/config.json');
    assert.equal(gitOut(['rev-parse', 'HEAD']), gitOut(['rev-parse', 'main']), 'the branch command committed');
    assert.ok(!fs.readFileSync(repo.file).equals(committed));
  } finally {
    repo.cleanup();
  }
});

test('a version 2 config holding repos is refused naming repos', () => {
  const error = 'repos: removed in configVersion 2; list repositories in .slicekit/workspace.json';
  const cfg = { ...defaultConfig({ name: 'demo', shape: 'backend' }), repos: [] };
  assert.equal(cfg.configVersion, 2);
  assert.deepEqual(validateConfig(cfg), [error]);
  const repo = repoWithConfig({ repos: ['api'] });
  try {
    const before = fs.readFileSync(repo.file);
    const r = runCli(['check'], { cwd: repo.root });
    assert.notEqual(r.code, 0, r.stdout + r.stderr);
    assert.ok(`${r.stdout}${r.stderr}`.includes(error), r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /config: migrated/);
    assert.ok(fs.readFileSync(repo.file).equals(before), 'a refused config was rewritten');
  } finally {
    repo.cleanup();
  }
});

test('migrateConfig copies, names the version read, and leaves a version that is no integer to validateConfig', () => {
  const old = { ...defaultConfig({ name: 'demo', shape: 'backend' }), configVersion: 1, repos: [{ name: 'api' }, 'web'] };
  const { cfg, from, changes } = migrateConfig(old);
  assert.equal(from, 1);
  assert.equal(cfg.configVersion, CONFIG_VERSION);
  assert.ok(!('repos' in cfg));
  assert.deepEqual(old.repos, [{ name: 'api' }, 'web'], 'the config passed in is not changed');
  assert.deepEqual(changes, ['removed repos, unread since D-47', 'repos held api, web; list them in .slicekit/workspace.json']);
  assert.deepEqual(validateConfig(cfg), []);

  const current = defaultConfig({ name: 'demo', shape: 'backend' });
  assert.deepEqual(migrateConfig(current), { cfg: current, from: CONFIG_VERSION, changes: [] });
  for (const bad of ['1', 0, 1.5, null, undefined]) {
    const odd = { ...current, configVersion: bad };
    assert.deepEqual(migrateConfig(odd).changes, []);
    assert.ok(validateConfig(migrateConfig(odd).cfg).includes(`configVersion: must be ${CONFIG_VERSION}`), String(bad));
  }
  assert.throws(() => migrateConfig({ ...current, configVersion: CONFIG_VERSION + 1 }), ConfigNewerError);

  // No config file, or one that is not JSON, is not this function's to report.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-migrate-'));
  try {
    assert.equal(migrateConfigFile(dir), null);
    fs.mkdirSync(path.join(dir, '.slicekit'));
    fs.writeFileSync(path.join(dir, '.slicekit', 'config.json'), '{not json');
    assert.equal(migrateConfigFile(dir), null);
    assert.equal(fs.readFileSync(path.join(dir, '.slicekit', 'config.json'), 'utf8'), '{not json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// P5/S-50 (issue #162, D-94): the branch `slicekit branch` switches to may already hold the migrated
// config, committed there by an earlier `pr open`. With the migrated config as the only uncommitted
// change, the command drops its own copy where the two contents are equal and switches; where they
// are not, it refuses with one line naming the difference and leaves the change where it is.
test('branch drops a migrated config that the target branch already holds, and refuses one that differs', () => {
  const repo = repoWithConfig({ configVersion: 1, repos: ['api'] });
  const gitOut = (args) => execFileSync('git', args, { cwd: repo.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // On main, with the committed config at version 1: a command writes the migration. -> its bytes
  const migrate = () => {
    const r = runCli(['status'], { cwd: repo.root });
    assert.match(r.stderr, /^config: migrated \.slicekit\/config\.json from configVersion 1 to 2$/m);
    assert.equal(gitOut(['diff', '--name-only', 'HEAD']), '.slicekit/config.json');
    return fs.readFileSync(repo.file);
  };
  // A plan branch that holds `content` as its committed config; the session is back on main after it.
  const planBranch = (name, content) => {
    gitOut(['switch', '-q', '-c', name]);
    fs.writeFileSync(repo.file, content);
    gitOut(['commit', '-q', '-am', 'chore: the migrated config']);
    gitOut(['switch', '-q', 'main']);
  };
  try {
    gitOut(['add', '-A']);
    gitOut(['commit', '-q', '-m', 'config']);
    const migrated = migrate();
    assert.equal(JSON.parse(migrated.toString('utf8')).configVersion, 2);

    // plan/config-2 holds the migrated config as the migration writes it.
    planBranch('plan/config-2', migrated);
    assert.ok(migrate().equals(migrated));
    const cut = runCli(['branch', 'plan', 'config-2'], { cwd: repo.root });
    assert.equal(cut.code, 0, cut.stdout + cut.stderr);
    assert.equal(cut.stdout, 'plan/config-2\n');
    assert.doesNotMatch(cut.stderr, /commit or stash|would be overwritten/);
    assert.equal(gitOut(['rev-parse', '--abbrev-ref', 'HEAD']), 'plan/config-2');
    assert.ok(fs.readFileSync(repo.file).equals(migrated), 'the config on the plan branch is not the migrated one');
    assert.equal(gitOut(['status', '--porcelain', '--untracked-files=no']), '', 'the dropped copy left a change behind');
    assert.equal(gitOut(['stash', 'list']), '', 'the change was stashed, not dropped');

    // plan/config-3 holds a config at the newer version that is not what the migration writes.
    gitOut(['switch', '-q', 'main']);
    const other = Buffer.from(`${JSON.stringify({ ...JSON.parse(migrated.toString('utf8')), name: 'other-team' }, null, 2)}\n`);
    assert.ok(migrate().equals(migrated));
    planBranch('plan/config-3', other);
    assert.ok(migrate().equals(migrated));
    const refused = runCli(['branch', 'plan', 'config-3'], { cwd: repo.root });
    assert.equal(refused.code, 1, refused.stdout + refused.stderr);
    assert.equal(refused.stdout, '');
    const lines = refused.stderr.split(/\r?\n/).filter((l) => l.trim() !== '');
    assert.equal(lines.length, 1, refused.stderr);
    assert.ok(lines[0].startsWith('slicekit: '), refused.stderr);
    // The line names the two files and where they differ: the `name` field.
    assert.ok(lines[0].includes('.slicekit/config.json') && lines[0].includes('plan/config-3'), refused.stderr);
    assert.match(lines[0], /\bname\b/);
    assert.doesNotMatch(refused.stderr, /would be overwritten/);
    assert.equal(gitOut(['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
    assert.ok(fs.readFileSync(repo.file).equals(migrated), 'a refusal changed the config');
    assert.equal(gitOut(['diff', '--name-only', 'HEAD']), '.slicekit/config.json');
  } finally {
    repo.cleanup();
  }
});

// P6/S-51 (REQ-5.6, issue #171, D-94): the target branch holds the migrated config with other line endings,
// or with other whitespace at its end, than the migration writes. The two are the same config, so
// the command drops its own copy and switches; afterwards the file on disk is the branch's committed
// bytes and git has nothing staged and nothing changed.
test("branch leaves no staged config when the branch's config differs only in its line endings", () => {
  const repo = repoWithConfig({ configVersion: 1, repos: ['api'] });
  const gitOut = (args) => execFileSync('git', args, { cwd: repo.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // The bytes of the config a branch holds, as committed.
  const committedOn = (branch) => execFileSync('git', ['cat-file', 'blob', `${branch}:.slicekit/config.json`], { cwd: repo.root, stdio: ['ignore', 'pipe', 'pipe'] });
  // On main, with the committed config at version 1: a command writes the migration. -> its bytes
  const migrate = () => {
    const r = runCli(['status'], { cwd: repo.root });
    assert.match(r.stderr, /^config: migrated \.slicekit\/config\.json from configVersion 1 to 2$/m);
    assert.equal(gitOut(['diff', '--name-only', 'HEAD']), '.slicekit/config.json');
    return fs.readFileSync(repo.file);
  };
  // A plan branch that holds `content` as its committed config; the session is back on main after it.
  const planBranch = (name, content) => {
    gitOut(['switch', '-q', '-c', name]);
    fs.writeFileSync(repo.file, content);
    gitOut(['commit', '-q', '-am', 'chore: the migrated config']);
    gitOut(['switch', '-q', 'main']);
  };
  try {
    // A blob holds the bytes written and a checkout writes the blob's bytes, whatever this machine's git converts.
    gitOut(['config', 'core.autocrlf', 'false']);
    gitOut(['add', '-A']);
    gitOut(['commit', '-q', '-m', 'config']);
    const migrated = migrate();
    const text = migrated.toString('utf8');
    assert.ok(!text.includes('\r') && text.endsWith('}\n'), 'the migration writes LF lines and one newline at the end');
    const variants = [
      ['plan/config-crlf', 'CRLF line endings', Buffer.from(text.replace(/\n/g, '\r\n'))],
      ['plan/config-blank', 'a blank line and spaces at its end', Buffer.from(`${text}  \n\n`)],
    ];
    for (const [name, what, content] of variants) {
      planBranch(name, content);
      assert.ok(committedOn(name).equals(content), `${what}: the branch does not hold the bytes written`);
      assert.ok(!content.equals(migrated), what);
      assert.ok(migrate().equals(migrated), what);

      const cut = runCli(['branch', 'plan', name.slice('plan/'.length)], { cwd: repo.root });
      assert.equal(cut.code, 0, `${what}: ${cut.stdout}${cut.stderr}`);
      assert.equal(cut.stdout, `${name}\n`, what);
      assert.doesNotMatch(cut.stderr, /commit or stash|would be overwritten/, what);
      assert.equal(gitOut(['rev-parse', '--abbrev-ref', 'HEAD']), name, what);
      // The config on disk is the branch's committed bytes; nothing is staged, nothing is changed.
      assert.ok(fs.readFileSync(repo.file).equals(committedOn(name)), `${what}: the config on disk is not the branch's committed bytes`);
      assert.equal(gitOut(['status', '--porcelain']), '', `${what}: the dropped copy left a change behind`);
      assert.equal(gitOut(['diff', '--cached', '--name-only']), '', `${what}: the config is staged`);
      assert.equal(gitOut(['stash', 'list']), '', `${what}: the change was stashed, not dropped`);
      gitOut(['switch', '-q', 'main']);
    }
  } finally {
    repo.cleanup();
  }
});
