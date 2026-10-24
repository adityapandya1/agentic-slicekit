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

// The linear order, with changes-requested a side loop: in-review may skip it to ci-green, and it
// returns only to in-review (a new verdict after a fix) or draft-pr (a fix push before the next verdict).
const MOVES = {
  'in-review': ['changes-requested', 'ci-green'],
  'changes-requested': ['in-review', 'draft-pr'],
};

export function nextStates(from) {
  if (MOVES[from]) return [...MOVES[from]];
  const i = STATES.indexOf(from);
  return i !== -1 && i + 1 < STATES.length ? [STATES[i + 1]] : [];
}

const last = (list) => list[list.length - 1];
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const present = (root, rel) => fs.existsSync(path.resolve(root, rel));

// `required` names the evidence keys a target state stores; --backfill still demands them.
export const TRANSITIONS = {
  'tests-red': {
    from: ['todo'],
    required: ['commit', 'tests'],
    check(_current, ev) {
      if (!ev.commit) return 'tests-red needs the commit sha of the failing run (--commit)';
      if (!isNum(ev.testExit) || ev.testExit === 0) {
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
      if (ctx.cfg.freezeTests) {
        const missing = current.frozenTests.filter((t) => !present(ctx.root, t));
        if (missing.length > 0) return `frozen tests are missing: ${missing.join(', ')}`;
      }
      return null;
    },
    apply: () => ({}),
  },
  'draft-pr': {
    from: ['building', 'changes-requested'],
    required: ['pr'],
    check(_current, ev, ctx) {
      if (ev.testExit !== 0) return 'draft-pr needs the test command to exit 0 (--test-exit 0)';
      if (ev.checkExit !== 0) return 'draft-pr needs slicekit check to exit 0 (--check-exit 0)';
      const prefix = `[${ctx.id}]`;
      if (!ev.pr || typeof ev.pr.title !== 'string' || !ev.pr.title.startsWith(prefix)) {
        return `draft-pr needs a pull request whose title begins ${prefix}`;
      }
      return null;
    },
    apply: (_current, ev) => ({
      pr: { number: ev.pr.number, url: ev.pr.url, headSha: ev.pr.headSha },
    }),
  },
  'in-review': {
    from: ['draft-pr', 'changes-requested'],
    required: ['verdict'],
    check(current, ev) {
      const v = ev.verdict;
      if (!v || !isNum(v.round) || v.round < 1) return 'in-review needs a verdict with round 1 or more';
      if (!isNum(v.blockers)) return 'in-review needs the verdict blocker count';
      const prev = last(current.verdicts);
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
    check(_current, ev, ctx) {
      if (!ev.release) return 'released needs the release file path (--release)';
      return present(ctx.root, ev.release) ? null : `release file not found: ${ev.release}`;
    },
    apply: () => ({}),
  },
};
