// `build finish` (REQ-2.6 step 9, REQ-1.8): a slice whose latest verdict on its head is clean waits
// for CI on the head the git host holds; on success its pull request's "Proof" takes the run link,
// the pull request is marked ready and `ci-green` is recorded on that head. The live head may be a
// later one that adds only the kit's bookkeeping (D-35): the verdict and in-review commits `build
// verdict` pushed. A head with any other change is a fix push `build pr` has not recorded, and is
// refused before anything changes. After `ci-green` it records `ready` when the ready label's own
// decision passes: the function the CI job calls, so the two cannot disagree.
import { headSha, pushBranch, resolveCommit } from '../git.js';
import { sleep as sleepMs } from '../lock.js';
import { PrBodyError, getSection, prBodyProblems, setSection } from '../prbody.js';
import { readSlice } from '../state/index.js';
import { headCovers } from '../state/covers.js';
import { verdictsOnHead } from '../state/transitions.js';
import { decideReady } from '../ready-label.js';
import { recordState } from './record.js';
import { assertNotBehind } from './sync.js';
import { committedVerdict } from './verdict.js';
import { BuildError, findWorktree } from './worktree.js';

const PROOF = 'Proof';
const short = (sha) => sha.slice(0, 7);
const push = (wt, cfg) => pushBranch(wt, { protectedBranches: cfg.protectedBranches, defaultBranch: cfg.defaultBranch });

// "Proof" with its CI part naming the run: `CI: pending` (what `build pr` writes) replaced, else the
// CI part it already holds (a re-run, a hand edit), else one added. The run is taken literally: the
// replacement is a function, so a `$&` in it is never expanded.
export function proofWithCi(proof, run) {
  const text = (proof ?? '').trim();
  const part = () => `CI: ${run}`;
  if (/CI: pending/.test(text)) return text.replace(/CI: pending/, part);
  if (/CI: \S+/.test(text)) return text.replace(/CI: \S+/, part);
  return text === '' ? part() : `${text} · ${part()}`;
}

// Writes "Proof" with the run, judged under `cfg` first: only problems the new text adds refuse it.
function setProof(cfg, host, number, ci) {
  const pr = host.getPullRequest(number);
  const body = pr.body ?? '';
  const run = ci.url ?? `passed on ${short(ci.sha)}`;
  const text = proofWithCi(getSection(body, PROOF), run);
  if (getSection(body, PROOF) === text) return;
  let next;
  try {
    next = setSection(body, PROOF, text);
  } catch (e) {
    if (e instanceof PrBodyError) throw new BuildError(`cannot set "${PROOF}" on pull request #${number}: ${e.message}`);
    throw e;
  }
  const before = new Set(prBodyProblems(pr.title ?? '', body, cfg));
  const added = prBodyProblems(pr.title ?? '', next, cfg).filter((p) => !before.has(p));
  if (added.length > 0) throw new BuildError(`cannot set "${PROOF}" on pull request #${number}: ${added.join('; ')}`);
  host.updatePullRequestBody(number, next);
}

// ciStatus(sha) until it is success or failure, or `wait` seconds are spent, sleeping `interval`
// seconds (the last nap cut to what is left) between asks.
function pollCi(host, sha, { wait, interval, sleep }) {
  let waited = 0;
  for (;;) {
    const status = host.ciStatus(sha);
    if (status.status === 'success' || status.status === 'failure' || waited >= wait) return status;
    const nap = Math.min(interval, wait - waited);
    sleep(nap);
    waited += nap;
  }
}

function assertTimes(wait, interval) {
  if (!(Number.isFinite(wait) && wait >= 0)) throw new BuildError('--wait must be a number of seconds, 0 or more', 2);
  if (!(Number.isFinite(interval) && interval > 0)) throw new BuildError('the poll interval must be a number of seconds above 0', 2);
}

// Seconds one `build finish` waits for CI by default: a Claude Code Bash call stops at 120 s, so the
// procedure runs it again on "CI still running" rather than waiting longer in one call.
export const FINISH_WAIT = 90;

// -> {ci: {status, sha, url}, ready, reason, number}. Every refusal is a BuildError; CI that
// failed, is still running or never ran is code 1 and records nothing.
export function finish(root, cfg, host, id, { worktree, wait = FINISH_WAIT, interval = 15, sleep = (s) => sleepMs(s * 1000) } = {}) {
  assertTimes(wait, interval);
  const held = findWorktree(root, id, { worktree });
  const wt = held.path;
  const current = readSlice(wt, cfg, id);
  const number = current.pr?.number;
  // Behind origin first, before the head guards below: commits another worktree pushed are synced.
  assertNotBehind(wt, held.branch, id);

  // A slice at ci-green skips the CI wait and goes to the ready decision, citing the run recorded
  // with ci-green; one at ready finishes a run that stopped before the pull request or the push. It
  // pushes only bookkeeping on top of the reviewed, green head.
  if ((current.state === 'ci-green' || current.state === 'ready') && current.ci?.sha && Number.isInteger(number)) {
    const local = headSha(wt);
    if (!headCovers(wt, current.pr.headSha, local) || !headCovers(wt, current.ci.sha, local)) {
      throw new BuildError(`${id} has commits since build pr; run slicekit build pr ${id} first`);
    }
    const ci = { status: 'success', sha: current.ci.sha, url: current.ci.url ?? null };
    setProof(cfg, host, number, ci);
    return { ci, ...readyStep(wt, cfg, host, id, current, ci.sha) };
  }
  if (current.state !== 'in-review') throw new BuildError(`${id} is ${current.state}; build finish runs from in-review`);
  if (!Number.isInteger(number)) throw new BuildError(`${id} has no recorded pull request`);
  const recorded = current.pr.headSha;

  const latest = verdictsOnHead(current, recorded, wt).at(-1);
  if (!latest) throw new BuildError(`${id} has no verdict on its head; finish needs a clean verdict`);
  // The committed verdict decides, not the count the state file holds: either can be edited by hand.
  const found = committedVerdict(wt, latest.path).findings.filter((f) => f.kind === 'blocker').length;
  if (found !== latest.blockers) {
    throw new BuildError(`the state says round ${latest.round} has ${latest.blockers} blockers but ${latest.path} holds ${found}`);
  }
  if (latest.blockers !== 0) throw new BuildError(`${id} has open blockers; finish needs a clean verdict`);

  const pr = host.getPullRequest(number);
  const live = pr.headSha;
  if (typeof live !== 'string' || live === '') throw new BuildError(`pull request #${number} reports no head sha`);
  const pull = `${id}'s pull request head ${short(live)} is not in the worktree; pull first`;
  if (resolveCommit(wt, live) === null) throw new BuildError(pull);
  if (!headCovers(wt, recorded, live)) throw new BuildError(`a fix push is not recorded; run slicekit build pr ${id}`);
  const local = headSha(wt);
  if (!headCovers(wt, recorded, local)) throw new BuildError(`${id} has commits since build pr; run slicekit build pr ${id} first`);
  if (!headCovers(wt, live, local)) throw new BuildError(pull);

  const status = pollCi(host, live, { wait, interval, sleep });
  if (status.status === 'failure') throw new BuildError(`CI failed on ${short(live)}${status.url ? `: ${status.url}` : ''}`);
  if (status.status === 'unknown') throw new BuildError(`no CI run found for ${short(live)}; check that the workflow ran`);
  if (status.status !== 'success') throw new BuildError(`CI still running on ${short(live)}; run slicekit build finish ${id} again`);

  const ci = { status: 'success', sha: live, url: status.url ?? null };
  setProof(cfg, host, number, ci);
  const green = recordState(wt, cfg, id, 'ci-green', { ci: { status: 'success', sha: live, ...(ci.url ? { url: ci.url } : {}) } });
  return { ci, ...readyStep(wt, cfg, host, id, green, live) };
}

// The step after ci-green, `head` being the green CI sha: `ready` is recorded when the ready label's
// decision passes. The pull request is marked ready only here, on green CI, so a failed or running CI
// leaves a draft, as in-review says. It is marked when the decision passes, or when no independent
// verdict is on the head yet so the independent reviewer is asked to review a ready pull request.
// After a clean independent verdict sent the slice back to in-review and the pull request to draft
// (D-39), it is ready again only once CI is green and the decision passes. Then the bookkeeping is
// pushed. -> {ready, reason, number}.
function readyStep(wt, cfg, host, id, state, head) {
  const number = state.pr.number;
  let current = state;
  const decision =
    current.state === 'ready' ? { ready: true, reason: 'ready is recorded' } : decideReady(current, cfg, { headSha: head, number, root: wt });
  if (decision.ready && current.state !== 'ready') current = recordState(wt, cfg, id, 'ready', {});
  const awaited = !verdictsOnHead(current, head, wt).some((v) => v.independent);
  if ((decision.ready || awaited) && host.getPullRequest(number).draft !== false) host.markReady(number);
  push(wt, cfg);
  return { ready: decision.ready, reason: decision.reason, number };
}
