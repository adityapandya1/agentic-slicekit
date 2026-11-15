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

// Review round 1 of P5/S-22.

test('a row holding a line separator is refused with its file and line', () => {
  for (const [label, sep] of [['U+2028', '\u2028'], ['U+2029', '\u2029']]) {
    for (const row of [`| Split | echo a${sep}echo b |`, `| Sp${sep}lit | echo a |`, `| Split | \`echo a${sep}\` |`]) {
      const text = doc(table('| Trace check | npm run trace-check |', row, '| Smoke | npm run smoke |'));
      const line = lineOf(text, 'echo a');
      const read = docSteps(text, REL);
      assert.equal(read.errors.length, 1, `${label}: ${JSON.stringify(read)}`);
      assert.ok(read.errors[0].startsWith(`${REL}:${line}: `), read.errors[0]);
      assert.match(read.errors[0], /contains a line separator YAML cannot carry/);
      // The rows around it are still read.
      assert.deepEqual(read.steps.map((s) => s.name), ['Trace check', 'Smoke'], label);
    }
  }

  // `slicekit workflow --write` refuses it and writes nothing.
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js', commands: { test: 'node --test' } });
    const text = doc(table('| Trace check | npm run trace-check |', '| Split | echo a\u2028echo b |'));
    fs.writeFileSync(path.join(repo.root, 'docs', 'observability.md'), text);
    const workflow = path.join(repo.root, WORKFLOW_PATH);
    const before = fs.readFileSync(workflow, 'utf8');
    const r = runCli(['workflow', '--write'], { cwd: repo.root });
    assert.notEqual(r.code, 0, r.stdout);
    assert.ok(r.stderr.includes(`${REL}:${lineOf(text, '| Split |')}: `), r.stderr);
    assert.equal(fs.readFileSync(workflow, 'utf8'), before);
  } finally {
    repo.cleanup();
  }
});

test('a bare pipe in a command and a row with more cells than the header are refused', () => {
  // A bare pipe inside a code span still ends the cell.
  const piped = doc(table('| Trace check | npm run trace-check |', '| Count | `cat a | wc -l` |'));
  const pipedRead = docSteps(piped, REL);
  assert.equal(pipedRead.errors.length, 1, JSON.stringify(pipedRead));
  assert.ok(pipedRead.errors[0].startsWith(`${REL}:${lineOf(piped, '| Count |')}: `), pipedRead.errors[0]);
  assert.ok(pipedRead.errors[0].includes('\\|'), pipedRead.errors[0]);
  assert.deepEqual(pipedRead.steps.map((s) => s.name), ['Trace check']);

  const wide = doc(table('| Count | cat a | wc -l |'));
  const wideRead = docSteps(wide, REL);
  assert.equal(wideRead.errors.length, 1, JSON.stringify(wideRead));
  assert.ok(wideRead.errors[0].startsWith(`${REL}:${lineOf(wide, '| Count |')}: `), wideRead.errors[0]);
  assert.deepEqual(wideRead.steps, []);

  // Written as the intake procedure says, the whole command is read.
  const escaped = doc(table('| Count | `cat a \\| wc -l` |'));
  const escapedRead = docSteps(escaped, REL);
  assert.deepEqual(escapedRead.errors, []);
  assert.deepEqual(escapedRead.steps.map((s) => s.run), ['cat a | wc -l']);
});

test('two rows with one Step name are refused, naming both lines', () => {
  const text = doc(table('| Smoke | npm run smoke |', '| Trace check | npm run trace-check |', '| Smoke | npm run smoke-two |'));
  const first = lineOf(text, 'npm run smoke |');
  const second = lineOf(text, 'npm run smoke-two');
  const read = docSteps(text, REL);
  assert.equal(read.errors.length, 1, JSON.stringify(read));
  assert.ok(read.errors[0].startsWith(`${REL}:${second}: `), read.errors[0]);
  assert.ok(read.errors[0].includes('"Smoke"'), read.errors[0]);
  assert.ok(read.errors[0].includes(`${REL}:${first}`), read.errors[0]);
  assert.deepEqual(read.steps.map((s) => s.run), ['npm run smoke', 'npm run trace-check']);
});

test('a command in a double-backtick span keeps its inner backtick only', () => {
  const text = doc(table('| Echo | `` echo `x` `` |', '| Plain | `npm run plain` |', '| Open | `echo a` && echo `b` |'));
  const read = docSteps(text, REL);
  // A Command of two code spans and text is refused with its line; the rows before it are read.
  assert.equal(read.errors.length, 1, JSON.stringify(read));
  assert.ok(read.errors[0].startsWith(`${REL}:${lineOf(text, '| Open |')}: `), read.errors[0]);
  assert.deepEqual(read.steps.map((s) => s.run), ['echo `x`', 'npm run plain']);
});

// Review round 2 of P5/S-22.

test('a line of the steps table that begins with a bar is read as a row or refused with its line (H-6)', () => {
  // A row with no closing bar is a row, and the rows after it are read.
  const open = doc(table('| A | npm run a |', '| B | npm run b', '| C | npm run c |'));
  const openRead = docSteps(open, REL);
  assert.deepEqual(openRead.errors, []);
  assert.deepEqual(openRead.warnings, []);
  assert.deepEqual(openRead.steps, [
    { name: 'A', run: 'npm run a', at: `${REL}:${lineOf(open, '| A |')}` },
    { name: 'B', run: 'npm run b', at: `${REL}:${lineOf(open, '| B |')}` },
    { name: 'C', run: 'npm run c', at: `${REL}:${lineOf(open, '| C |')}` },
  ]);

  // A row holding a lone carriage return is refused with its line, and the row after it is read.
  const split = doc(table('| Split | echo a\recho b |', '| Smoke | npm run smoke |'));
  const splitRead = docSteps(split, REL);
  assert.equal(splitRead.errors.length, 1, JSON.stringify(splitRead));
  assert.ok(splitRead.errors[0].startsWith(`${REL}:${lineOf(split, '| Split |')}: `), splitRead.errors[0]);
  assert.match(splitRead.errors[0], /carriage return/);
  assert.deepEqual(splitRead.steps.map((s) => s.name), ['Smoke']);

  // A line of text inside the table does not end it: the row after it is read.
  const mixed = doc(table('| A | npm run a |', 'a line of text', '| C | npm run c |'));
  assert.deepEqual(docSteps(mixed, REL).steps.map((s) => s.name), ['A', 'C']);

  // A blank line ends the table: a line beginning with a bar after it is no row, and is refused with its line.
  const ended = doc(`${table('| A | npm run a |')}\n\n| Later | npm run later |`);
  const endedRead = docSteps(ended, REL);
  assert.equal(endedRead.errors.length, 1, JSON.stringify(endedRead));
  assert.ok(endedRead.errors[0].startsWith(`${REL}:${lineOf(ended, '| Later |')}: `), endedRead.errors[0]);
  assert.deepEqual(endedRead.steps.map((s) => s.name), ['A']);
});

// Review round 3 of P5/S-22: the section is read whole. A line holding a vertical bar is a line of
// the one steps table in its exact form, or it is refused with its file and line.

test('a line holding a bar that does not open with one is refused with its line (H-8)', () => {
  // Inside the table: the line is refused, and the rows around it are read.
  const inside = doc(table('| Two | npm run two |', 'Three | npm run three', '| Four | npm run four |'));
  const insideRead = docSteps(inside, REL);
  assert.equal(insideRead.errors.length, 1, JSON.stringify(insideRead));
  assert.ok(insideRead.errors[0].startsWith(`${REL}:${lineOf(inside, 'Three |')}: `), insideRead.errors[0]);
  assert.match(insideRead.errors[0], /opens with a bar/);
  assert.deepEqual(insideRead.steps.map((s) => s.name), ['Two', 'Four']);

  // A whole table written with no opening bars is refused at its first line, and the message says the form.
  const bare = doc(['Step | Command', '---|---', 'Two | npm run two'].join('\n'));
  const bareRead = docSteps(bare, REL);
  assert.equal(bareRead.errors.length, 1, JSON.stringify(bareRead));
  assert.ok(bareRead.errors[0].startsWith(`${REL}:${lineOf(bare, 'Step | Command')}: `), bareRead.errors[0]);
  assert.ok(bareRead.errors[0].includes('| Step | Command |'), bareRead.errors[0]);
  assert.deepEqual(bareRead.steps, []);

  // A line of text holding a bar before the table is refused too.
  const before = doc(`Runs a | b nightly.\n\n${table('| Two | npm run two |')}`);
  const beforeRead = docSteps(before, REL);
  assert.equal(beforeRead.errors.length, 1, JSON.stringify(beforeRead));
  assert.ok(beforeRead.errors[0].startsWith(`${REL}:${lineOf(before, 'Runs a')}: `), beforeRead.errors[0]);

  // A second steps table is refused at its header.
  const twice = doc(`${table('| Two | npm run two |')}\n\nMore:\n\n${table('| Five | npm run five |')}`);
  const twiceRead = docSteps(twice, REL);
  const second = twice.split('\n').lastIndexOf('| Step | Command |') + 1;
  assert.equal(twiceRead.errors.length, 1, JSON.stringify(twiceRead));
  assert.ok(twiceRead.errors[0].startsWith(`${REL}:${second}: `), twiceRead.errors[0]);
  assert.ok(twiceRead.errors[0].includes('| Step | Command |'), twiceRead.errors[0]);
});

test('a Command cell that mixes a code span with other text is refused with its line (H-9)', () => {
  const text = doc(table('| Unit | `npm test` (D-12) |', '| Date | echo `date |', '| Plain | npm run plain |', '| Span | `npm run span` |', '| Wide | `` echo `x` `` |'));
  const read = docSteps(text, REL);
  assert.equal(read.errors.length, 2, JSON.stringify(read));
  assert.ok(read.errors[0].startsWith(`${REL}:${lineOf(text, '| Unit |')}: `), read.errors[0]);
  assert.ok(read.errors[1].startsWith(`${REL}:${lineOf(text, '| Date |')}: `), read.errors[1]);
  for (const e of read.errors) assert.match(e, /code span/);
  // One code span, or text with no backtick, is read.
  assert.deepEqual(read.steps.map((s) => s.run), ['npm run plain', 'npm run span', 'echo `x`']);
});

test('a table GitHub does not show is not read, and a divider of another cell count is refused (H-10)', () => {
  const rows = ['| Step | Command |', '|---|---|', '| Test report as TAP | `node --test --test-reporter=tap` |'];
  const hidden = {
    'an HTML comment over several lines': ['<!--', ...rows, '-->'].join('\n'),
    'an HTML comment on each line': rows.map((r) => `<!-- ${r} -->`).join('\n'),
    'four spaces of indent': rows.map((r) => `    ${r}`).join('\n'),
    'a tab of indent': rows.map((r) => `\t${r}`).join('\n'),
    'a code fence': ['```', ...rows, '```'].join('\n'),
  };
  for (const [label, body] of Object.entries(hidden)) {
    const read = docSteps(doc(`None.\n\n${body}`), REL);
    assert.deepEqual(read.steps, [], label);
    assert.deepEqual(read.warnings, [], label);
    assert.deepEqual(read.errors, [], label);
  }

  // A divider with one cell or three under the two-cell header is refused at the divider's line.
  for (const divider of ['|---|---|---|', '|---|']) {
    const text = doc(['| Step | Command |', divider, '| Smoke | npm run smoke |'].join('\n'));
    const read = docSteps(text, REL);
    assert.equal(read.errors.length, 1, `${divider}: ${JSON.stringify(read)}`);
    assert.ok(read.errors[0].startsWith(`${REL}:${lineOf(text, divider)}: `), read.errors[0]);
    assert.ok(read.errors[0].includes('| Step | Command |'), read.errors[0]);
    assert.deepEqual(read.steps, [], divider);
  }

  // A row commented out of the table is not a step. The comment ends the table, so the row after it is refused.
  const cut = doc(table('| A | npm run a |', '<!-- | B | npm run b | -->', '| C | npm run c |'));
  const cutRead = docSteps(cut, REL);
  assert.deepEqual(cutRead.steps.map((s) => s.name), ['A']);
  assert.equal(cutRead.errors.length, 1, JSON.stringify(cutRead));
  assert.ok(cutRead.errors[0].startsWith(`${REL}:${lineOf(cut, '| C |')}: `), cutRead.errors[0]);
});

test('a header whose cells are styled or differ in case is refused with its line (H-11)', () => {
  for (const header of ['| **Step** | **Command** |', '| step | command |', '| STEP | COMMAND |', '| `Step` | `Command` |', '| _Step_ | Command |']) {
    const text = doc([header, '|---|---|', '| Smoke | npm run smoke |'].join('\n'));
    const read = docSteps(text, REL);
    assert.equal(read.errors.length, 1, `${header}: ${JSON.stringify(read)}`);
    assert.ok(read.errors[0].startsWith(`${REL}:${lineOf(text, header)}: `), read.errors[0]);
    assert.ok(read.errors[0].includes('| Step | Command |'), read.errors[0]);
    assert.deepEqual(read.steps, [], header);
    assert.deepEqual(read.warnings, [], header);
  }
});
