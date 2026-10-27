// `build parallel P<n>` (REQ-2.6, D-38): every runnable slice of the phase's next Order step started
// side by side, each in its own worktree. Each start goes through startSlice, so each is claimed on
// origin exactly as `build start` claims it; one start that fails does not take back the others.
import { GitError } from '../git.js';
import { prepare, runnable, sliceSteps, waiting } from './order.js';
import { BuildError, startSlice } from './worktree.js';

// -> [{id, worktree, branch}] for each slice started and [{id, error}] for each that was not, in
// slice order. The step is the first Order step of `phase` holding a runnable slice; a phase with
// none is refused with the lines saying what each of its slices waits on.
export function startParallel(root, cfg, phase, { onWarning } = {}) {
  prepare(root, cfg);
  const steps = sliceSteps(root, cfg);
  if (![...steps.values()].some((s) => s.phase === phase)) throw new BuildError(`unknown phase ${phase}`, 2);
  const ready = runnable(root, cfg, { prepared: true }).filter((s) => s.phase === phase);
  if (ready.length === 0) {
    const lines = waiting(root, cfg).filter((l) => l.startsWith(`${phase}/`));
    throw new BuildError([`no slice of ${phase} is ready to build`, ...lines].join('\n'));
  }
  const first = Math.min(...ready.map((s) => steps.get(s.id).step));
  const out = [];
  for (const s of ready.filter((r) => steps.get(r.id).step === first)) {
    try {
      const { worktree, branch } = startSlice(root, cfg, s.id, onWarning ? { onWarning } : {});
      out.push({ id: s.id, worktree, branch });
    } catch (e) {
      if (!(e instanceof BuildError || e instanceof GitError)) throw e;
      out.push({ id: s.id, error: e.message });
    }
  }
  return out;
}
