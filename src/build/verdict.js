// `build verdict` (REQ-2.11, REQ-2.6 step 6): one review round of a slice's pull request. The
// reviewer writes its verdict into the session root; this checks it, moves it into the slice
// worktree at `.slicekit/reviews/<P-S>-r<k>.md`, commits it, records `in-review`, pushes, and says
// what comes next. Every refusal comes before anything moves. A run that stopped part way (moved but
// not committed, committed but not recorded, recorded but not pushed) finishes on a re-run with the
// same file name.
//
// Finding IDs name one finding for the whole slice: a finding that survives keeps its ID, a new one
// takes a number never used before in the slice (B and H counted apart). An ID absent from the
// previous verdict is new, so a finding that vanished and came back must take a new number.
import fs from 'node:fs';
import path from 'node:path';
import { git, headSha, pushBranch } from '../git.js';
import { verdictFileName, verdictFilePattern } from '../ids.js';
import { readSlice } from '../state/index.js';
import { headCovers } from '../state/covers.js';
import { parseVerdict, verdictProblems } from '../verdict.js';
import { posixRel } from './red.js';
import { commitBookkeeping, recordState } from './record.js';
import { BuildError, findWorktree, samePath } from './worktree.js';

// The states a verdict is recorded from: the `in-review` edges.
const FROM = ['draft-pr', 'changes-requested'];
export const LOOP_ROUNDS = 2;
const REVIEWS = '.slicekit/reviews';
const ID = /^([BH])-([1-9]\d*)$/;

function readText(file, shown) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new BuildError(`cannot read the verdict ${shown}: ${e.code ?? e.message}`);
  }
}

// Every finding ID of an earlier verdict, read from its file in the worktree, in round order.
function earlierIds(wt, verdicts) {
  return [...verdicts]
    .sort((a, b) => a.round - b.round)
    .map((v) => parseVerdict(readText(path.resolve(wt, v.path), v.path), v.path).findings.map((f) => f.id));
}

// One line per new ID that does not take a number above every number the slice has used.
function reusedNumbers(shown, ids, earlier) {
  const previous = new Set(earlier.at(-1) ?? []);
  const max = { B: 0, H: 0 };
  for (const id of earlier.flat()) {
    const m = ID.exec(id);
    if (m) max[m[1]] = Math.max(max[m[1]], Number(m[2]));
  }
  const out = [];
  for (const id of ids) {
    const m = ID.exec(id);
    if (!m || previous.has(id) || Number(m[2]) > max[m[1]]) continue;
    out.push(`verdict ${shown}: ${id} is new but reuses a number; new findings take the next unused number (${m[1]}-${max[m[1]] + 1})`);
  }
  return out;
}

// The parsed verdict, or a refusal naming each problem: the shape, then the file's own Independent
// line against the name it was given.
function checked(text, shown, name, independent) {
  const v = parseVerdict(text, shown);
  const problems = verdictProblems(v).map((p) => `verdict ${shown}: ${p}`);
  if (v.independent && !independent) problems.push(`verdict ${shown}: Independent does not match ${name}`);
  if (problems.length > 0) throw new BuildError(problems.join('\n'));
  return v;
}

// Moves `from` to `to`; a copy and a removal when a rename cannot cross the two.
function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(from, to);
    fs.rmSync(from);
  }
}

// HEAD is this round's verdict commit: the kit's subject, adding `rel` and nothing else.
function landedByKit(wt, id, k, rel) {
  return (
    git(wt, ['log', '-1', '--format=%s', 'HEAD']) === `chore(slicekit): ${id} verdict r${k}` &&
    git(wt, ['diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', 'HEAD']) === `A\t${rel}`
  );
}

const tracked = (wt, rel) => git(wt, ['--literal-pathspecs', 'ls-files', '--', rel]) !== '';

// The verdict's text: from the session root, or from the worktree where a run that stopped part way
// left it (moved and not committed, or committed by the kit and not recorded).
function verdictSource(wt, id, k, src, dest, rel, shown) {
  const here = !samePath(src, dest) && fs.existsSync(src);
  const there = fs.existsSync(dest);
  const moved = there && (!tracked(wt, rel) || landedByKit(wt, id, k, rel));
  if (there && !moved) throw new BuildError(`${rel} is already in the worktree and was not put there by build verdict ${id}`);
  if (here && moved && fs.readFileSync(src, 'utf8') !== fs.readFileSync(dest, 'utf8')) {
    throw new BuildError(`${rel} in the worktree differs from ${shown}; remove the one not to record and re-run`);
  }
  return { text: readText(moved ? dest : src, shown), here, moved };
}

function outcome(k, v, verdicts) {
  const blockers = v.findings.filter((f) => f.kind === 'blocker').map((f) => f.id);
  const shouldHaves = v.findings.filter((f) => f.kind === 'should-have').map((f) => f.id);
  const roundsUsed = verdicts.filter((x) => !x.independent).length;
  let next = 'ci';
  if (blockers.length > 0) next = roundsUsed < LOOP_ROUNDS ? 'fix' : 'stuck';
  else if (shouldHaves.length > 0) next = 'ask';
  return { round: k, blockers, shouldHaves, roundsUsed, next };
}

const push = (wt, cfg) => pushBranch(wt, { protectedBranches: cfg.protectedBranches, defaultBranch: cfg.defaultBranch });

// -> {round, blockers, shouldHaves, roundsUsed, next}: `blockers` and `shouldHaves` are finding IDs;
// `next` is `fix`, `ask`, `ci`, or `stuck` when blockers survive the last in-loop round.
export function recordVerdict(root, cfg, host, id, file, { worktree, independent = false } = {}) {
  const wt = findWorktree(root, id, { worktree }).path;
  const shown = typeof file === 'string' ? file.split(path.sep).join('/') : String(file);
  const name = path.basename(String(file));
  const m = verdictFilePattern(id, { independent }).exec(name);
  if (!m) throw new BuildError(`a verdict of ${id} is named ${verdictFileName(id, '<k>', { independent })}`, 2);
  const k = Number(m[2]);
  const src = path.resolve(root, String(file));
  const dest = path.join(wt, ...REVIEWS.split('/'), name);
  const rel = posixRel(wt, dest);

  const current = readSlice(wt, cfg, id);
  const verdicts = current.verdicts ?? [];

  // This round is the latest recorded: a run whose push failed. Push again; record nothing.
  const last = verdicts.at(-1);
  if (current.state === 'in-review' && last?.round === k && last.path === rel) {
    const text = readText(dest, rel);
    if (!samePath(src, dest) && fs.existsSync(src)) {
      if (fs.readFileSync(src, 'utf8') !== text) throw new BuildError(`round ${k} of ${id} is already recorded from ${rel}; ${shown} differs from it`);
      fs.rmSync(src);
    }
    const v = checked(text, rel, name, independent);
    push(wt, cfg);
    return outcome(k, v, verdicts);
  }

  if (!FROM.includes(current.state)) {
    throw new BuildError(`${id} is ${current.state}; build verdict runs from ${FROM.join(' or ')}`);
  }
  if (k !== verdicts.length + 1) throw new BuildError(`the next verdict of ${id} is round ${verdicts.length + 1}, not ${k}`);
  // The verdict is given on the recorded head; code committed since has not been through build pr.
  if (!headCovers(wt, current.pr?.headSha ?? '', headSha(wt))) {
    throw new BuildError(`${id} has commits since build pr; run slicekit build pr ${id} first`);
  }

  const { text, here, moved } = verdictSource(wt, id, k, src, dest, rel, shown);
  const v = checked(text, shown, name, independent);
  const reused = reusedNumbers(shown, v.findings.map((f) => f.id), earlierIds(wt, verdicts));
  if (reused.length > 0) throw new BuildError(reused.join('\n'));

  if (here && moved) fs.rmSync(src);
  else if (here) move(src, dest);
  commitBookkeeping(wt, id, `verdict r${k}`, [rel]);
  const blockers = v.findings.filter((f) => f.kind === 'blocker').length;
  const state = recordState(wt, cfg, id, 'in-review', { verdict: { round: k, path: rel, blockers, independent } });
  push(wt, cfg);
  return outcome(k, v, state.verdicts);
}
