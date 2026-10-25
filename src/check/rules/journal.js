// journal (03 REQ-3.7, REQ-3.8, D-34, D-36): every file under .slicekit/journal/ must verify as an unbroken
// hash chain from genesis (one finding per broken file, at its first broken line); nothing else may sit
// in that directory but `*.log` files and their `*.lock`; and every journal file committed at the merge
// base with the default branch must still be there and only have grown. Silent when there is no journal
// and, for the git part, outside a repository; without a base, silent locally and one finding under
// --ci. Never repairs.
import { appendOnlyProblems, verifyJournal } from '../../journal.js';

export const id = 'journal';
export const blocking = true;
export const ratchet = false;

export function run(ctx) {
  return [...verifyJournal(ctx.root, ctx.cfg).problems, ...appendOnlyProblems(ctx.root, ctx.cfg, { ci: Boolean(ctx.ci) })];
}

export default { id, blocking, ratchet, run };
