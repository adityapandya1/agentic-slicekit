// Which slice `build next` takes (REQ-2.6, D-38): a `todo` slice whose earlier phases, and earlier
// Order steps of its own phase, are all merged or released, and which no worktree, local branch or
// branch on origin already holds.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from '../fs.js';
import { git, hasRemote } from '../git.js';
import { sliceFromBranch } from '../ids.js';
import { findSliceFiles, parseOrder, parsePhaseFile, parseSliceFile } from '../slicefile.js';
import { readSlice } from '../state/index.js';
import { listWorktrees } from './worktree.js';

const DONE = ['merged', 'released'];

// The phase's Order steps, each a list of groups: the phase file's `**Order:**` line, else each
// group its own step in name order. A group the line leaves out runs after the steps it names.
function steps(phaseDir, phaseId, groups) {
  const own = `${phaseId}.md`;
  const candidates = fs
    .readdirSync(phaseDir)
    .filter((f) => f.endsWith('.md') && !/^S-\d+/.test(f))
    .sort((a, b) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b)));
  let order = null;
  for (const f of candidates) {
    const text = readText(path.join(phaseDir, f));
    if (parsePhaseFile(text)?.id === phaseId) {
      order = parseOrder(text);
      break;
    }
  }
  const out = order ?? [];
  const named = new Set(out.flat());
  for (const g of [...new Set(groups)].sort()) if (!named.has(g)) out.push([g]);
  return out;
}

// Every slice in phase and slice order: { id, phase, group, file, state, step }.
function slices(root, cfg) {
  const files = findSliceFiles(root, cfg).map((f) => ({ ...f, slice: parseSliceFile(readText(f.path), f.path) }));
  const byPhase = new Map();
  for (const f of files) {
    if (!byPhase.has(f.phaseId)) byPhase.set(f.phaseId, { dir: f.phaseDir, groups: [] });
    byPhase.get(f.phaseId).groups.push(f.slice.group);
  }
  const stepsOf = new Map([...byPhase].map(([id, p]) => [id, steps(p.dir, id, p.groups)]));
  return files.map((f) => ({
    id: f.slice.id,
    phase: f.phaseId,
    phaseN: Number(f.phaseId.slice(1)),
    group: f.slice.group,
    file: f.path,
    state: readSlice(root, cfg, f.slice.id).state,
    step: stepsOf.get(f.phaseId).findIndex((s) => s.includes(f.slice.group)),
  }));
}

// The first slice `s` waits on: of an earlier phase, then of an earlier step of its own; or null.
function blocker(s, all) {
  return (
    all.find((o) => o.phaseN < s.phaseN && !DONE.includes(o.state)) ??
    all.find((o) => o.phase === s.phase && o.step < s.step && !DONE.includes(o.state)) ??
    null
  );
}

// Slice ID → where it is held: a worktree path, a local branch, or `origin/<branch>`, as the refs
// stand now (runnable fetches first).
export function heldSlices(root) {
  const held = new Map();
  for (const w of listWorktrees(root)) {
    const id = w.branch && sliceFromBranch(w.branch);
    if (id && !held.has(id)) held.set(id, w.path);
  }
  const refs = git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/slice/', 'refs/remotes/origin/slice/']);
  for (const ref of refs === '' ? [] : refs.split('\n')) {
    const local = ref.startsWith('refs/heads/');
    const branch = ref.slice(local ? 'refs/heads/'.length : 'refs/remotes/origin/'.length);
    const id = sliceFromBranch(branch);
    if (id && !held.has(id)) held.set(id, local ? branch : `origin/${branch}`);
  }
  return held;
}

function fetchOrigin(root) {
  // --prune: a slice branch deleted on origin no longer holds its slice.
  if (hasRemote(root, 'origin')) git(root, ['fetch', '-q', '--prune', 'origin']);
}

export function runnable(root, cfg) {
  fetchOrigin(root);
  const all = slices(root, cfg);
  const held = heldSlices(root);
  return all
    .filter((s) => s.state === 'todo' && !held.has(s.id) && blocker(s, all) === null)
    .map(({ id, phase, group, file }) => ({ id, phase, group, file }));
}

const line = (s, b) => `${s.id} waits on ${b.id} (${b.state})`;

export function waiting(root, cfg) {
  const all = slices(root, cfg);
  const out = [];
  for (const s of all) {
    const b = s.state === 'todo' ? blocker(s, all) : null;
    if (b) out.push(line(s, b));
  }
  return out;
}

// The waiting line of one slice, or null when nothing earlier holds it back.
export function waitingOn(root, cfg, id) {
  const all = slices(root, cfg);
  const s = all.find((o) => o.id === id);
  const b = s && s.state === 'todo' ? blocker(s, all) : null;
  return b ? line(s, b) : null;
}
