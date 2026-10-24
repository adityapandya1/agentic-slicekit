import fs from 'node:fs';
import path from 'node:path';
import { exists, readText, writeText } from '../fs.js';
import { commitExists, hasCommits, isRepo, resolveCommit } from '../git.js';
import { parseSliceAddr, stateFileName } from '../ids.js';
import { kitPaths } from '../paths.js';
import { findSliceFiles, parseSliceFile } from '../slicefile.js';
import { TRANSITIONS, TransitionError, nextStates, validateEvidence } from './transitions.js';

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
const LOCK_WAIT_MS = 10;
const LOCK_STALE_MS = 30_000;

function stateFile(root, cfg, id) {
  if (!parseSliceAddr(id)) throw new Error(`unknown slice ${id}`);
  return path.join(kitPaths(root, cfg).state, stateFileName(id));
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// One writer per slice at a time: the read-modify-write in setState and unfreeze runs under it.
function withLock(root, cfg, id, fn) {
  const lock = `${stateFile(root, cfg, id)}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + LOCK_BUDGET_MS;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx');
      break;
    } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lock);
      } catch {
        // the holder released it between our attempt and the stat; try again
      }
      if (Date.now() >= deadline) throw new LockError(id);
      sleep(LOCK_WAIT_MS);
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
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
      if (current.state !== 'todo') throw new TransitionError('backfill is only allowed from todo');
      const missing = rule.required.filter((k) => ev[k] === undefined);
      if (missing.length > 0) throw new TransitionError(`backfill to ${to} needs ${missing.join(', ')}`);
      if (['draft-pr', 'ci-green', 'merged'].includes(to)) {
        const pr = ev.pr;
        if (!pr || !Number.isInteger(pr.number) || typeof pr.headSha !== 'string' || pr.headSha === '') {
          throw new TransitionError(`backfill to ${to} needs pr.number and pr.headSha`);
        }
      }
      if (to === 'ready' && cfg.review.independent !== 'optional') {
        const v = ev.verdict;
        if (!v || v.independent !== true || v.blockers !== 0) {
          throw new TransitionError('backfill to ready needs an independent verdict with no blockers');
        }
      }
    } else {
      if (!nextStates(current.state).includes(to)) {
        throw new TransitionError(`${current.state} cannot move to ${to}`);
      }
      const reason = rule.check(current, ev, { root, cfg, id });
      if (reason) throw new TransitionError(reason);
    }
    const next = {
      ...current,
      ...rule.apply(current, ev),
      state: to,
      history: [...current.history, entry(current.state, to, backfill ? 'backfill' : 'cli', ev)],
    };
    writeSlice(root, cfg, next);
    return next;
  });
}

// Only a test frozen at tests-red can be unfrozen; any other path has nothing to release.
export function unfreeze(root, cfg, id, file) {
  return withLock(root, cfg, id, () => {
    const current = readSlice(root, cfg, id);
    if (!current.frozenTests.includes(file)) {
      throw new TransitionError(`${file} is not a frozen test of ${id}`);
    }
    const next = {
      ...current,
      unfrozen: [...current.unfrozen, file],
      history: [...current.history, entry(current.state, current.state, 'cli', { unfreeze: file })],
    };
    writeSlice(root, cfg, next);
    return next;
  });
}
