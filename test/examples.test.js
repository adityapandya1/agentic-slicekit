// P5/S-24 (REQ-5.5, D-59): the three example projects. examples/backend is kept before init, as the
// README walkthrough needs it; examples/fullstack and examples/data are committed as init and
// `status --write` leave them. Each one checks green in a fresh git repository, every rendered file
// it holds equals what the running kit renders, and its one slice can be taken to a draft pull
// request with a fixture git host, after which the graph and every query answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { kitVersion } from '../src/render/index.js';
import { planUpdate } from '../src/render/update.js';
import { binPath, runCli } from './helpers/run-cli.js';

const KIT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const EXAMPLES = ['backend', 'fullstack', 'data'];
const SLICE = 'P1/S-01';

function git(root, args, env = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim();
}

function write(root, rel, text) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const tmp = (prefix) => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const remove = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows can hold handles briefly; the OS temp cleaner takes it.
  }
};

// The example copied into os.tmpdir() as a fresh git repository on main, with core.hooksPath set
// and everything committed. examples/backend is committed before init, so its copy gets
// `init --shape backend --cli <kit>` and `status --write` first, as the README walkthrough runs them.
function copyExample(name) {
  const source = path.join(KIT_ROOT, 'examples', name);
  assert.ok(fs.existsSync(path.join(source, '.slicekit', 'config.json')), `examples/${name} holds no .slicekit/config.json`);
  const root = tmp(`slicekit-example-${name}-`);
  const cleanup = () => remove(root);
  try {
    fs.cpSync(source, root, { recursive: true });
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.name', 'Slicekit Test']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    if (name === 'backend') {
      const cli = `node "${binPath.split(path.sep).join('/')}"`;
      const init = runCli(['init', '--shape', 'backend', '--cli', cli], { cwd: root });
      assert.equal(init.code, 0, `init in examples/backend: ${init.stdout}${init.stderr}`);
      const status = runCli(['status', '--write'], { cwd: root });
      assert.equal(status.code, 0, `status --write in examples/backend: ${status.stdout}${status.stderr}`);
    }
    git(root, ['config', 'core.hooksPath', '.githooks']);
    git(root, ['add', '-A']);
    // As init does: on Windows a plain add records the hooks as not executable, which the hooks rule reports.
    git(root, ['add', '--chmod=+x', '--', '.githooks/pre-commit', '.githooks/pre-merge-commit', '.githooks/prepare-commit-msg']);
    git(root, ['commit', '-q', '-m', 'chore: slicekit init'], { ALLOW_PROTECTED_COMMIT: '1' });
  } catch (e) {
    cleanup();
    throw e;
  }
  return { root, cleanup };
}

// The files slicekit renders whose `slicekit update` plan, at the running kit's version, is not `same`.
function renderDrift(root) {
  return planUpdate(root, loadConfig(root), { version: kitVersion() })
    .filter((item) => item.status !== 'same')
    .map((item) => item.dest);
}

const withExample = (name, fn) => {
  const example = copyExample(name);
  try {
    return fn(example.root);
  } finally {
    example.cleanup();
  }
};

// The one file under docs/phases that holds the slice P1/S-01, relative to the root.
function sliceFile(root) {
  const phases = path.join(root, 'docs', 'phases');
  for (const phase of fs.readdirSync(phases, { withFileTypes: true })) {
    if (!phase.isDirectory()) continue;
    for (const name of fs.readdirSync(path.join(phases, phase.name))) {
      const rel = `docs/phases/${phase.name}/${name}`;
      if (/^S-01\b.*\.md$/.test(name) && fs.readFileSync(path.join(root, rel), 'utf8').includes(`slice: ${SLICE}`)) return rel;
    }
  }
  throw new Error(`no slice file for ${SLICE} under docs/phases`);
}

// The rows of a slice file's evaluation set: [{file, title}].
function evaluationRows(text) {
  return [...text.matchAll(/^\| `([\w.-]+) » ([^`]+)` \|/gm)].map((m) => ({ file: m[1], title: m[2] }));
}

test('every example checks green', { timeout: 300_000 }, () => {
  for (const name of EXAMPLES) {
    withExample(name, (root) => {
      const r = runCli(['check'], { cwd: root });
      assert.equal(r.code, 0, `examples/${name}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /^check: 0 findings\b/m, `examples/${name}: ${r.stdout}`);
    });
  }
});

test('a rendered adapter file that differs from its template fails, naming the file', { timeout: 300_000 }, () => {
  // As committed, no rendered file of any example differs from what the running kit renders.
  for (const name of EXAMPLES) {
    withExample(name, (root) => assert.deepEqual(renderDrift(root), [], `examples/${name} holds rendered files that differ; run slicekit update --yes in it`));
  }
  // D-59: these two hold their rendered files in the kit's repository, so the comparison has files to read.
  for (const name of ['fullstack', 'data']) {
    for (const rel of ['.claude/commands/slicekit.md', '.claude/settings.json', '.githooks/pre-commit', 'BUILD.md', `.slicekit/rendered/${kitVersion()}`]) {
      assert.ok(fs.existsSync(path.join(KIT_ROOT, 'examples', name, ...rel.split('/'))), `examples/${name}/${rel} is not committed`);
    }
  }
  assert.ok(fs.existsSync(path.join(KIT_ROOT, 'examples', 'fullstack', '.claude', 'agents', 'designer.md')), 'examples/fullstack holds no designer agent');
  assert.equal(fs.existsSync(path.join(KIT_ROOT, 'examples', 'backend', '.claude')), false, 'examples/backend stays before init');

  // One line added to a rendered file: the comparison names it, and so does check's managed rule.
  withExample('fullstack', (root) => {
    const dest = '.claude/commands/slicekit.md';
    const file = path.join(root, ...dest.split('/'));
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const at = lines.findIndex((l, i) => i > 0 && l.trim() === '---') + 1;
    assert.ok(at > 0, `${dest} has no front matter`);
    lines.splice(at + 1, 0, 'A line the kit did not render.');
    fs.writeFileSync(file, lines.join('\n'));
    assert.deepEqual(renderDrift(root), [dest]);
    const r = runCli(['check'], { cwd: root });
    assert.notEqual(r.code, 0, r.stdout);
    const finding = r.stdout.split('\n').find((l) => l.startsWith(`managed ${dest}:`));
    assert.ok(finding, `no managed finding names ${dest}:\n${r.stdout}`);
  });
});

test('each example takes its slice to a draft pull request, then graph and every query answer', { timeout: 600_000 }, () => {
  for (const name of EXAMPLES) {
    withExample(name, (root) => {
      const githost = tmp('slicekit-example-githost-');
      const tracker = tmp('slicekit-example-tracker-');
      try {
        const env = { ...process.env, SLICEKIT_GITHOST_FIXTURE: githost, SLICEKIT_TRACKER_FIXTURE: tracker };
        for (const k of ['GITHUB_EVENT_PATH', 'GITHUB_HEAD_REF', 'GITHUB_BASE_REF', 'SLICEKIT_PR_TITLE', 'SLICEKIT_PR_BODY', 'NODE_TEST_CONTEXT']) delete env[k];
        const cli = (...args) => runCli(args, { cwd: root, env });
        const ok = (...args) => {
          const r = cli(...args);
          assert.equal(r.code, 0, `examples/${name}: slicekit ${args.join(' ')}\n${r.stdout}${r.stderr}`);
          return r.stdout;
        };

        const rel = sliceFile(root);
        const sliceText = fs.readFileSync(path.join(root, rel), 'utf8');
        const sliceName = /^name: (.+)$/m.exec(sliceText)?.[1].trim();
        assert.ok(sliceName, `${rel} has no name`);
        const rows = evaluationRows(sliceText);
        assert.equal(rows.length, 2, `${rel}: ${JSON.stringify(rows)}`);
        assert.match(ok('state', 'show', SLICE), /^P1\/S-01\s+todo\b/);

        // todo -> tests-red: the evaluation set's tests, committed on the slice branch, failing.
        const branch = `slice/P1-S-01-${rel.split('/').pop().replace(/^S-01-?/, '').replace(/\.md$/, '') || 'example'}`;
        git(root, ['checkout', '-q', '-b', branch]);
        const tests = [...new Set(rows.map((r) => `test/${r.file}`))];
        for (const t of tests) {
          const titles = rows.filter((r) => `test/${r.file}` === t).map((r) => r.title);
          const body = titles.map((title) => `test(${JSON.stringify(title)}, () => assert.equal(typeof built, 'function'));\n`).join('');
          write(root, t, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { built } from '../src/built.js';\n\n${body}`);
        }
        git(root, ['add', '-A']);
        git(root, ['commit', '-q', '-m', `test(${SLICE}): red tests`]);
        const red = git(root, ['rev-parse', 'HEAD']);
        ok('state', 'set', SLICE, 'tests-red', '--commit', red, '--test-exit', '1', '--tests', tests.join(','));

        // tests-red -> building, then the code.
        ok('state', 'set', SLICE, 'building');
        write(root, 'src/built.js', 'export function built() {\n  return true;\n}\n');
        git(root, ['add', '-A']);
        git(root, ['commit', '-q', '-m', `feat(${SLICE}): the code`]);
        const head = git(root, ['rev-parse', 'HEAD']);

        // building -> draft-pr: pull request 1 on the fixture host.
        const title = `[${SLICE}] ${sliceName}`;
        const url = 'https://example.test/pull/1';
        const pr = { number: 1, url, state: 'OPEN', isDraft: true, headRefName: branch, baseRefName: 'main', title, body: '', headRefOid: head, labels: [] };
        fs.writeFileSync(path.join(githost, 'pr-1.json'), `${JSON.stringify(pr, null, 2)}\n`);
        ok('state', 'set', SLICE, 'draft-pr', '--test-exit', '0', '--check-exit', '0', '--pr-number', '1', '--pr-title', title, '--pr-url', url, '--pr-sha', head);
        assert.match(ok('state', 'show', SLICE), /^P1\/S-01\s+draft-pr\s+PR #1\b/);

        // The graph, then every query.
        ok('graph');
        assert.ok(ok('trace', 'REQ-1.1').includes(SLICE), `examples/${name}: trace REQ-1.1 does not name ${SLICE}`);
        ok('history', 'src');
        ok('impact', SLICE);
        ok('uncovered');
        const shipped = cli('shipped', 'P1');
        assert.equal(shipped.code, 1, `examples/${name}: shipped P1\n${shipped.stdout}${shipped.stderr}`);
        assert.ok(`${shipped.stdout}${shipped.stderr}`.includes('P1 has no release record'), `${shipped.stdout}${shipped.stderr}`);
        assert.match(ok('status'), /(^|\n)P1\/S-01\s+draft-pr\s+PR #1\b/);
      } finally {
        remove(githost);
        remove(tracker);
      }
    });
  }
});
