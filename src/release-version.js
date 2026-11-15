// The version a sync pull request sets (05 REQ-5.5, D-90, D-92, P5/S-48, P5/S-49). With
// `release.auto` true in config, the sync step after a merge sets package.json's version and adds
// CHANGELOG.md's newest section for it: the patch number up by one, or the minor number up by one
// (patch 0) when a slice it names leaves every slice of that slice's phase `merged` or `released`.
// One version per sync; its section names every slice it versions.
//
// The changelog is the record (D-92). The slices a sync versions are the merged slices that no
// CHANGELOG.md section at the merge names, less those that began at or before the floor: the
// newest commit that set the version by hand, or the commit that turned `release.auto` on when
// there is none. So the result does not depend on which merge the sync runs on, nor on which
// slices this run of the sync moved to `merged`. A sync with no such slice, and a config without
// `release.auto`, set none. The version counts from package.json at the merge commit, never from
// one an open sync pull request proposes. The rendered files follow the version (`update --yes`),
// as `build render` would commit them.
//
// Where a slice begins: the oldest commit of the default branch's first-parent history that brings
// its state file. For a merge commit or a squash merge that is the merge itself; for a rebase merge
// it is the slice's first commit. A slice that begins at or before the floor either merged before
// the version set by hand or set that version itself: the commits of a rebase-merged slice are
// contiguous on that history, so a floor among them is that slice's own commit. Neither how the
// pull request was merged, nor a commit's subject, nor a move of a slice's recorded state plays a
// part.
//
// A version is set at the first commit of the first-parent history where package.json holds it and
// CHANGELOG.md holds its section, whichever of the two arrived first: a commit that changes the
// version followed by a commit that adds the section sets it at the second, and so does a section
// followed by the version. A version that never gets a section is not set. A heading
// `## [<version>] - <date>` is that version's section as `## <version>` is. What tells a sync's
// version from one set by hand is that section's content, read at that commit. The section is a sync's only when it holds a slice line
// and every non-empty line under its heading is a line `changelogSection` writes: a slice line,
// `- <slice ID> <name> (#<pull request>)`, or, for a minor version, a phase line. A section with
// any other line was written by hand, and its commit is a floor. A section written by hand that
// holds only lines of those shapes is taken for a sync's. That is accepted: the slices it names are
// excluded by name, and only the slices merged before it that no section names are then counted.
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

// The two lines `changelogSection` writes under a heading, each from its parts. `lineShape` builds
// the test for a line of either kind from the same two functions, so the test follows the format.
const sliceText = (id, name, pr) => `- ${id} ${name}${pr === null ? '' : ` (#${pr})`}`;
const phaseText = (number, name) => `Phase ${number}${name ? `: ${name}` : ''}.`;
const sliceLine = (s) => sliceText(s.id, s.name, Number.isInteger(s.pr) ? s.pr : null);
const phaseLine = (p) => phaseText(p.id.replace(/^P/, ''), p.name);

// A part left open in a line, and the text that may stand in its place.
const OPEN = { id: '\u0001', name: '\u0002', number: '\u0003' };
const FILLS = { [OPEN.id]: ID.sliceAddr, [OPEN.name]: '\\S.*', [OPEN.number]: '\\d+' };
function lineShape(text) {
  const literal = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${literal.replace(/[\u0001-\u0003]/g, (open) => FILLS[open])}$`);
}
const SLICE_SHAPES = [sliceText(OPEN.id, OPEN.name, null), sliceText(OPEN.id, OPEN.name, OPEN.number)].map(lineShape);
const PHASE_SHAPES = [phaseText(OPEN.number, ''), phaseText(OPEN.number, OPEN.name)].map(lineShape);
const isSliceLine = (l) => SLICE_SHAPES.some((re) => re.test(l));
const isPhaseLine = (l) => PHASE_SHAPES.some((re) => re.test(l));

// CHANGELOG.md's section for `version`: each phase it completes with all of that phase's slices,
// then every other slice merge the sync records. merges and slices: [{ id, name, pr }];
// phases: [{ id, name, slices }].
export function changelogSection({ version, merges, phases = [] }) {
  const out = [`## ${version}`, ''];
  const named = new Set();
  for (const p of phases) {
    out.push(phaseLine(p), '');
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

// The one reading of a changelog heading. A section starts at a line `## <version>` or
// `## [<version>]`, each with or without text after it (a date). `headingVersion` gives the version
// a line names, or null when the line is not a section heading.
const isHeading = (l) => /^## /.test(l);
function headingVersion(l) {
  if (!isHeading(l)) return null;
  const first = l.replace(/^## /, '').split(/\s/)[0];
  return /^\[.+\]$/.test(first) ? first.slice(1, -1) : first;
}

// The changelog with `section` on top, under the file's intro (everything before the first heading).
export function prependSection(text, section) {
  if (text === null || text === '') return `# Changelog\n\n${section}`;
  const lines = text.split('\n');
  const at = lines.findIndex(isHeading);
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

// The version field of a package.json's text, or null when it holds none.
function versionOf(text) {
  try {
    const v = JSON.parse(text)?.version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

// The lines of a changelog's sections: everything from its first heading on.
function sectionLines(text) {
  const all = (text ?? '').split('\n');
  const at = all.findIndex(isHeading);
  return at < 0 ? [] : all.slice(at);
}

// Whether a changelog's text holds the section of `version`.
const holdsSection = (text, version) => sectionLines(text).some((l) => headingVersion(l) === version);

// Whether package.json at `rev` holds `version` and CHANGELOG.md at `rev` holds its section.
const holdsVersion = (root, rev, version) => versionAt(root, rev) === version && holdsSection(textAt(root, rev, CHANGELOG), version);

// Whether a changelog section names the slice `id` (P1/S-01 does not name P1/S-011).
function namesSlice(sections, id) {
  const re = new RegExp(`(^|[^A-Za-z0-9/-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`);
  return sections.some((l) => re.test(l));
}

// Whether the commit `rev` set the version: package.json at it holds a version and CHANGELOG.md at
// it holds that version's section, and its first parent does not hold both. So the commit brought
// the version, the section, or the two together. A first commit sets none, and neither does a
// commit whose first parent has no package.json version.
function setsVersion(root, rev) {
  const now = versionAt(root, rev);
  if (now === null || !holdsVersion(root, rev, now)) return false;
  return versionAt(root, `${rev}^1`) !== null && !holdsVersion(root, `${rev}^1`, now);
}

const posix = (p) => p.split(path.sep).join('/');
const stateDir = (root, cfg) => posix(path.relative(root, kitPaths(root, cfg).state));
const nonEmpty = (out) => out.split('\n').map((l) => l.trim()).filter((l) => l !== '');

// Whether the commit `rev`, which set the version, set it by hand: CHANGELOG.md's section for that
// version, as it stands at `rev`, holds a line `changelogSection` does not write, or no slice line.
// A section of slice lines only (and, for a minor version, phase lines) is a sync's, however its
// pull request was merged and whatever the commit's subject.
function setByHand(root, rev) {
  const lines = sectionLines(textAt(root, rev, CHANGELOG));
  const version = versionAt(root, rev);
  // `rev` set the version, so CHANGELOG.md at it holds the section.
  const start = lines.findIndex((l) => headingVersion(l) === version);
  const end = lines.findIndex((l, i) => i > start && isHeading(l));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).map((l) => l.trimEnd()).filter((l) => l !== '');
  const minor = SEMVER.exec(String(version))?.[3] === '0';
  return !(body.some(isSliceLine) && body.every((l) => isSliceLine(l) || (minor && isPhaseLine(l))));
}

// The commits of `rev`'s first-parent history that changed one of `paths`, newest first.
function firstParentCommits(root, rev, paths) {
  return nonEmpty(git(root, ['log', '--first-parent', '-m', '--format=%H', rev, '--', ...paths]));
}

// The floor of D-92 at `merge`: the newest first-parent commit that set the version by hand; with
// none, the newest one that turned release.auto on (a first commit that holds it on counts). null
// when the history holds neither, and then no slice is versioned.
function floorOf(root, cfg, merge) {
  // A version is set by a commit that changes package.json or CHANGELOG.md, whichever came last.
  for (const c of firstParentCommits(root, merge, [PACKAGE, CHANGELOG])) {
    if (setsVersion(root, c) && setByHand(root, c)) return c;
  }
  const config = posix(CONFIG_PATH);
  const autoAt = (rev) => jsonAt(root, rev, config)?.release?.auto === true;
  for (const c of firstParentCommits(root, merge, [config])) {
    if (autoAt(c) && !autoAt(`${c}^1`)) return c;
  }
  return null;
}

// Where each slice begins at `merge`: Map(state file → the oldest commit of the first-parent
// history that brings it).
function sliceBegins(root, cfg, merge) {
  const out = git(root, ['-c', 'core.quotepath=off', 'log', '--first-parent', '-m', '--no-renames', '--diff-filter=A', '--name-only', '--format=%x00%H', merge, '--', stateDir(root, cfg)]);
  const begins = new Map();
  // Newest first, so the last commit seen for a file is the oldest that brings it.
  for (const chunk of out.split('\0')) {
    const [sha, ...files] = nonEmpty(chunk);
    if (!sha) continue;
    for (const f of files) begins.set(f, sha);
  }
  return begins;
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
  // Less those that began at or before the floor: merged before it, or the slice that set it.
  const after = nonEmpty(git(root, ['rev-list', '--first-parent', `${floor}..${merge}`]));
  const begins = sliceBegins(root, cfg, merge);
  const dir = stateDir(root, cfg);
  const merges = [];
  for (const s of unnamed) {
    const at = after.indexOf(begins.get(`${dir}/${stateFileName(s.id)}`));
    if (at < 0) continue;
    merges.push({ id: s.id, name: s.name, pr: s.pr, phase: s.phase, at });
  }
  // In the order they began, oldest first; the slices of one commit in the order of their files.
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
// which; it defaults to whether `root` is the kit's checkout. Returns the release, or null when
// there is none or the files on disk already hold it (a second run on the same commit).
export function applyRelease(root, cfg, { merge = 'HEAD', isKit = isKitRoot(root) } = {}) {
  const release = releaseFor(root, cfg, { merge });
  if (release === null) return null;
  const pkg = path.join(root, PACKAGE);
  const log = path.join(root, CHANGELOG);
  const pkgText = readText(pkg);
  const logText = fs.existsSync(log) ? readText(log) : null;
  // releaseFor reads the commits and this writes the files on disk. When package.json on disk holds
  // the version computed and CHANGELOG.md on disk holds its section, an earlier run on this commit
  // wrote them: this run writes nothing and sets no version.
  if (versionOf(pkgText) === release.version && holdsSection(logText, release.version)) return null;
  writeText(pkg, setVersion(pkgText, release.version));
  writeText(log, prependSection(logText, release.section));
  const version = isKit ? release.version : kitVersion();
  applyUpdate(root, cfg, planUpdate(root, cfg, { version }), { version });
  return release;
}
