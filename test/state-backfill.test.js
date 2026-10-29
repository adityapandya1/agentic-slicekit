// P2/S-29 Done when 5: `state set <id> merged --backfill` is accepted from any state when the git
// host reports the slice's pull request merged, with its merge time and head, and refused otherwise.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../src/git.js';
import { cli, green, stateIn } from './helpers/build-flow.js';

// One slice at draft-pr, its pull request #1 in the fixture host, for the whole file: the refused
// backfill changes nothing, so the accepted one still starts from draft-pr.
let p;
let number;
before(async () => {
  p = await green();
  const r = await p.pr();
  assert.equal(r.code, 0, r.stderr);
  number = stateIn(p.wt).pr.number;
});
after(() => p?.cleanup());

// The fixture host's pull request rewritten: `fields` replace what gh would print.
function hostReports(fields) {
  const file = path.join(p.host, `pr-${number}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...raw, ...fields }, null, 2)}\n`);
}

const backfill = () => cli(p.wt, ['state', 'set', 'P1/S-01', 'merged', '--backfill'], p.env);

test('backfill merged is refused when the host reports the pull request open', async () => {
  hostReports({ state: 'OPEN', mergedAt: null, headRefOid: git(p.wt, ['rev-parse', 'HEAD']) });
  const before = stateIn(p.wt);
  assert.equal(before.state, 'draft-pr');
  const r = await backfill();
  assert.notEqual(r.code, 0, r.stdout);
  // Refused because the host says the pull request is open, not because the slice is past todo.
  assert.doesNotMatch(r.stderr, /only allowed from todo/);
  assert.match(r.stderr, /open|not merged/i);
  assert.deepEqual(stateIn(p.wt), before);
});

test('backfill merged from draft-pr is accepted when the host reports the pull request merged', async () => {
  const head = git(p.wt, ['rev-parse', 'HEAD']);
  const mergedAt = '2026-10-28T09:30:00Z';
  hostReports({ state: 'MERGED', mergedAt, headRefOid: head });
  assert.equal(stateIn(p.wt).state, 'draft-pr');
  const r = await backfill();
  assert.equal(r.code, 0, r.stderr);
  const st = stateIn(p.wt);
  assert.equal(st.state, 'merged');
  assert.equal(Date.parse(st.mergedAt), Date.parse(mergedAt));
  assert.equal(st.pr.number, number);
  assert.equal(st.pr.headSha, head);
  const last = st.history.at(-1);
  assert.equal(last.from, 'draft-pr');
  assert.equal(last.to, 'merged');
  assert.equal(last.by, 'backfill');
});
