// The `ready` label decision (03 REQ-3.11, 02 REQ-2.8). Only verdicts that hold on the pull
// request's current head count (given on it, or on an earlier head followed only by bookkeeping
// commits, D-35): the latest of them must have no open blockers, and unless the config makes
// independent review optional, the latest independent one must have none either. The label is
// information; the merge button stays the human's.
import path from 'node:path';
import { GitError, assertRef, git } from './git.js';
import { verdictFilePattern } from './ids.js';
import { independentProblem, verdictsOnHead } from './state/transitions.js';
import { parseVerdict } from './verdict.js';

export const READY_LABEL = 'ready';
// What the label looks like when the CLI has to create it (I2): GitHub green, and who set it.
export const READY_LABEL_COLOR = '0e8a16';
export const READY_LABEL_DESCRIPTION = 'slicekit: reviewed and green';

// The states in which a pull request is open and under review.
const REVIEW_STATES = ['draft-pr', 'in-review', 'changes-requested', 'ci-green', 'ready'];

// The config file as git names it, whatever the platform's separator.
const CONFIG_GIT_PATH = '.slicekit/config.json';

// `review.independent` as `branch` holds it on origin, after a fetch: a pull request cannot switch
// off its own independent-review gate by editing the config on its branch or in a working tree.
// Anything that cannot be read (no origin, no such branch, no config, bad JSON) is `required`.
export function baseReviewMode(root, branch) {
  try {
    assertRef(branch);
  } catch {
    return 'required';
  }
  try {
    git(root, ['fetch', '-q', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    // Offline, or a CI checkout without credentials: judge on the last fetch.
  }
  try {
    const cfg = JSON.parse(git(root, ['show', `refs/remotes/origin/${branch}:${CONFIG_GIT_PATH}`]));
    return cfg?.review?.independent === 'optional' ? 'optional' : 'required';
  } catch {
    return 'required';
  }
}

// `cfg` with `review.independent` taken from `branch` on origin (baseReviewMode).
export const withBaseReviewMode = (root, cfg, branch) => ({ ...cfg, review: { ...(cfg.review ?? {}), independent: baseReviewMode(root, branch) } });

// What a recorded verdict says against the file the commit that added it holds: the blocker count,
// the independent flag against the file's `i-r<k>` name and its own Independent line, and the round.
// A hand edit of the state file is caught here. -> null, or the reason.
export function verdictMismatch(root, id, v) {
  const bad = (what) => `state does not match ${v.path}: ${what}`;
  let text;
  try {
    const sha = git(root, ['--literal-pathspecs', 'log', '-1', '--format=%H', '--diff-filter=A', '--', v.path]);
    if (sha === '') return bad('the file is not committed');
    text = git(root, ['show', `${sha}:${v.path}`]);
  } catch (e) {
    if (e instanceof GitError) return bad('the file cannot be read');
    throw e;
  }
  const file = parseVerdict(text, v.path);
  const blockers = file.findings.filter((f) => f.kind === 'blocker').length;
  if (blockers !== v.blockers) return bad(`the state records ${v.blockers} blockers, the file holds ${blockers}`);
  const name = verdictFilePattern(id).exec(path.posix.basename(String(v.path)));
  if (!name) return bad(`it is not a verdict file name of ${id}`);
  const named = name[1] === 'i';
  if (Boolean(v.independent) !== named) return bad(`the state records it as ${v.independent ? '' : 'not '}independent`);
  if (file.independent && !v.independent) return bad('the file says Independent: yes');
  if (Number(name[2]) !== v.round) return bad(`the state records round ${v.round}`);
  return null;
}

// `headSha` is the live head from the CI event; without it, the head the state recorded. `number`
// is the event's pull request, which must be the one the state recorded. `root` is the repository
// to look for bookkeeping-only commits in, and to check the latest verdict and the latest
// independent verdict against their committed files; without it only the exact head counts and
// nothing is checked. `cfg.review.independent` is taken as given: callers pass the default
// branch's (withBaseReviewMode).
export function decideReady(state, cfg, opts = {}) {
  if (!REVIEW_STATES.includes(state.state)) return { ready: false, reason: `the slice is ${state.state}, not under review` };
  if ('number' in opts && state.pr?.number !== opts.number) {
    return { ready: false, reason: `the state records pull request #${state.pr?.number ?? 'none'}, not #${opts.number ?? 'none'}` };
  }
  const verdicts = verdictsOnHead(state, opts.headSha ?? state.pr?.headSha, opts.root);
  if (verdicts.length === 0) return { ready: false, reason: 'no review verdict on the current head' };
  const latest = verdicts[verdicts.length - 1];
  if (opts.root !== undefined) {
    if (typeof state.slice !== 'string') return { ready: false, reason: 'the state names no slice' };
    const ind = verdicts.filter((v) => v.independent).at(-1);
    for (const v of ind && ind !== latest ? [latest, ind] : [latest]) {
      const problem = verdictMismatch(opts.root, state.slice, v);
      if (problem) return { ready: false, reason: problem };
    }
  }
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
