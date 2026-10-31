// REQ-4.4, REQ-3.11: the gate job keeps the graph's pull request cache between runs (P3/S-34, issue
// #37, D-51). It restores .slicekit/graph/cache before `Build the graph` and saves it after, with
// actions/cache pinned by SHA like every other action; pins without actions/cache are refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { loadPins, renderWorkflow } from '../src/workflow.js';

const KIT_WORKFLOW = fileURLToPath(new URL('../.github/workflows/slicekit.yml', import.meta.url));

const config = () => defaultConfig({ name: 'demo', shape: 'backend', cli: 'npx slicekit', commands: { test: 'node --test' } });

// The gate job's steps, each as its lines joined by \n.
function gateSteps(yml) {
  const lines = yml.replace(/\r\n/g, '\n').split('\n');
  const start = lines.indexOf('  gate:');
  assert.notEqual(start, -1, 'no gate job');
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:$/.test(lines[end])) end++;
  const steps = [];
  for (const line of lines.slice(start, end)) {
    if (/^ {6}- /.test(line)) steps.push([line]);
    else if (steps.length > 0 && /^ {8}/.test(line)) steps.at(-1).push(line);
  }
  return steps.map((s) => s.join('\n'));
}

test('the gate restores the pull request cache before the graph and saves it after', () => {
  const pin = loadPins()['actions/cache'];
  assert.deepEqual(Object.keys(pin ?? {}).sort(), ['sha', 'tag'], 'pins.json has an actions/cache entry');
  assert.equal(pin.tag, 'v4.2.3');
  assert.match(pin.sha, /^[0-9a-f]{40}$/);
  const restore = [
    '      - name: Restore the pull request cache',
    `        uses: actions/cache/restore@${pin.sha} # ${pin.tag}`,
    '        with:',
    '          path: .slicekit/graph/cache',
    '          key: slicekit-pr-cache-${{ github.run_id }}',
    '          restore-keys: slicekit-pr-cache-',
  ].join('\n');
  const save = [
    '      - name: Save the pull request cache',
    '        if: always()',
    `        uses: actions/cache/save@${pin.sha} # ${pin.tag}`,
    '        with:',
    '          path: .slicekit/graph/cache',
    '          key: slicekit-pr-cache-${{ github.run_id }}',
  ].join('\n');
  for (const [what, yml] of [['rendered', renderWorkflow(config(), loadPins())], ['the kit\'s own', fs.readFileSync(KIT_WORKFLOW, 'utf8')]]) {
    const steps = gateSteps(yml);
    const graph = steps.findIndex((s) => s.startsWith('      - name: Build the graph\n'));
    assert.notEqual(graph, -1, `${what}: no Build the graph step`);
    assert.equal(steps[graph - 1], restore, `${what}: the step before Build the graph`);
    assert.equal(steps[graph + 1], save, `${what}: the step after Build the graph`);
  }
});

test('pins without actions/cache are refused, naming it', () => {
  const pins = structuredClone(loadPins());
  delete pins['actions/cache'];
  assert.throws(() => renderWorkflow(config(), pins), { message: 'pins: actions/cache needs a 40-hex sha and a vX.Y.Z tag' });
  const bad = structuredClone(loadPins());
  bad['actions/cache'] = { tag: 'v4', sha: 'v4' };
  assert.throws(() => renderWorkflow(config(), bad), { message: 'pins: actions/cache needs a 40-hex sha and a vX.Y.Z tag' });
});
