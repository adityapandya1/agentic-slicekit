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

// hooks.json parsed first, then {{…}} filled inside each string, so a quote or backslash in a value
// (a Windows path in cli) stays a string and never breaks the JSON.
export function loadHooks(templates, vars) {
  const fill = (v) =>
    typeof v === 'string'
      ? substitute(v, vars)
      : Array.isArray(v)
        ? v.map(fill)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
          : v;
  return fill(JSON.parse(readText(path.join(templates, 'hooks.json'))));
}

// Semver precedence: major.minor.patch numerically; a prerelease sorts before its release; prerelease
// identifiers compare numerically when numeric, numeric before alphanumeric, a shorter set first.
export function compareVersions(a, b) {
  const split = (v) => {
    const cut = v.indexOf('-');
    const core = cut === -1 ? v : v.slice(0, cut);
    return { core: core.split('.').map(Number), pre: cut === -1 ? null : v.slice(cut + 1).split('.') };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (x.pre === null || y.pre === null) return (x.pre === null) - (y.pre === null);
  const num = /^\d+$/;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (num.test(p) && num.test(q)) return Number(p) - Number(q);
    if (num.test(p)) return -1;
    if (num.test(q)) return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

// The version whose reference copies slicekit holds: the one settings.json records if its directory
// exists, else the newest directory by semver. It becomes a path segment, so only version-shaped names count.
export function installedVersion(renderedRoot, settings) {
  if (!exists(renderedRoot)) return null;
  const recorded = settings?._slicekit?.version;
  if (typeof recorded === 'string' && VERSION_RE.test(recorded) && exists(path.join(renderedRoot, recorded))) return recorded;
  const dirs = fs
    .readdirSync(renderedRoot)
    .filter((d) => VERSION_RE.test(d))
    .sort(compareVersions);
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
  const verdict = compareManaged({ current, reference, fresh, style });
  let next = null;
  if (verdict === 'missing') next = fresh;
  else if (verdict !== 'unmanaged') {
    next = style === 'json' || style === 'frontmatter' ? fresh : replaceManaged(current, fresh.split('\n').slice(1, -2).join('\n'), { version, style });
  }
  return { dest, style, fresh, current, reference, verdict, next };
}
