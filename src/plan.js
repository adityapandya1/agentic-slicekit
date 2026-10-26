// What stops `/slicekit plan` (REQ-2.5): a clarification marker anywhere in the spec, contracts and
// stack.md included, or a gap scan that is not done (REQ-1.7).
import path from 'node:path';
import { exists, listFiles, readText } from './fs.js';
import { kitPaths } from './paths.js';
import { StageError, clarificationMarkers, requireStage } from './stage.js';

// Each blocker as one line: first every marker as `<file>:<line> clarification marker: <text>`,
// files in sorted order, then the refusal of the first stage up to the gap scan that is not done.
export function planBlockers(root, cfg) {
  const dir = kitPaths(root, cfg).spec;
  const blockers = [];
  const files = exists(dir) ? listFiles(dir, { ext: '.md' }).sort() : [];
  for (const f of files) {
    const name = path.relative(root, path.join(dir, f)).split(path.sep).join('/');
    for (const m of clarificationMarkers(readText(path.join(dir, f)))) blockers.push(`${name}:${m.line} clarification marker: ${m.text}`);
  }
  try {
    requireStage(root, cfg, 'gap-scan');
  } catch (e) {
    if (!(e instanceof StageError)) throw e;
    blockers.push(e.message);
  }
  return blockers;
}
