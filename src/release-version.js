// The version a sync pull request sets (05 REQ-5.5, D-90, P5/S-48). With `release.auto` true in
// config, the sync step after a merge sets package.json's version and adds CHANGELOG.md's newest
// section for it: the patch number up by one for the slice merges the sync records, or the minor
// number up by one (patch 0) when a merge it records leaves every slice of that slice's phase
// `merged` or `released`. One version per sync, however many merges it records; its section names
// every one of them. A merge that changes package.json's version itself, with that version's
// CHANGELOG.md section (the release slice's own, or a sync pull request's), a merge that records no
// slice merge (a [plan], [sync] or [release] merge), and a config without `release.auto` set none. The version counts from package.json at the merge commit, never from one
// an open sync pull request proposes. The rendered files follow the version (`update --yes`), as
// `build render` would commit them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, releaseAutoError } from './config.js';
import { GitError, git } from './git.js';
import { readText, writeText } from './fs.js';
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

// The version field of package.json at `rev`, or null when the commit holds none.
function versionAt(root, rev) {
  let text;
  try {
    text = git(root, ['show', `${rev}:${PACKAGE}`]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
  try {
    const v = JSON.parse(text).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

// The versions CHANGELOG.md's `## ` headings name at `rev`, newest first; [] when it holds none.
function changelogVersionsAt(root, rev) {
  let text;
  try {
    text = git(root, ['show', `${rev}:${CHANGELOG}`]);
  } catch (e) {
    if (e instanceof GitError) return [];
    throw e;
  }
  return text.split('\n').filter((l) => /^## /.test(l)).map((l) => l.replace(/^## /, '').split(/\s/)[0]);
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

// What the sync after `merge` sets, given the slice changes syncFromHost made: { version, section }
// or null (see the header). Reads the slice states on disk, so it runs after the sync.
export function releaseFor(root, cfg, changes, { merge = 'HEAD' } = {}) {
  const bad = releaseAutoError(cfg);
  if (bad) throw new ConfigError([bad]);
  if (cfg.release?.auto !== true) return null;
  if (!Array.isArray(changes) || changes.length === 0) return null;
  if (!fs.existsSync(path.join(root, PACKAGE))) return null;
  const current = versionAt(root, merge);
  if (current === null) return null;
  // A first commit, or a merge that sets the version itself: no version from the sync. A merge sets
  // it itself when it changes package.json's version and CHANGELOG.md at the merge already holds
  // that version's section (the release slice's merge, or a sync pull request's).
  const before = versionAt(root, `${merge}^1`);
  if (before === null) return null;
  if (before !== current && changelogVersionsAt(root, merge).includes(current)) return null;
  const all = findSliceFiles(root, cfg).map((f) => {
    const s = parseSliceFile(readText(f.path), f.path);
    const st = readSlice(root, cfg, s.id);
    return { id: s.id, name: s.name, phase: f.phaseId, phaseDir: f.phaseDir, state: st.state, pr: st.pr?.number ?? null };
  });
  const byId = new Map(all.map((s) => [s.id, s]));
  const merges = changes.map((c) => ({ id: c.id, name: byId.get(c.id)?.name ?? '', pr: c.pr, phase: byId.get(c.id)?.phase }));
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

// Writes what releaseFor computed: package.json's version, the changelog section, and the render at
// that version (the kit's own checkout) or at the running kit's version (any other). `isKit` says
// which; it defaults to whether `root` is the kit's checkout. Returns the release or null.
export function applyRelease(root, cfg, changes, { merge = 'HEAD', isKit = isKitRoot(root) } = {}) {
  const release = releaseFor(root, cfg, changes, { merge });
  if (release === null) return null;
  const pkg = path.join(root, PACKAGE);
  writeText(pkg, setVersion(readText(pkg), release.version));
  const log = path.join(root, CHANGELOG);
  writeText(log, prependSection(fs.existsSync(log) ? readText(log) : null, release.section));
  const version = isKit ? release.version : kitVersion();
  applyUpdate(root, cfg, planUpdate(root, cfg, { version }), { version });
  return release;
}
