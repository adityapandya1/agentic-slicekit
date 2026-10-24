import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../src/init.js';
import { ConfigError, validateConfig } from '../src/config.js';
import { git, GitError } from '../src/git.js';
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
    assert.equal(fs.existsSync(path.join(root, '.slicekit/journal.log')), false);
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
    const result = init(root, { name: 'demo', shape: 'fullstack' });
    assert.ok(result.created.includes('.slicekit/config.json'));
    assert.ok(isDir(root, '.githooks'));
    assert.throws(() => git(root, ['config', '--local', 'core.hooksPath']), GitError);
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
  withRepo((root) => {
    const opts = { name: 'demo', shape: 'backend' };
    const first = init(root, opts);
    assert.ok(first.created.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), '.slicekit/graph/\n');
    const second = init(root, opts);
    assert.ok(second.skipped.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), '.slicekit/graph/\n');
  });
  withRepo((root) => {
    const result = init(root, { name: 'demo', shape: 'backend' });
    assert.ok(result.updated.includes('.gitignore'));
    assert.ok(!result.skipped.includes('.gitignore'));
    assert.equal(read(root, '.gitignore'), 'node_modules\n.slicekit/graph/\n');
  }, { files: { '.gitignore': 'node_modules' } });
  for (const form of ['/.slicekit/graph/', '.slicekit/graph']) {
    withRepo((root) => {
      const result = init(root, { name: 'demo', shape: 'backend' });
      assert.ok(result.skipped.includes('.gitignore'), form);
      assert.equal(read(root, '.gitignore'), `${form}\n`);
    }, { files: { '.gitignore': `${form}\n` } });
  }
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
