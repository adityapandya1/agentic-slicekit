import fs from 'node:fs';
import path from 'node:path';
import { exists, readText, writeText } from '../fs.js';
import { commitExists, hasCommits, isRepo, resolveCommit } from '../git.js';
import { parseSliceAddr, stateFileName } from '../ids.js';
import { withFileLock } from '../lock.js';
import { kitPaths } from '../paths.js';
import { findSliceFiles, parseSliceFile } from '../slicefile.js';
import { TRANSITIONS, TransitionError, allowedMove, nextStates, validateEvidence } from './transitions.js';

export { TransitionError };

// Another slicekit holds the slice's lock for longer than the wait budget.
export class LockError extends Error {
  constructor(id) {
    super(`could not lock ${id}: another slicekit is writing it`);
    this.name = 'LockError';
    this.slice = id;
  }
}

const LOCK_BUDGET_MS = 5_000;

function stateFile(root, cfg, id) {
  if (!parseSliceAddr(id)) throw new Error(`unknown slice ${id}`);
  return path.join(kitPaths(root, cfg).state, stateFileName(id));
}

// One writer per slice at a time: the read-modify-write in setState and unfreeze runs under it.
function withLock(root, cfg, id, fn, budgetMs = LOCK_BUDGET_MS) {
  const lock = `${stateFile(root, cfg, id)}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  return withFileLock(lock, fn, { budgetMs, busy: () => new LockError(id) });
}

function defaultState(id) {
  return {
    slice: id,
    state: 'todo',
    branch: null,
    pr: null,
    redCommit: null,
    frozenTests: [],
    unfrozen: [],
    verdicts: [],
    ci: null,
    mergedAt: null,
    handoff: null,
    history: [],
  };
}

function sliceExists(root, cfg, id) {
  return findSliceFiles(root, cfg).some((f) => {
    try {
      return parseSliceFile(readText(f.path), f.path).id === id;
    } catch {
      return false;
    }
  });
}

export function readSlice(root, cfg, id) {
  const file = stateFile(root, cfg, id);
  if (exists(file)) {
    let stored;
    try {
      stored = JSON.parse(readText(file));
    } catch {
      throw new Error(`${file}: not valid JSON`);
    }
    return { ...defaultState(id), ...stored };
  }
  if (sliceExists(root, cfg, id)) return defaultState(id);
  throw new Error(`unknown slice ${id}`);
}

export function writeSlice(root, cfg, state) {
  writeText(stateFile(root, cfg, state.slice), `${JSON.stringify(state, null, 2)}\n`);
}

export function listSlices(root, cfg) {
  const out = [];
  for (const f of findSliceFiles(root, cfg)) {
    const slice = parseSliceFile(readText(f.path), f.path);
    out.push({ file: f.path, state: readSlice(root, cfg, slice.id) });
  }
  return out;
}

// Who made a move: a backfill, the host sync (evidence the host reported), or a person at the CLI.
const by = (backfill, ev) => (backfill ? 'backfill' : ev.source === 'host' ? 'sync' : 'cli');

function entry(from, to, by, evidence) {
  return { from, to, at: new Date().toISOString(), by, evidence };
}

// In a repository with commits, the red commit must be one of them, and every SHA the repository
// can resolve is stored as its full 40-hex form. A head or CI SHA the repository has not fetched
// is kept as given; comparisons then match by prefix.
function resolveShas(root, ev) {
  const given = [ev.commit, ev.pr?.headSha, ev.ci?.sha].some((s) => s !== undefined);
  if (!given || !isRepo(root) || !hasCommits(root)) return ev;
  const out = { ...ev };
  if (ev.commit !== undefined) {
    if (!commitExists(root, ev.commit)) throw new TransitionError(`commit ${ev.commit} is not a commit in this repository`);
    out.commit = resolveCommit(root, ev.commit) ?? ev.commit;
  }
  if (ev.pr?.headSha !== undefined) {
    const full = resolveCommit(root, ev.pr.headSha);
    if (full) out.pr = { ...ev.pr, headSha: full };
  }
  if (ev.ci?.sha !== undefined) {
    const full = resolveCommit(root, ev.ci.sha);
    if (full) out.ci = { ...ev.ci, sha: full };
  }
  return out;
}

// The only states backfill records.
const BACKFILL_TO = ['draft-pr', 'merged'];

export function setState(root, cfg, id, to, evidence = {}) {
  return withLock(root, cfg, id, () => {
    const current = readSlice(root, cfg, id);
    const { backfill, ...given } = evidence;
    const rule = TRANSITIONS[to];
    if (!rule) throw new TransitionError(`${current.state} cannot move to ${to}`);
    const typeError = validateEvidence(given);
    if (typeError) throw new TransitionError(typeError);
    const ev = resolveShas(root, given);
    if (backfill) {
      // Backfill adopts a slice built outside the loop: an open pull request or a merge. A review,
      // CI or ready state is recorded only by the build commands, whose checks backfill would skip.
      if (!BACKFILL_TO.includes(to)) throw new TransitionError('backfill records only draft-pr or merged; later states come from the build commands');
      // A merge is a fact the git host reports (D-43): recorded from any state before merged, and only
      // on the host's report (the state CLI asks the host and supplies it). An open pull request is
      // adopted only into a slice the loop has not started.
      if (to === 'draft-pr' && current.state !== 'todo') throw new TransitionError('backfill to draft-pr is only allowed from todo');
      const missing = rule.required.filter((k) => ev[k] === undefined);
      if (missing.length > 0) throw new TransitionError(`backfill to ${to} needs ${missing.join(', ')}`);
      const pr = ev.pr;
      if (!pr || !Number.isInteger(pr.number) || typeof pr.headSha !== 'string' || pr.headSha === '') {
        throw new TransitionError(`backfill to ${to} needs pr.number and pr.headSha`);
      }
      if (to === 'merged') {
        if (['merged', 'released'].includes(current.state)) throw new TransitionError(`${id} is already ${current.state}`);
        if (ev.source !== 'host') throw new TransitionError('backfill to merged needs the git host to report the pull request merged');
      }
    } else {
      if (!allowedMove(current.state, to, ev)) {
        throw new TransitionError(`${current.state} cannot move to ${to}`);
      }
      const reason = rule.check(current, ev, { root, cfg, id });
      if (reason) throw new TransitionError(reason);
    }
    const next = {
      ...current,
      ...rule.apply(current, ev),
      state: to,
      // A handoff belongs to the state it was written in.
      handoff: null,
      history: [...current.history, entry(current.state, to, by(backfill, ev), ev)],
    };
    writeSlice(root, cfg, next);
    return next;
  });
}

// A slice at draft-pr whose head moved since build pr recorded it (a merge of the default branch,
// any commit): the new head is recorded as a draft-pr entry, not a move, so the next verdict is taken
// on it (D-43). `pr` is { number, url, headSha }; only build pr calls this.
export function recordHead(root, cfg, id, pr) {
  return withLock(root, cfg, id, () => {
    const current = readSlice(root, cfg, id);
    if (current.state !== 'draft-pr') throw new TransitionError(`${id} is ${current.state}; a moved head is recorded only at draft-pr`);
    const typeError = validateEvidence({ pr });
    if (typeError) throw new TransitionError(typeError);
    const ev = resolveShas(root, { pr });
    const next = {
      ...current,
      pr: { ...(current.pr ?? {}), ...ev.pr },
      history: [...current.history, entry('draft-pr', 'draft-pr', 'cli', { head: ev.pr.headSha })],
    };
    writeSlice(root, cfg, next);
    return next;
  });
}

// Only a test frozen at tests-red can be unfrozen; any other path has nothing to release. `extra`
// joins the history entry's evidence (build amend gives the amendment commit and the reason). `to`
// moves the slice in the same write: build amend during review takes it back to building (D-43).
export function unfreeze(root, cfg, id, file, extra = {}, { to } = {}) {
  return withLock(root, cfg, id, () => {
    const current = readSlice(root, cfg, id);
    if (!current.frozenTests.includes(file)) {
      throw new TransitionError(`${file} is not a frozen test of ${id}`);
    }
    const state = to ?? current.state;
    const next = {
      ...current,
      state,
      ...(state === current.state ? {} : { handoff: null }),
      unfrozen: [...current.unfrozen, file],
      history: [...current.history, entry(current.state, state, 'cli', { unfreeze: file, ...extra })],
    };
    writeSlice(root, cfg, next);
    return next;
  });
}

// Replaces only the slice's handoff, under the slice lock, re-reading the file inside it so a
// concurrent `slicekit state set` is never undone. State and history are left as they are. A slice with
// no state file yet is skipped (returns false): the handoff never creates one. Throws LockError when
// the lock is not free within budgetMs.
export function setHandoff(root, cfg, id, handoff, { budgetMs = LOCK_BUDGET_MS } = {}) {
  return withLock(root, cfg, id, () => {
    if (!exists(stateFile(root, cfg, id))) return false;
    writeSlice(root, cfg, { ...readSlice(root, cfg, id), handoff });
    return true;
  }, budgetMs);
}
