// The shared setup of the test/commands/review-loop-<n>.test.js files (P3/S-33, issue #55): the imports
// and every helper the old review-loop.test.js defined at its top level, exported as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { getHost } from '../../src/adapters/githost/index.js';
import { recordVerdict, reviewerBlocked } from '../../src/build/verdict.js';
import { FINISH_WAIT, finish, proofWithCi } from '../../src/build/finish.js';
import { git } from '../../src/git.js';
import { getSection, prBodyProblems } from '../../src/prbody.js';
import { cli, commitIn, commitWorkCli, green as greenFlow, leaveReview, prCalls, reviewWorktree, stateIn, vpath, write } from '../helpers/build-flow.js';
import { briefProblems } from '../helpers/brief-lint.js';
import { TEMPLATES } from '../../src/instructions.js';

export const REVIEWS = '.slicekit/reviews';

// The worktree whose head the next verdict names (D-43): each slice this file builds sets it.
export let reviewed = null;

export const green = async () => {
  const p = await greenFlow();
  reviewed = p.wt;
  return p;
};

// A well-formed verdict file on the head `reviewed` holds: `findings` are [id, what is wrong] pairs.
export function verdictText(verdict, findings = []) {
  const rows = findings.map(([id, wrong]) => `| ${id} | src/t1.js:1 | ${wrong} | it matters | \`node --test\` printed "fail 1" |`);
  return [
    `Verdict: ${verdict}`,
    `Head: ${git(reviewed, ['rev-parse', 'HEAD'])}`,
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
    '- performance',
    '',
  ].join('\n');
}

// The reviewer writes round `k` into the session root; -> its path relative to the root.
export function review(p, k, text) {
  const rel = `${REVIEWS}/P1-S-01-r${k}.md`;
  write(p.root, rel, text);
  return rel;
}

// A slice at draft-pr: green, then build pr against the fixture host.
export async function drafted() {
  const p = await green();
  const r = await p.pr();
  assert.equal(r.code, 0, r.stderr);
  return { ...p, verdict: (file) => cli(p.root, ['build', 'verdict', 'P1/S-01', file], p.env) };
}

// A fix push: a code change committed green, then build pr again (back to draft-pr).
export async function fixPush(p, n) {
  write(p.wt, 'src/t1.js', `export const x = () => 2; // fix ${n}\n`);
  const done = await commitWorkCli(p, '--message', `fix: round ${n}`, '--require-green');
  assert.equal(done.code, 0, done.stderr);
  const again = await p.pr();
  assert.equal(again.code, 0, again.stderr);
  assert.equal(stateIn(p.wt).state, 'draft-pr');
}

export const at = (root, rel) => path.join(root, ...rel.split('/'));

// The pull request as the fixture host holds it.
export const prIn = (p) => JSON.parse(fs.readFileSync(path.join(p.host, 'pr-1.json'), 'utf8'));

export const bodyUpdates = (p) => prCalls(p.host).filter((c) => c.op === 'updatePullRequestBody');

// Task 4: `build finish`, and `build decline` end to end.

// The fixture host never moves headRefOid, so a test sets the live head it means by hand.
export function setLiveHead(p, sha) {
  const file = path.join(p.host, 'pr-1.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...raw, headRefOid: sha }, null, 2)}\n`);
}

export const RUN_URL = 'https://example.test/runs/1';

// S-16: with independent review required, finish stops at ci-green until an independent verdict.
export const WAITING = 'ready: waiting for an independent review; run /slicekit review 1 in a new session\n';

export function setCi(p, sha, status, conclusion = null) {
  write(p.host, `ci-${sha}.json`, JSON.stringify([{ status, conclusion, url: RUN_URL, createdAt: '2026-10-26T00:00:00Z' }]));
}

export const finishCli = (p, ...args) => cli(p.root, ['build', 'finish', 'P1/S-01', ...args], p.env);

// A slice in review with a clean round 1 on its head; the live head is the pushed verdict head.
export async function approved(findings = []) {
  const p = await drafted();
  const r = await p.verdict(review(p, 1, verdictText('APPROVE', findings)));
  assert.equal(r.code, 0, r.stderr);
  const head = git(p.wt, ['rev-parse', 'HEAD']);
  setLiveHead(p, head);
  return { ...p, head };
}
