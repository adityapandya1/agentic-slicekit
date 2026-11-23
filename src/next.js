// The one next step of the program (REQ-2.16, D-104, D-101). Read from files only: the stage files
// programStage reads, `.slicekit/state/` (a slice's worktree copy while it is being built), the slice
// files, the verdict files and `decisions.md`. Nothing is written and no git host is asked. A step is
// `{ step, command, more, person }`: the step on the first line, the command that runs it on the
// second, any further lines after them. `person` marks a step only a person takes (a merge, a
// publish, an Open decision row, the review budget stop): the command is printed for the person and
// nothing runs it.
import fs from 'node:fs';
import path from 'node:path';
import { readDecisions } from './decisions.js';
import { exists, readText } from './fs.js';
import { currentBranch, isRepo } from './git.js';
import { parseSliceAddr, sliceFromBranch, stateFileName } from './ids.js';
import { kitPaths } from './paths.js';
import { findSliceFiles, parseSliceFile } from './slicefile.js';
import { programStage } from './stage.js';
import { readSlice } from './state/index.js';
import { independentProblem, verdictsOnHead } from './state/transitions.js';
import { parseVerdict } from './verdict.js';
import { worktreeDir } from './worktrees.js';
import { sliceSteps } from './build/order.js';
import { LOOP_ROUNDS, QUICK_LOOP_ROUNDS, STOP_CHOICES, independentBlockers, independentRoundAllowed, nextVerdictPath } from './build/verdict.js';

const DONE = ['merged', 'released'];
const posix = (p) => p.split(path.sep).join('/');
const rel = (root, p) => posix(path.relative(root, p));

// The slash command of each stage before the build, as stage.js names them.
const STAGE_COMMANDS = {
  intake: '/slicekit intake',
  clarify: '/slicekit intake',
  specify: '/slicekit specify',
  'spec-review': '/slicekit specify',
  'gap-scan': '/slicekit gaps',
  stack: '/slicekit plan',
  plan: '/slicekit plan',
};

const person = (step, command, more = []) => ({ step, command: `person: ${command}`, more, person: true });
const agent = (step, command, more = []) => ({ step, command, more, person: false });

// The decision rows of `decisions.md` as the file holds them; none when it is missing.
function decisionRows(root, cfg) {
  const file = kitPaths(root, cfg).decisions;
  return exists(file) ? readDecisions(readText(file)).rows : [];
}

// The settled rows that allow `id` one more independent round (D-101), read from the file on disk.
function extraRounds(rows, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = new RegExp(`(?<![\\w/])${escaped}(?!\\d)`);
  return rows.filter((r) => r.table === 'settled' && names.test(r.answer) && /\bone more round\b/i.test(r.answer)).length;
}

// The command a person merges pull request `n` with: the GitHub CLI's on a GitHub host.
const mergeCommand = (cfg, n) => (cfg.gitHost?.kind === 'github' ? `gh pr merge ${n}` : `merge pull request #${n} on the git host`);

// The state of slice `id`: the worktree's state file while the slice is being built there, since
// the build commits its moves on the slice branch; the checkout's once it records a merge.
function sliceState(root, cfg, id, wt) {
  const here = readSlice(root, cfg, id);
  if (DONE.includes(here.state)) return here;
  const file = path.join(kitPaths(wt, cfg).state, stateFileName(id));
  if (!exists(file)) return here;
  try {
    return { ...here, ...JSON.parse(readText(file)) };
  } catch {
    return here;
  }
}

// The blocker IDs of the latest verdict, read from its file in the worktree or the checkout; an
// empty list when neither holds it.
function latestBlockers(root, wt, verdict) {
  if (!verdict?.path) return [];
  for (const base of [wt, root]) {
    const file = path.join(base, ...verdict.path.split('/'));
    if (!exists(file)) continue;
    return parseVerdict(readText(file), verdict.path)
      .findings.filter((f) => f.kind === 'blocker')
      .map((f) => f.id);
  }
  return [];
}

const choicesFor = (id, n, decisions) =>
  STOP_CHOICES.map((c, i) => `${i + 1}. ${c.replaceAll('<id>', id).replaceAll('<n>', String(n)).replaceAll('<decisions>', decisions)}`);

// The step a slice's state calls for.
function sliceStep(root, cfg, slice, rows) {
  const { id } = slice;
  const addr = parseSliceAddr(id);
  // Run inside the slice's own worktree, that worktree is the one the commands name.
  const own = path.basename(worktreeDir(root, addr));
  const inside = path.basename(root) === own && path.basename(path.dirname(root)) === '.worktrees';
  const wtAbs = inside ? root : worktreeDir(root, addr);
  const wt = posix(wtAbs);
  const cli = cfg.cli ?? 'slicekit';
  const s = sliceState(root, cfg, id, wtAbs);
  const n = s.pr?.number ?? null;
  const verdicts = s.verdicts ?? [];
  const rounds = slice.lane === 'quick' ? QUICK_LOOP_ROUNDS : LOOP_ROUNDS;
  const inLoop = verdicts.filter((v) => !v.independent).length;
  const decisions = rel(root, kitPaths(root, cfg).decisions);

  // An Open row the slice cites holds its build back until a person settles it.
  const open = new Set(rows.filter((r) => r.table === 'open').map((r) => r.id));
  const waiting = slice.decisions.filter((d) => open.has(d));
  if (['todo', 'tests-red', 'building'].includes(s.state) && waiting.length > 0) {
    return person(
      `${id} waits on ${waiting.join(', ')}, Open in ${decisions}: a person answers ${waiting.length === 1 ? 'it' : 'each'} before the build goes on`,
      `${cli} decide settle ${waiting[0]} --answer "<answer>"`,
    );
  }

  switch (s.state) {
    case 'todo':
      if (!fs.existsSync(wtAbs)) return agent(`${id} is todo: start its build (/slicekit build, step 1)`, `${cli} build start ${id}`);
      return agent(
        `${id} is todo in ${wt}: the developer writes the evaluation set's tests, then build red (/slicekit build, steps 2 and 3)`,
        `${cli} instructions developer ${id} --worktree ${wt}`,
      );
    case 'tests-red': {
      const tests = [...new Set((s.frozenTests ?? []).map((t) => (typeof t === 'string' ? t : t.file)))];
      return agent(
        `${id} is tests-red: build red records the failing tests and moves it to building (/slicekit build, step 3)`,
        `${cli} build red ${id} --tests ${tests.join(',') || '<a>,<b>'} --worktree ${wt}`,
      );
    }
    case 'building':
      return agent(
        `${id} is building: the developer makes the tests pass, then build commit --require-green and build pr (/slicekit build, steps 4 and 5)`,
        `${cli} instructions developer ${id} --worktree ${wt}`,
      );
    case 'draft-pr': {
      const next = nextVerdictPath(root, id, verdicts, rounds);
      if (next) {
        return agent(
          `${id} is draft-pr on #${n}: the reviewer gives the round ${verdicts.length + 1} verdict, then build verdict records it (/slicekit build, step 6)`,
          `${cli} instructions reviewer ${id} --worktree ${wt}`,
          [`then: ${cli} build verdict ${id} ${next} --worktree ${wt}`],
        );
      }
      return agent(
        `${id} is draft-pr on #${n}: the independent review, from a reviewer started in the main checkout (/slicekit review)`,
        `${cli} review start ${n}`,
      );
    }
    case 'in-review':
      return agent(`${id} is in-review on #${n}: wait for green CI and mark the pull request ready (/slicekit build, step 9)`, `${cli} build finish ${id} --worktree ${wt}`);
    case 'changes-requested': {
      const latest = verdicts.at(-1);
      const blockers = latestBlockers(root, wt, latest);
      const named = blockers.length > 0 ? ` ${blockers.join(', ')}` : '';
      if (latest?.independent) {
        if (independentRoundAllowed(independentBlockers(verdicts), extraRounds(rows, id))) {
          return agent(
            `${id} has open blockers${named} on #${n}: the fixer answers them, then build commit and build pr, then the next independent round (/slicekit review)`,
            `${cli} instructions fixer ${id} --worktree ${wt}`,
            [`then: ${cli} review start ${n}`],
          );
        }
        return person(`${id} has open blockers${named} on #${n} and no independent round is left (D-101): a person chooses one of three`, `choose one:`, choicesFor(id, n, decisions));
      }
      if (inLoop < rounds) {
        return agent(
          `${id} has open blockers${named} on #${n}: the fixer answers them, then build commit and build pr open the round ${verdicts.length + 1} review (/slicekit build, step 7)`,
          `${cli} instructions fixer ${id} --worktree ${wt}`,
        );
      }
      return person(`${id} has open blockers${named} on #${n} after the in-loop review rounds: a person chooses one of three`, `choose one:`, [
        `1. fix the open blockers by hand in ${wt} and push them with ${cli} build pr ${id}`,
        '2. re-scope the slice: amend the slice file so the blockers fall outside it, or move them to a new slice',
        `3. start the independent review: ${cli} review start ${n}`,
      ]);
    }
    case 'ci-green': {
      const problem = independentProblem(verdictsOnHead(s));
      if (problem && cfg.review?.independent !== 'optional') {
        return agent(`${id} is ci-green on #${n}, ${problem}: the independent review, from a reviewer started in the main checkout (/slicekit review)`, `${cli} review start ${n}`);
      }
      return agent(`${id} is ci-green on #${n}: build finish marks it ready`, `${cli} build finish ${id} --worktree ${wt}`);
    }
    case 'ready':
      return person(`${id} is ready: a person merges pull request #${n}`, mergeCommand(cfg, n), [`then: ${cli} status --sync records the merge`]);
    default:
      return agent(`${id} is ${s.state}`, `${cli} status`);
  }
}

// The slices in phase and Order-step order, each with its parsed slice file.
function orderedSlices(root, cfg) {
  const files = new Map();
  for (const f of findSliceFiles(root, cfg)) {
    const slice = parseSliceFile(readText(f.path), f.path);
    files.set(slice.id, slice);
  }
  const steps = [...sliceSteps(root, cfg)].map(([id, s], i) => ({ id, ...s, i }));
  steps.sort((a, b) => Number(a.phase.slice(1)) - Number(b.phase.slice(1)) || a.step - b.step || a.i - b.i);
  return steps.map((s) => files.get(s.id));
}

export function nextStep(root, cfg) {
  const cli = cfg.cli ?? 'slicekit';
  const rows = decisionRows(root, cfg);
  // On a slice branch the branch's own changes under docs/ (an amended slice file) are not a spec or
  // plan pull request waiting to merge: the stages are judged as the default branch has them.
  const branch = isRepo(root) ? currentBranch(root) : null;
  const asDefaultBranch = branch !== null && sliceFromBranch(branch) !== null;
  const before = programStage(root, cfg, { upTo: 'plan', asDefaultBranch });
  if (!before.complete) {
    const blocker = before.blockers[0];
    const openRow = /^(D-\d+) is Open/.exec(blocker);
    if (openRow) return person(`${before.stage}: ${blocker}: a person answers it`, `${cli} decide settle ${openRow[1]} --answer "<answer>"`);
    if (/merge the pull request/.test(blocker)) {
      return person(`${before.stage}: ${blocker}: a person merges that pull request`, `merge the ${before.stage === 'plan' ? 'plan' : 'spec'} pull request on the git host`, [`then: ${cli} stage require ${before.stage}`]);
    }
    return agent(`${before.stage} not done: ${blocker}`, STAGE_COMMANDS[before.stage]);
  }
  for (const slice of orderedSlices(root, cfg)) {
    const s = readSlice(root, cfg, slice.id);
    if (DONE.includes(s.state)) continue;
    return sliceStep(root, cfg, slice, rows);
  }
  const all = programStage(root, cfg, { asDefaultBranch });
  if (!all.complete) {
    const phase = /^(P\d+) has no releases/.exec(all.blockers[0]);
    if (phase) return agent(`${phase[1]}: every slice is merged; write its release record and open the release pull request`, `/slicekit release ${phase[1]}`);
    return agent(`${all.stage} not done: ${all.blockers[0]}`, `${cli} stage require ${all.stage}`);
  }
  return person('every phase is released: a publish, when the team makes one, is approved by a person', 'approve the publish in the team\'s release workflow', [
    'slicekit next approves no publish and pushes nothing',
  ]);
}

// The step's lines, the step first and its command second.
export const stepLines = (s) => [s.step, s.command, ...s.more];
