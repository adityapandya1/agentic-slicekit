// journal (03 REQ-3.7, REQ-3.8, D-34, D-36, D-71, D-89): every file under .slicekit/journal/ must verify as an unbroken
// hash chain from genesis (one finding per broken file, at its first broken line); nothing else may sit
// in that directory but `*.log` files and their `*.lock`; and every journal file committed at the merge
// base with the default branch must still be there and only have grown. Silent when there is no journal
// and, for the git part, outside a repository; without a base, silent locally and one finding under
// --ci. Never repairs.
//
// Under --ci only, on the branch the run judges (branchTip: the pull request's head, or the branch of a
// dispatched run) against its merge base with the default branch:
// - each commit that changes a file under .slicekit/journal/ must be signed and verified by the git
//   host (C-1 getCommit); one finding per commit that is not, naming it (D-71). The journal-heads file
//   sits outside that directory, so the sync job's unsigned commits are not asked about;
// - when .slicekit/journal-heads.log changed, the branch must be a sync branch (`sync/<short sha>`),
//   the file at the base must be a byte prefix of the file at the tip, and each line it gains must equal
//   the line headsLines computes for that line's merge commit from git and C-1 getRun (D-89). A line
//   that differs is a finding at its line number.
// Outside CI no signature or run is read.
import path from 'node:path';
import { getHost } from '../../adapters/githost/index.js';
import { GitHostError } from '../../adapters/githost/errors.js';
import { GitError } from '../../git.js';
import { appendOnlyProblems, headsAt, headsLines, journalCommits, mergeBaseWith, parseHeadsLine, SIGNED_MESSAGE, verifyJournal } from '../../journal.js';
import { kitPaths } from '../../paths.js';
import { SYNC_BRANCH, branchTip } from '../ci-event.js';

export const id = 'journal';
export const blocking = true;
export const ratchet = false;

const short = (sha) => sha.slice(0, 7);
const toPosix = (p) => p.split(path.sep).join('/');

export function run(ctx) {
  const found = [...verifyJournal(ctx.root, ctx.cfg).problems, ...appendOnlyProblems(ctx.root, ctx.cfg, { ci: Boolean(ctx.ci) })];
  if (!ctx.ci) return found;
  return [...found, ...ciProblems(ctx)];
}

function ciProblems(ctx) {
  const { root, cfg } = ctx;
  const at = branchTip(ctx);
  if (at === null) return [];
  const mb = mergeBaseWith(root, cfg, { tip: at.tip });
  if (mb === null) return []; // appendOnlyProblems already reports the missing base under --ci
  let host;
  const theHost = () => (host ??= getHost(cfg, ctx.env ?? process.env, root));
  return [...signedProblems(ctx, theHost, mb.base, at.tip), ...headsProblems(ctx, theHost, mb, at)];
}

function signedProblems(ctx, theHost, base, tip) {
  const relDir = toPosix(path.relative(ctx.root, kitPaths(ctx.root, ctx.cfg).journalDir));
  const out = [];
  for (const sha of journalCommits(ctx.root, ctx.cfg, base, tip)) {
    let got;
    try {
      got = theHost().getCommit(sha);
    } catch (e) {
      if (!(e instanceof GitHostError)) throw e;
      out.push({ file: relDir, line: 0, message: `commit ${short(sha)} changes a journal file and the host could not say whether it is signed (${e.message}); ${SIGNED_MESSAGE}` });
      continue;
    }
    if (!got.verified) out.push({ file: relDir, line: 0, message: `commit ${short(sha)} changes a journal file and its signature is not verified by the host; ${SIGNED_MESSAGE}` });
  }
  return out;
}

function headsProblems(ctx, theHost, mb, at) {
  const { root, cfg } = ctx;
  const { rel, was, now } = headsAt(root, cfg, mb.base, at.tip);
  if (was.equals(now)) return [];
  const at0 = (message) => [{ file: rel, line: 0, message }];
  if (!SYNC_BRANCH.test(at.branch)) return at0(`${rel} changed on ${at.branch}; only a sync pull request (a sync/<short sha> branch) may change it`);
  if (now.length < was.length || !now.subarray(0, was.length).equals(was)) return at0(`${rel} is not append-only against ${mb.ref}`);
  const before = was.toString('utf8');
  const first = (before.match(/\n/g)?.length ?? 0) + (before !== '' && !before.endsWith('\n') ? 1 : 0) + 1;
  const added = now.subarray(was.length).toString('utf8');
  const parts = added.split('\n');
  const torn = parts.at(-1) !== '';
  const lines = torn ? parts : parts.slice(0, -1);
  const out = [];
  const expected = new Map();
  const used = new Map();
  lines.forEach((text, i) => {
    const n = first + i;
    const differs = (want) => out.push({ file: rel, line: n, message: `${rel} line ${n} differs from the line CI computes: ${want}` });
    const p = parseHeadsLine(text);
    if (p === null || (torn && i === lines.length - 1)) return differs('a line that does not parse');
    const key = `${p.merge} ${p.run}`;
    if (!expected.has(key)) expected.set(key, recompute(root, cfg, theHost, p));
    const want = expected.get(key);
    if (typeof want === 'string') return differs(want);
    const j = used.get(key) ?? 0;
    used.set(key, j + 1);
    if (want[j] !== text) differs(want[j] ?? `no line (the merge ${short(p.merge)} changed ${want.length} journal file${want.length === 1 ? '' : 's'})`);
  });
  for (const [key, want] of expected) {
    if (typeof want === 'string') continue;
    const j = used.get(key) ?? 0;
    for (const missing of want.slice(j)) out.push({ file: rel, line: 0, message: `${rel} lacks the line CI computes: ${missing}` });
  }
  return out;
}

// The lines headsLines computes for p's merge commit and run, or a string saying why there are none.
function recompute(root, cfg, theHost, p) {
  let r;
  try {
    r = theHost().getRun(p.run);
  } catch (e) {
    if (!(e instanceof GitHostError) && !/run id must be/.test(String(e?.message))) throw e;
    return `none (run ${p.run} could not be read: ${e.message})`;
  }
  if (r.headSha !== p.merge) return `none (run ${p.run} ran on ${short(String(r.headSha))}, not ${short(p.merge)})`;
  try {
    return headsLines(root, cfg, p.merge, { run: p.run, workflow: r.workflow, actor: r.actor });
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    return `none (merge ${short(p.merge)} is not a commit of this clone)`;
  }
}

export default { id, blocking, ratchet, run };
