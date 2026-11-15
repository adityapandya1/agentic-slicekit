// runbook (03 REQ-3.7, D-21, D-55): on a slice branch whose slice file says `runbook: yes` and whose
// state is draft-pr or later and not merged or released, the branch changes a `##` section of the
// runbook or the pull request body's Runbook line begins "no operational change". The body comes
// from the CI event or `SLICEKIT_PR_BODY`; with neither the rule does not judge, because `build pr`
// already refuses to open a pull request without one of the two (D-55). One finding, at the slice
// file's `runbook:` line.
import path from 'node:path';
import { readText } from '../../fs.js';
import { sliceFromBranch } from '../../ids.js';
import { lines } from '../../markdown.js';
import { mergeBase, runbookRel, runbookSections, runbookVerdict } from '../../runbook.js';
import { findSliceFiles, parseSliceFile } from '../../slicefile.js';
import { readSlice } from '../../state/index.js';
import { branchTip, readCiEvent } from '../ci-event.js';

export const id = 'runbook';
export const blocking = true;
export const ratchet = false;

const JUDGED = ['draft-pr', 'in-review', 'changes-requested', 'ci-green', 'ready'];

// The slice file of `slice`: {rel, text, flag}, or null when no readable slice file names it.
function sliceFileOf(root, cfg, slice) {
  for (const f of findSliceFiles(root, cfg)) {
    let text;
    let parsed;
    try {
      text = readText(f.path);
      parsed = parseSliceFile(text, f.path);
    } catch {
      continue;
    }
    if (parsed.id === slice) return { rel: path.relative(root, f.path).split(path.sep).join('/'), text, flag: parsed.runbook };
  }
  return null;
}

export function run(ctx) {
  const { root, cfg } = ctx;
  const at = branchTip(ctx);
  if (!at) return [];
  const slice = sliceFromBranch(at.branch);
  if (!slice) return [];
  const file = sliceFileOf(root, cfg, slice);
  if (!file || !file.flag) return [];
  if (!JUDGED.includes(readSlice(root, cfg, slice).state)) return [];
  const env = ctx.env ?? {};
  const hasEvent = typeof env.GITHUB_EVENT_PATH === 'string' && env.GITHUB_EVENT_PATH !== '';
  if (!hasEvent && env.SLICEKIT_PR_BODY === undefined) return [];
  const pr = readCiEvent(env, { cfg, root });
  if (!pr) return [];
  const rel = runbookRel(root, cfg);
  const sections = runbookSections(root, rel, mergeBase(root, cfg, at.tip), at.tip);
  const message = runbookVerdict({ flag: true, sections, body: pr.body, rel });
  if (message === null) return [];
  const line = lines(file.text).findIndex((l) => /^runbook\s*:/.test(l)) + 1;
  return [{ file: file.rel, line, message }];
}

export default { id, blocking, ratchet, run };
