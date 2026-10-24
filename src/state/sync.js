import { GitHostNotFound } from '../adapters/githost/errors.js';
import { listSlices, setState } from './index.js';

// Moves every `ready` slice whose pull request the host reports merged to `merged`, and nothing
// else. Returns { changes: [{ id, from, to, pr }], warnings: [string] }.
//
// A pull request the host cannot find is warned and skipped. Any other error stops the sync; it
// carries what was already written as `error.partial = { changes, warnings }`, so a caller can
// report every change that reached disk before the failure.
export function syncFromHost(root, cfg, host) {
  const changes = [];
  const warnings = [];
  try {
    for (const { state } of listSlices(root, cfg)) {
      if (state.state !== 'ready') continue;
      const number = state.pr?.number;
      if (!Number.isInteger(number) || number < 1) {
        warnings.push(`${state.slice} is ready but has no valid pull request number recorded; skipped`);
        continue;
      }
      let pr;
      try {
        pr = host.getPullRequest(number);
      } catch (e) {
        if (!(e instanceof GitHostNotFound)) throw e;
        warnings.push(`${state.slice}: pull request ${number} could not be fetched: ${e.message}; skipped`);
        continue;
      }
      if (!pr.mergedAt) continue;
      const evidence = { number: pr.number };
      if (pr.url) evidence.url = pr.url;
      if (pr.headSha) evidence.headSha = pr.headSha;
      setState(root, cfg, state.slice, 'merged', { mergedAt: pr.mergedAt, pr: evidence });
      changes.push({ id: state.slice, from: 'ready', to: 'merged', pr: number });
    }
  } catch (e) {
    if (e && typeof e === 'object') e.partial = { changes, warnings };
    throw e;
  }
  return { changes, warnings };
}
