// The version a sync pull request sets (05 REQ-5.5, D-90, D-92, P5/S-48, P5/S-49). With
// `release.auto` true in config, the sync step after a merge sets package.json's version and adds
// CHANGELOG.md's newest section for it: the patch number up by one, or the minor number up by one
// (patch 0) when a slice it names leaves every slice of that slice's phase `merged` or `released`.
// One version per sync; its section names every slice it versions.
//
// The changelog is the record (D-92). The slices a sync versions are the merged slices that no
// CHANGELOG.md section at the merge names, less those whose own merge set the version, less those
// merged at or before the floor: the newest merge that set the version by hand, or the commit that
// turned `release.auto` on when there is none. So the result does not depend on which merge the
// sync runs on, nor on which slices this run of the sync moved to `merged`. A sync with no such
// slice, and a config without `release.auto`, set none. The version counts from package.json at
// the merge commit, never from one an open sync pull request proposes. The rendered files follow
// the version (`update --yes`), as `build render` would commit them.
//
// A commit sets the version when it changes package.json's version and CHANGELOG.md at that commit
// holds the new version's section. What tells a sync's version from one set by hand is that
// section's content, read at that commit: a section the kit generated (`changelogSection`) holds
// slice lines, `- <slice ID> <name> (#<pull request>)`; a section written by hand holds none, and
// its commit is a floor. Neither the commit's subject, nor how the pull request was merged, nor
// whether it moves a slice's recorded state plays a part. A slice's own merge is the newest commit
// of the first-parent history that changed its state file and left it in a state before `merged`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_PATH, ConfigError, releaseAutoError } from './config.js';
import { GitError, git } from './git.js';
import { readText, writeText } from './fs.js';
import { ID, stateFileName } from './ids.js';
import { kitPaths } from './paths.js';
import { RENDERED, SETTINGS, kitVersion } from './render/index.js';
import { entriesForShape } from './render/manifest.js';
import { applyUpdate, planUpdate } from './render/update.js';
import { findSliceFiles, parsePhaseFile, parseSliceFile } from './slicefile.js';
import { readSlice } from './state/index.js';

export const PACKAGE = 'package.json';
export const CHANGELOG = 'CHANGELOG.md';
const DONE = ['merged', 'released'];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

// The kit's own checkout: in it the rendered files name the version the sync sets.
const KIT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
export const isKitRoot = (root) => real(root).toLowerCase() === real(KIT_ROOT).toLowerCase();

export class ReleaseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseError';
  }
}

// The next version: null with no merge; else the minor up (patch 0) when a phase completed, else
// the patch up. `current` must be MAJOR.MINOR.PATCH.
export function nextVersion({ current, merges, phaseComplete }) {
  if (!Array.isArray(merges) || merges.length === 0) return null;
  const m = SEMVER.exec(String(current));
  if (!m) throw new ReleaseError(`package.json's version '${current}' is not MAJOR.MINOR.PATCH`);
  const [maj, min, pat] = m.slice(1).map(Number);
  return phaseComplete ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
}

const sliceLine = (s) => `- ${s.id} ${s.name}${Number.isInteger(s.pr) ? ` (#${s.pr})` : ''}`;

// CHANGELOG.md's section for `version`: each phase it completes with all of that phase's slices,
// then every other slice merge the sync records. merges and slices: [{ id, name, pr }];
// phases: [{ id, name, slices }].
export function changelogSection({ version, merges, phases = [] }) {
  const out = [`## ${version}`, ''];
  const named = new Set();
  for (const p of phases) {
    out.push(`Phase ${p.id.replace(/^P/, '')}${p.name ? `: ${p.name}` : ''}.`, '');
    for (const s of p.slices) {
      out.push(sliceLine(s));
      named.add(s.id);
    }
    out.push('');
  }
  const rest = merges.filter((s) => !named.has(s.id));
  if (rest.length > 0) {
    for (const s of rest) out.push(sliceLine(s));
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

// The changelog with `section` on top, under the file's intro (everything before the first `## `).
export function prependSection(text, section) {
  if (text === null || text === '') return `# Changelog\n\n${section}`;
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^## /.test(l));
  if (at < 0) return `${text.replace(/\n*$/, '\n\n')}${section}`;
  return [...lines.slice(0, at), ...`${section}\n`.split('\n').slice(0, -1), ...lines.slice(at)].join('\n');
}

// package.json's text with only its top-level version field changed.
export function setVersion(text, version) {
  const next = text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  let parsed;
  try {
    parsed = JSON.parse(next);
  } catch {
    throw new ReleaseError('package.json is not valid JSON');
  }
  if (parsed.version !== version) throw new ReleaseError('package.json has no top-level "version" field to set');
  return next;
}

// The text of `file` (a POSIX path from the root) at `rev`, or null when the commit holds none.
function textAt(root, rev, file) {
  try {
    return git(root, ['show', `${rev}:${file}`]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

function jsonAt(root, rev, file) {
  const text = textAt(root, rev, file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The version field of package.json at `rev`, or null when the commit holds none.
function versionAt(root, rev) {
  const v = jsonAt(root, rev, PACKAGE)?.version;
  return typeof v === 'string' ? v : null;
}

// The lines of a changelog's `## ` sections: everything from its first `## ` heading on.
function sectionLines(text) {
  const all = (text ?? '').split('\n');
  const at = all.findIndex((l) => /^## /.test(l));
  return at < 0 ? [] : all.slice(at);
}

// The versions CHANGELOG.md's `## ` headings name at `rev`, newest first; [] when it holds none.
function changelogVersionsAt(root, rev) {
  return sectionLines(textAt(root, rev, CHANGELOG)).filter((l) => /^## /.test(l)).map((l) => l.replace(/^## /, '').split(/\s/)[0]);
}

// Whether a changelog section names the slice `id` (P1/S-01 does not name P1/S-011).
function namesSlice(sections, id) {
  const re = new RegExp(`(^|[^A-Za-z0-9/-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`);
  return sections.some((l) => re.test(l));
}

// Whether the commit `rev` set the version: it changes package.json's version from its first
// parent's, and CHANGELOG.md at it holds the new version's section. A first commit sets none.
function setsVersion(root, rev) {
  const now = versionAt(root, rev);
  if (now === null) return false;
  const before = versionAt(root, `${rev}^1`);
  return before !== null && before !== now && changelogVersionsAt(root, rev).includes(now);
}

const posix = (p) => p.split(path.sep).join('/');
const stateDir = (root, cfg) => posix(path.relative(root, kitPaths(root, cfg).state));
const nonEmpty = (out) => out.split('\n').map((l) => l.trim()).filter((l) => l !== '');

// A slice's recorded state at `rev`, or null when the commit holds no readable state file.
function stateAt(root, rev, file) {
  const stored = jsonAt(root, rev, file);
  if (stored === null || typeof stored !== 'object') return null;
  return typeof stored.state === 'string' ? stored.state : 'todo';
}

// A slice line as `changelogSection` writes it: `- <slice ID> <name>`, the pull request after it.
const SLICE_LINE = new RegExp(`^- ${ID.sliceAddr} \\S`);

// Whether the commit `rev`, which set the version, set it by hand: CHANGELOG.md's section for that
// version, as it stands at `rev`, holds no slice line. A section with one is a sync's, however its
// pull request was merged and whatever the commit's subject.
function setByHand(root, rev) {
  const lines = sectionLines(textAt(root, rev, CHANGELOG));
  const heading = (l) => /^## /.test(l);
  const version = versionAt(root, rev);
  const start = lines.findIndex((l) => heading(l) && l.replace(/^## /, '').split(/\s/)[0] === version);
  if (start < 0) return true;
  const end = lines.findIndex((l, i) => i > start && heading(l));
  return !lines.slice(start + 1, end < 0 ? undefined : end).some((l) => SLICE_LINE.test(l));
}

// The commits of `rev`'s first-parent history that changed one of `paths`, newest first.
function firstParentCommits(root, rev, paths, extra = []) {
  return nonEmpty(git(root, ['log', '--first-parent', '-m', '--format=%H', ...extra, rev, '--', ...paths]));
}

// The floor of D-92 at `merge`: the newest first-parent commit that set the version by hand; with
// none, the newest one that turned release.auto on (a first commit that holds it on counts). null
// when the history holds neither, and then no slice is versioned.
function floorOf(root, cfg, merge) {
  // -G keeps the commits whose change to package.json touches a version line.
  for (const c of firstParentCommits(root, merge, [PACKAGE], ['-G"version"'])) {
    if (setsVersion(root, c) && setByHand(root, c)) return c;
  }
  const config = posix(CONFIG_PATH);
  const autoAt = (rev) => jsonAt(root, rev, config)?.release?.auto === true;
  for (const c of firstParentCommits(root, merge, [config])) {
    if (autoAt(c) && !autoAt(`${c}^1`)) return c;
  }
  return null;
}

// The state files changed after `floor` up to `merge` on the first-parent history:
// { byFile: Map(file → the commits that changed it, newest first), order: every such commit,
// newest first }.
function stateChangesAfter(root, cfg, floor, merge) {
  const out = git(root, ['-c', 'core.quotepath=off', 'log', '--first-parent', '-m', '--no-renames', '--name-only', '--format=%x00%H', `${floor}..${merge}`, '--', stateDir(root, cfg)]);
  const byFile = new Map();
  const order = [];
  for (const chunk of out.split('\0')) {
    const [sha, ...files] = nonEmpty(chunk);
    if (!sha) continue;
    order.push(sha);
    for (const f of files) byFile.set(f, [...(byFile.get(f) ?? []), sha]);
  }
  return { byFile, order };
}

// The paths the release step may write: package.json, CHANGELOG.md and the files `update` renders.
export function releasePaths(cfg) {
  return [PACKAGE, CHANGELOG, ...new Set([...entriesForShape(cfg.shape).map((e) => e.dest), SETTINGS]), RENDERED];
}
export const isReleasePath = (cfg) => {
  const dests = new Set(releasePaths(cfg));
  return (f) => dests.has(f) || f.startsWith(`${RENDERED}/`);
};

function phaseName(phaseDir, phaseId) {
  for (const f of fs.readdirSync(phaseDir).filter((n) => n.endsWith('.md') && !/^S-\d+/.test(n)).sort()) {
    const p = parsePhaseFile(readText(path.join(phaseDir, f)));
    if (p?.id === phaseId) return p.name;
  }
  return null;
}

// What the sync on `merge` sets: { version, section } or null (see the header). Reads the slice
// states on disk, so it runs after the sync; everything else it reads from the commits up to `merge`.
export function releaseFor(root, cfg, { merge = 'HEAD' } = {}) {
  const bad = releaseAutoError(cfg);
  if (bad) throw new ConfigError([bad]);
  if (cfg.release?.auto !== true) return null;
  if (!fs.existsSync(path.join(root, PACKAGE))) return null;
  const current = versionAt(root, merge);
  if (current === null) return null;
  const all = findSliceFiles(root, cfg).map((f) => {
    const s = parseSliceFile(readText(f.path), f.path);
    const st = readSlice(root, cfg, s.id);
    return { id: s.id, name: s.name, phase: f.phaseId, phaseDir: f.phaseDir, state: st.state, pr: st.pr?.number ?? null };
  });
  // The merged slices no changelog section at the merge names.
  const sections = sectionLines(textAt(root, merge, CHANGELOG));
  const unnamed = all.filter((s) => DONE.includes(s.state) && !namesSlice(sections, s.id));
  if (unnamed.length === 0) return null;
  const floor = floorOf(root, cfg, merge);
  if (floor === null) return null;
  // Less those merged at or before the floor (no own merge after it), less those whose own merge
  // set the version.
  const { byFile, order } = stateChangesAfter(root, cfg, floor, merge);
  const dir = stateDir(root, cfg);
  const merges = [];
  for (const s of unnamed) {
    const file = `${dir}/${stateFileName(s.id)}`;
    const own = (byFile.get(file) ?? []).find((sha) => {
      const state = stateAt(root, sha, file);
      return state !== null && !DONE.includes(state);
    });
    if (own === undefined || setsVersion(root, own)) continue;
    merges.push({ id: s.id, name: s.name, pr: s.pr, phase: s.phase, at: order.indexOf(own) });
  }
  // In the order they merged, oldest first; the slices of one merge in the order of their files.
  merges.sort((x, y) => y.at - x.at);
  const phases = [];
  for (const id of [...new Set(merges.map((m) => m.phase).filter(Boolean))]) {
    const slices = all.filter((s) => s.phase === id);
    if (slices.length > 0 && slices.every((s) => DONE.includes(s.state))) {
      phases.push({ id, name: phaseName(slices[0].phaseDir, id), slices });
    }
  }
  const version = nextVersion({ current, merges, phaseComplete: phases.length > 0 });
  if (version === null) return null;
  return { version, section: changelogSection({ version, merges, phases }) };
}

// Whether HEAD is the tip of the default branch: the local branch, or origin's when the clone has
// no local one. `status --sync --write` sets a version only there (issue #142).
export function onDefaultTip(root, cfg) {
  const at = (ref) => {
    try {
      return git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    } catch (e) {
      if (e instanceof GitError) return null;
      throw e;
    }
  };
  const head = at('HEAD');
  const tip = at(`refs/heads/${cfg.defaultBranch}`) ?? at(`refs/remotes/origin/${cfg.defaultBranch}`);
  return head !== null && head === tip;
}

// Writes what releaseFor computed: package.json's version, the changelog section, and the render at
// that version (the kit's own checkout) or at the running kit's version (any other). `isKit` says
// which; it defaults to whether `root` is the kit's checkout. Returns the release or null.
export function applyRelease(root, cfg, { merge = 'HEAD', isKit = isKitRoot(root) } = {}) {
  const release = releaseFor(root, cfg, { merge });
  if (release === null) return null;
  const pkg = path.join(root, PACKAGE);
  writeText(pkg, setVersion(readText(pkg), release.version));
  const log = path.join(root, CHANGELOG);
  writeText(log, prependSection(fs.existsSync(log) ? readText(log) : null, release.section));
  const version = isKit ? release.version : kitVersion();
  applyUpdate(root, cfg, planUpdate(root, cfg, { version }), { version });
  return release;
}
