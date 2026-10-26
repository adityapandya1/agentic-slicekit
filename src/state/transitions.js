import fs from 'node:fs';
import path from 'node:path';
import { isDate, isSha, sameSha } from '../evidence.js';
import { headCovers } from './covers.js';

export const STATES = [
  'todo',
  'tests-red',
  'building',
  'draft-pr',
  'in-review',
  'changes-requested',
  'ci-green',
  'ready',
  'merged',
  'released',
];

export class TransitionError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'TransitionError';
    this.reason = reason;
  }
}

const last = (list) => list[list.length - 1];
const isInt = (n) => Number.isInteger(n) && n >= 0;
const isStr = (s) => typeof s === 'string' && s !== '';
const present = (root, rel) => fs.existsSync(path.resolve(root, rel));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The verdicts that hold on the pull request head as it stands now: those given on it, and, with a
// repository to look in, those given on an earlier head whose later commits are only the kit's own
// bookkeeping (D-35). Any other earlier head reviewed code a fix push has since replaced. `head`
// defaults to the head the state recorded; a caller holding the live head (a CI event) passes it.
// No head, no verdicts.
export function verdictsOnHead(current, head = current.pr?.headSha, root) {
  return (current.verdicts ?? []).filter(
    (v) => sameSha(v.headSha, head) || (root !== undefined && headCovers(root, v.headSha, head)),
  );
}
const onHead = (current, ctx) => verdictsOnHead(current, current.pr?.headSha, ctx.root);

// The independent-review rule `ready` and the ready label share: the latest independent verdict on
// the head decides, so a later independent verdict with blockers is not hidden by an earlier clean one.
export function independentProblem(verdicts) {
  const ind = verdicts.filter((v) => v.independent).at(-1);
  if (!ind) return 'independent review missing';
  if (ind.blockers !== 0) return `independent review found ${ind.blockers} blocker${ind.blockers === 1 ? '' : 's'}`;
  return null;
}

const SHA_SHAPE = '7 to 40 lowercase hex characters';

// Every evidence value that is given must have the right type, whatever the target state.
export function validateEvidence(ev) {
  const bad = (name, want) => `${name} must be ${want}`;
  for (const k of ['commit', 'release']) {
    if (ev[k] !== undefined && !isStr(ev[k])) return bad(k, 'a non-empty string');
  }
  if (ev.commit !== undefined && !isSha(ev.commit)) return bad('commit', SHA_SHAPE);
  if (ev.mergedAt !== undefined && !isDate(ev.mergedAt)) return bad('mergedAt', 'an ISO date');
  if (ev.source !== undefined && ev.source !== 'host') return bad('source', "'host'");
  for (const k of ['testExit', 'checkExit']) {
    if (ev[k] !== undefined && !isInt(ev[k])) return bad(k, 'a non-negative integer');
  }
  if (ev.tests !== undefined && !(Array.isArray(ev.tests) && ev.tests.every(isStr))) {
    return bad('tests', 'an array of non-empty strings');
  }
  const pr = ev.pr;
  if (pr !== undefined) {
    if (pr === null || typeof pr !== 'object') return bad('pr', 'an object');
    if (pr.number !== undefined && !(Number.isInteger(pr.number) && pr.number >= 1)) {
      return bad('pr.number', 'a positive integer');
    }
    for (const k of ['url', 'headSha', 'title']) {
      if (pr[k] !== undefined && !isStr(pr[k])) return bad(`pr.${k}`, 'a non-empty string');
    }
    if (pr.headSha !== undefined && !isSha(pr.headSha)) return bad('pr.headSha', SHA_SHAPE);
  }
  const v = ev.verdict;
  if (v !== undefined) {
    if (v === null || typeof v !== 'object') return bad('verdict', 'an object');
    for (const k of ['round', 'blockers']) {
      if (v[k] !== undefined && !isInt(v[k])) return bad(`verdict.${k}`, 'a non-negative integer');
    }
    if (v.path !== undefined && !isStr(v.path)) return bad('verdict.path', 'a non-empty string');
  }
  const ci = ev.ci;
  if (ci !== undefined) {
    if (ci === null || typeof ci !== 'object') return bad('ci', 'an object');
    for (const k of ['sha', 'status']) {
      if (ci[k] !== undefined && !isStr(ci[k])) return bad(`ci.${k}`, 'a non-empty string');
    }
    if (ci.sha !== undefined && !isSha(ci.sha)) return bad('ci.sha', SHA_SHAPE);
  }
  return null;
}

// `from` is the one place the graph is written; `required` names the evidence keys the target
// stores, which --backfill still demands. "Frozen tests unchanged since the red commit" is not
// checked here: the pre-edit hook (S-06) and `slicekit check` enforce it.
export const TRANSITIONS = {
  'tests-red': {
    from: ['todo'],
    required: ['commit', 'tests'],
    check(_current, ev) {
      if (!ev.commit) return 'tests-red needs the commit sha of the failing run (--commit)';
      if (ev.testExit === undefined || ev.testExit === 0) {
        return 'tests-red needs a non-zero test exit code (--test-exit); the tests must fail first';
      }
      if (!Array.isArray(ev.tests) || ev.tests.length === 0) {
        return 'tests-red needs the test file paths (--tests a,b)';
      }
      return null;
    },
    apply: (_current, ev) => ({ redCommit: ev.commit, frozenTests: [...ev.tests] }),
  },
  building: {
    from: ['tests-red'],
    required: [],
    check(current, _ev, ctx) {
      if (!current.redCommit) return 'building needs a recorded red commit';
      const missing = current.frozenTests.filter((t) => !present(ctx.root, t));
      return missing.length > 0 ? `frozen tests are missing: ${missing.join(', ')}` : null;
    },
    apply: () => ({}),
  },
  'draft-pr': {
    from: ['building', 'in-review', 'changes-requested', 'ci-green', 'ready'],
    required: ['pr'],
    check(current, ev, ctx) {
      if (ev.testExit !== 0) return 'draft-pr needs the test command to exit 0 (--test-exit 0)';
      if (ev.checkExit !== 0) return 'draft-pr needs slicekit check to exit 0 (--check-exit 0)';
      const prefix = `[${ctx.id}]`;
      const pr = ev.pr;
      const titled = pr && typeof pr.title === 'string' && (pr.title === prefix || pr.title.startsWith(`${prefix} `));
      if (!titled) return `draft-pr needs a pull request whose title begins ${prefix} followed by a space`;
      if (!isInt(pr.number)) return 'draft-pr needs the pull request number (pr.number)';
      if (!isStr(pr.headSha)) return 'draft-pr needs the pull request head sha (pr.headSha)';
      if (current.state !== 'building' && current.pr && sameSha(pr.headSha, current.pr.headSha)) {
        return 'a return to draft-pr needs a new head sha (a fix push)';
      }
      return null;
    },
    apply: (_current, ev) => ({
      pr: { number: ev.pr.number, url: ev.pr.url, headSha: ev.pr.headSha },
      ci: null,
    }),
  },
  'in-review': {
    from: ['draft-pr', 'changes-requested'],
    required: ['verdict'],
    check(current, ev, ctx) {
      const v = ev.verdict;
      if (!v || !isInt(v.round) || v.round < 1) return 'in-review needs a verdict with round 1 or more';
      if (!isInt(v.blockers)) return 'in-review needs the verdict blocker count';
      if (!isStr(v.path)) return 'in-review needs the verdict file path (verdict.path)';
      if (!present(ctx.root, v.path)) return `verdict file not found: ${v.path}`;
      if (!current.pr?.headSha) return 'in-review needs a recorded pull request head sha';
      const prev = last(current.verdicts);
      if (!prev && v.round !== 1) return `the first verdict must be round 1, got round ${v.round}`;
      if (prev && v.round <= prev.round) return `verdict round ${v.round} is not after round ${prev.round}`;
      return null;
    },
    // Each verdict is stamped with the head it was given on; `ready` trusts only those on the current head.
    apply: (current, ev) => ({
      verdicts: [
        ...current.verdicts,
        {
          round: ev.verdict.round,
          path: ev.verdict.path,
          blockers: ev.verdict.blockers,
          independent: Boolean(ev.verdict.independent),
          headSha: current.pr.headSha,
        },
      ],
    }),
  },
  'changes-requested': {
    from: ['in-review'],
    required: [],
    check(current, _ev, ctx) {
      const v = last(onHead(current, ctx));
      return v && v.blockers > 0 ? null : 'changes-requested needs a latest verdict on the current head sha with open blockers';
    },
    apply: () => ({}),
  },
  'ci-green': {
    from: ['in-review'],
    required: ['ci'],
    check(current, ev, ctx) {
      const v = last(onHead(current, ctx));
      if (!v || v.blockers !== 0) return 'ci-green needs a latest verdict on the current head sha with no blockers';
      if (!ev.ci || ev.ci.status !== 'success') return 'ci-green needs the CI status to be success (--ci-status)';
      if (!isStr(ev.ci.sha)) return 'ci-green needs the CI sha (--ci-sha)';
      // D-35: CI on a later head that adds only the kit's bookkeeping ran on the reviewed work.
      const head = current.pr?.headSha;
      if (!head || !(sameSha(ev.ci.sha, head) || headCovers(ctx.root, head, ev.ci.sha))) {
        return 'ci-green needs the CI sha to be the pull request head sha or a later head that only adds bookkeeping';
      }
      return null;
    },
    apply: (_current, ev) => ({ ci: { sha: ev.ci.sha, status: ev.ci.status } }),
  },
  ready: {
    from: ['ci-green'],
    required: [],
    check(current, _ev, ctx) {
      if (ctx.cfg.review?.independent === 'optional') return null;
      const problem = independentProblem(onHead(current, ctx));
      return problem ? `ready needs an independent review verdict with no blockers on the current head sha: ${problem}` : null;
    },
    apply: () => ({}),
  },
  // A merge the git host reports is a fact, whatever pre-merge state the slice was in: `hostFrom`
  // reaches merged only with `source: 'host'` evidence naming the recorded pull request (the sync
  // supplies it; the state CLI cannot). The `ready` path is the ordinary one.
  merged: {
    from: ['ready'],
    hostFrom: ['draft-pr', 'in-review', 'changes-requested', 'ci-green'],
    required: ['mergedAt'],
    check(current, ev) {
      if (!ev.mergedAt) return 'merged needs mergedAt (--merged-at)';
      if (current.state === 'ready') return null;
      if (ev.source !== 'host') return `${current.state} reaches merged only on a merge the git host reports`;
      const n = current.pr?.number;
      if (!Number.isInteger(n)) return 'a host merge needs a recorded pull request number';
      if (ev.pr?.number !== n) return `a host merge must name the recorded pull request #${n}`;
      return null;
    },
    apply: (current, ev) => ({
      mergedAt: ev.mergedAt,
      ...(ev.pr ? { pr: { ...(current.pr ?? {}), ...ev.pr } } : {}),
    }),
  },
  released: {
    from: ['merged'],
    required: ['release'],
    check(current, ev, ctx) {
      if (!ev.release) return 'released needs the release file path (--release)';
      if (!present(ctx.root, ev.release)) return `release file not found: ${ev.release}`;
      const pr = current.pr;
      if (!pr) return 'released needs a recorded pull request to look for in the release record';
      const text = fs.readFileSync(path.resolve(ctx.root, ev.release), 'utf8');
      // `#7` is not `#70`, and the url of pull request 7 is not the url of pull request 70.
      const byNumber = pr.number !== undefined && new RegExp(`#${pr.number}(?![0-9A-Za-z_])`).test(text);
      const byUrl = isStr(pr.url) && new RegExp(`${escape(pr.url)}(?![0-9A-Za-z_])`).test(text);
      return byNumber || byUrl ? null : `the release record does not name the pull request (#${pr.number})`;
    },
    apply: () => ({}),
  },
};

export function nextStates(from) {
  return STATES.filter((to) => TRANSITIONS[to]?.from.includes(from));
}

// The states a merge the host reports moves to merged.
export const HOST_MERGE_FROM = [...TRANSITIONS.merged.hostFrom, ...TRANSITIONS.merged.from];

// Whether from → to is an edge for this evidence: the graph's own, or a host-only edge with host evidence.
export function allowedMove(from, to, ev) {
  if (nextStates(from).includes(to)) return true;
  return ev.source === 'host' && Boolean(TRANSITIONS[to]?.hostFrom?.includes(from));
}
