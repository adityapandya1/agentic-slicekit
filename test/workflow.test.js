// REQ-3.11: the generated GitHub Actions workflow (SHA-pinned actions, a job per declared command).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultConfig, validateConfig } from '../src/config.js';
import { PINS_PATH, loadPins, renderWorkflow, yamlScalar } from '../src/workflow.js';

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
  for (const u of uses) assert.match(u, /^actions\/[a-z-]+@[0-9a-f]{40}$/, u);
  assert.ok(yml.includes(`actions/checkout@${pins['actions/checkout'].sha} # ${pins['actions/checkout'].tag}`));
  assert.ok(yml.includes(`actions/setup-node@${pins['actions/setup-node'].sha} # ${pins['actions/setup-node'].tag}`));
  assert.ok(yml.includes(`actions/upload-artifact@${pins['actions/upload-artifact'].sha}`));
  assert.deepEqual(jobIds(yml), ['gate', 'cmd-test', 'cmd-lint', 'obs-1', 'ready-label', 'sync']);
  assert.ok(jobBlock(yml, 'cmd-lint').includes('run: npm run lint\n'));
  assert.ok(jobBlock(yml, 'cmd-test').includes(`run: 'node --test "test/**/*.test.js"'\n`));

  const gate = jobBlock(yml, 'gate');
  assert.ok(gate.includes('fetch-depth: 0'));
  assert.ok(gate.includes('git fetch --no-tags origin main'));
  assert.ok(gate.indexOf('git config core.hooksPath .githooks') < gate.indexOf('slicekit.js check --ci'));
  assert.ok(gate.includes('run: node node_modules/slicekit/bin/slicekit.js check --ci\n'));
  assert.ok(gate.includes("if: hashFiles('package-lock.json') != ''"));
  assert.ok(!gate.includes('write'), 'gate keeps read-only permissions');
  assert.ok(!yml.includes('npx'), 'never a registry fetch (D-30)');

  const ready = jobBlock(yml, 'ready-label');
  assert.ok(ready.includes('needs: [gate, cmd-test, cmd-lint]'));
  assert.ok(ready.includes('pull-requests: write'));
  assert.ok(ready.includes('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}'));
  assert.ok(ready.includes('slicekit.js ready-label'));
  const sync = jobBlock(yml, 'sync');
  assert.ok(sync.includes("if: github.event_name == 'push'"));
  assert.ok(sync.includes('contents: write'));
  assert.ok(sync.includes("ALLOW_PROTECTED_COMMIT: '1'"));
  assert.ok(sync.includes('slicekit.js status --sync --write'));
  assert.ok(sync.includes('chore(slicekit): sync state [skip ci]'));
  assert.ok(sync.includes('github-actions[bot]'));
  assert.ok(sync.includes('git status --porcelain'));
  assert.match(yml, /^permissions:\n {2}contents: read\n/m);
  assert.match(yml, /^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n/m);
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
  assert.ok(jobBlock(yml, 'ready-label').includes('needs: [gate, cmd-test, cmd-build]'));
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
  assert.ok(jobBlock(yml, 'cmd-lint').includes('runs-on: ubuntu-latest'));
  assert.equal((yml.match(/matrix\.os/g) || []).length, 1);
  assert.ok(jobBlock(yml, 'gate').includes("require('./package.json').dependencies"), 'REQ-5.3 dependency check');
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
