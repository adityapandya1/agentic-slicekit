// The shared setup of the test/commands/review-<n>.test.js files (P3/S-33, issue #55): the imports
// and every helper the old review.test.js defined at its top level, exported as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { getHost } from '../../src/adapters/githost/index.js';
import { GitHostError } from '../../src/adapters/githost/errors.js';
import { recordVerdict, reviewerBlocked } from '../../src/build/verdict.js';
import { getSection } from '../../src/prbody.js';
import { git } from '../../src/git.js';
import { cli, commitAll, commitIn, commitWorkCli, green as greenFlow, prCalls, project, reviewWorktree, stateIn, vpath, write } from '../helpers/build-flow.js';
import { briefProblems } from '../helpers/brief-lint.js';
import { TEMPLATES, renderProcedure } from '../../src/instructions.js';

export const REVIEWS = '.slicekit/reviews';

export const RUN_URL = 'https://example.test/runs/1';

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

export const prIn = (p) => JSON.parse(fs.readFileSync(path.join(p.host, 'pr-1.json'), 'utf8'));

export function setLiveHead(p, sha) {
  const file = path.join(p.host, 'pr-1.json');
  fs.writeFileSync(file, `${JSON.stringify({ ...prIn(p), headRefOid: sha }, null, 2)}\n`);
}

export const setCi = (p, sha) => write(p.host, `ci-${sha}.json`, JSON.stringify([{ status: 'completed', conclusion: 'success', url: RUN_URL, createdAt: '2026-10-26T00:00:00Z' }]));

// A slice at ci-green after two in-loop rounds (a blocker, a fix push, a clean round 2), its pull
// request marked ready.
export async function greenAfterTwoRounds() {
  const p = await green();
  const opened = await p.pr();
  assert.equal(opened.code, 0, opened.stderr);
  const verdict = (k, text) => {
    write(p.root, `${REVIEWS}/P1-S-01-r${k}.md`, text);
    return cli(p.root, ['build', 'verdict', 'P1/S-01', `${REVIEWS}/P1-S-01-r${k}.md`], p.env);
  };
  const one = await verdict(1, verdictText('BLOCK', [['B-1', 'x is wrong']]));
  assert.equal(one.code, 0, one.stderr);
  write(p.wt, 'src/t1.js', 'export const x = () => 2; // fix 1\n');
  const done = await commitWorkCli(p, '--message', 'fix: B-1', '--require-green');
  assert.equal(done.code, 0, done.stderr);
  const again = await p.pr();
  assert.equal(again.code, 0, again.stderr);
  const two = await verdict(2, verdictText('APPROVE'));
  assert.equal(two.code, 0, two.stderr);
  const head = git(p.wt, ['rev-parse', 'HEAD']);
  setLiveHead(p, head);
  setCi(p, head);
  const finished = await cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);
  assert.equal(finished.code, 0, finished.stderr);
  assert.equal(stateIn(p.wt).state, 'ci-green');
  assert.equal(prIn(p).isDraft, false);
  return p;
}

// Round `k` of the independent review, written into the session root by its absolute path.
export function independentFile(p, k, text) {
  const file = vpath(p.root, `P1-S-01i-r${k}.md`);
  write(p.root, `${REVIEWS}/P1-S-01i-r${k}.md`, text);
  return file;
}

export const independent = (p, file, wt) => cli(p.root, ['build', 'verdict', 'P1/S-01', file, '--independent', '--worktree', wt], p.env);

// ---- Task 2: review start, build sync, the behind-origin refusals ----

export const SLICE_BRANCH = 'slice/P1-S-01-thing-1';

export const REVIEW_BRANCH = 'slice/P1-S-01-review';

export const fwd = (p) => path.resolve(p).split(path.sep).join('/');

export const reviewDir = (p) => path.join(p.root, '.worktrees', 'review-P1-S-01');

// The fixture's head of pull request #1 is origin's tip, as the git host reports it.
export function liveHeadIsOrigin(p) {
  const file = path.join(p.host, 'pr-1.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...raw, headRefOid: git(p.remote, ['rev-parse', 'refs/heads/slice/P1-S-01-thing-1']) }, null, 2)}\n`);
}

export const reviewStart = (p, n = '1') => {
  liveHeadIsOrigin(p);
  return cli(p.root, ['review', 'start', n], p.env);
};

export const commits = (n) => `${n} commit${n === 1 ? '' : 's'}`;

export const originHeads = (p) => git(p.remote, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).split('\n');

export const originTip = (p) => git(p.remote, ['rev-parse', `refs/heads/${SLICE_BRANCH}`]);

// A commit of the worktree's own, never pushed.
export function localCommit(wt, text, message) {
  write(wt, 'src/t1.js', text);
  git(wt, ['add', '-A']);
  git(wt, ['commit', '-q', '-m', `${message}\n\nSlice: P1/S-01`]);
}

// ---- Task 2 fix round 1 ----

// A copy of pull request #1 in the fixture as #<n>, with `over` changed.
export function copyPr(p, n, over) {
  liveHeadIsOrigin(p);
  write(p.host, `pr-${n}.json`, JSON.stringify({ ...prIn(p), number: n, ...over }));
}

// A clone of the bare origin with an identity.
export function cloneOf(remote) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-clone-'));
  git(dir, ['clone', '-q', remote, '.']);
  git(dir, ['config', 'user.name', 'Other']);
  git(dir, ['config', 'user.email', 'other@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return { root: dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ---- Task 3: ready only after an independent verdict ----

export const WAITING = 'ready: waiting for an independent review; run /slicekit review 1 in a new session\n';

export const labelCalls = (p) => {
  const file = path.join(p.host, 'label-calls.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};

// The ready-label job, run in the slice worktree on an event for pull request #1 at its live head
// that already carries the label.
export function readyLabel(p) {
  const pr = prIn(p);
  const event = path.join(p.host, 'event.json');
  fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 1, title: pr.title, head: { sha: pr.headRefOid }, labels: [{ name: 'ready' }] } }));
  return cli(p.wt, ['ready-label'], { ...p.env, GITHUB_EVENT_PATH: event, SLICEKIT_CHECKS_OK: 'true', GH_TOKEN: 'x' });
}

// An independent round `k` from a fresh review worktree, then the build worktree synced and CI green
// on origin's new tip, which is the pull request's live head.
export async function independentRound(p, k, text) {
  const started = await reviewStart(p);
  assert.equal(started.code, 0, started.stderr);
  const r = await independent(p, independentFile(p, k, text), reviewDir(p));
  assert.equal(r.code, 0, r.stderr);
  const synced = await cli(p.root, ['build', 'sync', 'P1/S-01'], p.env);
  assert.equal(synced.code, 0, synced.stderr);
  liveHeadIsOrigin(p);
  setCi(p, originTip(p));
  return r;
}

// ---- Task 3 fix round 1: hand edits, the base branch's gate ----

export const stateFile = (p) => path.join(p.wt, '.slicekit', 'state', 'P1-S-01.json');

export function editState(p, fn) {
  const st = JSON.parse(fs.readFileSync(stateFile(p), 'utf8'));
  fs.writeFileSync(stateFile(p), `${JSON.stringify(fn(st), null, 2)}\n`);
}

export const markReadies = (p) => prCalls(p.host).filter((c) => c.op === 'markReady').length;

export const finishOf = (p) => cli(p.root, ['build', 'finish', 'P1/S-01'], p.env);

export function setReviewMode(file, mode) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...cfg, review: { ...cfg.review, independent: mode } }, null, 2)}\n`);
}
