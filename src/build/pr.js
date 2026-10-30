// `build pr` (REQ-2.6 step 5, REQ-2.10, REQ-1.8): the test, lint and build commands and `slicekit
// check` pass in the worktree, then the branch is pushed, its draft pull request opened (or its body
// updated) with the REQ-2.10 body, and `draft-pr` recorded on the pushed head. Every refusal comes
// before the push. A run that stopped part way (pushed but not opened, opened but not recorded,
// recorded but the bookkeeping commit not pushed) finishes on a re-run without a second pull request.
import fs from 'node:fs';
import path from 'node:path';
import { check } from '../check/index.js';
import { buildTestCommand } from '../config.js';
import { git, headSha, pushBranch, pushTarget } from '../git.js';
import { stateFileName } from '../ids.js';
import { kitPaths } from '../paths.js';
import { openOrUpdate } from '../pr.js';
import { PrBodyError, getSection, renderPrBody } from '../prbody.js';
import { readSlice, recordHead } from '../state/index.js';
import { headCovers } from '../state/covers.js';
import { posixRel, runCommand, sliceIn, unusableRun } from './red.js';
import { commitBookkeeping, commitState, recordState } from './record.js';
import { overlapWith, planDefectLine } from './overlap.js';
import { assertNotBehind } from './sync.js';
import { nextVerdictPath } from './verdict.js';
import { BuildError, findWorktree } from './worktree.js';

const FROM = ['building', 'draft-pr', 'in-review', 'changes-requested', 'ci-green', 'ready'];
const NOTES_SHAPE = 'notes need tryIt (three steps) and skipped';
const NO_CHANGE = 'no operational change: the slice touches no configuration, infrastructure, migration, alert, queue or integration';
const RUNBOOK_REFUSAL = 'the slice touches operations; change the runbook or give notes.runbook "no operational change: <reason>"';
const COMMANDS = ['test', 'lint', 'build'];
// The sections the notes give: with no notes, the live body must hold each of them.
const NOTED_SECTIONS = ['Decisions', 'Runbook', 'Infra / migration', 'Try it', 'Skipped / not checked'];

const text = (v) => typeof v === 'string' && v.trim() !== '';

// The notes, from an object or a JSON file (relative to `root`): what only the agent can say.
function readNotes(root, notes) {
  let n = notes;
  if (typeof notes === 'string') {
    try {
      n = JSON.parse(fs.readFileSync(path.resolve(root, notes), 'utf8'));
    } catch (e) {
      throw new BuildError(`cannot read the notes file ${notes}: ${e.code ?? e.message}`, 2);
    }
  }
  if (n === null || typeof n !== 'object' || Array.isArray(n)) throw new BuildError(NOTES_SHAPE, 2);
  // The field that is wrong is named with the type it needs: a list given for `skipped` must not read
  // as a missing `skipped`.
  const wrong = [];
  if (!Array.isArray(n.tryIt) || n.tryIt.length !== 3 || !n.tryIt.every(text)) wrong.push('notes.tryIt must be a list of exactly three non-empty strings');
  if (!text(n.skipped)) wrong.push('notes.skipped must be one non-empty string');
  if (wrong.length > 0) throw new BuildError(`${NOTES_SHAPE}: ${wrong.join('; ')}`, 2);
  if (n.decisions !== undefined && !(Array.isArray(n.decisions) && n.decisions.every(text))) {
    throw new BuildError('notes.decisions must be a list of non-empty strings', 2);
  }
  for (const k of ['runbook', 'infra']) {
    if (n[k] !== undefined && !text(n[k])) throw new BuildError(`notes.${k} must be a non-empty string`, 2);
  }
  return n;
}

const lines = (out) => out.split('\n').filter((l) => l !== '');

// The worktree is clean, or holds only the state file and BUILD.md of a draft-pr recording whose
// bookkeeping commit did not land: that commit is made now.
function cleanOrFinish(wt, cfg, id, current) {
  // Paths from name lists, never from status columns: git() trims its output, and a leading space
  // is part of the first porcelain line.
  const changed = [
    ...lines(git(wt, ['diff', '--name-only', '--no-renames', 'HEAD'])),
    ...lines(git(wt, ['ls-files', '--others', '--exclude-standard'])),
  ];
  const files = [...new Set(changed)];
  if (files.length === 0) return;
  const paths = kitPaths(wt, cfg);
  const stateRel = posixRel(wt, path.join(paths.state, stateFileName(id)));
  const buildRel = posixRel(wt, paths.build);
  const onlyBookkeeping = files.includes(stateRel) && files.every((f) => f === stateRel || f === buildRel);
  if (current.state === 'draft-pr' && onlyBookkeeping && pendingDraftPr(wt, stateRel, current)) {
    commitBookkeeping(wt, id, 'draft-pr', files);
    return;
  }
  throw new BuildError(`the worktree has uncommitted changes (${files.slice(0, 5).join(', ')}); build commit them first`);
}

// The state on disk is HEAD's plus one move to draft-pr.
function pendingDraftPr(wt, stateRel, current) {
  let committed;
  try {
    committed = JSON.parse(git(wt, ['show', `HEAD:${stateRel}`]));
  } catch {
    return false;
  }
  const h = current.history ?? [];
  return (
    h.length === (committed.history ?? []).length + 1 &&
    JSON.stringify(h.slice(0, -1)) === JSON.stringify(committed.history ?? []) &&
    h.at(-1)?.to === 'draft-pr'
  );
}

// Whether the branch changed the runbook since it left the default branch.
function runbookChanged(wt, cfg, rel) {
  const origin = `refs/remotes/origin/${cfg.defaultBranch}`;
  let from;
  try {
    git(wt, ['rev-parse', '--verify', '--quiet', origin]);
    from = origin;
  } catch {
    from = `refs/heads/${cfg.defaultBranch}`;
  }
  const base = git(wt, ['merge-base', 'HEAD', from]);
  return git(wt, ['--literal-pathspecs', 'diff', '--name-only', base, 'HEAD', '--', rel]) !== '';
}

// The test run's pass and fail totals, from the last line naming each; the summary line when the
// output does not name both on separate lines.
function proofSummary(run) {
  const all = run.output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  const pass = all.filter((l) => /\bpass(ed|es|ing)?\b/i.test(l)).at(-1);
  const fail = all.filter((l) => /\bfail(ed|s|ures?)?\b/i.test(l)).at(-1);
  return pass && fail && pass !== fail ? `${pass} · ${fail}` : run.summary;
}

// Each declared command in the worktree, the test command from .slicekit/local.json when the session
// root has one (D-43); -> { summary, command, local }: the test run's pass and fail totals, the test
// command run, and whether it was the local one.
function runCommands(root, wt, cfg, env) {
  const tests = buildTestCommand(root, cfg, env);
  const commands = { ...(cfg.commands ?? {}), test: tests.command };
  if (!text(commands.test)) throw new BuildError('commands.test is not declared in .slicekit/config.json');
  let summary = '';
  for (const name of COMMANDS) {
    const command = commands[name];
    if (!text(command)) continue;
    const run = runCommand(wt, command);
    const unusable = unusableRun(command, run);
    if (unusable) throw unusable;
    if (run.exit !== 0) throw new BuildError(`${name} failed (exit ${run.exit}): ${run.summary}`);
    if (name === 'test') summary = proofSummary(run);
  }
  return { summary, command: tests.command, local: tests.local };
}

function assertNoOverlap(wt, cfg, id) {
  const defects = overlapWith(wt, cfg, id);
  if (defects.length > 0) throw new BuildError(defects.map((d) => planDefectLine(id, d)).join('\n'));
}

function checkClean(wt, env) {
  const result = check(wt, { env });
  if (result.exitCode === 0) return;
  const found = result.lines.slice(0, -1).filter((l) => !l.startsWith('(baseline) '));
  throw new BuildError(['slicekit check failed:', ...found.slice(0, 10), result.lines.at(-1)].join('\n'));
}

// `notes` may be left out for a slice that already has a pull request (the reviewing session does not
// have the building session's notes): each section the notes do not give keeps the live body's text.
export function openSlicePr(root, cfg, host, id, { notes, worktree, env = process.env } = {}) {
  const given = notes === undefined ? null : readNotes(root, notes);
  const held = findWorktree(root, id, { worktree });
  const wt = held.path;
  const current = readSlice(wt, cfg, id);
  if (!FROM.includes(current.state)) throw new BuildError(`${id} is ${current.state}; build pr runs from building to ready`);
  if (!given && !current.pr) throw new BuildError(`${id} has no pull request yet; build pr needs --notes to open it`, 2);
  const slice = sliceIn(wt, cfg, id);
  // Behind origin first: a head with commits origin has and this worktree lacks is synced, not
  // judged against the reviewed head (a different refusal, below).
  const { target } = pushTarget(wt);
  assertNotBehind(wt, held.branch, id);
  cleanOrFinish(wt, cfg, id, current);
  // After a verdict, a return to draft-pr needs a new head (the state refuses the same one): refused
  // here, before the push, rather than after it.
  const afterReview = current.state !== 'building' && current.state !== 'draft-pr';
  // A head that adds only bookkeeping (a verdict, the state, BUILD.md) to the reviewed one is the same work.
  if (afterReview && current.pr && headCovers(wt, current.pr.headSha, headSha(wt))) {
    throw new BuildError(`${id} has nothing new since review of ${current.pr.headSha.slice(0, 7)}; push a fix to return to draft-pr`);
  }
  // A path another slice of the same Order step already changes on origin (D-06): a plan defect,
  // refused before the notes, the body and the commands, so a defect in the plan stops the run before
  // minutes of test runs, and before anything is pushed. After the behind-origin refusal, which a
  // sync answers, and the nothing-new refusal, whose head was pushed and checked before. Asked again,
  // with a fresh fetch, just before the first push (below).
  assertNoOverlap(wt, cfg, id);

  // The pull request already open for the branch, and its live body, asked once when first needed.
  let asked = null;
  const openPr = () => {
    if (!asked) {
      const open = host.pullRequestForBranch(target);
      asked = { open, livePr: open ? host.getPullRequest(open.number) : null };
    }
    return asked;
  };
  const kept = (name, fallback) => {
    const { open, livePr } = openPr();
    return (open ? getSection(livePr?.body ?? '', name) : null) ?? fallback;
  };
  // A field the notes give, else the live body's section when one is open, else the fallback.
  const noted = (field, name, fallback) => given?.[field] ?? kept(name, fallback);
  // With no notes, every section they would give comes from the live body: checked before any command runs.
  if (!given) {
    const { open, livePr } = openPr();
    if (!open) throw new BuildError(`${id} has no open pull request; build pr needs --notes to open one`, 2);
    const missing = NOTED_SECTIONS.find((name) => !(getSection(livePr?.body ?? '', name) ?? '').trim());
    if (missing) throw new BuildError(`the pull request body has no "${missing}"; pass --notes <file> to supply it`);
  }

  const runbookRel = cfg.docsRoot === '.' ? 'runbook.md' : `${cfg.docsRoot}/runbook.md`;
  const changed = runbookChanged(wt, cfg, runbookRel);
  const runbookNote = changed ? null : (given?.runbook ?? (current.pr ? kept('Runbook', null) : null));
  if (slice.runbook && !changed && !(runbookNote ?? '').trim().startsWith('no operational change')) {
    throw new BuildError(RUNBOOK_REFUSAL);
  }
  const { summary, command: testCommand, local } = runCommands(root, wt, cfg, env);
  checkClean(wt, env);

  // The pull request already open for the branch: the recorded one once there is a recording.
  const { open, livePr } = openPr();
  if (current.state !== 'building' && (!open || open.number !== current.pr?.number)) {
    throw new BuildError(`pull request #${current.pr?.number} of ${id} is not open for ${target}`);
  }

  const title = `[${id}] ${slice.name}`;
  let body;
  try {
    body = renderPrBody({
      slice: id,
      name: slice.name,
      sections: {
        'Done when': slice.doneWhen.map((c, i) => `${i + 1}. ${c}`).join(' '),
        Proof: `\`${testCommand}\` → ${summary} · CI: pending`,
        Decisions: given?.decisions === undefined ? kept('Decisions', 'none') : given.decisions.join('; ') || 'none',
        Runbook: changed ? `changed: ${runbookRel}` : (runbookNote ?? NO_CHANGE),
        'Infra / migration': noted('infra', 'Infra / migration', 'none'),
        'Try it': given ? given.tryIt.map((s, i) => `${i + 1}. ${s.trim()}`).join(' ') : kept('Try it', ''),
        'Reviewer blocked': kept('Reviewer blocked', 'nothing'),
        'Should-haves declined': kept('Should-haves declined', 'none'),
        'Skipped / not checked': given ? given.skipped : kept('Skipped / not checked', ''),
      },
    });
  } catch (e) {
    if (e instanceof PrBodyError) throw new BuildError(e.message);
    throw e;
  }

  // Again just before openOrUpdate's push: another slice of the step may have pushed while the
  // commands ran. What is left is the moment between this fetch and the push; only a check on the
  // server could close that.
  assertNoOverlap(wt, cfg, id);
  const made = openOrUpdate(wt, cfg, host, { title, body, draft: true });
  // The absolute session-root path the next in-loop reviewer writes (null once the loop's rounds are
  // used or an independent verdict is recorded): recording draft-pr adds no verdict, so the count read before is the count after.
  const verdictPath = nextVerdictPath(root, id, current.verdicts ?? []);
  // The reviewer writes there at once: its directory is made here, as the path is printed.
  if (verdictPath) fs.mkdirSync(path.dirname(verdictPath), { recursive: true });
  const result = { number: made.number, url: made.url, created: made.created, verdictPath, local: local ? testCommand : null, movedHead: null };
  // `build finish` marked it ready; a slice back at draft-pr has a draft pull request again.
  if (livePr?.draft === false) host.markDraft(made.number);
  // At draft-pr a head that moved since the recorded one (a merge of the default branch, any commit)
  // is recorded in a bookkeeping commit and pushed, so the next verdict is taken on it (D-43). A head
  // that adds only bookkeeping to the recorded one is the same work: nothing is recorded.
  if (current.state === 'draft-pr') {
    const head = headSha(wt);
    if (current.pr?.headSha && !headCovers(wt, current.pr.headSha, head)) {
      recordHead(wt, cfg, id, { number: made.number, url: made.url, headSha: head });
      commitState(wt, cfg, id, 'head');
      pushBranch(wt, { protectedBranches: cfg.protectedBranches, defaultBranch: cfg.defaultBranch });
      result.movedHead = head;
    }
    return result;
  }
  recordState(wt, cfg, id, 'draft-pr', {
    testExit: 0,
    checkExit: 0,
    pr: { number: made.number, url: made.url, headSha: headSha(wt), title },
  });
  pushBranch(wt, { protectedBranches: cfg.protectedBranches, defaultBranch: cfg.defaultBranch });
  return result;
}
