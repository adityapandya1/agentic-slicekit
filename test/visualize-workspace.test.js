// REQ-4.7: visualize names a workspace repository's pull request by its repository (P3/S-34, issue
// #63). On the workspace fixture of test/helpers/workspace-fixture.js, orders' pull request 3 is
// labelled orders#3 in its title and its pull request line, as src/graph/render.js names it, and a
// pull request of the program repository stays #<n>. The page's view functions run under node:vm.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { renderPage } from '../src/visualize/page.js';
import { commitFixed } from './helpers/graph-fixture.js';
import { runCli } from './helpers/run-cli.js';
import { workspaceProgram, writeJson } from './helpers/workspace-fixture.js';

let ws;
let graph;

// The page script (the <script> with no type) run under node:vm with no document -> slicekitViews.
function viewsOf(html) {
  const code = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\btype=/.test(m[1]) && !/\bsrc=/.test(m[1]));
  assert.equal(code.length, 1, 'the page holds one inline page script');
  return vm.runInNewContext(`${code[0][2]}\n;slicekitViews`, {}, { timeout: 2000 });
}

before(() => {
  ws = workspaceProgram();
  // A program pull request, squash-merged as #5, for P1/S-01.
  commitFixed(ws.root, 'feat(P1/S-01): more (#5)\n\nSlice: P1/S-01', { 'src/d.js': '1\n' });
  writeJson(ws.fixture, 'pr-5.json', {
    number: 5,
    url: 'https://github.com/acme/program/pull/5',
    state: 'MERGED',
    mergedAt: '2026-10-03T10:00:00Z',
    headRefOid: 'b'.repeat(40),
    headRefName: 'slice/P1-S-01-a',
    isDraft: false,
    title: '[P1/S-01] Program a',
    body: 'Slice: P1/S-01',
    labels: [],
  });
  const r = runCli(['graph', '--full'], { cwd: ws.root, env: { ...process.env, SLICEKIT_GITHOST_FIXTURE: ws.fixture } });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  graph = JSON.parse(fs.readFileSync(path.join(ws.root, '.slicekit', 'graph', 'graph.json'), 'utf8'));
});
after(() => ws?.cleanup());

const heading = (html) => /<h2>[\s\S]*?<\/h2>/.exec(html)?.[0] ?? '';
const prSection = (html) => html.slice(html.indexOf('<h3>Pull requests</h3>'));

test('a workspace pull request is labelled with its repository and a program one is not', () => {
  assert.ok(graph.nodes.some((n) => n.id === 'pull-request:orders#3' && n.repo === 'orders'), 'the graph holds orders#3');
  assert.ok(graph.nodes.some((n) => n.id === 'pull-request:5' && !n.repo), 'the graph holds #5');
  const views = viewsOf(renderPage(graph));

  const orders = views.detail(graph, 'pull-request:orders#3');
  assert.match(heading(orders), /<\/span>orders#3 \[P1\/S-04\] Publish orders<\/h2>/);
  assert.ok(prSection(orders).includes('<a href="https://github.com/acme/orders/pull/3"'), prSection(orders));
  assert.match(prSection(orders), />orders#3<\/a>/);
  assert.doesNotMatch(prSection(orders), />#3</);

  const slice = views.detail(graph, 'slice:P1/S-04');
  assert.match(prSection(slice), />orders#3<\/a>/);

  const program = views.detail(graph, 'pull-request:5');
  assert.match(heading(program), /<\/span>#5 \[P1\/S-01\] Program a<\/h2>/);
  assert.match(prSection(program), /<a href="https:\/\/github\.com\/acme\/program\/pull\/5"[^>]*>#5<\/a>/);
});
