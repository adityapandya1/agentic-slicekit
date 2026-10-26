// `build verdict` (REQ-2.11, REQ-2.6 step 6): one review round of a slice's pull request. The
// reviewer writes its verdict into the session root; this checks it, moves it into the slice
// worktree at `.slicekit/reviews/<P-S>-r<k>.md`, commits it, records `in-review`, pushes, and says
// what comes next. Every refusal comes before anything moves.
//
// Finding IDs name one finding for the whole slice: a finding that survives keeps its ID, a new one
// takes a number never used before in the slice (B and H counted apart). An ID absent from the
// previous verdict is new, so a finding that vanished and came back must take a new number.
import fs from 'node:fs';
import path from 'node:path';
import { pushBranch } from '../git.js';
import { stateFileName } from '../ids.js';
import { readSlice } from '../state/index.js';
import { parseVerdict, verdictProblems } from '../verdict.js';
import { posixRel } from './red.js';
import { commitBookkeeping, recordState } from './record.js';
import { BuildError, findWorktree } from './worktree.js';

// The states a verdict is recorded from: the `in-review` edges.
const FROM = ['draft-pr', 'changes-requested'];
export const LOOP_ROUNDS = 2;
const REVIEWS = '.slicekit/reviews';
const ID = /^([BH])-([1-9]\d*)$/;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The verdict's file stem for the slice: `P<n>-S-<nn>`, with `i` for an independent review.
const stem = (id, independent) => `${stateFileName(id).replace(/\.json$/, '')}${independent ? 'i' : ''}`;

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

// -> {round, blockers, shouldHaves, roundsUsed, next}: `blockers` and `shouldHaves` are finding IDs;
// `next` is `fix`, `ask`, `ci`, or `stuck` when blockers survive the last in-loop round.
export function recordVerdict(root, cfg, host, id, file, { worktree, independent = false } = {}) {
  const wt = findWorktree(root, id, { worktree }).path;
  const shown = typeof file === 'string' ? file.split(path.sep).join('/') : String(file);
  const name = path.basename(String(file));
  const s = stem(id, independent);
  const m = new RegExp(`^${escape(s)}-r([1-9]\\d*)\\.md$`).exec(name);
  if (!m) throw new BuildError(`a verdict of ${id} is named ${s}-r<k>.md`, 2);
  const k = Number(m[1]);

  const current = readSlice(wt, cfg, id);
  if (!FROM.includes(current.state)) {
    throw new BuildError(`${id} is ${current.state}; build verdict runs from ${FROM.join(' or ')}`);
  }
  const verdicts = current.verdicts ?? [];
  if (k !== verdicts.length + 1) throw new BuildError(`the next verdict of ${id} is round ${verdicts.length + 1}, not ${k}`);

  const src = path.resolve(root, String(file));
  const v = parseVerdict(readText(src, shown), shown);
  const problems = verdictProblems(v).map((p) => `verdict ${shown}: ${p}`);
  if (problems.length > 0) throw new BuildError(problems.join('\n'));
  const ids = v.findings.map((f) => f.id);
  const reused = reusedNumbers(shown, ids, earlierIds(wt, verdicts));
  if (reused.length > 0) throw new BuildError(reused.join('\n'));

  const dest = path.join(wt, ...REVIEWS.split('/'), name);
  const rel = posixRel(wt, dest);
  if (fs.existsSync(dest)) throw new BuildError(`${rel} already exists in the worktree; remove it or name the next round`);
  move(src, dest);
  commitBookkeeping(wt, id, `verdict r${k}`, [rel]);

  const blockers = v.findings.filter((f) => f.kind === 'blocker').map((f) => f.id);
  const shouldHaves = v.findings.filter((f) => f.kind === 'should-have').map((f) => f.id);
  const state = recordState(wt, cfg, id, 'in-review', {
    verdict: { round: k, path: rel, blockers: blockers.length, independent },
  });
  pushBranch(wt, { protectedBranches: cfg.protectedBranches, defaultBranch: cfg.defaultBranch });

  const roundsUsed = state.verdicts.filter((x) => !x.independent).length;
  let next = 'ci';
  if (blockers.length > 0) next = roundsUsed < LOOP_ROUNDS ? 'fix' : 'stuck';
  else if (shouldHaves.length > 0) next = 'ask';
  return { round: k, blockers, shouldHaves, roundsUsed, next };
}
