import { listSlices, setState } from './index.js';

// Moves every `ready` slice whose pull request the host reports merged to `merged`, and nothing
// else. Returns { changes: [{ id, from, to, pr }], warnings: [string] }.
export function syncFromHost(root, cfg, host) {
  const changes = [];
  const warnings = [];
  for (const { state } of listSlices(root, cfg)) {
    if (state.state !== 'ready') continue;
    const number = state.pr?.number;
    if (!Number.isInteger(number) || number < 1) {
      warnings.push(`${state.slice} is ready but has no pull request number recorded; skipped`);
      continue;
    }
    const pr = host.getPullRequest(number);
    if (!pr.mergedAt) continue;
    const evidence = { number: pr.number };
    if (pr.url) evidence.url = pr.url;
    if (pr.headSha) evidence.headSha = pr.headSha;
    setState(root, cfg, state.slice, 'merged', { mergedAt: pr.mergedAt, pr: evidence });
    changes.push({ id: state.slice, from: 'ready', to: 'merged', pr: number });
  }
  return { changes, warnings };
}
