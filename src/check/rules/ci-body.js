// ci-body (02 REQ-2.10, 03 REQ-3.11, REQ-3.7): with --ci, the pull request's body carries the
// REQ-2.10 sections, each once, in order, none empty, under a `## [P<n>/S-<nn>] <name>` heading
// that names the title's slice. What the body must hold lives in src/prbody.js, so `slicekit pr
// open` refuses the same bodies before it pushes. A pull request opened by an actor in
// ci.botActors is exempt (D-37). Without --ci, or with no pull request, nothing.
import { PR_FILE, isBotAuthor, readCiEvent } from '../ci-event.js';
import { REQUIRED_SECTIONS, prBodyProblems } from '../../prbody.js';

export { REQUIRED_SECTIONS };

export const id = 'ci-body';
export const blocking = true;
export const ratchet = false;

export function run(ctx) {
  if (!ctx.ci) return [];
  const pr = readCiEvent(ctx.env);
  if (!pr || isBotAuthor(ctx.cfg, pr)) return [];
  return prBodyProblems(pr.title, pr.body, ctx.cfg).map((message) => ({ file: PR_FILE, line: 0, message }));
}

export default { id, blocking, ratchet, run };
