import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../src/init.js';
import { ConfigError, loadConfig, validateConfig } from '../src/config.js';
import { buildContext } from '../src/check/context.js';
import hooksRule from '../src/check/rules/hooks.js';
import { git } from '../src/git.js';
import { kitPaths } from '../src/paths.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { binPath, runCli } from './helpers/run-cli.js';

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const isDir = (root, rel) => fs.statSync(path.join(root, rel)).isDirectory();

function withRepo(fn, opts) {
  const repo = makeRepo(opts);
  try {
    return fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

test('creates the layout for shape backend', () => {
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend' });
    const files = [
      '.slicekit/config.json',
      '.slicekit/baselines/references.json',
      '.slicekit/baselines/style.json',
      'docs/decisions.md',
      'docs/spec/00-overview.md',
      'docs/spec/gaps.md',
      'docs/spec/stack.md',
      'docs/platform.md',
      'docs/observability.md',
      'docs/runbook.md',
      'BUILD.md',
    ];
    for (const rel of files) assert.ok(fs.statSync(path.join(root, rel)).isFile(), rel);
    const dirs = [
      '.slicekit/state',
      'docs/intake',
      'docs/spec/contracts',
      'docs/phases',
      'docs/releases',
      '.githooks',
    ];
    for (const rel of dirs) assert.ok(isDir(root, rel), rel);
    assert.deepEqual(JSON.parse(read(root, '.slicekit/baselines/references.json')), {});
    assert.deepEqual(JSON.parse(read(root, '.slicekit/baselines/style.json')), {});
    const cfg = JSON.parse(read(root, '.slicekit/config.json'));
    assert.deepEqual(validateConfig(cfg), []);
    assert.equal(cfg.name, 'demo');
    assert.equal(cfg.shape, 'backend');
    assert.equal(fs.existsSync(path.join(root, '.slicekit/journal')), false);
    assert.match(read(root, 'docs/runbook.md'), /^# Runbook: demo$/m);
    assert.match(read(root, 'BUILD.md'), /Spec: `docs\/spec\/`/);
    assert.match(read(root, 'docs/spec/00-overview.md'), /^Source: \.\.\/intake\/$/m);
  });
});

test('creates platform, observability and runbook with "Not yet known" sections', () => {
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend' });
    const expected = {
      'docs/platform.md': [
        'Providers and services',
        'Environments',
        'How a change reaches each environment',
        'Access and ownership',
        'Secrets',
        'Network boundaries',
      ],
      'docs/observability.md': [
        'Dashboards',
        'Alert routes',
        'Log shape and required fields',
        'Trace and correlation IDs',
        'CI steps the monitoring setup requires',
        'On-call contact',
      ],
      'docs/runbook.md': [
        'How to run it',
        'Dependencies and their owners',
        'Known failure modes and the first thing to check',
        'Actions and who may take them',
        'Rollback',
      ],
    };
    for (const [rel, headings] of Object.entries(expected)) {
      const text = read(root, rel);
      for (const heading of headings) {
        assert.ok(text.includes(`## ${heading}\n\nNot yet known\n`), `${rel}: ${heading}`);
      }
    }
  });
});

test('second run skips everything and overwrites nothing', () => {
  withRepo((root) => {
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs/README.md'), 'X');
    const opts = { name: 'demo', shape: 'backend' };
    const first = init(root, opts);
    fs.writeFileSync(path.join(root, 'docs/platform.md'), 'edited');
    const second = init(root, opts);
    assert.equal(read(root, 'docs/README.md'), 'X');
    assert.equal(read(root, 'docs/platform.md'), 'edited');
    assert.deepEqual(second.created, []);
    assert.deepEqual(second.skipped, first.created);
    assert.ok(first.created.includes('docs/platform.md'));
    assert.deepEqual(first.created, [...first.created].sort());
  });
});

test('init on a repo with no commits', () => {
  withRepo((root) => {
    const result = init(root, { name: 'demo', shape: 'fullstack', cli: 'slicekit' });
    assert.ok(result.created.includes('.slicekit/config.json'));
    assert.ok(isDir(root, '.githooks'));
    // REQ-3.9: init now sets the hooks path that S-01 left unset.
    assert.equal(git(root, ['config', '--local', 'core.hooksPath']), '.githooks');
    assert.deepEqual(result.warnings, []);
  }, { commits: 0 });
});

test('init outside a git repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-plain-'));
  try {
    const r = runCli(['init', '--shape', 'data', '--name', 'demo'], { cwd: root });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, 'slicekit: not a git repository\n');
    assert.match(r.stdout, /^created \.slicekit\/config\.json$/m);
    assert.equal(fs.existsSync(path.join(root, '.git')), false);
    const direct = init(root, { name: 'demo', shape: 'data' });
    assert.deepEqual(direct.warnings, ['not a git repository']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cli: init from a subdirectory exits 2 and writes nothing', () => {
  withRepo((root) => {
    const sub = path.join(root, 'pkg', 'inner');
    fs.mkdirSync(sub, { recursive: true });
    const r = runCli(['init', '--shape', 'backend'], { cwd: sub });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /run slicekit init from the repository root: /);
    assert.equal(r.stdout, '');
    assert.deepEqual(fs.readdirSync(root).sort(), ['.git', 'pkg']);
    assert.deepEqual(fs.readdirSync(sub), []);
    const top = runCli(['init', '--shape', 'backend'], { cwd: root });
    assert.equal(top.code, 0);
    assert.equal(top.stderr, '');
  });
});

test('cli: an existing config is the truth for shape and docsRoot', () => {
  withRepo((root) => {
    assert.equal(runCli(['init', '--shape', 'backend', '--docs', 'handbook'], { cwd: root }).code, 0);
    const shape = runCli(['init', '--shape', 'data'], { cwd: root });
    assert.equal(shape.code, 2);
    assert.match(shape.stderr, /config\.json already sets shape = backend; remove the flag or edit the config/);
    const docs = runCli(['init', '--docs', 'docs'], { cwd: root });
    assert.equal(docs.code, 2);
    assert.match(docs.stderr, /config\.json already sets docsRoot = handbook; remove the flag or edit the config/);
    assert.equal(fs.existsSync(path.join(root, 'docs')), false);
    for (const args of [[], ['--shape', 'backend', '--docs', 'handbook']]) {
      const again = runCli(['init', ...args], { cwd: root });
      assert.equal(again.code, 0, args.join(' '));
      assert.doesNotMatch(again.stdout, /^created /m);
      assert.match(again.stdout, /^skipped handbook\/decisions\.md$/m);
    }
    assert.equal(fs.existsSync(path.join(root, 'docs')), false);
    assert.equal(JSON.parse(read(root, '.slicekit/config.json')).shape, 'backend');
  });
});

test('cli: --docs outside the repo exits 2 and writes nothing', () => {
  withRepo((root) => {
    const r = runCli(['init', '--shape', 'backend', '--docs', '../outside'], { cwd: root });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /docsRoot: no \.\. segment/);
    assert.deepEqual(fs.readdirSync(root), ['.git']);
    assert.equal(fs.existsSync(path.join(root, '..', 'outside')), false);
  });
});

test('cli: --docs is normalised to forward slashes without a trailing slash', () => {
  withRepo((root) => {
    const r = runCli(['init', '--shape', 'backend', '--docs', 'handbook\\specs\\'], { cwd: root });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(read(root, '.slicekit/config.json')).docsRoot, 'handbook/specs');
    assert.ok(fs.existsSync(path.join(root, 'handbook/specs/decisions.md')));
  });
});

test('writes gitignore rule once', () => {
  const JOURNAL = '!.slicekit/journal/\n!.slicekit/journal/*.log\n.slicekit/journal/*.lock\n';
  const ROOTED = '!/.slicekit/journal/\n!/.slicekit/journal/*.log\n/.slicekit/journal/*.lock\n';
  const rules = `.slicekit/graph/\n.slicekit/.subagent-*\n${JOURNAL}`;
  withRepo((root) => {
    const opts = { name: 'demo', shape: 'backend' };
    const first = init(root, opts);
    assert.ok(first.created.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), rules);
    const second = init(root, opts);
    assert.ok(second.skipped.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), rules);
  });
  withRepo((root) => {
    const result = init(root, { name: 'demo', shape: 'backend' });
    assert.ok(result.updated.includes('.gitignore'));
    assert.ok(!result.skipped.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), `node_modules\n${rules}`);
  }, { files: { '.gitignore': 'node_modules' } });
  for (const form of ['/.slicekit/graph/', '.slicekit/graph']) {
    withRepo((root) => {
      const result = init(root, { name: 'demo', shape: 'backend' });
      assert.ok(result.skipped.includes('.gitignore'), form);
      assert.equal(read(root, '.gitignore'), `${form}\n/.slicekit/.subagent-*\n${ROOTED}`);
    }, { files: { '.gitignore': `${form}\n/.slicekit/.subagent-*\n${ROOTED}` } });
  }
  // Each rule is added once when absent: with the graph rule present, only the others are appended.
  withRepo((root) => {
    const result = init(root, { name: 'demo', shape: 'backend' });
    assert.ok(result.updated.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), `/.slicekit/graph\n.slicekit/.subagent-*\n${JOURNAL}`);
  }, { files: { '.gitignore': '/.slicekit/graph\n' } });
});

// Whole-branch I2: a project that ignores *.log still commits its journal files; their locks stay ignored.
test('init un-ignores journal files after a *.log rule and ignores their locks', () => {
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend' });
    const ignored = (rel) => {
      const file = path.join(root, ...rel.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
      try {
        git(root, ['check-ignore', '--quiet', rel]);
        return true;
      } catch {
        return false;
      }
    };
    assert.equal(ignored('.slicekit/journal/main--0123abcd.log'), false);
    assert.equal(ignored('.slicekit/journal/main--0123abcd.log.lock'), true);
    assert.equal(ignored('build/other.log'), true);
  }, { files: { '.gitignore': 'node_modules\n*.log\n' } });
});

test('every kitPaths entry S-01 owns exists after init', () => {
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend' });
    const cfg = JSON.parse(read(root, '.slicekit/config.json'));
    const p = kitPaths(root, cfg);
    const owned = ['config', 'state', 'baselines', 'intake', 'decisions', 'spec', 'contracts', 'gaps', 'stack',
      'platform', 'observability', 'runbook', 'phases', 'releases', 'build', 'githooks'];
    for (const key of owned) assert.ok(fs.existsSync(p[key]), key);
  });
});

test('cli prints updated for an appended gitignore', () => {
  withRepo((root) => {
    const r = runCli(['init', '--shape', 'backend'], { cwd: root });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^updated \.gitignore$/m);
  }, { files: { '.gitignore': 'node_modules\n' } });
});

test('a bad shape throws ConfigError and writes nothing', () => {
  withRepo((root) => {
    assert.throws(() => init(root, { name: 'demo', shape: 'nope' }), ConfigError);
    assert.equal(fs.existsSync(path.join(root, '.slicekit')), false);
  });
});

test('cli: no shape prints usage and exits 2; bad shape prints the error', () => {
  withRepo((root) => {
    const none = runCli(['init'], { cwd: root });
    assert.equal(none.code, 2);
    assert.match(none.stderr, /usage: slicekit init --shape/);
    const bad = runCli(['init', '--shape', 'nope'], { cwd: root });
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /shape: must be one of/);
  });
});

test('cli: flags reach the config', () => {
  withRepo((root) => {
    const r = runCli(['init', '--shape', 'backend', '--docs', 'handbook', '--test', 'npm test'], { cwd: root });
    assert.equal(r.code, 0);
    const cfg = JSON.parse(read(root, '.slicekit/config.json'));
    assert.equal(cfg.docsRoot, 'handbook');
    assert.equal(cfg.commands.test, 'npm test');
    assert.equal(cfg.name, path.basename(root));
    assert.ok(fs.existsSync(path.join(root, 'handbook/decisions.md')));
  });
});

test('cli: a corrupt .claude/settings.json exits 2 and nothing else is created', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-bad-settings-'));
  try {
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude/settings.json'), '{nope');
    const r = runCli(['init', '--shape', 'backend'], { cwd: root });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^slicekit: \.claude\/settings\.json is not valid JSON/);
    assert.equal(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'), '{nope');
    assert.deepEqual(fs.readdirSync(root).sort(), ['.claude']);
    assert.deepEqual(fs.readdirSync(path.join(root, '.claude')), ['settings.json']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const HOOK_WARNING = (cli) =>
  `slicekit: hook command "${cli}" did not answer; hooks will report errors on every tool call until .slicekit/config.json cli is fixed\n`;

test('cli: init prints the hook command it chose and checks that it answers', () => {
  withRepo((root) => {
    const r = runCli(['init', '--shape', 'backend'], { cwd: root });
    assert.equal(r.code, 0, r.stderr);
    const cli = JSON.parse(read(root, '.slicekit/config.json')).cli;
    assert.equal(r.stdout.split('\n').filter((l) => l === `hooks run: ${cli}`).length, 1);
    assert.equal(r.stderr, '');
  });
});

// PATH without any slicekit (the shim or a global install), so the probe finds nothing.
function pathWithoutSlicekit() {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const names = process.platform === 'win32' ? ['slicekit.cmd', 'slicekit.exe', 'slicekit.bat', 'slicekit'] : ['slicekit'];
  const dirs = (process.env[key] ?? '').split(path.delimiter).filter((d) => d && !names.some((n) => fs.existsSync(path.join(d, n))));
  return { ...process.env, [key]: dirs.join(path.delimiter) };
}

test('cli: init with slicekit neither local nor on PATH warns once, never names npx, and exits 0', () => {
  withRepo((root) => {
    const r = runCli(['init', '--shape', 'backend'], { cwd: root, env: pathWithoutSlicekit(), shim: false });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(
      r.stderr,
      'slicekit: slicekit is not installed locally or on PATH; hooks will fail until it is (npm i -D slicekit, or set cli in .slicekit/config.json)\n',
    );
    assert.match(r.stdout, /^hooks run: slicekit$/m);
    assert.equal(JSON.parse(read(root, '.slicekit/config.json')).cli, 'slicekit');
    assert.doesNotMatch(read(root, '.claude/settings.json'), /npx/);
  });
});

test('cli: --cli overrides the probe and lands in config and settings', () => {
  withRepo((root) => {
    const cli = `node "${binPath}"`;
    const r = runCli(['init', '--shape', 'backend', '--cli', cli], { cwd: root });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, new RegExp(`^hooks run: ${cli.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}$`, 'm'));
    assert.equal(JSON.parse(read(root, '.slicekit/config.json')).cli, cli);
    assert.ok(JSON.parse(read(root, '.claude/settings.json')).hooks.Stop[0].hooks[0].command.startsWith(`${cli} hook `));
  });
});

test('cli: a hook command that does not answer warns on init and on update', () => {
  withRepo((root) => {
    const cli = 'node -e "process.exit(3)"';
    const r = runCli(['init', '--shape', 'backend', '--cli', cli], { cwd: root });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, HOOK_WARNING(cli));
    const u = runCli(['update', '--yes'], { cwd: root });
    assert.equal(u.code, 0);
    assert.equal(u.stderr, HOOK_WARNING(cli));
  });
});

const HOOKS = ['pre-commit', 'pre-merge-commit', 'prepare-commit-msg'];
const template = (name) => fs.readFileSync(new URL(`../templates/githooks/${name}`, import.meta.url), 'utf8');

// REQ-3.9: init writes both git hooks, executable, and points core.hooksPath at them.
test('init installs the git hooks and sets core.hooksPath', () => {
  withRepo((root) => {
    const result = init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    for (const name of HOOKS) {
      const rel = `.githooks/${name}`;
      assert.ok(result.created.includes(rel), rel);
      assert.equal(read(root, rel), template(name));
      assert.ok(!read(root, rel).includes('\r'), rel);
      if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, rel)).mode & 0o777, 0o755, rel);
    }
    assert.equal(git(root, ['config', 'core.hooksPath']), '.githooks');
    assert.deepEqual(result.warnings, []);
    const second = init(root, { name: 'demo', shape: 'backend' });
    for (const name of HOOKS) assert.ok(second.skipped.includes(`.githooks/${name}`), name);
    assert.deepEqual(second.warnings, []);
  });
});

test('init leaves another core.hooksPath alone and says so', () => {
  withRepo((root) => {
    git(root, ['config', 'core.hooksPath', '.husky']);
    const result = init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    assert.equal(git(root, ['config', 'core.hooksPath']), '.husky');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /core\.hooksPath is \.husky/);
  });
});

test('init warns that hooks in .git/hooks stop running', () => {
  withRepo((root) => {
    fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-push'), '#!/bin/sh\n');
    const result = init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    assert.equal(git(root, ['config', 'core.hooksPath']), '.githooks');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /\.git\/hooks\/pre-push/);
    assert.match(result.warnings[0], /stop running/);
  });
});

test('init never overwrites a team hook that differs from the template', () => {
  withRepo((root) => {
    const result = init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    assert.equal(read(root, '.githooks/pre-commit'), '#!/bin/sh\nexit 0\n');
    assert.ok(result.skipped.includes('.githooks/pre-commit'));
    assert.ok(result.created.includes('.githooks/prepare-commit-msg'));
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /\.githooks\/pre-commit/);
  }, { files: { '.githooks/pre-commit': '#!/bin/sh\nexit 0\n' } });
});

test('init outside a repo writes the hooks and sets no hooks path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-plain-'));
  try {
    const result = init(root, { name: 'demo', shape: 'data', cli: 'slicekit' });
    assert.deepEqual(result.warnings, ['not a git repository']);
    for (const name of HOOKS) assert.ok(result.created.includes(`.githooks/${name}`), name);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// R2: hooks checked out with CRLF break sh, so init pins .githooks/* to LF.
test('init writes the .githooks eol rule to .gitattributes once', () => {
  withRepo((root) => {
    const first = init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    assert.ok(first.created.includes('.gitattributes'));
    assert.equal(read(root, '.gitattributes'), '.githooks/* text eol=lf\n');
    const second = init(root, { name: 'demo', shape: 'backend' });
    assert.ok(second.skipped.includes('.gitattributes'));
    assert.equal(read(root, '.gitattributes'), '.githooks/* text eol=lf\n');
  });
  withRepo((root) => {
    const result = init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    assert.ok(result.updated.includes('.gitattributes'));
    assert.equal(read(root, '.gitattributes'), '* text=auto\n.githooks/* text eol=lf\n');
  }, { files: { '.gitattributes': '* text=auto\n' } });
  withRepo((root) => {
    const result = init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    assert.ok(result.skipped.includes('.gitattributes'));
  }, { files: { '.gitattributes': '/.githooks/*   text  eol=lf\n' } });
});

// M5: a CRLF file gets CRLF lines appended.
test('init keeps a CRLF ignore or attributes file CRLF', () => {
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    const kit = '.slicekit/graph/\r\n.slicekit/.subagent-*\r\n!.slicekit/journal/\r\n!.slicekit/journal/*.log\r\n.slicekit/journal/*.lock\r\n';
    assert.equal(read(root, '.gitignore'), `node_modules\r\n${kit}`);
    assert.equal(read(root, '.gitattributes'), '* text=auto\r\n.githooks/* text eol=lf\r\n');
  }, { files: { '.gitignore': 'node_modules\r\n', '.gitattributes': '* text=auto' + '\r\n' } });
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    assert.equal(read(root, '.gitignore'), 'a\r\nb\r\n.slicekit/graph/\r\n.slicekit/.subagent-*\r\n!.slicekit/journal/\r\n!.slicekit/journal/*.log\r\n.slicekit/journal/*.lock\r\n');
  }, { files: { '.gitignore': 'a\r\nb' } });
});

// I3: on win32 a new file is staged 100644; init stages its hooks executable so the first commit
// records 100755. D-19: init never commits.
test('init stages the hooks it creates as executable, with or without commits', () => {
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    const staged = git(root, ['ls-files', '-s', '.githooks']).split('\n').map((l) => [l.split('\t')[1], l.split(' ')[0]]);
    assert.deepEqual(staged, HOOKS.map((n) => [`.githooks/${n}`, '100755']));
    assert.equal(git(root, ['rev-list', '--count', 'HEAD']), '1');
  }, { commits: 1 });
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    const staged = git(root, ['ls-files', '-s', '.githooks']).split('\n').map((l) => [l.split('\t')[1], l.split(' ')[0]]);
    assert.deepEqual(staged, HOOKS.map((n) => [`.githooks/${n}`, '100755']));
    assert.equal(git(root, ['rev-list', '--all', '--count']), '0');
  }, { commits: 0 });
});

// M2: the absolute path to .githooks is already installed.
test('init treats another spelling of .githooks as installed', () => {
  withRepo((root) => {
    const abs = path.join(root, '.githooks').split(path.sep).join('/');
    git(root, ['config', 'core.hooksPath', abs]);
    const result = init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    assert.deepEqual(result.warnings, []);
    assert.equal(git(root, ['config', 'core.hooksPath']), abs);
  });
});

// ---- final fix wave ----

// I1: in a fresh repository, the first `git add -A` keeps the hooks executable and check is clean.
test('in a fresh repository the hooks stay executable through git add -A', () => {
  withRepo((root) => {
    init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' });
    git(root, ['add', '-A']);
    const staged = git(root, ['ls-files', '-s', ...HOOKS.map((n) => `.githooks/${n}`)]).split('\n').map((l) => [l.split('\t')[1], l.split(' ')[0]]);
    assert.deepEqual(staged, HOOKS.map((n) => [`.githooks/${n}`, '100755']));
    const ctx = buildContext(root, loadConfig(root));
    assert.deepEqual(hooksRule.run(ctx), []);
  }, { commits: 0 });
});

// M6
const UNBORN_NEXT = 'commit this scaffold with ALLOW_PROTECTED_COMMIT=1 git commit …, or start on a slice branch';
test('init on an unborn protected branch says how to make the first commit', () => {
  withRepo((root) => {
    assert.equal(init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' }).next, UNBORN_NEXT);
    const r = runCli(['init', '--shape', 'backend', '--name', 'demo', '--cli', 'slicekit'], { cwd: root });
    assert.equal(r.stdout.split('\n').filter((l) => l === UNBORN_NEXT).length, 1);
  }, { commits: 0 });
  withRepo((root) => {
    assert.equal(init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' }).next, null);
  }, { commits: 0, branch: 'slice/P1-S-01-x' });
  withRepo((root) => {
    assert.equal(init(root, { name: 'demo', shape: 'backend', cli: 'slicekit' }).next, null);
  }, { commits: 1 });
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-plain-'));
  try {
    assert.equal(init(plain, { name: 'demo', shape: 'backend', cli: 'slicekit' }).next, null);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});
