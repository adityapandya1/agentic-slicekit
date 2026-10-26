// `build verdict` (REQ-2.11, REQ-2.6 step 6): one review round of a slice's pull request. The
// reviewer writes its verdict into the session root; this checks it, moves it into the slice
// worktree at `.slicekit/reviews/<P-S>-r<k>.md`, commits it, records `in-review`, pushes, and says
// what comes next. Every refusal comes before anything moves. A run that stopped part way (moved but
// not committed, committed but not recorded, recorded but not pushed) finishes on a re-run with the
// same file name.
//
// Two in-loop rounds (D-18): a third is refused before anything moves, and a blocker left at round 2
// records `changes-requested` and stops the loop with the pull request still a draft. After every
// verdict the body's "Reviewer blocked" names each blocker and whether it was fixed.
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
import { bannedPhrasesIn } from '../check/rules/style.js';
import { PrBodyError, getSection, prBodyProblems, setSection } from '../prbody.js';
import { parseVerdict, verdictProblems } from '../verdict.js';
import { posixRel } from './red.js';
import { commitBookkeeping, recordState } from './record.js';
import { BuildError, findWorktree, samePath } from './worktree.js';

// The states a verdict is recorded from: the `in-review` edges.
const FROM = ['draft-pr', 'changes-requested'];
export const LOOP_ROUNDS = 2;
const REVIEWS = '.slicekit/reviews';
const BLOCKED = 'Reviewer blocked';
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

const inLoop = (verdicts) => verdicts.filter((x) => !x.independent).length;

// An independent verdict sits outside the in-loop cap (D-18): its blockers ask for a fix, never `stuck`.
function outcome(k, v, verdicts, independent) {
  const blockers = v.findings.filter((f) => f.kind === 'blocker').map((f) => f.id);
  const shouldHaves = v.findings.filter((f) => f.kind === 'should-have').map((f) => f.id);
  const roundsUsed = inLoop(verdicts);
  let next = 'ci';
  if (blockers.length > 0) next = independent || roundsUsed < LOOP_ROUNDS ? 'fix' : 'stuck';
  else if (shouldHaves.length > 0) next = 'ask';
  return { round: k, blockers, shouldHaves, roundsUsed, next };
}

const push = (wt, cfg) => pushBranch(wt, { protectedBranches: cfg.protectedBranches, defaultBranch: cfg.defaultBranch });

const blockersOf = (v) => (v?.findings ?? []).filter((f) => f.kind === 'blocker');

// The longest "what is wrong" the line quotes, in characters, the closing `…` included.
const WHAT_MAX = 160;

// A finding's "what is wrong" as a code span: its backticks removed, cut to WHAT_MAX characters.
function quoted(wrong) {
  const chars = Array.from(String(wrong).replace(/`/g, '').trim());
  const cut = chars.length > WHAT_MAX ? `${chars.slice(0, WHAT_MAX - 1).join('')}…` : chars.join('');
  return `\`${cut}\``;
}

// The pull request body's "Reviewer blocked" (REQ-2.10) over the slice's verdicts in round order,
// each `{round, findings}` with findings as parseVerdict reads them. A blocker of an earlier round
// that the latest does not hold is fixed in the round after its last appearance. Each blocker of the
// latest is open after the round it was first seen in, or, when the loop stopped (`stuck`), not
// fixed after the latest round. `nothing` when there are none. Round numbers are shared with
// independent rounds, so each names the real round.
export function reviewerBlocked(verdicts, { stuck = false } = {}) {
  const sorted = [...verdicts].sort((a, b) => a.round - b.round);
  const latest = sorted.at(-1);
  const open = new Set(blockersOf(latest).map((f) => f.id));
  const seen = new Map();
  for (const v of sorted) for (const f of blockersOf(v)) if (!seen.has(f.id)) seen.set(f.id, v.round);
  // In order of first appearance, with the text of the last.
  const fixed = new Map();
  sorted.slice(0, -1).forEach((v, i) => {
    for (const f of blockersOf(v)) {
      if (!open.has(f.id)) fixed.set(f.id, `${f.id} ${quoted(f.wrong)} — fixed in round ${sorted[i + 1].round}`);
    }
  });
  const out = [...fixed.values()];
  for (const f of blockersOf(latest)) {
    out.push(`${f.id} ${quoted(f.wrong)} — ${stuck ? `not fixed after round ${latest.round}` : `open after round ${seen.get(f.id)}`}`);
  }
  return out.length > 0 ? out.join('; ') : 'nothing';
}

// The recorded verdicts as reviewerBlocked takes them, read from their files in the worktree.
const parsedVerdicts = (wt, verdicts) =>
  verdicts.map((x) => ({ round: x.round, findings: parseVerdict(readText(path.resolve(wt, x.path), x.path), x.path).findings }));

const BREAKS = 'the section would break the body: ';

// The pull request body with "Reviewer blocked" set to `text` -> {next, problems}: `next` is null
// when the line is already `text`; `problems` are what the new body would add, judged under `cfg`.
function withBlocked(host, number, text, cfg) {
  const pr = host.getPullRequest(number);
  const body = pr.body ?? '';
  if (getSection(body, BLOCKED) === text) return { next: null, problems: [] };
  let next;
  try {
    next = setSection(body, BLOCKED, text);
  } catch (e) {
    if (!(e instanceof PrBodyError)) throw e;
    const problems = e.message.startsWith(BREAKS) ? e.message.slice(BREAKS.length).split('; ') : [e.message];
    return { next: null, problems };
  }
  const before = new Set(prBodyProblems(pr.title ?? '', body, cfg));
  return { next, problems: prBodyProblems(pr.title ?? '', next, cfg).filter((p) => !before.has(p)) };
}

// Sets the pull request's "Reviewer blocked" from the recorded verdict files, writing the body only
// when the line changes.
function updateBlocked(wt, cfg, host, number, verdicts, stuck) {
  const { next, problems } = withBlocked(host, number, reviewerBlocked(parsedVerdicts(wt, verdicts), { stuck }), cfg);
  if (problems.length > 0) throw new BuildError(`cannot set "${BLOCKED}" on pull request #${number}: ${problems.join('; ')}`);
  if (next !== null) host.updatePullRequestBody(number, next);
}

// Each banned phrase (style.banned) in the verdict: by finding where a finding's text holds it, then
// any left in the rest of the file. The style rule checks the committed file, and the body quotes
// each "what is wrong".
function bannedProblems(cfg, v, text, shown) {
  const banned = cfg.style?.banned ?? [];
  const out = [];
  const named = new Set();
  for (const f of v.findings) {
    for (const p of bannedPhrasesIn([f.wrong, f.why, f.verified].join('\n\n'), banned)) {
      out.push(`verdict ${shown}: ${f.id} uses "${p}"; reword it`);
      named.add(p.toLowerCase());
    }
  }
  for (const p of bannedPhrasesIn(text, banned)) if (!named.has(p.toLowerCase())) out.push(`verdict ${shown}: uses "${p}"; reword it`);
  return out;
}

// After a round is recorded: a stopped loop records changes-requested (once), then the branch is
// pushed and the body's "Reviewer blocked" brought up to date.
function finish(wt, cfg, host, id, current, result, verdicts) {
  const stuck = result.next === 'stuck';
  if (stuck && current.state === 'in-review') recordState(wt, cfg, id, 'changes-requested', {});
  push(wt, cfg);
  updateBlocked(wt, cfg, host, current.pr.number, verdicts, stuck);
  return result;
}

// The verdict is given on the recorded head; code committed since has not been through build pr.
function assertBuilt(wt, id, current) {
  if (!headCovers(wt, current.pr?.headSha ?? '', headSha(wt))) {
    throw new BuildError(`${id} has commits since build pr; run slicekit build pr ${id} first`);
  }
}

// -> {round, blockers, shouldHaves, roundsUsed, next}: `blockers` and `shouldHaves` are finding IDs;
// `next` is `fix`, `ask`, `ci`, or `stuck` when an in-loop verdict leaves blockers at the last round.
// `stuck` is returned, not thrown: the loop has stopped and changes-requested is recorded, and a
// caller must exit 1 on it (the CLI does).
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

  // This round is the latest recorded: a run that stopped after recording it (before changes-requested,
  // the push or the body). Finish what is left; record the round nothing more. The push carries only
  // what build pr has seen.
  const last = verdicts.at(-1);
  if (['in-review', 'changes-requested'].includes(current.state) && last?.round === k && last.path === rel) {
    assertBuilt(wt, id, current);
    const text = readText(dest, rel);
    if (!samePath(src, dest) && fs.existsSync(src)) {
      if (fs.readFileSync(src, 'utf8') !== text) throw new BuildError(`round ${k} of ${id} is already recorded from ${rel}; ${shown} differs from it`);
      fs.rmSync(src);
    }
    const v = checked(text, rel, name, independent);
    return finish(wt, cfg, host, id, current, outcome(k, v, verdicts, independent), verdicts);
  }

  // D-18: two in-loop rounds; independent verdicts (D-39) do not count against them.
  if (!independent && inLoop(verdicts) >= LOOP_ROUNDS) throw new BuildError('two review rounds used; the loop stopped (D-18)');

  if (!FROM.includes(current.state)) {
    throw new BuildError(`${id} is ${current.state}; build verdict runs from ${FROM.join(' or ')}`);
  }
  if (k !== verdicts.length + 1) throw new BuildError(`the next verdict of ${id} is round ${verdicts.length + 1}, not ${k}`);
  assertBuilt(wt, id, current);

  const { text, here, moved } = verdictSource(wt, id, k, src, dest, rel, shown);
  const v = checked(text, shown, name, independent);
  const reused = reusedNumbers(shown, v.findings.map((f) => f.id), earlierIds(wt, verdicts));
  if (reused.length > 0) throw new BuildError(reused.join('\n'));
  const banned = bannedProblems(cfg, v, text, shown);
  if (banned.length > 0) throw new BuildError(banned.join('\n'));
  // The line this round would write, judged against the live body before anything moves.
  const stuck = outcome(k, v, [...verdicts, { independent }], independent).next === 'stuck';
  const line = reviewerBlocked([...parsedVerdicts(wt, verdicts), { round: k, findings: v.findings }], { stuck });
  const { problems } = withBlocked(host, current.pr.number, line, cfg);
  if (problems.length > 0) {
    throw new BuildError(problems.map((p) => `verdict ${shown}: the Reviewer blocked line would break the pull request body: ${p}`).join('\n'));
  }

  if (here && moved) fs.rmSync(src);
  else if (here) move(src, dest);
  commitBookkeeping(wt, id, `verdict r${k}`, [rel]);
  const blockers = v.findings.filter((f) => f.kind === 'blocker').length;
  const state = recordState(wt, cfg, id, 'in-review', { verdict: { round: k, path: rel, blockers, independent } });
  return finish(wt, cfg, host, id, state, outcome(k, v, state.verdicts, independent), state.verdicts);
}
