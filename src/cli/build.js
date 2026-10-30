// `slicekit build <sub>` (REQ-2.6): the deterministic steps of `/slicekit build`. Each subcommand
// lands with its task; S-15 and S-16 add theirs.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig, localNote } from '../config.js';
import { GitError } from '../git.js';
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { getTracker, TrackerError } from '../adapters/tracker/index.js';
import { PrError } from '../pr.js';
import { PrBodyError } from '../prbody.js';
import { SliceFileError } from '../slicefile.js';
import { LockError, TransitionError } from '../state/index.js';
import { runnable, waiting } from '../build/order.js';
import { amend, commitWork } from '../build/commit.js';
import { declineFinding } from '../build/decline.js';
import { finish } from '../build/finish.js';
import { startParallel } from '../build/parallel.js';
import { openSlicePr } from '../build/pr.js';
import { red } from '../build/red.js';
import { renderSlice } from '../build/render.js';
import { syncWorktree } from '../build/sync.js';
import { LOOP_ROUNDS, latestVerdictPath, recordVerdict } from '../build/verdict.js';
import { BuildError, startSlice } from '../build/worktree.js';
import { readSlice } from '../state/index.js';
import { INDEPENDENT_MISSING } from '../state/transitions.js';

const SUBCOMMANDS = ['next', 'start', 'red', 'commit', 'render', 'amend', 'pr', 'verdict', 'decline', 'finish', 'sync', 'parallel'];
const USAGE =
  'build next | build start <id> [--descr <d>] | build parallel P<n> | build red <id> --tests <a,b> [--worktree <p>] | build commit <id> --message <m> [--require-green] [--worktree <p>] | build render <id> [--worktree <p>] | build amend <id> --test <path> --reason <r> [--worktree <p>] | build pr <id> [--notes <file>] [--worktree <p>] | build verdict <id> <file> [--independent] [--worktree <p>] | build decline <id> <H-n> [--worktree <p>] | build finish <id> [--wait <s>, default 90] [--worktree <p>] | build sync <id> [--worktree <p>]';

const OPTIONS = {
  descr: { type: 'string' },
  tests: { type: 'string' },
  worktree: { type: 'string' },
  message: { type: 'string' },
  'require-green': { type: 'boolean' },
  test: { type: 'string' },
  reason: { type: 'string' },
  notes: { type: 'string' },
  wait: { type: 'string' },
  independent: { type: 'boolean' },
};

function next(root, io, positionals) {
  if (positionals.length > 0) return usage(io);
  const cfg = loadConfig(root);
  const ready = runnable(root, cfg);
  if (ready.length > 0) {
    io.stdout(`${ready[0].id}\n`);
    return 0;
  }
  io.stdout(['no slice is ready to build', ...waiting(root, cfg)].map((l) => `${l}\n`).join(''));
  return 1;
}

function start(root, io, positionals, values) {
  if (positionals.length !== 1) return usage(io);
  const cfg = loadConfig(root);
  const { worktree, branch, resumed, state } = startSlice(root, cfg, positionals[0], {
    descr: values.descr,
    onWarning: (msg) => io.stderr(`${msg}\n`),
  });
  // Forward slashes on every platform, as the brief's Where section prints it: a backslash path
  // pasted unquoted into a POSIX shell loses its separators.
  const where = path.resolve(worktree).split(path.sep).join('/');
  if (!resumed) {
    io.stdout(`${where}\n${branch}\n`);
    return 0;
  }
  // At in-review the latest round is recorded and its next step not yet acted on: `build verdict`
  // with that round's file re-prints the step and records nothing again. After an independent round
  // that file is recorded only from the review worktree: the next review is a new session's.
  const current = state === 'in-review' ? readSlice(worktree, cfg, positionals[0]) : null;
  const last = current?.verdicts?.at(-1);
  let line = '';
  if (last?.independent) line = `next review: /slicekit review ${current.pr?.number ?? '<PR>'} in a new session\n`;
  else if (last) line = `verdict ${latestVerdictPath(root, current.verdicts)}\n`;
  io.stdout(`resumed ${where} at ${state}\n${line}`);
  return 0;
}

// Prints `<id> <worktree> <branch>` for each slice started, and a refusal on stderr for each that
// was not, `held in <where>` for one another clone holds. Each start is claimed on its own, so the ones that started stay started when another
// fails: the exit is 0 only when every runnable slice of the step started, else 1, with the started
// lines still printed so the caller knows which worktrees exist.
function parallel(root, io, positionals) {
  if (positionals.length !== 1 || !/^P\d+$/.test(positionals[0])) return usage(io);
  const cfg = loadConfig(root);
  const outcomes = startParallel(root, cfg, positionals[0], { onWarning: (msg) => io.stderr(`${msg}\n`) });
  for (const o of outcomes) {
    if (o.error === undefined) io.stdout(`${o.id} ${path.resolve(o.worktree).split(path.sep).join('/')} ${o.branch}\n`);
    else io.stderr(`slicekit: ${o.id} not started: ${o.error}\n`);
  }
  return outcomes.every((o) => o.error === undefined || o.held) ? 0 : 1;
}

function redStep(root, io, positionals, values) {
  if (positionals.length !== 1 || values.tests === undefined) return usage(io);
  const cfg = loadConfig(root);
  const { commit, local } = red(root, cfg, positionals[0], { tests: values.tests, worktree: values.worktree, env: io.env ?? process.env });
  if (local) io.stderr(`${localNote(local)}\n`);
  io.stdout(`${commit}\ntests-red → building\n`);
  return 0;
}

function commitStep(root, io, positionals, values) {
  if (positionals.length !== 1 || values.message === undefined) return usage(io);
  const cfg = loadConfig(root);
  const { sha, exit, local } = commitWork(root, cfg, positionals[0], {
    message: values.message,
    requireGreen: Boolean(values['require-green']),
    worktree: values.worktree,
    env: io.env ?? process.env,
  });
  if (local) io.stderr(`${localNote(local)}\n`);
  io.stdout(sha === null ? 'nothing to commit\n' : `${sha.slice(0, 7)} exit ${exit}\n`);
  return 0;
}

// Prints the render commit's short SHA, or that the worktree already holds this kit's render.
function renderStep(root, io, positionals, values) {
  if (positionals.length !== 1) return usage(io);
  const cfg = loadConfig(root);
  const { sha, files } = renderSlice(root, cfg, positionals[0], { worktree: values.worktree });
  io.stdout(sha === null ? 'nothing to render\n' : `${sha.slice(0, 7)} render (${files.length} files)\n`);
  return 0;
}

function amendStep(root, io, positionals, values) {
  if (positionals.length !== 1 || values.test === undefined || values.reason === undefined) return usage(io);
  const cfg = loadConfig(root);
  const { test } = amend(root, cfg, positionals[0], { test: values.test, reason: values.reason, worktree: values.worktree });
  io.stdout(`unfroze ${test}\n`);
  return 0;
}

function prStep(root, io, positionals, values) {
  if (positionals.length !== 1) return usage(io);
  const cfg = loadConfig(root);
  const host = getHost(cfg, io.env ?? process.env, root);
  const { number, url, verdictPath, local, movedHead } = openSlicePr(root, cfg, host, positionals[0], { notes: values.notes, worktree: values.worktree, env: io.env ?? process.env });
  if (local) io.stderr(`${localNote(local)}\n`);
  // Last, the path the next reviewer writes; none once the loop's rounds are used.
  // A head recorded at draft-pr: the verdict path again, for a review of that head.
  const moved = movedHead ? `head ${movedHead} recorded; the next verdict reviews it\n` : '';
  io.stdout(`#${number} ${url}\n${moved}${verdictPath ? `verdict ${verdictPath}\n` : ''}`);
  return 0;
}

// Prints the next step, the round's finding IDs and the in-loop rounds used; a stopped loop (D-18)
// also says so and exits 1. `--independent` records an independent review's verdict (D-39).
function verdictStep(root, io, positionals, values) {
  if (positionals.length !== 2) return usage(io);
  const cfg = loadConfig(root);
  const [id, file] = positionals;
  const r = recordVerdict(root, cfg, getHost(cfg, io.env ?? process.env, root), id, file, {
    worktree: values.worktree,
    independent: Boolean(values.independent),
  });
  const list = (ids) => (ids.length > 0 ? ids.join(', ') : 'none');
  const out = [`next: ${r.next}`, `blockers: ${list(r.blockers)}`, `should-haves: ${list(r.shouldHaves)}`, `rounds: ${r.roundsUsed} of ${LOOP_ROUNDS}`];
  if (r.next === 'ask' && r.roundsUsed >= LOOP_ROUNDS) out.push('fix: not available after round 2; decline or leave for the independent review');
  if (r.verdictPath) out.push(`verdict ${r.verdictPath}`);
  io.stdout(out.map((l) => `${l}\n`).join(''));
  if (r.next === 'stuck') {
    io.stderr(`slicekit: stopped: ${r.blockers.join(', ')} survive round ${r.round}; the pull request stays draft\n`);
    return 1;
  }
  return 0;
}

// Prints the issue's URL, and `(already filed)` (`, closed` for a closed one) when the finding's issue
// was there before.
function declineStep(root, io, positionals, values) {
  if (positionals.length !== 2) return usage(io);
  const cfg = loadConfig(root);
  const env = io.env ?? process.env;
  const [id, finding] = positionals;
  const { url, created, state } = declineFinding(root, cfg, getHost(cfg, env, root), getTracker(cfg, env, root), id, finding, { worktree: values.worktree });
  const filed = state === 'closed' ? 'already filed, closed' : 'already filed';
  io.stdout(created ? `${url}\n` : `${url} (${filed})\n`);
  return 0;
}

// Prints `ci-green` and the CI run's URL once CI succeeds on the pull request's live head, then
// `ready`, or that the slice is waiting for an independent review.
function finishStep(root, io, positionals, values) {
  if (positionals.length !== 1) return usage(io);
  let wait;
  if (values.wait !== undefined) {
    if (!/^\d+$/.test(values.wait)) return usage(io);
    wait = Number(values.wait);
  }
  const cfg = loadConfig(root);
  const { ci, ready, reason, number } = finish(root, cfg, getHost(cfg, io.env ?? process.env, root), positionals[0], { worktree: values.worktree, ...(wait === undefined ? {} : { wait }) });
  io.stdout(`ci-green\n${ci.url ?? `passed on ${ci.sha.slice(0, 7)}`}\n`);
  if (ready) io.stdout('ready\n');
  else if (reason === INDEPENDENT_MISSING) io.stdout(`ready: waiting for an independent review; run /slicekit review ${number} in a new session\n`);
  else io.stdout(`ready: not yet: ${reason}\n`);
  return 0;
}

// Prints the worktree's head once it is fast-forwarded to its branch on origin.
function syncStep(root, io, positionals, values) {
  if (positionals.length !== 1) return usage(io);
  const cfg = loadConfig(root);
  const { head } = syncWorktree(root, cfg, positionals[0], { worktree: values.worktree });
  io.stdout(`${head}\n`);
  return 0;
}

const HANDLERS = { next, start, parallel, red: redStep, commit: commitStep, render: renderStep, amend: amendStep, pr: prStep, verdict: verdictStep, decline: declineStep, finish: finishStep, sync: syncStep };

function usage(io) {
  io.stderr(`usage: slicekit ${USAGE}\n`);
  return 2;
}

async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\n`);
    return usage(io);
  }
  const [sub, ...rest] = positionals;
  const handler = Object.hasOwn(HANDLERS, sub ?? '') ? HANDLERS[sub] : undefined;
  if (!handler) return usage(io);
  try {
    return handler(io.cwd, io, rest, values);
  } catch (e) {
    if (e instanceof BuildError || e instanceof PrError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return e.code;
    }
    if (e instanceof ConfigError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    if (e instanceof GitError || e instanceof GitHostError || e instanceof TrackerError || e instanceof PrBodyError || e instanceof SliceFileError || e instanceof TransitionError || e instanceof LockError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 1;
    }
    if (/^unknown slice /.test(e.message)) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export const buildCommand = { run, usage: USAGE, subcommands: SUBCOMMANDS };
