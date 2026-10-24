import fs from 'node:fs';
import path from 'node:path';

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

// Every evidence value that is given must have the right type, whatever the target state.
export function validateEvidence(ev) {
  const bad = (name, want) => `${name} must be ${want}`;
  for (const k of ['commit', 'mergedAt', 'release']) {
    if (ev[k] !== undefined && !isStr(ev[k])) return bad(k, 'a non-empty string');
  }
  for (const k of ['testExit', 'checkExit']) {
    if (ev[k] !== undefined && !isInt(ev[k])) return bad(k, 'a non-negative integer');
  }
  if (ev.tests !== undefined && !(Array.isArray(ev.tests) && ev.tests.every(isStr))) {
    return bad('tests', 'an array of non-empty strings');
  }
  const pr = ev.pr;
  if (pr !== undefined) {
    if (pr === null || typeof pr !== 'object') return bad('pr', 'an object');
    if (pr.number !== undefined && !isInt(pr.number)) return bad('pr.number', 'a non-negative integer');
    for (const k of ['url', 'headSha', 'title']) {
      if (pr[k] !== undefined && !isStr(pr[k])) return bad(`pr.${k}`, 'a non-empty string');
    }
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
      if (!pr || typeof pr.title !== 'string' || !pr.title.startsWith(prefix)) {
        return `draft-pr needs a pull request whose title begins ${prefix}`;
      }
      if (!isInt(pr.number)) return 'draft-pr needs the pull request number (pr.number)';
      if (!isStr(pr.headSha)) return 'draft-pr needs the pull request head sha (pr.headSha)';
      if (current.state !== 'building' && current.pr && pr.headSha === current.pr.headSha) {
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
      const prev = last(current.verdicts);
      if (!prev && v.round !== 1) return `the first verdict must be round 1, got round ${v.round}`;
      if (prev && v.round <= prev.round) return `verdict round ${v.round} is not after round ${prev.round}`;
      return null;
    },
    apply: (current, ev) => ({
      verdicts: [
        ...current.verdicts,
        {
          round: ev.verdict.round,
          path: ev.verdict.path,
          blockers: ev.verdict.blockers,
          independent: Boolean(ev.verdict.independent),
        },
      ],
    }),
  },
  'changes-requested': {
    from: ['in-review'],
    required: [],
    check(current) {
      const v = last(current.verdicts);
      return v && v.blockers > 0 ? null : 'changes-requested needs a latest verdict with open blockers';
    },
    apply: () => ({}),
  },
  'ci-green': {
    from: ['in-review'],
    required: ['ci'],
    check(current, ev) {
      const v = last(current.verdicts);
      if (!v || v.blockers !== 0) return 'ci-green needs a latest verdict with no blockers';
      if (!ev.ci || ev.ci.status !== 'success') return 'ci-green needs the CI status to be success (--ci-status)';
      if (!isStr(ev.ci.sha)) return 'ci-green needs the CI sha (--ci-sha)';
      if (!current.pr || ev.ci.sha !== current.pr.headSha) {
        return 'ci-green needs the CI sha to equal the pull request head sha';
      }
      return null;
    },
    apply: (_current, ev) => ({ ci: { sha: ev.ci.sha, status: ev.ci.status } }),
  },
  ready: {
    from: ['ci-green'],
    required: [],
    check(current, _ev, ctx) {
      if (ctx.cfg.review.independent === 'optional') return null;
      return current.verdicts.some((v) => v.independent && v.blockers === 0)
        ? null
        : 'ready needs an independent review verdict with no blockers';
    },
    apply: () => ({}),
  },
  merged: {
    from: ['ready'],
    required: ['mergedAt'],
    check: (_current, ev) => (ev.mergedAt ? null : 'merged needs mergedAt (--merged-at)'),
    apply: (current, ev) => (ev.pr ? { pr: { ...(current.pr ?? {}), ...ev.pr } } : {}),
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
      const named = (pr.number !== undefined && text.includes(`#${pr.number}`)) || (pr.url && text.includes(pr.url));
      return named ? null : `the release record does not name the pull request (#${pr.number})`;
    },
    apply: () => ({}),
  },
};

export function nextStates(from) {
  return STATES.filter((to) => TRANSITIONS[to]?.from.includes(from));
}
