// ci-title (03 REQ-3.11, REQ-3.7): with --ci, the pull request's title begins with the slice it
// delivers, `[P<n>/S-<nn>]`, and that slice has a slice file, a state file and a state of at least
// `draft-pr` and before `merged`: a pull request opened by hand, outside the build loop, fails, and
// so does one for a slice already merged or released (a later change needs its own slice). A `[spec] `,
// `[plan] ` or `[sync] ` title is not a slice's and is exempt; a `[sync] ` title only on a `sync/<short sha>`
// branch (the head of the pull request event, or the branch of a dispatched run). Draft and closed pull requests are judged alike.
// A pull request opened by an actor in ci.botActors is exempt (D-37). Without --ci, or with no pull
// request in the event (a push), there is nothing to judge.
import fs from 'node:fs';
import path from 'node:path';
import { ID, stateFileName } from '../../ids.js';
import { readSlice } from '../../state/index.js';
import { STATES } from '../../state/transitions.js';
import { EXEMPT_TITLE, PR_FILE, SYNC_BRANCH, SYNC_TITLE, isBotAuthor, readCiEvent } from '../ci-event.js';

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
  const pr = readCiEvent(ctx.env, ctx);
  if (!pr || isBotAuthor(ctx.cfg, pr)) return [];
  const at = (message) => [{ file: PR_FILE, line: 0, message }];
  if (SYNC_TITLE.test(pr.title)) {
    const branch = pr.branch ?? (ctx.env?.GITHUB_HEAD_REF || ctx.git?.branch || null);
    if (typeof branch !== 'string' || !SYNC_BRANCH.test(branch)) return at(`a [sync] title belongs to a sync/<short sha> branch, not ${branch ?? 'an unknown branch'}`);
    return [];
  }
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
