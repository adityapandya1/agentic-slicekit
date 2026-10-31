// REQ-2.11, REQ-3.7: build verdict refuses a verdict whose text fails the references rule, naming each line.
// P2/S-29 Done when 4: `build verdict` refuses a verdict whose text would fail the `references` rule,
// naming each line, before it moves or commits the file; the reviewer brief says so.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../src/git.js';
import { TEMPLATES } from '../src/instructions.js';
import { cli, green, stateIn, write } from './helpers/build-flow.js';

const REVIEWS = '.slicekit/reviews';
const at = (root, rel) => path.join(root, ...rel.split('/'));

// A well-formed verdict file whose findings rows say `wrong`, with `notChecked` under "Not checked".
function verdictText(verdict, findings = [], notChecked = ['performance']) {
  const head = git(p.wt, ['rev-parse', 'HEAD']);
  const rows = findings.map(([id, wrong]) => `| ${id} | src/t1.js:1 | ${wrong} | it matters | read only |`);
  return [
    `Verdict: ${verdict}`,
    `Head: ${head}`,
    '',
    '| ID | File:line | What is wrong | Why it matters | How verified |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '## Checklists run',
    '',
    '- correctness',
    '',
    '## Not checked',
    '',
    ...notChecked.map((n) => `- ${n}`),
    '',
  ].join('\n');
}

// One slice at draft-pr for the whole file: the refused verdict changes nothing, so the accepted one
// is still round 1.
let p;
before(async () => {
  p = await green();
  const r = await p.pr();
  assert.equal(r.code, 0, r.stderr);
});
after(() => p?.cleanup());

const verdict = (file) => cli(p.root, ['build', 'verdict', 'P1/S-01', file], p.env);

test('a verdict naming an unknown slice or a missing path is refused, naming the line', async () => {
  const text = verdictText('BLOCK', [
    ['B-1', 'x repeats the fault of P9/S-99'],
    ['B-2', 'x should be read from `src/missing.js`'],
  ]);
  const rel = `${REVIEWS}/P1-S-01-r1.md`;
  write(p.root, rel, text);
  const lines = text.split('\n');
  const sliceLine = lines.findIndex((l) => l.includes('P9/S-99')) + 1;
  const pathLine = lines.findIndex((l) => l.includes('src/missing.js')) + 1;
  const before = stateIn(p.wt);
  const head = git(p.wt, ['rev-parse', 'HEAD']);

  const r = await verdict(rel);
  assert.notEqual(r.code, 0, r.stdout);
  const err = r.stderr.split('\n');
  const named = (value, line) => err.some((l) => l.includes(value) && new RegExp(`\\b${line}\\b`).test(l));
  assert.ok(named('P9/S-99', sliceLine), `no stderr line names P9/S-99 at line ${sliceLine}:\n${r.stderr}`);
  assert.ok(named('src/missing.js', pathLine), `no stderr line names src/missing.js at line ${pathLine}:\n${r.stderr}`);
  // Refused before anything moved or was committed.
  assert.ok(fs.existsSync(at(p.root, rel)));
  assert.ok(!fs.existsSync(at(p.wt, rel)));
  assert.equal(git(p.wt, ['rev-parse', 'HEAD']), head);
  assert.deepEqual(stateIn(p.wt), before);
  fs.rmSync(at(p.root, rel));
});

test('a verdict with only known IDs and real paths is accepted', async () => {
  // The reviewer brief says a verdict names only IDs and paths that exist.
  const brief = fs.readFileSync(path.join(TEMPLATES, 'agents', 'reviewer.md'), 'utf8').split('\n');
  assert.ok(
    brief.some((l) => /\bIDs?\b/.test(l) && /\bpaths?\b/i.test(l) && /refused/.test(l)),
    'the reviewer brief has no line saying a verdict naming an ID or a path that does not exist is refused',
  );

  // src/t1.js exists in the worktree, not in the session root the verdict is written in.
  assert.ok(fs.existsSync(at(p.wt, 'src/t1.js')));
  assert.ok(!fs.existsSync(at(p.root, 'src/t1.js')));
  const text = verdictText('APPROVE', [], ['P1/S-01 against REQ-1.1 and D-01 in `src/t1.js` on Windows']);
  const rel = `${REVIEWS}/P1-S-01-r1.md`;
  write(p.root, rel, text);
  const r = await verdict(rel);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(at(p.wt, rel)));
  assert.equal(stateIn(p.wt).state, 'in-review');
});
