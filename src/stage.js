import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { exists, listFiles, readText } from './fs.js';
import { GitError, assertRef, git, hasCommits, isRepo } from './git.js';
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

export class StageError extends Error {
  constructor(stage, blocker) {
    super(`${stage} not done: ${blocker}; run /slicekit ${COMMANDS[stage]}`);
    this.name = 'StageError';
    this.stage = stage;
  }
}

const posix = (p) => p.split(path.sep).join('/');
const rel = (root, p) => posix(path.relative(root, p));
const filesUnder = (dir, ext) => (exists(dir) ? listFiles(dir, { ext }).map((f) => path.join(dir, f)) : []);

function intake(root, cfg) {
  const dir = kitPaths(root, cfg).intake;
  const files = filesUnder(dir).filter((f) => {
    const name = path.basename(f);
    return name !== '.keep' && !name.endsWith('.meta.json');
  });
  if (files.length === 0) return [`no snapshot under ${rel(root, dir)}/`];
  const blockers = [];
  let valid = 0;
  for (const f of files) {
    const sidecar = [`${f}.meta.json`, path.join(path.dirname(f), `${path.basename(f, path.extname(f))}.meta.json`)].find(exists);
    const name = rel(root, f);
    if (!sidecar) {
      blockers.push(`${name} has no sidecar .meta.json`);
      continue;
    }
    let want;
    try {
      want = JSON.parse(fs.readFileSync(sidecar, 'utf8')).sha256;
    } catch {
      blockers.push(`${rel(root, sidecar)} is not valid JSON`);
      continue;
    }
    const got = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    if (typeof want === 'string' && want.toLowerCase() === got) valid++;
    else blockers.push(`${name} does not match the sha256 in its sidecar`);
  }
  return valid > 0 ? [] : blockers;
}

function clarify(root, cfg) {
  const p = kitPaths(root, cfg);
  if (!exists(p.decisions)) return [`${rel(root, p.decisions)} is missing`];
  const open = new Set();
  for (const t of tables(readText(p.decisions))) {
    const type = t.header.findIndex((h) => h.toLowerCase() === 'type');
    if (type === -1) continue;
    for (const row of t.rows) if (row[type] === 'Open' && row[0]) open.add(row[0]);
  }
  const cited = new Set();
  for (const f of filesUnder(p.spec, '.md')) {
    for (const r of refs(readText(f))) if (r.kind === 'id' && open.has(r.value)) cited.add(r.value);
  }
  return [...cited].sort().map((id) => `${id} is Open and cited by the spec`);
}

// Every REQ heading in the spec, with its block of text up to the next heading of the same or a higher level.
function reqBlocks(root, cfg) {
  const out = [];
  for (const f of filesUnder(kitPaths(root, cfg).spec, '.md')) {
    const text = readText(f);
    const all = lines(text);
    const hs = headings(text);
    hs.forEach((h, i) => {
      const m = h.level >= 2 && h.level <= 3 ? new RegExp(`^(${re('req').source})\\b`).exec(h.text) : null;
      if (!m) return;
      const next = hs.slice(i + 1).find((n) => n.level <= h.level);
      out.push({ id: m[1], block: all.slice(h.line, next ? next.line - 1 : all.length).join('\n') });
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

// A directory counts as merged when nothing in it is untracked or changed and every file is on the default branch.
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
  const blockers = [];
  if (git(root, ['status', '--porcelain', '--', where]) !== '') blockers.push(`${where} has uncommitted or untracked changes`);
  for (const f of filesUnder(dir)) {
    const name = rel(root, f);
    if (git(root, ['log', '-1', '--format=%H', base, '--', name]) === '') blockers.push(`${name} is not on ${base}`);
  }
  return blockers;
}

const specReview = (root, cfg) => unmerged(root, cfg, kitPaths(root, cfg).spec, 'spec review');

function gapScan(root, cfg) {
  const file = kitPaths(root, cfg).gaps;
  if (!exists(file)) return [`${rel(root, file)} is missing`];
  const blockers = [];
  for (const t of tables(readText(file))) {
    const closed = t.header.findIndex((h) => h.toLowerCase() === 'closed by');
    if (closed === -1) continue;
    for (const row of t.rows) {
      if (row[0] && (row[closed] ?? '') === '') blockers.push(`${row[0]} is not closed`);
    }
  }
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

export function programStage(root, cfg) {
  for (const stage of STAGES) {
    const blockers = CHECKS[stage](root, cfg);
    if (blockers.length > 0) return { stage, complete: false, blockers };
  }
  return { stage: 'release', complete: true, blockers: [] };
}

// Passes when `stage` and every stage before it is complete; otherwise throws for the first one that is not.
export function requireStage(root, cfg, stage) {
  const at = STAGES.indexOf(stage);
  if (at === -1) throw new Error(`unknown stage ${stage}`);
  const now = programStage(root, cfg);
  if (STAGES.indexOf(now.stage) <= at && !now.complete) throw new StageError(now.stage, now.blockers[0]);
  return now;
}
