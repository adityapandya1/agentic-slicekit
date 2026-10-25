// The `ready` label decision (03 REQ-3.11, 02 REQ-2.8). Only verdicts given on the pull request's
// current head count: the latest of them must have no open blockers, and when the config requires
// an independent review, one of them must be independent with no blockers. The label is
// information; the merge button stays the human's.
import { verdictsOnHead } from './state/transitions.js';

export const READY_LABEL = 'ready';

// `headSha` is the live head from the CI event; without it, the head the state recorded.
export function decideReady(state, cfg, { headSha } = {}) {
  const verdicts = verdictsOnHead(state, headSha ?? state.pr?.headSha);
  if (verdicts.length === 0) return { ready: false, reason: 'no review verdict on the current head' };
  const latest = verdicts[verdicts.length - 1];
  if (latest.blockers !== 0) {
    const n = latest.blockers;
    return { ready: false, reason: `the latest verdict on the current head has ${n} open blocker${n === 1 ? '' : 's'}` };
  }
  if (cfg.review?.independent === 'required' && !verdicts.some((v) => v.independent && v.blockers === 0)) {
    return { ready: false, reason: 'independent review missing' };
  }
  return { ready: true, reason: 'the latest verdict on the current head has no open blockers' };
}
