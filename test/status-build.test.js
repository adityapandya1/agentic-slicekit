// REQ-1.6, D-105 (P8/S-58): BUILD.md lists every slice of a phase with a slice not yet merged, with
// its name, group, status and a link to its slice file, and no Done when column; a phase whose slices
// are all merged is one line naming the phase, its number of slices and its folder under the docs root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../src/init.js';
import { loadConfig } from '../src/config.js';
import { readSlice, writeSlice } from '../src/state/index.js';
import { generatedRegion, renderBuild } from '../src/state/build.js';
import { makeRepo } from './helpers/tmp-repo.js';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pad = (n) => String(n).padStart(2, '0');

function write(root, rel, text) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// Phase P<phase>, named `name`, in docs/phases/P<phase>-<dir>/ with `count` slices.
function writePhase(root, { phase, name, dir, count }) {
  const folder = `docs/phases/P${phase}-${dir}`;
  write(root, `${folder}/P${phase}.md`, `# Phase ${phase} — ${name}\n`);
  for (let n = 1; n <= count; n++) {
    write(
      root,
      `${folder}/S-${pad(n)}-thing-${n}.md`,
      `---
slice: P${phase}/S-${pad(n)}
name: Thing ${phase}.${n}
repo: .
group: G${n}
runbook: no
requirements: [REQ-1.6]
decisions: []
---

## Done when

1. Thing ${phase}.${n} finished its unique done-when text.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| \`t.test.js » works\` | happy | REQ-1.6 |

## Expected changes

\`src/t${n}.js\`.
`,
    );
  }
  return folder;
}

const setTo = (root, cfg, id, state, pr = null) => writeSlice(root, cfg, { ...readSlice(root, cfg, id), state, pr });
const merged = (root, cfg, id, n) => setTo(root, cfg, id, 'merged', { number: n, url: `http://x/${n}`, headSha: 'a'.repeat(40), title: `[${id}] x` });

// Phase 1 (Alpha, 2 slices) and phase 2 (Beta, 3 slices), both under the default docs root.
function withPhases(fn) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const one = writePhase(repo.root, { phase: 1, name: 'Alpha', dir: 'alpha', count: 2 });
    const two = writePhase(repo.root, { phase: 2, name: 'Beta', dir: 'beta', count: 3 });
    const cfg = loadConfig(repo.root);
    const render = () => generatedRegion(renderBuild(repo.root, cfg, '')).generated;
    return fn({ root: repo.root, cfg, one, two, render });
  } finally {
    repo.cleanup();
  }
}

const tableLines = (text) => text.split('\n').filter((l) => l.startsWith('|'));
// The table rows that link to a slice file under `folder`.
const rowsInto = (text, folder) => tableLines(text).filter((l) => l.includes(`](${folder}/S-`));

test('a phase with a slice not merged lists its slices with links and no Done when column', () => {
  withPhases(({ root, cfg, one, render }) => {
    merged(root, cfg, 'P1/S-01', 11);
    setTo(root, cfg, 'P1/S-02', 'draft-pr', { number: 14, url: 'http://x/14', headSha: 'b'.repeat(40), title: '[P1/S-02] x' });
    const text = render();
    assert.doesNotMatch(text, /Done when/i);
    assert.doesNotMatch(text, /unique done-when text/);
    const rows = rowsInto(text, one);
    assert.equal(rows.length, 2, text);
    const [first, second] = rows;
    assert.ok(first.includes(`](${one}/S-01-thing-1.md)`), first);
    assert.ok(first.includes('Thing 1.1') && first.includes('G1') && first.includes('Done'), first);
    assert.ok(second.includes(`](${one}/S-02-thing-2.md)`), second);
    assert.ok(second.includes('Thing 1.2') && second.includes('G2') && second.includes('#14'), second);
    // Each table's header, the line above its separator, names the name, group and status, and no Done when.
    const all = text.split('\n');
    const headers = all.filter((l, i) => l.startsWith('|') && /^\|[\s|:-]+\|$/.test(all[i + 1] ?? ''));
    assert.ok(headers.length >= 1, text);
    for (const h of headers) {
      for (const col of ['Name', 'Group', 'Status']) assert.ok(h.includes(col), h);
    }
  });
  // The kit's own queue, rendered from its own state files, is under 20 KB.
  const kitCfg = loadConfig(kitRoot);
  const size = Buffer.byteLength(renderBuild(kitRoot, kitCfg, ''), 'utf8');
  assert.ok(size < 20 * 1024, `the kit's BUILD.md renders to ${size} bytes`);
});

test('a phase whose slices are all merged is one line, and a slice moved back from done brings its rows back', () => {
  withPhases(({ root, cfg, one, two, render }) => {
    merged(root, cfg, 'P2/S-01', 21);
    merged(root, cfg, 'P2/S-02', 22);
    setTo(root, cfg, 'P2/S-03', 'released', { number: 23, url: 'http://x/23', headSha: 'c'.repeat(40), title: '[P2/S-03] x' });
    const text = render();
    assert.deepEqual(rowsInto(text, two), [], text);
    assert.equal(rowsInto(text, one).length, 2, 'phase 1 has slices not merged and keeps its rows');
    const lines = text.split('\n').filter((l) => /Phase 2\b/.test(l));
    assert.equal(lines.length, 1, text);
    const [line] = lines;
    assert.ok(line.includes('Beta'), line);
    assert.ok(line.includes(two), line);
    assert.match(line.replace(/Phase 2\b/, ''), /\b3\b/, line);
    assert.doesNotMatch(text, /Thing 2\.\d/);

    setTo(root, cfg, 'P2/S-02', 'ready', { number: 22, url: 'http://x/22', headSha: 'd'.repeat(40), title: '[P2/S-02] x' });
    const back = render();
    const rows = rowsInto(back, two);
    assert.equal(rows.length, 3, back);
    assert.ok(rows[1].includes('Thing 2.2') && rows[1].includes('#22'), rows[1]);
    assert.ok(back.includes('## Phase 2'), back);
  });
});
