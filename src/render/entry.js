import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, readText } from '../fs.js';
import { compareManaged } from './compare.js';
import { markerStyle, replaceManaged, wrapManaged } from './managed.js';
import { readSettings } from './settings.js';

export const TEMPLATES = fileURLToPath(new URL('../../templates/claude-code/', import.meta.url));
export const SETTINGS = '.claude/settings.json';
export const RENDERED = '.slicekit/rendered';
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export function substitute(text, vars) {
  return text.replace(/\{\{(version|name|docsRoot|cli)\}\}/g, (_, key) => vars[key]);
}

export const varsFor = (cfg, version) => ({ version, name: cfg.name, docsRoot: cfg.docsRoot, cli: cfg.cli });

// The version slicekit last wrote: settings.json says so, else the newest reference directory.
// It becomes a path segment, so anything that is not a version counts as none.
export function installedVersion(renderedRoot, settings) {
  const recorded = settings?._slicekit?.version;
  if (recorded !== undefined && recorded !== null) return typeof recorded === 'string' && VERSION_RE.test(recorded) ? recorded : null;
  if (!exists(renderedRoot)) return null;
  const dirs = fs
    .readdirSync(renderedRoot)
    .filter((d) => VERSION_RE.test(d))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return dirs.length > 0 ? dirs[dirs.length - 1] : null;
}

// The copy of dest that slicekit wrote last, or null when there is none.
export function loadReference(root, dest) {
  const renderedRoot = path.join(root, RENDERED);
  const installed = installedVersion(renderedRoot, readSettings(root));
  const refFile = installed === null ? null : path.join(renderedRoot, installed, dest);
  return refFile !== null && exists(refFile) ? readText(refFile) : null;
}

// The one place a manifest entry is rendered and judged; planUpdate and renderAll both come through here.
// next: the whole file as it would be written (null for an unmanaged file, which is never written).
export function renderEntry(root, cfg, { src, dest }, { version, templates = TEMPLATES }) {
  const rendered = substitute(readText(path.join(templates, src)), varsFor(cfg, version));
  const style = markerStyle(dest, rendered);
  const fresh = wrapManaged(rendered, { version, style });
  const file = path.join(root, dest);
  const current = exists(file) ? readText(file) : null;
  const reference = loadReference(root, dest);
  const verdict = compareManaged({ dest, current, reference, fresh, style });
  let next = null;
  if (verdict === 'missing') next = fresh;
  else if (verdict !== 'unmanaged') {
    next = style === 'json' || style === 'frontmatter' ? fresh : replaceManaged(current, fresh.split('\n').slice(1, -2).join('\n'), { version, style });
  }
  return { dest, style, fresh, current, reference, verdict, next };
}
