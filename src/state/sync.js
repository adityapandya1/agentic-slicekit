import { GitHostNotFound } from '../adapters/githost/errors.js';
import { listSlices, setState } from './index.js';
import { isDate } from '../evidence.js';
import { HOST_MERGE_FROM } from './transitions.js';

// Before a pull request exists in the state machine: a merged pull request recorded here means the
// record is wrong, and a human should look rather than the sync guess.
const BEFORE_DRAFT = ['todo', 'tests-red', 'building'];

// Moves every slice in a pre-merge state (draft-pr through ready) whose pull request the host
// reports merged to `merged`, recording the real previous state and `by: 'sync'`. A slice before
// draft-pr with a merged pull request is warned, not moved. Returns
// { changes: [{ id, from, to, pr }], warnings: [string] }.
//
// A pull request the host cannot find, an answer about another pull request, and a merge time that
// is not a date are each warned and skipped. Any other error stops the sync; it
// carries what was already written as `error.partial = { changes, warnings }`, so a caller can
// report every change that reached disk before the failure.
export function syncFromHost(root, cfg, host) {
  const changes = [];
  const warnings = [];
  try {
    for (const { state } of listSlices(root, cfg)) {
      const from = state.state;
      const syncable = HOST_MERGE_FROM.includes(from);
      if (!syncable && !BEFORE_DRAFT.includes(from)) continue;
      const number = state.pr?.number;
      if (!Number.isInteger(number) || number < 1) {
        if (syncable) warnings.push(`${state.slice} is ${from} but has no valid pull request number recorded; skipped`);
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
      if (pr.number !== number) {
        warnings.push(`${state.slice}: the host answered pull request ${number} with pull request ${pr.number}; skipped`);
        continue;
      }
      if (!pr.mergedAt) continue;
      if (!isDate(pr.mergedAt)) {
        warnings.push(`${state.slice}: pull request ${number} has a merge time that is not a date ('${pr.mergedAt}'); skipped`);
        continue;
      }
      if (!syncable) {
        warnings.push(`${state.slice} is ${from} but pull request ${number} is merged; its record needs a human; skipped`);
        continue;
      }
      const evidence = { number };
      if (pr.url) evidence.url = pr.url;
      if (pr.headSha) evidence.headSha = pr.headSha;
      setState(root, cfg, state.slice, 'merged', { mergedAt: pr.mergedAt, pr: evidence, source: 'host' });
      changes.push({ id: state.slice, from, to: 'merged', pr: number });
    }
  } catch (e) {
    if (e && typeof e === 'object') e.partial = { changes, warnings };
    throw e;
  }
  return { changes, warnings };
}
