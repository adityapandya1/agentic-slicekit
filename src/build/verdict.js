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
import { sliceFromBranch, verdictFileName, verdictFilePattern } from '../ids.js';
import { readSlice } from '../state/index.js';
import { headCovers } from '../state/covers.js';
import { INDEPENDENT_ONLY } from '../state/transitions.js';
import { bannedPhrasesIn } from '../check/rules/style.js';
import { buildContext } from '../check/context.js';
import references from '../check/rules/references.js';
import { loadConfig } from '../config.js';
import { lines as splitLines } from '../markdown.js';
import { PrBodyError, getSection, prBodyProblems, setSection } from '../prbody.js';
import { parseVerdict, verdictProblems } from '../verdict.js';
import { posixRel } from './red.js';
import { commitBookkeeping, recordState } from './record.js';
import { assertNotBehind } from './sync.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { isReviewWorktreeAt, listWorktrees } from '../worktrees.js';
import { BuildError, findWorktree, samePath } from './worktree.js';

// The states a verdict is recorded from: the `in-review` edges. An independent verdict (D-39) is
// also recorded from in-review, ci-green and ready, and sends a green slice back to review.
const FROM = ['draft-pr', 'changes-requested'];
const fromStates = (independent) => (independent ? [...FROM, ...INDEPENDENT_ONLY] : FROM);
const orList = (xs) => (xs.length < 3 ? xs.join(' or ') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);
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

// A recorded verdict's text as the commit that added it holds it: a hand edit of the working copy
// after recording changes nothing the kit judges.
export function committedVerdictText(wt, rel) {
  const sha = git(wt, ['--literal-pathspecs', 'log', '-1', '--format=%H', '--diff-filter=A', '--', rel]);
  if (sha === '') throw new BuildError(`the recorded verdict ${rel} is not committed`);
  return git(wt, ['show', `${sha}:${rel}`]);
}

// A recorded verdict, parsed from its commit.
export const committedVerdict = (wt, rel) => parseVerdict(committedVerdictText(wt, rel), rel);

// Every finding ID of an earlier verdict, read from its commit, in round order.
function earlierIds(wt, verdicts) {
  return [...verdicts]
    .sort((a, b) => a.round - b.round)
    .map((v) => committedVerdict(wt, v.path).findings.map((f) => f.id));
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

// A verdict file's absolute path in the session root, with forward slashes: the reviewer works in
// the worktree, so a relative path would land there.
const inSessionRoot = (root, name) => path.resolve(root, ...REVIEWS.split('/'), name).split(path.sep).join('/');

// The absolute session-root path the next in-loop reviewer writes, `<root>/.slicekit/reviews/<P-S>-r<k>.md`
// with k the slice's verdict count plus one; null once the in-loop rounds are used (D-18). `build pr`
// and `build verdict` print it so the procedure never computes k.
export function nextVerdictPath(root, id, verdicts = []) {
  // Once an independent review has given a verdict, the next review is a new session's `review start`.
  if (inLoop(verdicts) >= LOOP_ROUNDS || verdicts.some((v) => v.independent)) return null;
  return inSessionRoot(root, verdictFileName(id, verdicts.length + 1));
}

// The absolute session-root path an independent reviewer writes, `<root>/.slicekit/reviews/<P-S>i-r<k>.md`
// with k the slice's verdict count plus one: `review start` prints it.
export const independentVerdictPath = (root, id, verdicts = []) => inSessionRoot(root, verdictFileName(id, verdicts.length + 1, { independent: true }));

// The latest recorded verdict's session-root path, or null: `build verdict` with it re-prints that
// round's next step and records nothing again (a session resumed at in-review).
export function latestVerdictPath(root, verdicts = []) {
  const last = verdicts.at(-1);
  return last ? inSessionRoot(root, path.posix.basename(last.path)) : null;
}

// The next verdict path after a round: only when the round asks for a fix or a should-have decision
// and another in-loop round is allowed; `stuck` and `ci` name none. After an independent verdict
// there is no in-loop path: the next independent round's path comes from `review start`.
const withNextPath = (root, id, result, verdicts, independent) => ({
  ...result,
  verdictPath: !independent && (result.next === 'fix' || result.next === 'ask') ? nextVerdictPath(root, id, verdicts) : null,
});

// An independent verdict sits outside the in-loop cap (D-18): its blockers ask for a fix, never
// `stuck`, and without blockers it goes to CI; its should-haves are the review procedure's to list.
function outcome(k, v, verdicts, independent) {
  const blockers = v.findings.filter((f) => f.kind === 'blocker').map((f) => f.id);
  const shouldHaves = v.findings.filter((f) => f.kind === 'should-have').map((f) => f.id);
  const roundsUsed = inLoop(verdicts);
  let next = 'ci';
  if (blockers.length > 0) next = independent || roundsUsed < LOOP_ROUNDS ? 'fix' : 'stuck';
  else if (shouldHaves.length > 0 && !independent) next = 'ask';
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
// each `{round, findings, headSha?, independent?}` with findings as parseVerdict reads them. A
// blocker of an earlier round that the latest does not hold is fixed in the round after its last
// appearance when code changed between the two verdicts' heads; when only bookkeeping lies between
// them (`covers(from, to)`, by default the same sha), the next verdict just did not raise it. Each
// blocker of the latest is open after the round it was first seen in, or, when the loop stopped
// (`stuck`), not fixed after the latest round. `nothing` when there are none. Round numbers are
// shared with independent rounds, so each names the real round.
export function reviewerBlocked(verdicts, { stuck = false, covers = sameHead } = {}) {
  const sorted = [...verdicts].sort((a, b) => a.round - b.round);
  const latest = sorted.at(-1);
  const open = new Set(blockersOf(latest).map((f) => f.id));
  const seen = new Map();
  for (const v of sorted) for (const f of blockersOf(v)) if (!seen.has(f.id)) seen.set(f.id, v.round);
  // In order of first appearance, with the text of the last.
  const fixed = new Map();
  sorted.slice(0, -1).forEach((v, i) => {
    for (const f of blockersOf(v)) {
      if (open.has(f.id)) continue;
      const after = sorted[i + 1];
      const unchanged = typeof v.headSha === 'string' && typeof after.headSha === 'string' && covers(v.headSha, after.headSha);
      const how = !unchanged ? 'fixed in' : after.independent ? 'not raised by the independent review in' : 'not raised in';
      fixed.set(f.id, `${f.id} ${quoted(f.wrong)} — ${how} round ${after.round}`);
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
  verdicts.map((x) => ({ round: x.round, findings: committedVerdict(wt, x.path).findings, headSha: x.headSha, independent: Boolean(x.independent) }));

const sameHead = (a, b) => a === b;
// Whether only the kit's bookkeeping lies between two verdicts' heads in the worktree.
const coversIn = (wt) => (a, b) => headCovers(wt, a, b);

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
  const { next, problems } = withBlocked(host, number, reviewerBlocked(parsedVerdicts(wt, verdicts), { stuck, covers: coversIn(wt) }), cfg);
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

// The round is committed and recorded when this runs; a host failure says so, and a re-run of the
// same command resumes and finishes it.
function markDraft(host, number, round) {
  try {
    if (host.getPullRequest(number).draft === false) host.markDraft(number);
  } catch (e) {
    if (!(e instanceof GitHostError)) throw e;
    throw new BuildError(`could not mark pull request #${number} draft: ${e.message}; round ${round} is recorded locally; run the same command again to finish`);
  }
}

// After a round is recorded: a stopped loop records changes-requested (once); an independent verdict
// with blockers that sent a green slice back to review (D-39) marks a ready pull request draft again,
// so the host agrees with the state, and a clean one leaves it as it is, so GitHub does not notify
// its reviewers a second time; then the branch is pushed and the body's "Reviewer blocked" brought up to date.
function finish(wt, cfg, host, id, current, result, verdicts, independent) {
  const stuck = result.next === 'stuck';
  if (stuck && current.state === 'in-review') recordState(wt, cfg, id, 'changes-requested', {});
  if (independent && current.state === 'in-review' && result.blockers.length > 0) markDraft(host, current.pr.number, result.round);
  push(wt, cfg);
  updateBlocked(wt, cfg, host, current.pr.number, verdicts, stuck);
  return result;
}

// The path of the slice's review worktree, or null when review start has not made one.
function reviewWorktreeOf(root, id) {
  const w = listWorktrees(root).find((x) => x.branch !== null && sliceFromBranch(x.branch) === id && isReviewWorktreeAt(x.path, id));
  return w ? w.path : null;
}

// The verdict is given on the recorded head; code committed since has not been through build pr.
// One line per finding the `references` rule would make on the verdict once it sits at `rel` in the
// worktree: an unknown slice, requirement or decision ID, or a backticked path the worktree does not
// hold. Judged before the file moves, so `slicekit check` never fails on a recorded verdict (D-43).
function referenceProblems(wt, rel, text, shown) {
  const ctx = buildContext(wt, loadConfig(wt));
  const doc = { path: path.join(wt, ...rel.split('/')), rel, text, lines: splitLines(text) };
  return references.run({ ...ctx, docs: [doc] }).map((f) => `verdict ${shown} line ${f.line}: ${f.message}`);
}

function assertBuilt(wt, id, current) {
  if (!headCovers(wt, current.pr?.headSha ?? '', headSha(wt))) {
    throw new BuildError(`${id} has commits since build pr; run slicekit build pr ${id} first`);
  }
}

// -> {round, blockers, shouldHaves, roundsUsed, next, verdictPath}: `blockers` and `shouldHaves` are
// finding IDs; `next` is `fix`, `ask`, `ci`, or `stuck` when an in-loop verdict leaves blockers at the last round.
// `stuck` is returned, not thrown: the loop has stopped and changes-requested is recorded, and a
// caller must exit 1 on it (the CLI does). `verdictPath` is the next round's file (nextVerdictPath)
// on `fix` or `ask` of an in-loop verdict, else null.
//
// `independent` (D-39): the verdict of an independent review, named `<P-S>i-r<k>.md`, recorded from
// the review worktree `review start` makes, from draft-pr, changes-requested, in-review, ci-green or
// ready, outside the two in-loop rounds.
export function recordVerdict(root, cfg, host, id, file, { worktree, independent = false } = {}) {
  // Without --worktree an independent verdict goes to the review worktree when there is one; with
  // none, the build worktree is found and refused below.
  const review = independent && worktree === undefined ? reviewWorktreeOf(root, id) : null;
  const held = findWorktree(root, id, { worktree: review ?? worktree });
  const wt = held.path;
  const shown = typeof file === 'string' ? file.split(path.sep).join('/') : String(file);
  const name = path.basename(String(file));
  const m = verdictFilePattern(id, { independent }).exec(name);
  if (!m) {
    // The name and the flag disagree: an `i` name without --independent, or --independent without one.
    const crossed = verdictFilePattern(id, { independent: !independent }).test(name);
    const want = crossed ? `an independent verdict is named ${verdictFileName(id, '<k>', { independent: true })}` : `a verdict of ${id} is named ${verdictFileName(id, '<k>', { independent })}`;
    throw new BuildError(want, 2);
  }
  const k = Number(m[2]);
  const src = path.resolve(root, String(file));
  const dest = path.join(wt, ...REVIEWS.split('/'), name);
  const rel = posixRel(wt, dest);

  const current = readSlice(wt, cfg, id);
  const verdicts = current.verdicts ?? [];

  // The building session never approves itself through its own worktree: an independent verdict is
  // recorded only in the review worktree `review start` makes, decided by its path and its branch
  // together, and never in the worktree `build start` made. That the session is fresh is the
  // person's to keep (D-18).
  if (independent && !isReviewWorktreeAt(held.path, id)) {
    throw new BuildError(`an independent verdict is recorded from the review worktree; run slicekit review start ${current.pr?.number ?? '<PR>'} in a new session`);
  }
  // This round is the latest recorded: a run that stopped after recording it (before changes-requested,
  // the push or the body). Finish what is left; record the round nothing more. The push carries only
  // what build pr has seen.
  const last = verdicts.at(-1);
  const resuming = ['in-review', 'changes-requested'].includes(current.state) && last?.round === k && last.path === rel;

  // Every path below pushes: a worktree behind its branch on origin takes the other worktree's
  // commits first (build sync), before anything moves. Only a round already recorded is finished on
  // the last fetch when origin cannot be reached; a new round needs a fresh one, so a stale worktree
  // never records on a head origin has moved past.
  assertNotBehind(wt, held.branch, id, {
    onFetchFail: resuming ? 'last-fetch' : `could not reach origin to check ${held.branch}; a new verdict needs a fresh fetch`,
  });

  if (resuming) {
    assertBuilt(wt, id, current);
    // The round as committed: a hand edit of the working copy since does not change what it says.
    const text = committedVerdictText(wt, rel);
    if (!samePath(src, dest) && fs.existsSync(src)) {
      if (fs.readFileSync(src, 'utf8').trim() !== text.trim()) throw new BuildError(`round ${k} of ${id} is already recorded from ${rel}; ${shown} differs from it`);
      fs.rmSync(src);
    }
    const v = checked(text, rel, name, independent);
    return withNextPath(root, id, finish(wt, cfg, host, id, current, outcome(k, v, verdicts, independent), verdicts, independent), verdicts, independent);
  }

  // D-18: two in-loop rounds; independent verdicts (D-39) do not count against them.
  if (!independent && inLoop(verdicts) >= LOOP_ROUNDS) throw new BuildError('two review rounds used; the loop stopped (D-18)');

  const from = fromStates(independent);
  if (!from.includes(current.state)) {
    throw new BuildError(`${id} is ${current.state}; build verdict runs from ${orList(from)}`);
  }
  if (k !== verdicts.length + 1) throw new BuildError(`the next verdict of ${id} is round ${verdicts.length + 1}, not ${k}`);
  assertBuilt(wt, id, current);

  const { text, here, moved } = verdictSource(wt, id, k, src, dest, rel, shown);
  const v = checked(text, shown, name, independent);
  const reused = reusedNumbers(shown, v.findings.map((f) => f.id), earlierIds(wt, verdicts));
  if (reused.length > 0) throw new BuildError(reused.join('\n'));
  const banned = bannedProblems(cfg, v, text, shown);
  if (banned.length > 0) throw new BuildError(banned.join('\n'));
  const unknown = referenceProblems(wt, rel, text, shown);
  if (unknown.length > 0) throw new BuildError(unknown.join('\n'));
  // The line this round would write, judged against the live body before anything moves.
  const stuck = outcome(k, v, [...verdicts, { independent }], independent).next === 'stuck';
  const line = reviewerBlocked([...parsedVerdicts(wt, verdicts), { round: k, findings: v.findings, headSha: current.pr.headSha, independent }], {
    stuck,
    covers: coversIn(wt),
  });
  const { problems } = withBlocked(host, current.pr.number, line, cfg);
  if (problems.length > 0) {
    throw new BuildError(problems.map((p) => `verdict ${shown}: the Reviewer blocked line would break the pull request body: ${p}`).join('\n'));
  }

  if (here && moved) fs.rmSync(src);
  else if (here) move(src, dest);
  commitBookkeeping(wt, id, `verdict r${k}`, [rel]);
  const blockers = v.findings.filter((f) => f.kind === 'blocker').length;
  const state = recordState(wt, cfg, id, 'in-review', { verdict: { round: k, path: rel, blockers, independent } });
  return withNextPath(root, id, finish(wt, cfg, host, id, state, outcome(k, v, state.verdicts, independent), state.verdicts, independent), state.verdicts, independent);
}
