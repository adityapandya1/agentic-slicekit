// `slicekit release P<n>` (02 REQ-2.9, D-12, D-54, D-55): the release record of a phase. It refuses
// while a slice of the phase is not merged or fails the runbook judgement, and otherwise writes
// `<docsRoot>/releases/P<n>.md`, sets each slice released and rewrites BUILD.md. It commits nothing
// (D-19: the procedure opens the `[release] P<n>` pull request through `pr open`) and deploys
// nothing (D-12). The record is the same bytes from the same inputs: the default branch's commit,
// the slice files, the spec, decisions.md, the runbook and what the git host says of each pull request.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readDecisions } from './decisions.js';
import { exists, readText, writeText } from './fs.js';
import { commitExists, currentBranch, git } from './git.js';
import { stateFileName } from './ids.js';
import { headings, lines } from './markdown.js';
import { kitPaths } from './paths.js';
import { getSection } from './prbody.js';
import { defaultRef, mergeBase, runbookRel, runbookSections, runbookVerdict } from './runbook.js';
import { findSliceFiles, parsePhaseFile, parseSliceFile, phaseOfDir } from './slicefile.js';
import { reqBlocks } from './stage.js';
import { renderBuild } from './state/build.js';
import { readSlice, setState } from './state/index.js';

// code 1: refused; code 2: usage, or a phase that is not one.
export class ReleaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReleaseError';
    this.code = code;
  }
}

const PHASE = /^P[1-9]\d*$/;
const RELEASE_BRANCH = /^release\/[a-z0-9][a-z0-9-]{0,59}$/;
const posix = (root, file) => path.relative(root, file).split(path.sep).join('/');

// The slices of the phase, in slice order: [{slice, state, phaseDir}].
function phaseSlices(root, cfg, phase) {
  if (!PHASE.test(String(phase))) throw new ReleaseError(2, `${phase} is not a phase`);
  const files = findSliceFiles(root, cfg).filter((f) => f.phaseId === phase);
  if (files.length === 0) throw new ReleaseError(2, `${phase} is not a phase`);
  return files.map((f) => {
    const slice = parseSliceFile(readText(f.path), f.path);
    return { slice, state: readSlice(root, cfg, slice.id), phaseDir: f.phaseDir };
  });
}

// The commit a merged head left the default branch at. Once a merge commit has brought the head
// into the default branch, the merge base of the two is the head itself; the base is then the merge
// base of the head and the first parent of the commit that brought it in. A head that was
// fast-forwarded or rebased in has no such parent, and its base stays the head.
// A state written by backfill records the merge commit itself as the head: the head is then a
// commit of the default branch's own line with two parents, and what it brought is the diff from
// its first parent.
function baseOfMerged(root, cfg, head) {
  const base = mergeBase(root, cfg, head);
  const full = git(root, ['rev-parse', '--verify', `${head}^{commit}`]);
  if (base !== full) return base;
  const parentsOf = (sha) => git(root, ['rev-list', '--parents', '-n', '1', sha]).split(' ').slice(1);
  const later = git(root, ['rev-list', '--first-parent', '--ancestry-path', `${full}..${defaultRef(root, cfg)}`]);
  const merge = later === '' ? null : later.split('\n').at(-1);
  const parents = merge ? parentsOf(merge) : [];
  if (!merge || parents[0] === full) {
    const own = parentsOf(full);
    return own.length >= 2 ? own[0] : base;
  }
  if (parents.length < 2) return base;
  return git(root, ['merge-base', parents[0], full]);
}

// What stops the release, one line per slice, in slice order; [] when nothing does.
export function releaseBlockers(root, cfg, phase, host) {
  const rel = runbookRel(root, cfg);
  const out = [];
  for (const { slice, state } of phaseSlices(root, cfg, phase)) {
    const id = slice.id;
    if (state.state !== 'merged') {
      out.push(`${id} is ${state.state}, not merged`);
      continue;
    }
    const n = state.pr?.number;
    if (!Number.isInteger(n)) {
      out.push(`${id} has no recorded pull request`);
      continue;
    }
    if (!slice.runbook) continue;
    // D-55: the body first, read through the host; else the diff to the recorded head.
    const body = host.getPullRequest(n).body ?? '';
    if (runbookVerdict({ flag: true, sections: [], body, rel }) === null) continue;
    const head = state.pr.headSha;
    if (typeof head !== 'string' || !/^[0-9a-f]{7,40}$/.test(head) || !commitExists(root, head)) {
      out.push(`${id}: commit ${String(head ?? 'unknown').slice(0, 7)} of #${n} is not here; fetch it or give the pull request body a Runbook line`);
      continue;
    }
    const sections = runbookSections(root, rel, baseOfMerged(root, cfg, head), head);
    const message = runbookVerdict({ flag: true, sections, body, rel });
    if (message !== null) out.push(`${id} (#${n}): ${message}`);
  }
  return out;
}

// `REQ-3.10` before `REQ-10.1`, `D-9` before `D-10`: by each number in the ID.
const numbers = (id) => (id.match(/\d+/g) ?? []).map(Number);
function byNumbers(a, b) {
  const x = numbers(a);
  const y = numbers(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d !== 0) return d;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

// The phase's name: the phase file's `# Phase <n> — <name>` heading, else the directory's name.
function phaseTitle(phase, phaseDir) {
  const own = `${phase}.md`;
  const candidates = fs
    .readdirSync(phaseDir)
    .filter((f) => f.endsWith('.md') && !/^S-\d+/.test(f))
    .sort((a, b) => (a === own ? -1 : b === own ? 1 : a < b ? -1 : a > b ? 1 : 0));
  for (const f of candidates) {
    const parsed = parsePhaseFile(readText(path.join(phaseDir, f)));
    if (parsed && parsed.id === phase) return parsed.name;
  }
  return phaseOfDir(path.basename(phaseDir))?.name ?? phase;
}

// REQ id -> its heading's text after the ID.
function reqTitles(root, cfg) {
  const out = new Map();
  const texts = new Map();
  for (const b of reqBlocks(root, cfg)) {
    if (out.has(b.id)) continue;
    if (!texts.has(b.file)) texts.set(b.file, lines(readText(path.join(root, ...b.file.split('/')))));
    const heading = (texts.get(b.file)[b.line - 1] ?? '').replace(/^#+\s*/, '').replace(/\s*#*\s*$/, '');
    out.set(b.id, heading.startsWith(b.id) ? heading.slice(b.id.length).trim() : '');
  }
  return out;
}

// The runbook's `## Rollback` section, quoted with its file and line.
function rollbackLines(root, cfg) {
  const file = kitPaths(root, cfg).runbook;
  const rel = runbookRel(root, cfg);
  const text = exists(file) ? readText(file) : '';
  const hs = headings(text);
  const i = hs.findIndex((h) => h.level === 2 && h.text === 'Rollback');
  if (i === -1) return ['The runbook has no ## Rollback section.'];
  const all = lines(text);
  const next = hs.slice(i + 1).find((h) => h.level <= 2);
  const body = all.slice(hs[i].line, next ? next.line - 1 : all.length);
  while (body.length > 0 && body[0].trim() === '') body.shift();
  while (body.length > 0 && body.at(-1).trim() === '') body.pop();
  return [`From ${rel}:${hs[i].line}:`, '', ...body.map((l) => (l.trim() === '' ? '>' : `> ${l.trimEnd()}`))];
}

// The record's text: LF endings, one newline at the end. `sha` is the default branch's commit.
export function renderRelease(root, cfg, phase, { host, sha }) {
  const slices = phaseSlices(root, cfg, phase);
  const committed = new Date(Number(git(root, ['log', '-1', '--format=%ct', sha])) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out = [
    `# Release ${phase} — ${phaseTitle(phase, slices[0].phaseDir)}`,
    '',
    `Default branch: ${cfg.defaultBranch} at ${sha}, committed ${committed}.`,
  ];

  const titles = reqTitles(root, cfg);
  const reqs = new Map();
  for (const { slice } of slices) {
    for (const r of slice.requirements) {
      if (!reqs.has(r)) reqs.set(r, []);
      if (!reqs.get(r).includes(slice.id)) reqs.get(r).push(slice.id);
    }
  }
  out.push('', '## Requirements delivered', '');
  for (const r of [...reqs.keys()].sort(byNumbers)) out.push(`- ${[r, titles.get(r)].filter(Boolean).join(' ')} (${reqs.get(r).join(', ')})`);
  if (reqs.size === 0) out.push('None.');

  // Each pull request as the host has it; the state file's record where the host leaves a field out.
  const prs = new Map();
  for (const { state } of slices) {
    const n = state.pr?.number;
    if (!Number.isInteger(n) || prs.has(n)) continue;
    const live = host.getPullRequest(n);
    prs.set(n, {
      title: live.title ?? state.pr.title ?? '',
      url: live.url ?? state.pr.url ?? '',
      mergedAt: live.mergedAt ?? state.mergedAt ?? null,
      body: live.body ?? '',
    });
  }
  const numbersOf = [...prs.keys()].sort((a, b) => a - b);
  out.push('', '## Pull requests', '');
  for (const n of numbersOf) {
    const p = prs.get(n);
    out.push(`- ${[`#${n}`, p.title, p.url].filter((s) => s !== '').join(' ')}${p.mergedAt ? `, merged ${p.mergedAt}` : ''}`);
  }
  if (numbersOf.length === 0) out.push('None.');

  const decisionsFile = kitPaths(root, cfg).decisions;
  const known = new Map((exists(decisionsFile) ? readDecisions(readText(decisionsFile)).rows : []).map((r) => [r.id, r]));
  const taken = new Map();
  for (const n of numbersOf) {
    for (const m of (getSection(prs.get(n).body, 'Decisions') ?? '').matchAll(/(?<![\w-])D-\d+(?!\w)/g)) {
      if (!known.has(m[0])) continue;
      if (!taken.has(m[0])) taken.set(m[0], []);
      if (!taken.get(m[0]).includes(n)) taken.get(m[0]).push(n);
    }
  }
  out.push('', '## Decisions', '');
  for (const d of [...taken.keys()].sort(byNumbers)) out.push(`- ${d} ${known.get(d).question} (${taken.get(d).map((n) => `#${n}`).join(', ')})`);
  if (taken.size === 0) out.push('None.');

  out.push('', '## Rollback', '', ...rollbackLines(root, cfg));
  return `${out.join('\n')}\n`;
}

// -> {rel, text, slices}. A record that exists refuses; one HEAD does not hold was written by an
// earlier run and not committed, and the refusal then names `--undo`. With `dryRun` nothing is written and the branch is not judged, so the
// procedure can ask before it cuts the release branch; the text is then the record a release at the
// default branch's tip would write.
export function writeRelease(root, cfg, phase, { host, dryRun = false }) {
  const slices = phaseSlices(root, cfg, phase).map(({ slice }) => slice.id);
  const tip = git(root, ['rev-parse', '--verify', `${defaultRef(root, cfg)}^{commit}`]);
  if (!dryRun) {
    const branch = currentBranch(root);
    if (!branch || !RELEASE_BRANCH.test(branch) || git(root, ['rev-parse', 'HEAD']) !== tip) {
      throw new ReleaseError(1, `release runs on a release branch at the tip of ${cfg.defaultBranch}; run slicekit branch release <slug>`);
    }
  }
  const file = path.join(kitPaths(root, cfg).releases, `${phase}.md`);
  const rel = posix(root, file);
  if (exists(file)) {
    const way = blobAtHead(root, rel) === null ? `\n${rel} is not committed; slicekit release ${phase} --undo removes it and puts the state files and BUILD.md back` : '';
    throw new ReleaseError(1, `${rel} exists; a phase is released once${way}`);
  }
  const blockers = releaseBlockers(root, cfg, phase, host);
  if (blockers.length > 0) throw new ReleaseError(1, blockers.join('\n'));
  const text = renderRelease(root, cfg, phase, { host, sha: tip });
  if (dryRun) return { rel, text, slices };

  // Through a temporary name and a rename: a reader never sees half a record. The record comes
  // first because the move to released reads it. When a later write fails, the record is removed
  // and each state file is put back as it was, so the next run is not refused by this one's remains.
  const stateDir = kitPaths(root, cfg).state;
  const before = slices.map((id) => {
    const stateFile = path.join(stateDir, stateFileName(id));
    return { stateFile, bytes: exists(stateFile) ? fs.readFileSync(stateFile) : null };
  });
  try {
    writeText(file, text);
    for (const id of slices) setState(root, cfg, id, 'released', { release: rel });
    const build = kitPaths(root, cfg).build;
    writeText(build, renderBuild(root, cfg, exists(build) ? readText(build) : ''));
  } catch (e) {
    fs.rmSync(file, { force: true });
    for (const { stateFile, bytes } of before) {
      if (bytes === null) fs.rmSync(stateFile, { force: true });
      else if (!fs.readFileSync(stateFile).equals(bytes)) fs.writeFileSync(stateFile, bytes);
    }
    throw e;
  }
  return { rel, text, slices };
}

// The bytes of `rel` in HEAD, or null when HEAD has no such file.
function blobAtHead(root, rel) {
  try {
    return execFileSync('git', ['cat-file', 'blob', `HEAD:${rel}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// `release P<n> --undo`: takes back a release that was written and not committed, so the phase can
// be released again with no git command. It removes the record and puts each state file of the phase
// and BUILD.md back as HEAD has them, in the working tree and in the index. A record HEAD holds is
// not undone: that phase is released. -> {rel}
export function undoRelease(root, cfg, phase) {
  const slices = phaseSlices(root, cfg, phase).map(({ slice }) => slice.id);
  const paths = kitPaths(root, cfg);
  const file = path.join(paths.releases, `${phase}.md`);
  const rel = posix(root, file);
  if (blobAtHead(root, rel) !== null) throw new ReleaseError(1, `${rel} exists; a phase is released once`);
  if (!exists(file)) throw new ReleaseError(1, `${rel} is not written; nothing to undo`);
  const back = [...slices.map((id) => path.join(paths.state, stateFileName(id))), paths.build];
  const rels = [rel, ...back.map((f) => posix(root, f))];
  // The index first: a pull request that failed after staging leaves these paths staged.
  git(root, ['--literal-pathspecs', 'reset', '-q', '--', ...rels]);
  for (const f of back) {
    const bytes = blobAtHead(root, posix(root, f));
    if (bytes === null) fs.rmSync(f, { force: true });
    else if (!exists(f) || !fs.readFileSync(f).equals(bytes)) fs.writeFileSync(f, bytes);
  }
  fs.rmSync(file, { force: true });
  return { rel };
}
