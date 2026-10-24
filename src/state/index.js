import path from 'node:path';
import { exists, readText, writeText } from '../fs.js';
import { stateFileName } from '../ids.js';
import { kitPaths } from '../paths.js';
import { findSliceFiles, parseSliceFile } from '../slicefile.js';
import { TRANSITIONS, TransitionError, nextStates } from './transitions.js';

export { TransitionError };

const stateFile = (root, cfg, id) => path.join(kitPaths(root, cfg).state, stateFileName(id));

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
  if (exists(file)) return { ...defaultState(id), ...JSON.parse(readText(file)) };
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

export function setState(root, cfg, id, to, evidence = {}) {
  const current = readSlice(root, cfg, id);
  const { backfill, ...ev } = evidence;
  const rule = TRANSITIONS[to];
  if (!rule) throw new TransitionError(`${current.state} cannot move to ${to}`);
  if (backfill) {
    const missing = rule.required.filter((k) => ev[k] === undefined || ev[k] === null || ev[k] === '');
    if (missing.length > 0) throw new TransitionError(`backfill to ${to} needs ${missing.join(', ')}`);
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
}

export function unfreeze(root, cfg, id, file) {
  const current = readSlice(root, cfg, id);
  const next = {
    ...current,
    unfrozen: [...current.unfrozen, file],
    history: [...current.history, entry(current.state, current.state, 'cli', { unfreeze: file })],
  };
  writeSlice(root, cfg, next);
  return next;
}
