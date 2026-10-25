// ci-title (03 REQ-3.11, REQ-3.7): with --ci, the pull request's title begins with the slice it
// delivers, `[P<n>/S-<nn>]`, and that slice has a slice file, a state file and a state of at least
// `draft-pr` and before `merged`: a pull request opened by hand, outside the build loop, fails, and
// so does one for a slice already merged or released (a later change needs its own slice). A `[spec] ` or
// `[plan] ` title is not a slice's and is exempt. Draft and closed pull requests are judged alike.
// Without --ci, or with no pull request in the event (a push), there is nothing to judge.
import fs from 'node:fs';
import path from 'node:path';
import { ID, stateFileName } from '../../ids.js';
import { readSlice } from '../../state/index.js';
import { STATES } from '../../state/transitions.js';
import { EXEMPT_TITLE, PR_FILE, readCiEvent } from '../ci-event.js';

export const id = 'ci-title';
export const blocking = true;
export const ratchet = false;

const TITLE = new RegExp(`^\\[(${ID.sliceAddr})\\]`);
const DRAFT_PR = STATES.indexOf('draft-pr');
const MERGED = STATES.indexOf('merged');

// The slice a title names, or null.
export const titleSlice = (title) => TITLE.exec(title)?.[1] ?? null;

export function run(ctx) {
  if (!ctx.ci) return [];
  const pr = readCiEvent(ctx.env);
  if (!pr) return [];
  const at = (message) => [{ file: PR_FILE, line: 0, message }];
  if (EXEMPT_TITLE.test(pr.title)) return [];
  const slice = titleSlice(pr.title);
  if (!slice) return at('title must begin with [P<n>/S-<nn>]');
  if (!ctx.ids.slice.has(slice)) return at(`slice ${slice} has no slice file`);
  if (!fs.existsSync(path.join(ctx.paths.state, stateFileName(slice)))) return at(`slice ${slice} has no state file`);
  const { state } = readSlice(ctx.root, ctx.cfg, slice);
  const rank = STATES.indexOf(state);
  if (!(rank >= DRAFT_PR)) return at(`slice ${slice} is ${state}; open the pull request through /slicekit build`);
  if (rank >= MERGED) return at(`slice ${slice} is ${state}; a change after merge needs its own slice`);
  return [];
}

export default { id, blocking, ratchet, run };
