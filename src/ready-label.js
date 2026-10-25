// The `ready` label decision (03 REQ-3.11, 02 REQ-2.8). Only verdicts that hold on the pull
// request's current head count (given on it, or on an earlier head followed only by bookkeeping
// commits, D-35): the latest of them must have no open blockers, and unless the config makes
// independent review optional, the latest independent one must have none either. The label is
// information; the merge button stays the human's.
import { independentProblem, verdictsOnHead } from './state/transitions.js';

export const READY_LABEL = 'ready';

// The states in which a pull request is open and under review.
const REVIEW_STATES = ['draft-pr', 'in-review', 'changes-requested', 'ci-green', 'ready'];

// `headSha` is the live head from the CI event; without it, the head the state recorded. `number`
// is the event's pull request, which must be the one the state recorded. `root` is the repository
// to look for bookkeeping-only commits in; without it only the exact head counts.
export function decideReady(state, cfg, opts = {}) {
  if (!REVIEW_STATES.includes(state.state)) return { ready: false, reason: `the slice is ${state.state}, not under review` };
  if ('number' in opts && state.pr?.number !== opts.number) {
    return { ready: false, reason: `the state records pull request #${state.pr?.number ?? 'none'}, not #${opts.number ?? 'none'}` };
  }
  const verdicts = verdictsOnHead(state, opts.headSha ?? state.pr?.headSha, opts.root);
  if (verdicts.length === 0) return { ready: false, reason: 'no review verdict on the current head' };
  const latest = verdicts[verdicts.length - 1];
  if (latest.blockers !== 0) {
    const n = latest.blockers;
    return { ready: false, reason: `the latest verdict on the current head has ${n} open blocker${n === 1 ? '' : 's'}` };
  }
  // A config without a review section is held to the default: independent review required.
  if (cfg.review?.independent !== 'optional') {
    const problem = independentProblem(verdicts);
    if (problem) return { ready: false, reason: problem };
  }
  return { ready: true, reason: 'the latest verdict on the current head has no open blockers' };
}
