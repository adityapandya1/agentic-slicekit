import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { exists, listFiles, readText } from './fs.js';
import { GitError, assertRef, git, hasCommits, isRepo } from './git.js';
import { readDecisions } from './decisions.js';
import { headings, lines, refs, tables } from './markdown.js';
import { re } from './ids.js';
import { kitPaths } from './paths.js';
import { findSliceFiles, parseSliceFile } from './slicefile.js';
import { listSlices } from './state/index.js';

export const STAGES = ['intake', 'clarify', 'specify', 'spec-review', 'gap-scan', 'stack', 'plan', 'build', 'release'];

// The slash command that does each stage, named in the refusal.
const COMMANDS = {
  intake: 'intake',
  clarify: 'intake (clarify)',
  specify: 'specify',
  'spec-review': 'specify (spec-review: merge the spec pull request)',
  'gap-scan': 'gaps',
  stack: 'plan (stack)',
  plan: 'plan',
  build: 'build',
  release: 'release',
};

// The display name of each stage, used in messages; the ids stay in code.
const LABELS = {
  intake: 'intake',
  clarify: 'clarify',
  specify: 'specify',
  'spec-review': 'spec review',
  'gap-scan': 'gap scan',
  stack: 'stack',
  plan: 'plan',
  build: 'build',
  release: 'release',
};

export class StageError extends Error {
  constructor(stage, blocker) {
    super(`${LABELS[stage]} not done: ${blocker}; run /slicekit ${COMMANDS[stage]}`);
    this.name = 'StageError';
    this.stage = stage;
  }
}

const posix = (p) => p.split(path.sep).join('/');
const rel = (root, p) => posix(path.relative(root, p));
const filesUnder = (dir, ext) => (exists(dir) ? listFiles(dir, { ext }).map((f) => path.join(dir, f)) : []);

// How an intake file is pinned (REQ-1.2): `frozen` when `<file>.meta.json` or `<stem>.meta.json`
// exists and its sha256 matches the file's bytes; otherwise `no-sidecar`, `bad-json` or
// `mismatch`, with the sidecar path when there is one.
export function intakePin(file) {
  const sidecar = [`${file}.meta.json`, path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.meta.json`)].find(exists);
  if (!sidecar) return { status: 'no-sidecar', sidecar: null };
  let want;
  try {
    want = JSON.parse(fs.readFileSync(sidecar, 'utf8')).sha256;
  } catch {
    return { status: 'bad-json', sidecar };
  }
  const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return { status: typeof want === 'string' && want.toLowerCase() === got ? 'frozen' : 'mismatch', sidecar };
}

// Every intake file must be pinned: one valid snapshot does not excuse another.
function intake(root, cfg) {
  const dir = kitPaths(root, cfg).intake;
  const files = filesUnder(dir).filter((f) => {
    const name = path.basename(f);
    return name !== '.keep' && !name.endsWith('.meta.json');
  });
  if (files.length === 0) return [`no snapshot under ${rel(root, dir)}/`];
  const blockers = [];
  for (const f of files) {
    const { status, sidecar } = intakePin(f);
    const name = rel(root, f);
    if (status === 'no-sidecar') blockers.push(`${name} has no sidecar .meta.json`);
    else if (status === 'bad-json') blockers.push(`${rel(root, sidecar)} is not valid JSON`);
    else if (status === 'mismatch') blockers.push(`${name} does not match the sha256 in its sidecar`);
  }
  return blockers;
}

// The Types of an open row that do not stop clarify: work only a person can do, or a fact still
// being gathered.
const PENDING_TYPES = ['Action', 'Information'];

// A row is open when it sits in the Open table, whatever its Type (REQ-1.4). An open Action or
// Information row is listed as pending. Any other open row blocks: Decision, Open, Counsel (an
// expert view not yet given), and an unknown or empty Type, so a typo never passes silently.
function clarify(root, cfg) {
  const p = kitPaths(root, cfg);
  if (!exists(p.decisions)) return [`${rel(root, p.decisions)} is missing`];
  const rows = readDecisions(readText(p.decisions)).rows.filter((r) => r.table === 'open');
  const open = new Map(rows.map((r) => [r.id, r.type]));
  const cited = new Set();
  for (const f of filesUnder(p.spec, '.md')) {
    for (const r of refs(readText(f))) if (r.kind === 'id' && open.has(r.value)) cited.add(r.value);
  }
  const ids = [...cited].sort();
  const blocks = (id) => !PENDING_TYPES.includes(open.get(id));
  return {
    blockers: ids.filter(blocks).map((id) => `${id} is Open and cited by the spec`),
    pending: ids.filter((id) => !blocks(id)).map((id) => `${id} is Open (${open.get(id)}) and cited by the spec; it does not block`),
  };
}

// Every REQ heading in the spec: its ID, its file (relative to root, forward slashes), the 1-based
// line of the heading, and the text after the heading up to the next heading of the same or a higher
// level. S-11 and S-12 report findings at `file:line`.
export function reqBlocks(root, cfg) {
  const out = [];
  for (const f of filesUnder(kitPaths(root, cfg).spec, '.md')) {
    const text = readText(f);
    const all = lines(text);
    const hs = headings(text);
    hs.forEach((h, i) => {
      const m = h.level >= 2 && h.level <= 3 ? new RegExp(`^(${re('req').source})\\b`).exec(h.text) : null;
      if (!m) return;
      const next = hs.slice(i + 1).find((n) => n.level <= h.level);
      out.push({ id: m[1], file: rel(root, f), line: h.line, block: all.slice(h.line, next ? next.line - 1 : all.length).join('\n') });
    });
  }
  return out;
}

function specify(root, cfg) {
  const reqs = reqBlocks(root, cfg);
  if (reqs.length === 0) return [`${rel(root, kitPaths(root, cfg).spec)}/ has no REQ`];
  const blockers = [];
  for (const { id, block } of reqs) {
    const missing = [];
    if (!/\bSHALL\b/.test(block)) missing.push('SHALL');
    if (!/^\s*Scenario:/m.test(block)) missing.push('Scenario:');
    if (!/^\s*Cites:/m.test(block)) missing.push('Cites:');
    if (!/^\s*Enforced by:/m.test(block)) missing.push('Enforced by:');
    if (missing.length > 0) blockers.push(`${id} lacks ${missing.join(', ')}`);
  }
  return blockers;
}

// A directory counts as merged when nothing in it is untracked or changed and its content equals the default branch's.
function unmerged(root, cfg, dir, what) {
  if (!isRepo(root)) return [`${what} needs a git repository`];
  if (!hasCommits(root)) return [`${what} needs a commit on ${cfg.defaultBranch}`];
  const base = cfg.defaultBranch;
  try {
    assertRef(base);
    git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  } catch (e) {
    if (e instanceof GitError) return [`${what} needs the default branch ${base}, which was not found`];
    throw e;
  }
  const where = rel(root, dir);
  if (git(root, ['status', '--porcelain', '--', where]) !== '') return [`${where} has uncommitted changes`];
  try {
    git(root, ['diff', '--quiet', '--end-of-options', base, '--', where]);
  } catch (e) {
    if (e instanceof GitError) return [`${where} differs from ${base}; merge the pull request`];
    throw e;
  }
  return [];
}

const specReview = (root, cfg) => unmerged(root, cfg, kitPaths(root, cfg).spec, 'spec review');

function gapScan(root, cfg) {
  const file = kitPaths(root, cfg).gaps;
  if (!exists(file)) return [`${rel(root, file)} is missing`];
  const text = readText(file);
  const blockers = [];
  let hasColumn = false;
  for (const t of tables(text)) {
    const closed = t.header.findIndex((h) => h.toLowerCase() === 'closed by');
    if (closed === -1) continue;
    hasColumn = true;
    for (const row of t.rows) {
      if (row[0] && (row[closed] ?? '') === '') blockers.push(`${row[0]} is not closed`);
    }
  }
  if (!hasColumn && re('gap', 'g').test(text)) return [`${rel(root, file)} has no Closed by column`];
  return blockers;
}

function stack(root, cfg) {
  const file = kitPaths(root, cfg).stack;
  if (!exists(file)) return [`${rel(root, file)} is missing`];
  const text = readText(file);
  if (text.includes('[NEEDS CLARIFICATION')) return [`${rel(root, file)} still has a [NEEDS CLARIFICATION marker`];
  const body = text.replace(/^#.*$/gm, '').trim();
  if (body === '' || /^not yet known\.?$/i.test(body)) return [`${rel(root, file)} says nothing is known yet`];
  return [];
}

function readSlices(root, cfg) {
  const slices = [];
  const errors = [];
  for (const f of findSliceFiles(root, cfg)) {
    try {
      slices.push(parseSliceFile(readText(f.path), f.path));
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { slices, errors };
}

function plan(root, cfg) {
  const { slices, errors } = readSlices(root, cfg);
  const named = new Set(slices.flatMap((s) => s.requirements));
  const ids = [...new Set(reqBlocks(root, cfg).map((r) => r.id))];
  const blockers = [
    ...errors,
    ...ids.filter((id) => !named.has(id)).map((id) => `${id} is named by no slice file`),
  ];
  return [...blockers, ...unmerged(root, cfg, kitPaths(root, cfg).phases, 'plan review')];
}

function build(root, cfg) {
  const { errors } = readSlices(root, cfg);
  if (errors.length > 0) return errors;
  const all = listSlices(root, cfg);
  if (all.length === 0) return ['no slice is planned'];
  return all
    .filter(({ state }) => state.state !== 'merged' && state.state !== 'released')
    .map(({ state }) => `${state.slice} is ${state.state}, not merged`);
}

function release(root, cfg) {
  const p = kitPaths(root, cfg);
  const phases = exists(p.phases)
    ? fs
        .readdirSync(p.phases, { withFileTypes: true })
        .map((d) => (d.isDirectory() ? /^P(\d+)(?:\b|[-_])/.exec(d.name) : null))
        .filter(Boolean)
        .map((m) => `P${m[1]}`)
    : [];
  if (phases.length === 0) return ['no phase is planned'];
  return [...new Set(phases)]
    .filter((id) => !exists(path.join(p.releases, `${id}.md`)))
    .map((id) => `${id} has no releases/${id}.md`);
}

const CHECKS = { intake, clarify, specify, 'spec-review': specReview, 'gap-scan': gapScan, stack, plan, build, release };

// Evaluates the stages in order and stops after `upTo` (default: all), so later stages cost nothing.
export function programStage(root, cfg, { upTo = 'release' } = {}) {
  const last = STAGES.indexOf(upTo);
  if (last === -1) throw new Error(`unknown stage ${upTo}`);
  // A check returns its blockers, or `{blockers, pending}` when it also lists rows that do not
  // block. The result carries `pending` only when something is pending.
  const pending = [];
  const result = (r) => (pending.length > 0 ? { ...r, pending } : r);
  for (const stage of STAGES.slice(0, last + 1)) {
    const out = CHECKS[stage](root, cfg);
    const blockers = Array.isArray(out) ? out : out.blockers;
    if (!Array.isArray(out)) pending.push(...out.pending);
    if (blockers.length > 0) return result({ stage, complete: false, blockers });
  }
  return result({ stage: upTo, complete: true, blockers: [] });
}

// requireStage(X) means X and every stage before it are complete; it throws for the first that is not.
export function requireStage(root, cfg, stage) {
  const now = programStage(root, cfg, { upTo: stage });
  if (!now.complete) throw new StageError(now.stage, now.blockers[0]);
  return now;
}
