// REQ-3.11, D-56: the CI steps table of observability.md, read as steps of the generated workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { init } from '../src/init.js';
import { WORKFLOW_PATH } from '../src/workflow.js';
import { STEPS_HEADING, allSteps, docSteps } from '../src/observability.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';

const KIT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REL = 'docs/observability.md';

// An observability.md whose CI steps section holds `body`, between two other sections.
const doc = (body) => `# Observability\n\n## Dashboards\n\nNone.\n\n## ${STEPS_HEADING}\n\n${body}\n\n## On-call contact\n\nNone.\n`;
// The 1-based line of the first line of `text` that holds `needle`.
const lineOf = (text, needle) => {
  const at = text.split('\n').findIndex((l) => l.includes(needle));
  assert.notEqual(at, -1, `a line holding ${needle}`);
  return at + 1;
};
const table = (...rows) => ['| Step | Command |', '|---|---|', ...rows].join('\n');

function configWithSteps(steps) {
  const cfg = defaultConfig({ name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js', commands: { test: 'node --test' } });
  cfg.ci.observabilitySteps = steps;
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

test('a section of Not yet known or None holds no steps', () => {
  assert.equal(STEPS_HEADING, 'CI steps the monitoring setup requires');
  const texts = {
    'Not yet known': doc('Not yet known'),
    'None.': doc('None.'),
    'prose with no table': doc('The monitoring setup asks nothing of CI; the test output is all there is.'),
  };
  for (const [label, text] of Object.entries(texts)) {
    const read = docSteps(text, REL);
    assert.deepEqual(read.steps, [], label);
    assert.deepEqual(read.warnings, [], label);
    assert.deepEqual(read.errors, [], label);
  }
  // No such section at all reads the same.
  const none = docSteps('# Observability\n\n## Dashboards\n\nNone.\n', REL);
  assert.deepEqual(none.steps, []);
  assert.deepEqual(none.warnings, []);
});

test('a step named in observability.md and in config is refused, naming both', () => {
  const text = doc(table('| Trace check | `npm run trace-check` |', '| Smoke | npm run smoke |'));
  const line = lineOf(text, '| Smoke |');
  const read = docSteps(text, REL);
  assert.deepEqual(read.errors, []);
  assert.deepEqual(read.steps, [
    { name: 'Trace check', run: 'npm run trace-check', at: `${REL}:${lineOf(text, '| Trace check |')}` },
    { name: 'Smoke', run: 'npm run smoke', at: `${REL}:${line}` },
  ]);

  const cfg = configWithSteps([{ name: 'Lint logs', run: 'npm run lint-logs' }, { name: 'Smoke', run: 'curl -fsS "$URL"', env: { URL: 'https://x.example.com' } }]);
  const all = allSteps(cfg, read);
  assert.deepEqual(all.errors, [`${REL}:${line}: step "Smoke" is also in ci.observabilitySteps[1]; name it in one place`]);

  // A name in one place only: config's steps first, then the doc's.
  const apart = allSteps(configWithSteps([{ name: 'Lint logs', run: 'npm run lint-logs' }]), read);
  assert.deepEqual(apart.errors, []);
  assert.deepEqual(apart.steps.map((s) => s.name), ['Lint logs', 'Trace check', 'Smoke']);

  // `slicekit workflow --write` refuses it, names the file and line, and writes nothing.
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js', commands: { test: 'node --test' } });
    const configFile = path.join(repo.root, '.slicekit', 'config.json');
    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    saved.ci.observabilitySteps = [{ name: 'Smoke', run: 'npm run smoke' }];
    fs.writeFileSync(configFile, `${JSON.stringify(saved, null, 2)}\n`);
    fs.writeFileSync(path.join(repo.root, 'docs', 'observability.md'), text);
    const workflow = path.join(repo.root, WORKFLOW_PATH);
    const before = fs.readFileSync(workflow, 'utf8');
    const r = runCli(['workflow', '--write'], { cwd: repo.root });
    assert.notEqual(r.code, 0, r.stdout);
    assert.ok(r.stderr.includes(`${REL}:${line}: step "Smoke" is also in ci.observabilitySteps[0]; name it in one place`), r.stderr);
    assert.equal(fs.readFileSync(workflow, 'utf8'), before);
  } finally {
    repo.cleanup();
  }
});

test('a doc step holding a GitHub expression is refused with its line', () => {
  const text = doc(table('| Trace check | npm run trace-check |', '| Leak | `echo ${{ secrets.X }}` |'));
  const line = lineOf(text, '| Leak |');
  const read = docSteps(text, REL);
  assert.equal(read.errors.length, 1, read.errors.join('\n'));
  assert.ok(read.errors[0].startsWith(`${REL}:${line}: `), read.errors[0]);
  assert.match(read.errors[0], /contains a GitHub expression/);
  // The error reaches the caller that renders the workflow.
  const all = allSteps(configWithSteps([]), read);
  assert.ok(all.errors.some((e) => e.startsWith(`${REL}:${line}: `)), all.errors.join('\n'));
});

test("the backend example's step renders as a job", () => {
  const repo = makeRepo();
  try {
    fs.cpSync(path.join(KIT_ROOT, 'examples', 'backend'), repo.root, { recursive: true });
    init(repo.root, { name: 'greeting', shape: 'backend', cli: 'node bin/slicekit.js' });
    const yml = fs.readFileSync(path.join(repo.root, WORKFLOW_PATH), 'utf8');
    assert.deepEqual(jobIds(yml).filter((id) => id.startsWith('obs-')), ['obs-1']);
    const job = jobBlock(yml, 'obs-1');
    assert.ok(job.includes('name: Test report as TAP\n'), job);
    assert.match(job, /^ {8}run: .*node --test --test-reporter=tap/m);
    assert.ok(jobBlock(yml, 'checks').includes('obs-1]'), 'the checks job needs obs-1');
    const check = runCli(['workflow', '--check'], { cwd: repo.root });
    assert.equal(check.code, 0, check.stderr);
  } finally {
    repo.cleanup();
  }
});
