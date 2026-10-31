// REQ-4.5: the order of `history` (P3/S-34, issues #48 and #49). Two slices whose newest commit is
// the same commit print in slice order whatever order the index returns the `in` edges; commits whose
// committer dates carry different UTC offsets are ordered by instant, through history itself, on a
// repository built with test/helpers/graph-fixture.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../../src/config.js';
import { history } from '../../src/graph/history.js';
import { indexGraph } from '../../src/graph/load.js';
import { cli } from '../helpers/build-flow.js';
import { commitFixed, gitIn, write } from '../helpers/graph-fixture.js';
import { makeRepo } from '../helpers/tmp-repo.js';

test('two slices tied on one newest commit print in slice order, whatever the edge order', () => {
  const nodes = [
    { id: 'file:src/a.js', kind: 'file' },
    { id: 'commit:ccc', kind: 'commit', date: '2026-10-30T10:00:00Z' },
    { id: 'slice:P1/S-03', kind: 'slice' },
    { id: 'slice:P1/S-04', kind: 'slice' },
  ];
  const touched = { kind: 'touched', from: 'commit:ccc', to: 'file:src/a.js' };
  const in03 = { kind: 'in', from: 'commit:ccc', to: 'slice:P1/S-03' };
  const in04 = { kind: 'in', from: 'commit:ccc', to: 'slice:P1/S-04' };
  for (const edges of [[touched, in03, in04], [touched, in04, in03]]) {
    const out = history(indexGraph({ nodes, edges }), ['src']).map((e) => [e.slice, e.sha]);
    assert.deepEqual(out, [['P1/S-03', 'ccc'], ['P1/S-04', 'ccc']]);
  }
});

const sliceFile = (id) =>
  `---\nslice: ${id}\nname: Zone\nrepo: .\ngroup: A\nrunbook: no\nrequirements: [REQ-1.1]\ndecisions: [D-01]\n---\n\n## Done when\n\n1. It works.\n\n## Evaluation set\n\n| Test | Kind | Covers |\n|---|---|---|\n| \`a.test.js » works\` | happy | REQ-1.1 |\n\n## Expected changes\n\n\`src/x/a.js\`.\n`;

// One commit with the given committer (and author) date -> its SHA.
function commitAt(root, message, date, files) {
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  gitIn(root, ['add', '-A']);
  gitIn(root, ['commit', '-q', '-m', message], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return gitIn(root, ['rev-parse', 'HEAD']);
}

test('history orders commits whose dates carry different offsets by instant', async () => {
  const repo = makeRepo();
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-graph-host-'));
  try {
    const { root } = repo;
    const cfg = defaultConfig({ name: 'zones', shape: 'backend', commands: { test: 'node --test' } });
    commitFixed(root, 'plan', {
      '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n`,
      '.gitignore': '.slicekit/graph/\n',
      'docs/spec/01-zones.md': '# 01 — Zones\n\n## REQ-1.1 It works\n\nThe kit SHALL work.\n\nScenario: GIVEN a zone WHEN it runs THEN it works.\n\nCites: D-01.\n',
      'docs/decisions.md': '# Decisions\n\n## Settled\n\n| # | Type | Question | Answer | Who, when |\n|---|------|----------|--------|-----------|\n| D-01 | Decision | Zones? | yes | team, 2026-10-01 |\n',
      'docs/phases/P1-zones/P1.md': '# Phase 1 — Zones\n\n**Order:** A\n',
      'docs/phases/P1-zones/S-01-a.md': sliceFile('P1/S-01'),
      'docs/phases/P1-zones/S-02-b.md': sliceFile('P1/S-02'),
      'docs/phases/P1-zones/S-03-c.md': sliceFile('P1/S-03'),
    });
    // 10:00+05:30 is 04:30 UTC: earlier than 06:00+00:00, though its text sorts later.
    const INDIA = '2026-10-30T10:00:00+05:30';
    const LONDON = '2026-10-30T06:00:00+00:00';
    assert.ok(INDIA > LONDON && Date.parse(INDIA) < Date.parse(LONDON), 'text order and instant order disagree');
    // The final sort: S-01 at 04:30 UTC, S-02 at 06:00 UTC, both on src/x.
    commitAt(root, 'feat(P1/S-01): a\n\nSlice: P1/S-01', INDIA, { 'src/x/a.js': '1\n' });
    commitAt(root, 'feat(P1/S-02): b\n\nSlice: P1/S-02', LONDON, { 'src/x/b.js': '1\n' });
    // The newest pick: S-03's two commits on src/y, the later instant written with the earlier text.
    commitAt(root, 'feat(P1/S-03): c\n\nSlice: P1/S-03', INDIA, { 'src/y/c.js': '1\n' });
    const s03 = commitAt(root, 'feat(P1/S-03): c again\n\nSlice: P1/S-03', LONDON, { 'src/y/c.js': '2\n' });

    const built = await cli(root, ['graph'], { ...process.env, SLICEKIT_GITHOST_FIXTURE: host });
    assert.equal(built.code, 0, built.stderr);
    const graph = JSON.parse(fs.readFileSync(path.join(root, '.slicekit', 'graph', 'graph.json'), 'utf8'));
    // The graph keeps each committer's offset, so the dates reach history as text that sorts wrongly.
    const dates = graph.nodes.filter((n) => n.kind === 'commit').map((n) => n.date);
    assert.ok(dates.includes(INDIA), dates.join(', '));
    const index = indexGraph(graph);

    assert.deepEqual(history(index, ['src/x']).map((e) => e.slice), ['P1/S-02', 'P1/S-01']);
    assert.deepEqual(history(index, ['src/y']).map((e) => [e.slice, e.sha]), [['P1/S-03', s03]]);
    const r = await cli(root, ['history', 'src/x', '--json']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).map((e) => e.slice), ['P1/S-02', 'P1/S-01']);
  } finally {
    fs.rmSync(host, { recursive: true, force: true });
    repo.cleanup();
  }
});
