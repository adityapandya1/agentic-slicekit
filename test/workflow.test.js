// REQ-3.11: the generated GitHub Actions workflow (SHA-pinned actions, a job per declared command).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultConfig, loadConfig, validateConfig } from '../src/config.js';
import { init } from '../src/init.js';
import { PINS_PATH, WORKFLOW_PATH, loadPins, renderWorkflow, yamlScalar } from '../src/workflow.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { CI_PULL_REQUEST, runCli } from './helpers/run-cli.js';
import { appendJournal, journalFile, parseLine } from '../src/journal.js';

const GOLDEN = fileURLToPath(new URL('./fixtures/golden/workflow/backend.yml', import.meta.url));
const HEX40 = /^[0-9a-f]{40}$/;

// The fixed example config the golden file is rendered from.
function exampleConfig() {
  const cfg = defaultConfig({
    name: 'demo',
    shape: 'backend',
    cli: 'node node_modules/slicekit/bin/slicekit.js',
    commands: { test: 'node --test "test/**/*.test.js"', lint: 'npm run lint', build: '', e2e: '' },
  });
  cfg.ci.observabilitySteps = [
    { name: 'Smoke: staging health', run: 'curl -fsS "$STAGING_URL/health"', env: { STAGING_URL: 'https://staging.example.com' } },
  ];
  return cfg;
}

// Job ids: the two-space keys under `jobs:`.
const jobIds = (yml) => [...yml.slice(yml.indexOf('\njobs:\n')).matchAll(/^ {2}([A-Za-z0-9_-]+):$/gm)].map((m) => m[1]);
// The text of one job, from its id line up to the next job's id line.
const jobBlock = (yml, id) => {
  const lines = yml.split('\n');
  const start = lines.indexOf(`  ${id}:`, lines.indexOf('jobs:'));
  assert.notEqual(start, -1, `job ${id}`);
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:$/.test(lines[end]) && !/^\S/.test(lines[end])) end++;
  return lines.slice(start, end).join('\n') + '\n';
};

test('pins.json has 40-hex shas', () => {
  const pins = JSON.parse(fs.readFileSync(PINS_PATH, 'utf8'));
  assert.match(pins.resolved, /^\d{4}-\d{2}-\d{2}$/);
  for (const action of ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact']) {
    assert.match(pins[action].sha, HEX40, action);
    assert.match(pins[action].tag, /^v\d+\.\d+\.\d+$/, action);
  }
});

test('renders pinned actions and a job per non-empty command (REQ-3.11)', () => {
  const pins = loadPins();
  const yml = renderWorkflow(exampleConfig(), pins);
  const uses = [...yml.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  // actions/cache is used through its restore and save sub-actions (D-51).
  for (const u of uses) assert.match(u, /^actions\/[a-z-]+(?:\/(?:restore|save))?@[0-9a-f]{40}$/, u);
  assert.ok(yml.includes(`actions/checkout@${pins['actions/checkout'].sha} # ${pins['actions/checkout'].tag}`));
  assert.ok(yml.includes(`actions/setup-node@${pins['actions/setup-node'].sha} # ${pins['actions/setup-node'].tag}`));
  assert.ok(yml.includes(`actions/upload-artifact@${pins['actions/upload-artifact'].sha}`));
  assert.deepEqual(jobIds(yml), ['gate', 'cmd-test', 'cmd-lint', 'obs-1', 'checks', 'ready-label', 'sync']);
  assert.ok(jobBlock(yml, 'cmd-lint').includes('run: npm run lint\n'));
  assert.ok(jobBlock(yml, 'cmd-test').includes(`run: 'node --test "test/**/*.test.js"'\n`));

  const gate = jobBlock(yml, 'gate');
  assert.ok(gate.includes('fetch-depth: 0'));
  // fetch-depth 0 fetches every branch; with persist-credentials false a second fetch would have no token.
  assert.ok(gate.includes('git rev-parse --verify --quiet refs/remotes/origin/main'));
  assert.ok(gate.indexOf('git config core.hooksPath .githooks') < gate.indexOf('slicekit.js check --ci'));
  assert.ok(gate.includes('run: node node_modules/slicekit/bin/slicekit.js check --ci\n'));
  assert.ok(gate.includes("if: hashFiles('package-lock.json') != ''"));
  assert.ok(!gate.includes('write'), 'gate keeps read-only permissions');
  assert.ok(!yml.includes('npx'), 'never a registry fetch (D-30)');

  assert.ok(jobBlock(yml, 'checks').includes('needs: [gate, cmd-test, cmd-lint, obs-1]'));
  const ready = jobBlock(yml, 'ready-label');
  assert.ok(ready.includes('needs: [checks]'));
  assert.ok(ready.includes('pull-requests: write'));
  assert.ok(ready.includes('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}'));
  assert.ok(ready.includes('slicekit.js ready-label'));
  const sync = jobBlock(yml, 'sync');
  assert.ok(sync.includes("if: github.event_name == 'push'"));
  assert.ok(sync.includes('contents: write'));
  assert.ok(sync.includes('slicekit.js status --sync --write'));
  assert.ok(sync.includes('slicekit.js sync open'));
  assert.ok(sync.includes('github-actions[bot]'));
  assert.ok(!sync.includes('[skip ci]'), 'nothing in the sync job suppresses the dispatched run');
  assert.match(yml, /^permissions:\n {2}contents: read\n/m);
  assert.match(yml, /^on:\n {2}pull_request:\n {4}types: \[opened, synchronize, reopened, edited\]\n {2}push:\n {4}branches: \[main\]\n/m);
  assert.ok(yml.includes('group: slicekit-${{ github.ref }}'));
  assert.ok(yml.includes('cancel-in-progress: true'));
});

test('empty e2e command renders no job (REQ-3.11)', () => {
  const cfg = exampleConfig();
  cfg.commands = { test: 'npm test', lint: '   ', build: 'npm run build', e2e: '' };
  const yml = renderWorkflow(cfg, loadPins());
  const ids = jobIds(yml);
  assert.ok(!ids.includes('cmd-e2e'));
  assert.ok(!ids.includes('cmd-lint'), 'whitespace-only is empty');
  assert.deepEqual(ids.filter((id) => id.startsWith('cmd-')), ['cmd-test', 'cmd-build']);
  assert.ok(jobBlock(yml, 'checks').includes('needs: [gate, cmd-test, cmd-build, obs-1]'));
});

test('observability steps render as jobs (REQ-3.11)', () => {
  const cfg = exampleConfig();
  cfg.ci.observabilitySteps = [
    { name: 'Smoke', run: 'curl -fsS "$URL"', env: { URL: 'https://x.example.com' } },
    { name: 'Trace check', run: 'echo one\necho two' },
  ];
  assert.deepEqual(validateConfig(cfg), []);
  const yml = renderWorkflow(cfg, loadPins());
  const one = jobBlock(yml, 'obs-1');
  assert.ok(one.includes('name: Smoke\n'));
  assert.ok(one.includes('run: curl -fsS "$URL"\n'));
  assert.ok(one.includes("URL: 'https://x.example.com'\n"));
  const two = jobBlock(yml, 'obs-2');
  assert.ok(two.includes('name: Trace check\n'));
  assert.ok(two.includes('run: |\n          echo one\n          echo two\n'));
  assert.ok(!two.includes('env:'));
});

test('a command with a double quote, a colon and a hash is quoted (REQ-3.11)', () => {
  const cfg = exampleConfig();
  cfg.commands.lint = `echo "a: b" # it's done`;
  const yml = renderWorkflow(cfg, loadPins());
  assert.ok(jobBlock(yml, 'cmd-lint').includes(`run: 'echo "a: b" # it''s done'\n`));
  assert.equal(yamlScalar('plain words'), 'plain words');
  assert.equal(yamlScalar(' padded'), "' padded'");
  assert.equal(yamlScalar('{x}'), "'{x}'");
  assert.equal(yamlScalar('a*b'), "'a*b'");
  assert.equal(yamlScalar('true'), "'true'");
  assert.equal(yamlScalar('-x'), "'-x'");
  assert.equal(yamlScalar(''), "''");
});

test('a cli with a colon is quoted as a whole', () => {
  const cfg = exampleConfig();
  cfg.cli = 'node C:/tools/slicekit.js';
  const yml = renderWorkflow(cfg, loadPins());
  assert.ok(yml.includes("run: 'node C:/tools/slicekit.js check --ci'\n"));
});

test('matrix puts only cmd-test on three operating systems', () => {
  const cfg = exampleConfig();
  cfg.ci.matrix = true;
  const yml = renderWorkflow(cfg, loadPins());
  const t = jobBlock(yml, 'cmd-test');
  assert.ok(t.includes('os: [ubuntu-latest, windows-latest, macos-latest]'));
  assert.ok(t.includes('runs-on: ${{ matrix.os }}'));
  assert.ok(t.includes('fail-fast: false'), 'every operating system reports, one failing leg does not cancel the others');
  assert.ok(jobBlock(yml, 'cmd-lint').includes('runs-on: ubuntu-latest'));
  assert.equal((yml.match(/matrix\.os/g) || []).length, 1);
  assert.ok(jobBlock(yml, 'gate').includes('No runtime dependencies (REQ-5.3)'), 'REQ-5.3 dependency check');
  assert.ok(!renderWorkflow(exampleConfig(), loadPins()).includes('package.json'), 'off without matrix');
});

test('renderWorkflow refuses a pin that is not a 40-hex sha', () => {
  const pins = structuredClone(loadPins());
  pins['actions/checkout'].sha = 'v4';
  assert.throws(() => renderWorkflow(exampleConfig(), pins), /actions\/checkout/);
});

test('golden workflow for the example config (REQ-3.11)', () => {
  const golden = fs.readFileSync(GOLDEN, 'utf8');
  assert.ok(!golden.includes('\r'), 'golden is LF');
  assert.equal(renderWorkflow(exampleConfig(), loadPins()), golden);
});

test('config: ci.observabilitySteps entries and ci.matrix are validated', () => {
  const cfg = exampleConfig();
  assert.equal(defaultConfig({ name: 'x', shape: 'backend' }).ci.matrix, false);
  const bad = (ci) => validateConfig({ ...cfg, ci: { ...cfg.ci, ...ci } });
  assert.ok(bad({ matrix: 'yes' }).includes('ci.matrix: must be a boolean'));
  assert.ok(bad({ observabilitySteps: 'x' }).includes('ci.observabilitySteps: must be an array'));
  assert.ok(bad({ observabilitySteps: ['echo'] }).includes('ci.observabilitySteps[0]: must be an object'));
  assert.ok(bad({ observabilitySteps: [{ name: '', run: 'x' }] }).includes('ci.observabilitySteps[0].name: must be a non-empty string'));
  assert.ok(bad({ observabilitySteps: [{ name: 'a', run: ' ' }] }).includes('ci.observabilitySteps[0].run: must be a non-empty string'));
  assert.ok(bad({ observabilitySteps: [{ name: 'a', run: 'x', env: { A: 1 } }] }).includes('ci.observabilitySteps[0].env: must map names to strings'));
  assert.ok(bad({ observabilitySteps: [{ name: 'a', run: 'x', env: { 'bad name': 'v' } }] }).includes('ci.observabilitySteps[0].env: must map names to strings'));
  assert.ok(bad({ observabilitySteps: [{ name: 'a', run: 'x', extra: 1 }] }).includes('ci.observabilitySteps[0].extra: unknown key; use name, run, env'));
  assert.deepEqual(validateConfig({ ...cfg, ci: { observabilitySteps: [] } }), [], 'matrix is optional');
});

// Fix round 1 (review of d20a820).

test('sync opens pull requests, dispatches the workflow and hands the cli a token (C1)', () => {
  const sync = jobBlock(renderWorkflow(exampleConfig(), loadPins()), 'sync');
  assert.ok(sync.includes('    permissions:\n      actions: write\n      contents: write\n      pull-requests: write\n'));
  for (const name of ['Sync state', 'Open the sync pull request']) {
    const at = sync.indexOf(`- name: ${name}`);
    const step = sync.slice(at, sync.indexOf('- name:', at + 1) === -1 ? undefined : sync.indexOf('- name:', at + 1));
    assert.ok(step.includes('GH_TOKEN: ${{ github.token }}'), step);
  }
});

test('ready-label runs only for same-repository pull requests not opened by dependabot (I2)', () => {
  const ready = jobBlock(renderWorkflow(exampleConfig(), loadPins()), 'ready-label');
  assert.ok(
    ready.includes(
      "    if: ${{ !cancelled() && github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.actor != 'dependabot[bot]' }}\n",
    ),
  );
});

test('ready-label still runs when a needed job failed, and is told so', () => {
  // A failed gate or command job must take the label away, so the job runs unless the run was
  // cancelled (a newer push superseded it), and passes the failure to the CLI.
  const yml = renderWorkflow(exampleConfig(), loadPins());
  const ready = jobBlock(yml, 'ready-label');
  // ready-label reads the checks job's result; the checks job needs every gating job and holds the
  // expression, which the P3/S-32 test below evaluates.
  assert.ok(ready.includes('needs: [checks]'));
  assert.ok(ready.includes("          SLICEKIT_CHECKS_OK: ${{ needs.checks.result == 'success' }}\n"), ready);
  assert.match(jobBlock(yml, 'checks'), /^ {10}SLICEKIT_CHECKS_OK: \$\{\{ .*'failure'.*'cancelled'.* \}\}$/m);
  assert.ok(!ready.includes('SLICEKIT_CHECKS_FAILED'));
  // D-35: telling a bookkeeping-only commit from a code change needs the reviewed head in the clone.
  assert.ok(ready.includes('          fetch-depth: 0\n'), 'ready-label checks out full history');
  assert.ok(!ready.includes('always()'), 'always() would also run a cancelled, superseded run');
});

// P4/S-41: sync open stages only BUILD.md, the state directory and the journal heads log
// (test/sync.test.js); the job stages nothing itself, whatever the docs root.
test('the sync job stages nothing itself (I3)', () => {
  const cfg = exampleConfig();
  cfg.docsRoot = 'documentation';
  const sync = jobBlock(renderWorkflow(cfg, loadPins()), 'sync');
  assert.ok(!/git add/.test(sync), sync);
});

test('the default branch is a YAML string wherever it lands (M4)', () => {
  for (const [branch, quoted] of [['1.10', "'1.10'"], ['on', "'on'"], ['main', 'main']]) {
    const cfg = exampleConfig();
    cfg.defaultBranch = branch;
    const yml = renderWorkflow(cfg, loadPins());
    assert.ok(yml.includes(`    branches: [${quoted}]\n`), branch);
    assert.ok(yml.includes(`refs/remotes/origin/${branch}`), branch);
  }
});

test('yamlScalar: carriage returns, separators, tabs, .inf and the block indicator (M5)', () => {
  assert.equal(yamlScalar('echo a\rrm -rf x', 8), '|\n          echo a\n          rm -rf x');
  assert.equal(yamlScalar('a\r\nb', 8), '|\n          a\n          b');
  for (const sep of ['\u0085', ' ', ' ']) assert.throws(() => yamlScalar(`a${sep}b`), /line separator/);
  assert.equal(yamlScalar('\n  a\nb', 8), '|2\n\n            a\n          b');
  assert.equal(yamlScalar('a\n  b', 8), '|\n          a\n            b');
  assert.equal(yamlScalar('echo\ta'), "'echo\ta'");
  for (const v of ['.inf', '.NaN', '-.Inf', '+.inf']) assert.equal(yamlScalar(v), `'${v}'`, v);
});

test('a line separator in a command is a config error (M5)', () => {
  const cfg = exampleConfig();
  cfg.commands.test = 'echo a b';
  assert.ok(validateConfig(cfg).includes('commands.test: contains a line separator YAML cannot carry'));
  const step = exampleConfig();
  step.ci.observabilitySteps[0].env.STAGING_URL = 'x\u0085';
  assert.ok(validateConfig(step).includes('ci.observabilitySteps[0].env: contains a line separator YAML cannot carry'));
});

test('a GitHub expression in a command, the cli or a step is a config error (M6)', () => {
  const msg = (key) => `${key}: contains a GitHub expression; pass values through env:`;
  const cfg = exampleConfig();
  cfg.commands.lint = 'echo ${{ github.event.pull_request.title }}';
  cfg.cli = 'node x.js ${{ github.head_ref }}';
  cfg.ci.observabilitySteps[0].run = 'echo ${{secrets.X}}';
  const errors = validateConfig(cfg);
  for (const key of ['commands.lint', 'cli', 'ci.observabilitySteps[0].run']) assert.ok(errors.includes(msg(key)), key);
  assert.throws(() => renderWorkflow(cfg, loadPins()), /GitHub expression/);
});

test('a placeholder inside the cli is written as text, never filled', () => {
  const cfg = exampleConfig();
  cfg.cli = 'x {{defaultBranch}}';
  const yml = renderWorkflow(cfg, loadPins());
  assert.ok(yml.includes("run: 'x {{defaultBranch}} check --ci'\n"));
});

test('checkout does not keep the token except in sync (M8)', () => {
  const yml = renderWorkflow(exampleConfig(), loadPins());
  for (const id of ['gate', 'cmd-test', 'cmd-lint', 'obs-1', 'ready-label']) {
    assert.ok(jobBlock(yml, id).includes('          persist-credentials: false\n'), id);
  }
  assert.ok(!jobBlock(yml, 'sync').includes('persist-credentials'));
});

// REQ-5.5: the kit's own CI is the generator's output for the kit's own config, byte for byte.
test("the kit's own workflow matches the generator (REQ-5.5)", () => {
  const kitRoot = fileURLToPath(new URL('..', import.meta.url));
  const cfg = loadConfig(kitRoot);
  assert.equal(cfg.ci.matrix, true, 'the kit tests on three operating systems (REQ-5.2)');
  const own = fs.readFileSync(path.join(kitRoot, WORKFLOW_PATH), 'utf8');
  assert.ok(!own.includes('\r'), 'the workflow is LF');
  assert.equal(own, renderWorkflow(cfg, loadPins()));
});

function withKitRepo(fn) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js', commands: { test: 'node --test' } });
    return fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

test('cli workflow prints the render, --write writes it, --check finds drift', () => {
  withKitRepo((root) => {
    const file = path.join(root, WORKFLOW_PATH);
    const expected = renderWorkflow(loadConfig(root), loadPins());
    const printed = runCli(['workflow'], { cwd: root });
    assert.equal(printed.code, 0, printed.stderr);
    assert.equal(printed.stdout, expected);

    fs.rmSync(file, { force: true });
    const missing = runCli(['workflow', '--check'], { cwd: root });
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /slicekit workflow --write/);

    const wrote = runCli(['workflow', '--write'], { cwd: root });
    assert.equal(wrote.code, 0, wrote.stderr);
    assert.equal(fs.readFileSync(file, 'utf8'), expected);
    assert.equal(runCli(['workflow', '--check'], { cwd: root }).code, 0);

    fs.writeFileSync(file, expected.replace('node-version: 22', 'node-version: 20'));
    const drift = runCli(['workflow', '--check'], { cwd: root });
    assert.equal(drift.code, 1);
    assert.match(drift.stderr, /\.github\/workflows\/slicekit\.yml differs from the generator/);

    assert.equal(runCli(['workflow', '--write', '--check'], { cwd: root }).code, 2);
    assert.equal(runCli(['workflow', 'extra'], { cwd: root }).code, 2);
  });
});

test('init writes the workflow when absent and never overwrites one (REQ-3.11)', () => {
  withKitRepo((root) => {
    const file = path.join(root, WORKFLOW_PATH);
    assert.equal(fs.readFileSync(file, 'utf8'), renderWorkflow(loadConfig(root), loadPins()));
    const same = init(root, { name: 'demo', shape: 'backend' });
    assert.ok(same.skipped.includes(WORKFLOW_PATH));
    assert.deepEqual(same.warnings.filter((w) => w.includes('workflow')), []);

    fs.writeFileSync(file, 'name: ours\n');
    const again = init(root, { name: 'demo', shape: 'backend' });
    assert.equal(fs.readFileSync(file, 'utf8'), 'name: ours\n');
    assert.ok(again.skipped.includes(WORKFLOW_PATH));
    assert.ok(again.warnings.some((w) => w.includes(WORKFLOW_PATH) && w.includes('slicekit workflow')), again.warnings.join('\n'));
  });
});

// Final fix wave (whole-branch review of 71e9ae0).


test('ready-label may create the label: issues write as well as pull requests (I2)', () => {
  const ready = jobBlock(renderWorkflow(exampleConfig(), loadPins()), 'ready-label');
  assert.ok(ready.includes('    permissions:\n      contents: read\n      issues: write\n      pull-requests: write\n'), ready);
});

test('the gate reports a workflow that differs from the generator, after check (I3)', () => {
  const gate = jobBlock(renderWorkflow(exampleConfig(), loadPins()), 'gate');
  const check = gate.indexOf('      - name: slicekit check\n        run: node node_modules/slicekit/bin/slicekit.js check --ci\n');
  const drift = gate.indexOf('      - name: The workflow matches the generator\n        run: node node_modules/slicekit/bin/slicekit.js workflow --check\n');
  assert.notEqual(check, -1, gate);
  assert.ok(drift > check, gate);
});

test('every job has a timeout: ci.timeoutMinutes, and 10 for ready-label and sync (I5)', () => {
  const yml = renderWorkflow(exampleConfig(), loadPins());
  for (const id of ['gate', 'cmd-test', 'cmd-lint', 'obs-1']) assert.ok(jobBlock(yml, id).includes('    timeout-minutes: 30\n'), id);
  for (const id of ['ready-label', 'sync']) assert.ok(jobBlock(yml, id).includes('    timeout-minutes: 10\n'), id);
  const cfg = exampleConfig();
  cfg.ci.timeoutMinutes = 45;
  cfg.ci.matrix = true;
  const longer = renderWorkflow(cfg, loadPins());
  for (const id of ['gate', 'cmd-test', 'cmd-lint', 'obs-1']) assert.ok(jobBlock(longer, id).includes('    timeout-minutes: 45\n'), id);
  for (const id of ['ready-label', 'sync']) assert.ok(jobBlock(longer, id).includes('    timeout-minutes: 10\n'), id);
  for (const id of jobIds(longer)) assert.equal(jobBlock(longer, id).match(/timeout-minutes/g).length, 1, id);
  const { timeoutMinutes, ...absent } = exampleConfig().ci;
  assert.ok(jobBlock(renderWorkflow({ ...exampleConfig(), ci: absent }, loadPins()), 'gate').includes('    timeout-minutes: 30\n'), 'absent reads as 30');
});

test('config: ci.timeoutMinutes is an integer from 1 to 360 (I5)', () => {
  const cfg = exampleConfig();
  assert.equal(cfg.ci.timeoutMinutes, 30);
  const errs = (timeoutMinutes) => validateConfig({ ...cfg, ci: { ...cfg.ci, timeoutMinutes } });
  for (const ok of [1, 30, 360]) assert.deepEqual(errs(ok), [], String(ok));
  for (const bad of [0, 361, 1.5, '30', null]) {
    assert.ok(errs(bad).includes('ci.timeoutMinutes: must be an integer from 1 to 360'), String(bad));
  }
});

// P4/S-41: whether anything changed decides whether a pull request opens; sync open makes that test.
test('sync sets its commit identity, then runs sync open (M1)', () => {
  const sync = jobBlock(renderWorkflow(exampleConfig(), loadPins()), 'sync');
  const step = sync.slice(sync.indexOf('      - name: Commit identity'));
  assert.ok(
    step.startsWith(
      [
        '      - name: Commit identity',
        '        run: |',
        "          git config user.name 'github-actions[bot]'",
        "          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'",
        '      - name: Open the sync pull request',
        '',
      ].join('\n'),
    ),
    step,
  );
});

test('the no-dependencies step fails on any dependency field, naming it (M6)', () => {
  const cfg = exampleConfig();
  cfg.ci.matrix = true;
  const gate = jobBlock(renderWorkflow(cfg, loadPins()), 'gate');
  const lines = gate.split('\n');
  const at = lines.indexOf('      - name: No runtime dependencies (REQ-5.3)');
  assert.notEqual(at, -1, gate);
  assert.equal(lines[at + 1], '        run: |');
  const m = /^ {10}node -e "(.*)"$/.exec(lines[at + 2]);
  assert.ok(m, lines[at + 2]);
  const script = m[1];
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? process.env.TEMP ?? '.', 'slicekit-deps-'));
  const runWith = (pkg) => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    const r = spawnSync(process.execPath, ['-e', script], { cwd: dir, encoding: 'utf8' });
    return { code: r.status, stderr: r.stderr };
  };
  try {
    assert.equal(runWith({ name: 'x' }).code, 0);
    assert.equal(runWith({ name: 'x', dependencies: {}, peerDependencies: {}, bundleDependencies: [] }).code, 0);
    assert.equal(runWith({ name: 'x', devDependencies: { a: '1' } }).code, 0, 'dev dependencies are allowed');
    for (const [field, value, named] of [
      ['dependencies', { a: '1', b: '2' }, 'a, b'],
      ['optionalDependencies', { c: '1' }, 'c'],
      ['bundleDependencies', ['d'], 'd'],
      ['bundledDependencies', ['e'], 'e'],
      ['peerDependencies', { f: '1' }, 'f'],
      ['bundleDependencies', true, 'true'],
    ]) {
      const r = runWith({ name: 'x', [field]: value });
      assert.equal(r.code, 1, field);
      assert.ok(r.stderr.includes(`${field}: ${named}`), `${field}: ${r.stderr}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// P3/S-17, REQ-4.4: CI builds the graph in the gate job, then uploads it.
test('the gate builds the graph before uploading it', () => {
  const cfg = exampleConfig();
  const gate = jobBlock(renderWorkflow(cfg, loadPins()), 'gate');
  const at = (name) => gate.indexOf(`      - name: ${name}\n`);
  const hooks = at("Use the repository's git hooks");
  const build = at('Build the graph');
  const check = at('slicekit check');
  const upload = at('Upload the graph');
  assert.ok(build >= 0, 'no Build the graph step');
  assert.ok(hooks >= 0 && hooks < build, 'Build the graph comes after the git hooks step');
  assert.ok(build < check, 'Build the graph comes before slicekit check');
  assert.ok(build < upload, 'Build the graph comes before Upload the graph');
  const step = gate.slice(build, gate.indexOf('      - ', build + 1));
  assert.ok(step.includes(`        run: ${cfg.cli} graph\n`), step);
  assert.ok(step.includes('GH_TOKEN: ${{ github.token }}'), step);
  assert.match(gate, /\n {4}permissions:\n(?: {6}\S.*\n)*? {6}pull-requests: read\n/);
});

// P3/S-32, REQ-3.11, D-49: bookkeeping pushes skip the team command jobs, and ci.shards splits the
// test job. The job conditions are judged by evaluating the rendered GitHub expressions, so the tests
// hold the behaviour, not one spelling of it.

// A GitHub Actions expression evaluator for the subset the workflow uses: literals, property paths
// (with `*` over an object), ! && || == != and parentheses, contains/startsWith/endsWith and the
// status functions. Strings compare case-insensitively, as GitHub does.
function evalExpression(source, ctx) {
  let text = source.trim();
  if (/^'.*'$/s.test(text)) text = text.slice(1, -1).replace(/''/g, "'");
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(text.trim());
  if (wrapped) text = wrapped[1];
  const tokens = [];
  const re = /\s*(?:(\|\||&&|==|!=|[!(),])|'((?:[^']|'')*)'|([A-Za-z_*][A-Za-z0-9_.*-]*)|(-?\d+(?:\.\d+)?))/y;
  let at = 0;
  while (at < text.length) {
    if (/^\s*$/.test(text.slice(at))) break;
    re.lastIndex = at;
    const m = re.exec(text);
    assert.ok(m, `expression: cannot read at ${at}: ${text}`);
    at = re.lastIndex;
    if (m[1]) tokens.push({ op: m[1] });
    else if (m[2] !== undefined) tokens.push({ value: m[2].replace(/''/g, "'") });
    else if (m[3]) tokens.push({ name: m[3] });
    else tokens.push({ value: Number(m[4]) });
  }
  let i = 0;
  const peek = () => tokens[i];
  const take = (op) => {
    assert.equal(tokens[i]?.op, op, `expression: expected ${op} in ${text}`);
    i++;
  };
  const truthy = (v) => !(v === false || v === null || v === undefined || v === '' || v === 0);
  const eq = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const resolve = (name) => {
    if (name === 'true') return true;
    if (name === 'false') return false;
    if (name === 'null') return null;
    let values = [ctx];
    let spread = false;
    for (const part of name.split('.')) {
      if (part === '*') {
        values = values.flatMap((v) => (v && typeof v === 'object' ? Object.values(v) : []));
        spread = true;
      } else {
        values = values.map((v) => (v && typeof v === 'object' ? v[part] : undefined));
      }
    }
    return spread ? values : values[0];
  };
  const call = (fn, args) => {
    const status = ctx.__status ?? {};
    switch (fn.toLowerCase()) {
      case 'contains':
        return Array.isArray(args[0])
          ? args[0].some((v) => eq(v, args[1]))
          : String(args[0] ?? '').toLowerCase().includes(String(args[1]).toLowerCase());
      case 'startswith':
        return String(args[0] ?? '').toLowerCase().startsWith(String(args[1]).toLowerCase());
      case 'endswith':
        return String(args[0] ?? '').toLowerCase().endsWith(String(args[1]).toLowerCase());
      case 'success':
        return status.success ?? true;
      case 'failure':
        return status.failure ?? false;
      case 'cancelled':
        return false;
      case 'always':
        return true;
      default:
        assert.fail(`expression: unsupported function ${fn}`);
    }
  };
  // Forward references: or() is defined below primary().
  let or;
  const primary = () => {
    const t = tokens[i++];
    assert.ok(t, `expression: unexpected end of ${text}`);
    if (t.op === '(') {
      const v = or();
      take(')');
      return v;
    }
    if (t.op === '!') return !truthy(primary());
    if ('value' in t) return t.value;
    assert.ok(t.name, `expression: unexpected ${t.op} in ${text}`);
    if (peek()?.op === '(') {
      i++;
      const args = [];
      while (peek()?.op !== ')') {
        args.push(or());
        if (peek()?.op === ',') i++;
      }
      take(')');
      return call(t.name, args);
    }
    return resolve(t.name);
  };
  const comparison = () => {
    let v = primary();
    while (peek()?.op === '==' || peek()?.op === '!=') {
      const op = tokens[i++].op;
      const r = primary();
      v = op === '==' ? eq(v, r) : !eq(v, r);
    }
    return v;
  };
  const and = () => {
    let v = comparison();
    while (peek()?.op === '&&') {
      i++;
      const r = comparison();
      v = truthy(v) ? r : v;
    }
    return v;
  };
  or = () => {
    let v = and();
    while (peek()?.op === '||') {
      i++;
      const r = and();
      v = truthy(v) ? v : r;
    }
    return v;
  };
  const v = or();
  assert.equal(i, tokens.length, `expression: trailing tokens in ${text}`);
  return truthy(v);
}

// A job-level `if:`: GitHub adds success() when the condition names no status function.
function jobRuns(block, ctx) {
  const m = /^ {4}if: (.*)$/m.exec(block);
  const results = Object.values(ctx.needs ?? {}).map((n) => n.result);
  const status = { success: results.every((r) => r === 'success'), failure: results.includes('failure') };
  if (!m) return status.success;
  const cond = m[1];
  const named = /\b(success|failure|cancelled|always)\s*\(/.test(cond);
  const ok = evalExpression(cond, { ...ctx, __status: status });
  return named ? ok : status.success && ok;
}

const listOf = (block, key) => {
  const m = new RegExp(`^ {4}${key}: \\[(.*)\\]$`, 'm').exec(block);
  return m ? m[1].split(',').map((s) => s.trim()) : [];
};

// The gate's job output that carries the bookkeeping decision: the output fed by the step that runs
// `<cli> ci bookkeeping`.
function bookkeepingOutput(yml, cli) {
  const gate = jobBlock(yml, 'gate');
  const steps = gate.split(/\n(?= {6}- )/);
  const step = steps.find((s) => s.includes(`${cli} ci bookkeeping`));
  assert.ok(step, `the gate runs ${cli} ci bookkeeping:\n${gate}`);
  const id = /^ {8}id: (\S+)$/m.exec(step)?.[1];
  assert.ok(id, `the ci bookkeeping step has an id:\n${step}`);
  const outputs = /^ {4}outputs:\n((?: {6}.+\n)+)/m.exec(gate);
  assert.ok(outputs, `the gate has outputs:\n${gate}`);
  const line = outputs[1].split('\n').find((l) => l.includes(`steps.${id}.outputs.`));
  assert.ok(line, `a gate output reads steps.${id}:\n${outputs[1]}`);
  return { key: /^ {6}([A-Za-z0-9_-]+):/.exec(line)[1], step };
}

test('team command jobs are skipped for bookkeeping and the checks job counts them as passed', () => {
  const cfg = exampleConfig();
  const yml = renderWorkflow(cfg, loadPins());
  const { key, step } = bookkeepingOutput(yml, cfg.cli);
  // The range comes in through env, never as an expression inside run (M6).
  const runLines = step.slice(step.indexOf('        run:'));
  assert.ok(!runLines.includes('${{'), runLines);
  // The gate names the head and the base branch, never a base of its own: the command finds the
  // newest commit of the pull request whose CI passed (D-49).
  assert.ok(runLines.includes('--head') && runLines.includes('--base-branch'), runLines);
  assert.ok(!/--base(?!-branch)/.test(runLines), runLines);
  assert.ok(/^ {10}[A-Z_]+: \$\{\{ github\.event\.pull_request\.head\.sha \}\}$/m.test(step), step);

  const gateWith = (result, kind) => ({ result, outputs: { [key]: kind } });
  const commands = ['cmd-test', 'cmd-lint'];
  for (const id of commands) {
    const block = jobBlock(yml, id);
    assert.ok(listOf(block, 'needs').includes('gate'), `${id} needs the gate's decision`);
    assert.equal(jobRuns(block, { needs: { gate: gateWith('success', 'bookkeeping') } }), false, `${id} skips for bookkeeping`);
    assert.equal(jobRuns(block, { needs: { gate: gateWith('success', 'code') } }), true, `${id} runs for code`);
    assert.equal(jobRuns(block, { needs: { gate: gateWith('success', '') } }), true, `${id} runs when there is no decision`);
  }

  const ready = jobBlock(yml, 'checks');
  const okLine = /^ {10}SLICEKIT_CHECKS_OK: (.*)$/m.exec(ready);
  assert.ok(okLine, ready);
  assert.deepEqual(listOf(ready, 'needs'), ['gate', 'cmd-test', 'cmd-lint', 'obs-1']);
  const checksOk = (gate, results) => {
    const needs = { gate, 'obs-1': { result: 'success' } };
    for (const c of commands) needs[c] = { result: results[c] ?? 'success' };
    return evalExpression(okLine[1], { needs, github: { event_name: 'pull_request' } });
  };
  const book = gateWith('success', 'bookkeeping');
  const code = gateWith('success', 'code');
  const bothSkipped = { 'cmd-test': 'skipped', 'cmd-lint': 'skipped' };
  assert.equal(checksOk(code, {}), true, 'every job passed');
  assert.equal(checksOk(book, bothSkipped), true, 'skipped for bookkeeping counts as passed');
  assert.equal(checksOk(book, { 'cmd-test': 'failure', 'cmd-lint': 'skipped' }), false, 'a failed job is not passed');
  assert.equal(checksOk(book, { 'cmd-test': 'skipped', 'cmd-lint': 'cancelled' }), false, 'a cancelled job is not passed');
  assert.equal(checksOk(code, { 'cmd-test': 'skipped' }), false, 'skipped for another reason is not passed');
  assert.equal(checksOk(gateWith('success', ''), bothSkipped), false, 'skipped without a bookkeeping decision is not passed');
  assert.equal(checksOk(gateWith('failure', 'bookkeeping'), bothSkipped), false, 'a failed gate is not passed');
  assert.equal(checksOk(gateWith('skipped', ''), bothSkipped), false, 'a skipped gate is not passed');
});

// The entries of a job's matrix `include:` list, as plain objects (quotes taken off).
function matrixInclude(block) {
  const lines = block.split('\n');
  const at = lines.findIndex((l) => /^ +include:$/.test(l));
  assert.notEqual(at, -1, `a matrix include list:\n${block}`);
  const indent = lines[at].search(/\S/);
  const unquote = (v) => (/^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v);
  const items = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() === '' || l.search(/\S/) <= indent) break;
    const item = /^\s*- ([A-Za-z_-]+): (.*)$/.exec(l);
    const more = /^\s*([A-Za-z_-]+): (.*)$/.exec(l);
    if (item) items.push({ [item[1]]: unquote(item[2]) });
    else if (more && items.length > 0) items.at(-1)[more[1]] = unquote(more[2]);
  }
  return items;
}

// `<os> <k>/<n>` for each job the test job's matrix starts, sorted.
function shardJobs(block) {
  const shardVar = /^ {10}SLICEKIT_SHARD: \$\{\{ matrix\.([A-Za-z_-]+) \}\}$/m.exec(block);
  assert.ok(shardVar, `the test step sets SLICEKIT_SHARD from the matrix:\n${block}`);
  assert.ok(block.includes('    runs-on: ${{ matrix.os }}\n'), block);
  assert.ok(block.includes('      fail-fast: false\n'), block);
  return matrixInclude(block)
    .map((e) => `${e.os} ${e[shardVar[1]]}`)
    .sort();
}

test('ci.shards renders one job per shard with SLICEKIT_SHARD', () => {
  const cfg = exampleConfig();
  cfg.ci.matrix = true;
  cfg.ci.shards = { 'windows-latest': 3 };
  assert.deepEqual(validateConfig(cfg), []);
  const yml = renderWorkflow(cfg, loadPins());
  assert.deepEqual(shardJobs(jobBlock(yml, 'cmd-test')), [
    'macos-latest 1/1',
    'ubuntu-latest 1/1',
    'windows-latest 1/3',
    'windows-latest 2/3',
    'windows-latest 3/3',
  ]);
  assert.ok(jobBlock(yml, 'cmd-test').includes(`run: 'node --test "test/**/*.test.js"'\n`), 'each shard runs the same test command');
  assert.ok(!jobBlock(yml, 'cmd-lint').includes('SLICEKIT_SHARD'), 'only the test command is sharded');
  assert.ok(jobBlock(yml, 'cmd-lint').includes('    runs-on: ubuntu-latest\n'));

  // Without the matrix the test job runs on Linux, so a Linux shard count splits it there.
  const linux = exampleConfig();
  linux.ci.shards = { 'ubuntu-latest': 2 };
  assert.deepEqual(validateConfig(linux), []);
  assert.deepEqual(shardJobs(jobBlock(renderWorkflow(linux, loadPins()), 'cmd-test')), ['ubuntu-latest 1/2', 'ubuntu-latest 2/2']);

  // Default none: no shard anywhere.
  assert.ok(!renderWorkflow(exampleConfig(), loadPins()).includes('SLICEKIT_SHARD'));

  // The kit's own config splits Windows in three (D-49).
  const kitRoot = fileURLToPath(new URL('..', import.meta.url));
  assert.deepEqual(loadConfig(kitRoot).ci.shards, { 'windows-latest': 3 });
});

test('a shard count that is not a positive integer is refused, naming the field', () => {
  const cfg = exampleConfig();
  cfg.ci.matrix = true;
  const withShards = (shards) => ({ ...cfg, ci: { ...cfg.ci, shards } });
  for (const ok of [1, 3]) assert.deepEqual(validateConfig(withShards({ 'windows-latest': ok })), [], String(ok));
  for (const bad of [0, -1, 1.5, '3', null, true, [3]]) {
    const errors = validateConfig(withShards({ 'windows-latest': bad }));
    assert.ok(errors.includes('ci.shards.windows-latest: must be a positive integer'), `${JSON.stringify(bad)}: ${errors.join('; ')}`);
    assert.throws(() => renderWorkflow(withShards({ 'windows-latest': bad }), loadPins()), /ci\.shards\.windows-latest/, JSON.stringify(bad));
  }
  for (const bad of [3, 'windows-latest', ['windows-latest']]) {
    const errors = validateConfig(withShards(bad));
    assert.ok(errors.some((e) => e.startsWith('ci.shards: ')), `${JSON.stringify(bad)}: ${errors.join('; ')}`);
  }
});

// P4/S-40 B-1, REQ-3.14: the ruleset requires gate and checks. On a bookkeeping head the command jobs
// are skipped by their own if (no matrix names are reported), and the checks job still runs and passes,
// so the required checks are satisfied.
test('a bookkeeping run satisfies the required checks: checks runs and passes while cmd-test is skipped', () => {
  const cfg = exampleConfig();
  cfg.ci.matrix = true;
  const yml = renderWorkflow(cfg, loadPins());
  const { key } = bookkeepingOutput(yml, cfg.cli);
  const book = { result: 'success', outputs: { [key]: 'bookkeeping' } };
  const checks = jobBlock(yml, 'checks');
  assert.ok(checks.includes('    if: ${{ always() }}\n'), checks);
  assert.ok(!/strategy:|matrix/.test(checks), 'the checks job has no matrix, so its name is fixed');
  const needs = listOf(checks, 'needs');
  assert.deepEqual(needs, ['gate', ...jobIds(yml).filter((id) => /^(cmd-|obs-)/.test(id))]);
  assert.equal(jobRuns(jobBlock(yml, 'cmd-test'), { needs: { gate: book } }), false, 'cmd-test is skipped for bookkeeping');
  const results = { gate: book, 'obs-1': { result: 'success' } };
  for (const id of needs.filter((n) => n.startsWith('cmd-'))) results[id] = { result: 'skipped' };
  // A skipped need would skip a job without always(); the checks job runs anyway.
  assert.equal(jobRuns(checks, { needs: results, __anySkipped: true }), true, 'checks runs');
  const okLine = /^ {10}SLICEKIT_CHECKS_OK: (.*)$/m.exec(checks);
  assert.equal(evalExpression(okLine[1], { needs: results, github: { event_name: 'pull_request' } }), true, 'checks passes');
  assert.ok(checks.includes('run: test "$SLICEKIT_CHECKS_OK" = true\n'), checks);
  assert.ok(jobBlock(yml, 'ready-label').includes('needs: [checks]'));
});

// P4/S-41, REQ-3.11, D-78, D-80: the sync job opens a pull request with the state change through
// `slicekit sync open` instead of committing to the default branch, and the workflow can be started
// on the sync branch with workflow_dispatch.
test('the sync job never pushes to the default branch or sets ALLOW_PROTECTED_COMMIT', () => {
  const cfg = exampleConfig();
  const yml = renderWorkflow(cfg, loadPins());
  const sync = jobBlock(yml, 'sync');
  assert.ok(sync.includes("if: github.event_name == 'push'"), sync);
  assert.ok(!yml.includes('ALLOW_PROTECTED_COMMIT'), 'no job sets ALLOW_PROTECTED_COMMIT');
  assert.ok(!/\bgit push\b/.test(sync), 'the job itself never pushes');
  assert.ok(!/\bgit commit\b/.test(sync), 'the job itself never commits');
  const syncStep = `run: ${cfg.cli} status --sync --write\n`;
  const openStep = `run: ${cfg.cli} sync open\n`;
  assert.ok(sync.includes(syncStep), sync);
  assert.ok(sync.includes(openStep), sync);
  assert.ok(sync.indexOf(syncStep) < sync.indexOf(openStep), 'status --sync --write runs before sync open');
  const open = sync.slice(sync.lastIndexOf('- name:', sync.indexOf(openStep)), sync.indexOf(openStep));
  assert.ok(open.includes('GH_TOKEN: ${{ github.token }}'), open);
  // Its permissions are exactly these three.
  const lines = sync.split('\n');
  const at = lines.indexOf('    permissions:');
  assert.notEqual(at, -1, sync);
  const perms = [];
  for (let i = at + 1; i < lines.length && /^ {6}\S/.test(lines[i]); i++) perms.push(lines[i].trim());
  assert.deepEqual(perms.sort(), ['actions: write', 'contents: write', 'pull-requests: write']);
  // The workflow accepts workflow_dispatch, so the sync branch's checks can be started on it.
  const on = yml.slice(yml.indexOf('\non:\n'), yml.indexOf('\npermissions:\n'));
  assert.match(on, /^ {2}workflow_dispatch:/m, on);
});

// ---- P4/S-42: the sync pull request records each journal's last hash (REQ-3.8, D-71, D-89) ----

const S42_RUN = { id: '987654321', workflow: 'kitflow', actor: 'octocat' };
const s42git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const S42_FIELDS = { actor: 'ada', slice: 'P1/S-07', stage: 'build', commits: [], verdicts: [], decisions: [] };

// The environment the sync job's step runs in: the CI run's own variables, no pull request.
function s42RunEnv(mergeSha) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if ([...CI_PULL_REQUEST, 'SLICEKIT_GITHOST_FIXTURE'].includes(k.toUpperCase())) delete env[k];
  }
  return { ...env, GITHUB_RUN_ID: S42_RUN.id, GITHUB_WORKFLOW: S42_RUN.workflow, GITHUB_ACTOR: S42_RUN.actor, GITHUB_TRIGGERING_ACTOR: S42_RUN.actor, GITHUB_SHA: mergeSha };
}

// REQ-3.8
test('the sync job writes a journal-heads line per changed journal file', () => {
  // The job runs `journal heads <merge sha>` after the state sync and before sync open commits.
  const cfg = exampleConfig();
  const sync = jobBlock(renderWorkflow(cfg, loadPins()), 'sync');
  const heads = new RegExp(`run: ${cfg.cli.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} journal heads (\\$\\{\\{ github\\.sha \\}\\}|"?\\$\\{?GITHUB_SHA\\}?"?)\\n`).exec(sync);
  assert.ok(heads, sync);
  assert.ok(sync.indexOf(`run: ${cfg.cli} status --sync --write\n`) < heads.index, 'after the state sync');
  assert.ok(heads.index < sync.indexOf(`run: ${cfg.cli} sync open\n`), 'before sync open');

  // A merge that changed two journal files and left a third alone: one line for each changed file.
  const { root, cleanup } = makeRepo({ commits: 1 });
  try {
    const conf = path.join(root, '.slicekit', 'config.json');
    fs.mkdirSync(path.dirname(conf), { recursive: true });
    fs.writeFileSync(conf, JSON.stringify(defaultConfig({ name: 'demo', shape: 'backend' })));
    appendJournal(root, S42_FIELDS);
    s42git(root, ['add', '-A']);
    s42git(root, ['commit', '--quiet', '-m', 'journal on main']);
    s42git(root, ['checkout', '--quiet', '-b', 'slice/a']);
    appendJournal(root, S42_FIELDS);
    appendJournal(root, S42_FIELDS, { branch: 'slice/b' });
    appendJournal(root, { ...S42_FIELDS, stage: 'review' }, { branch: 'slice/b' });
    s42git(root, ['add', '-A']);
    s42git(root, ['commit', '--quiet', '-m', 'a']);
    s42git(root, ['checkout', '--quiet', 'main']);
    s42git(root, ['merge', '--quiet', '--no-ff', '-m', 'merge a', 'slice/a']);
    const merge = s42git(root, ['rev-parse', 'HEAD']);

    const out = runCli(['journal', 'heads', merge], { cwd: root, env: s42RunEnv(merge) });
    assert.equal(out.code, 0, out.stderr + out.stdout);
    const lines = fs.readFileSync(path.join(root, '.slicekit', 'journal-heads.log'), 'utf8').trimEnd().split('\n');
    assert.equal(lines.length, 2, lines.join('\n'));
    const rel = (branch) => path.relative(root, journalFile(root, branch)).split(path.sep).join('/');
    const lastHash = (branch) => parseLine(fs.readFileSync(journalFile(root, branch), 'utf8').trimEnd().split('\n').at(-1)).hash;
    for (const branch of ['slice/a', 'slice/b']) {
      const line = lines.find((l) => l.includes(rel(branch)));
      assert.ok(line, `${rel(branch)} in ${lines.join('\n')}`);
      for (const part of [lastHash(branch), merge.slice(0, 7), S42_RUN.id, S42_RUN.workflow, S42_RUN.actor]) assert.ok(line.includes(part), `${part} in ${line}`);
    }
    assert.ok(!lines.some((l) => l.includes(rel('main'))), 'a journal file the merge did not change has no line');
  } finally {
    cleanup();
  }
});

// P4/S-43, REQ-3.11, D-67, D-69, D-85: Java builds and the team's runners.
//
// Interface these tests fix: renderWorkflow(cfg, pins, { root }) reads the repository at `root` for
// pom.xml, build.gradle and build.gradle.kts at its root; workflowState(root, cfg) passes its root.
// Without a root only the declared commands decide. The JDK step is actions/setup-java pinned by SHA
// from pins.json, with `java-version` from ci.java (default 25) and `cache: maven` or `cache: gradle`.

const commandJobIds = (yml) => jobIds(yml).filter((id) => id.startsWith('cmd-'));

function withRepoFiles(files, fn) {
  const repo = makeRepo({ files });
  try {
    return fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

// The setup-java step of one job: pinned by the pins.json SHA, the JDK version and the cache, placed
// after checkout and before the job's team command.
function assertJdkStep(block, { java, cache }, label) {
  const pins = loadPins();
  const pin = pins['actions/setup-java'];
  assert.ok(pin, 'pins.json pins actions/setup-java');
  assert.match(pin.sha, HEX40);
  assert.match(pin.tag, /^v\d+\.\d+\.\d+$/);
  const uses = `      - uses: actions/setup-java@${pin.sha} # ${pin.tag}\n`;
  const at = block.indexOf(uses);
  assert.notEqual(at, -1, `${label}: setup-java pinned by SHA\n${block}`);
  const next = block.indexOf('\n      - ', at + uses.length - 1);
  const step = block.slice(at, next === -1 ? block.length : next + 1);
  assert.match(step, new RegExp(`\\n {10}java-version: '?${java}'?\\n`), `${label}: java-version ${java}\n${step}`);
  // cache: null means a JDK step with no cache line: setup-java fails a cache that matches no file.
  if (cache === null) assert.doesNotMatch(step, /\n {10}cache: /, `${label}: no cache\n${step}`);
  else assert.match(step, new RegExp(`\\n {10}cache: ${cache}\\n`), `${label}: cache ${cache}\n${step}`);
  assert.equal((block.match(/actions\/setup-java@/g) || []).length, 1, `${label}: one JDK step`);
  assert.ok(block.indexOf('actions/checkout@') < at, `${label}: after checkout`);
  assert.ok(at < block.lastIndexOf('        run: '), `${label}: before the team command`);
}

function assertNoJdkOutsideCommandJobs(yml) {
  for (const id of jobIds(yml).filter((j) => !j.startsWith('cmd-'))) {
    assert.ok(!jobBlock(yml, id).includes('setup-java'), `${id} runs no team command and sets up no JDK`);
  }
}

test("a Maven repository's command jobs set up a JDK with the Maven cache", () => {
  // pom.xml at the root: Maven.
  withRepoFiles({ 'pom.xml': '<project/>\n' }, (root) => {
    const cfg = exampleConfig();
    cfg.commands = { test: 'mvn -B verify', lint: 'npm run lint', build: '', e2e: '' };
    const yml = renderWorkflow(cfg, loadPins(), { root });
    assert.deepEqual(commandJobIds(yml), ['cmd-test', 'cmd-lint']);
    for (const id of commandJobIds(yml)) assertJdkStep(jobBlock(yml, id), { java: 25, cache: 'maven' }, id);
    assertNoJdkOutsideCommandJobs(yml);

    // ci.java overrides the default 25 (D-85).
    cfg.ci.java = 21;
    assertJdkStep(jobBlock(renderWorkflow(cfg, loadPins(), { root }), 'cmd-test'), { java: 21, cache: 'maven' }, 'ci.java 21');
  });

  // No build file, a command calling mvn: still a Java repository; with no pom.xml to key on, no cache.
  withRepoFiles({}, (root) => {
    const cfg = exampleConfig();
    cfg.commands = { test: 'mvn -B verify', lint: '', build: '', e2e: '' };
    assertJdkStep(jobBlock(renderWorkflow(cfg, loadPins(), { root }), 'cmd-test'), { java: 25, cache: null }, 'mvn command only');
  });

  // The scenario: init in a repository with pom.xml and `mvn -B verify` writes a workflow whose test
  // job sets up the JDK with the Maven cache, and `workflow --check` passes on it.
  withRepoFiles({ 'pom.xml': '<project/>\n' }, (root) => {
    init(root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js', commands: { test: 'mvn -B verify' } });
    const written = fs.readFileSync(path.join(root, WORKFLOW_PATH), 'utf8');
    assertJdkStep(jobBlock(written, 'cmd-test'), { java: 25, cache: 'maven' }, 'init');
    const check = runCli(['workflow', '--check'], { cwd: root });
    assert.equal(check.code, 0, check.stderr);
  });
});

test("a Gradle repository's command jobs set up a JDK with the Gradle cache", () => {
  for (const file of ['build.gradle', 'build.gradle.kts']) {
    withRepoFiles({ [file]: '// gradle\n' }, (root) => {
      const cfg = exampleConfig();
      cfg.commands = { test: './gradlew test', lint: './gradlew spotlessCheck', build: 'npm run build', e2e: '' };
      cfg.ci.java = '21';
      const yml = renderWorkflow(cfg, loadPins(), { root });
      assert.deepEqual(commandJobIds(yml), ['cmd-test', 'cmd-lint', 'cmd-build']);
      for (const id of commandJobIds(yml)) assertJdkStep(jobBlock(yml, id), { java: 21, cache: 'gradle' }, `${file} ${id}`);
      assertNoJdkOutsideCommandJobs(yml);
    });
  }

  // Both build files present: the tool the declared commands call decides (D-69).
  withRepoFiles({ 'pom.xml': '<project/>\n', 'build.gradle': '// gradle\n' }, (root) => {
    const cfg = exampleConfig();
    cfg.commands = { test: 'gradle test', lint: '', build: '', e2e: '' };
    assertJdkStep(jobBlock(renderWorkflow(cfg, loadPins(), { root }), 'cmd-test'), { java: 25, cache: 'gradle' }, 'both files, gradle command');
    cfg.commands = { test: 'mvn -B verify', lint: '', build: '', e2e: '' };
    assertJdkStep(jobBlock(renderWorkflow(cfg, loadPins(), { root }), 'cmd-test'), { java: 25, cache: 'maven' }, 'both files, mvn command');
  });

  // Neither build file, a command calling ./gradlew: Gradle, with no cache; a wrapper file deeper down keys it.
  withRepoFiles({}, (root) => {
    const cfg = exampleConfig();
    cfg.commands = { test: './gradlew check', lint: '', build: '', e2e: '' };
    assertJdkStep(jobBlock(renderWorkflow(cfg, loadPins(), { root }), 'cmd-test'), { java: 25, cache: null }, 'gradlew command only');
  });
  withRepoFiles({ 'gradle/wrapper/gradle-wrapper.properties': 'distributionUrl=x\n' }, (root) => {
    const cfg = exampleConfig();
    cfg.commands = { test: './gradlew check', lint: '', build: '', e2e: '' };
    assertJdkStep(jobBlock(renderWorkflow(cfg, loadPins(), { root }), 'cmd-test'), { java: 25, cache: 'gradle' }, 'gradlew with a wrapper file');
  });

  // workflow --check accepts the generated Gradle workflow.
  withRepoFiles({ 'build.gradle.kts': '// gradle\n' }, (root) => {
    init(root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js', commands: { test: './gradlew test' } });
    assertJdkStep(jobBlock(fs.readFileSync(path.join(root, WORKFLOW_PATH), 'utf8'), 'cmd-test'), { java: 25, cache: 'gradle' }, 'init');
    const check = runCli(['workflow', '--check'], { cwd: root });
    assert.equal(check.code, 0, check.stderr);
  });
});

test('ci.runsOn names the runner of every job', () => {
  const runsOnLines = (yml) => yml.split('\n').filter((l) => /^ {4}runs-on: /.test(l));

  // A string: one label.
  const one = exampleConfig();
  one.ci.runsOn = 'payments-runner';
  const ymlOne = renderWorkflow(one, loadPins());
  for (const id of jobIds(ymlOne)) assert.ok(jobBlock(ymlOne, id).includes('    runs-on: payments-runner\n'), id);
  assert.equal(runsOnLines(ymlOne).length, jobIds(ymlOne).length, 'one runs-on per job');
  assert.ok(!ymlOne.includes('ubuntu-latest'), 'no job left on ubuntu-latest');

  // A list: the labels a self-hosted runner carries, every one required.
  const many = exampleConfig();
  many.ci.runsOn = ['self-hosted', 'linux', 'x64'];
  const ymlMany = renderWorkflow(many, loadPins());
  for (const id of jobIds(ymlMany)) assert.ok(jobBlock(ymlMany, id).includes('    runs-on: [self-hosted, linux, x64]\n'), id);
  assert.ok(!ymlMany.includes('ubuntu-latest'));

  // The three-system test matrix is unchanged: cmd-test keeps its operating systems, every other job
  // runs on ci.runsOn (D-67).
  const matrix = exampleConfig();
  matrix.ci.matrix = true;
  matrix.ci.runsOn = ['self-hosted', 'linux'];
  const ymlMatrix = renderWorkflow(matrix, loadPins());
  const t = jobBlock(ymlMatrix, 'cmd-test');
  assert.ok(t.includes('os: [ubuntu-latest, windows-latest, macos-latest]'), t);
  assert.ok(t.includes('    runs-on: ${{ matrix.os }}\n'), t);
  for (const id of jobIds(ymlMatrix).filter((j) => j !== 'cmd-test')) {
    assert.ok(jobBlock(ymlMatrix, id).includes('    runs-on: [self-hosted, linux]\n'), id);
  }

  // Default: ubuntu-latest, as before.
  const plain = renderWorkflow(exampleConfig(), loadPins());
  for (const id of jobIds(plain)) assert.ok(jobBlock(plain, id).includes('    runs-on: ubuntu-latest\n'), id);
});

test('a repository with no Java build renders as before', () => {
  // A Node repository: package.json, no Java build file, no command calling mvn, gradle or ./gradlew.
  withRepoFiles({ 'package.json': '{}\n', 'src/index.js': '\n' }, (root) => {
    const golden = fs.readFileSync(GOLDEN, 'utf8');
    const cfg = exampleConfig();
    assert.equal(renderWorkflow(cfg, loadPins(), { root }), golden, 'with a root');
    assert.equal(renderWorkflow(cfg, loadPins()), golden, 'without a root');
    cfg.ci.runsOn = 'ubuntu-latest';
    assert.equal(renderWorkflow(cfg, loadPins(), { root }), golden, 'ci.runsOn ubuntu-latest is the default');
    cfg.ci.java = 21;
    assert.equal(renderWorkflow(cfg, loadPins(), { root }), golden, 'ci.java alone does not make a Java repository');
    // A word that only contains a tool name is not a call to it.
    cfg.commands = { ...cfg.commands, lint: 'npm run lint:gradle-free && node mvnw-docs.js' };
    assert.ok(!renderWorkflow(cfg, loadPins(), { root }).includes('setup-java'));
  });
  // The kit's own workflow: no Java build, unchanged by this slice.
  const kitRoot = fileURLToPath(new URL('..', import.meta.url));
  const own = renderWorkflow(loadConfig(kitRoot), loadPins(), { root: kitRoot });
  assert.ok(!own.includes('setup-java'));
  assert.equal(fs.readFileSync(path.join(kitRoot, WORKFLOW_PATH), 'utf8'), own);
});
