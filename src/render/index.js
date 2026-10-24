import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, readText, writeText } from '../fs.js';
import { entriesForShape } from './manifest.js';
import { extractManaged, markerStyle, replaceManaged, wrapManaged } from './managed.js';
import { mergeSettings, readSettings } from './settings.js';

const TEMPLATES = fileURLToPath(new URL('../../templates/claude-code/', import.meta.url));
const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url));
const SETTINGS = '.claude/settings.json';
const RENDERED = '.slicekit/rendered';

export function kitVersion() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version;
}

function substitute(text, vars) {
  return text.replace(/\{\{(version|name|docsRoot|cli)\}\}/g, (_, key) => vars[key]);
}

// The version slicekit last wrote: settings.json says so, else the newest reference directory.
function installedVersion(renderedRoot, settings) {
  const recorded = settings?._slicekit?.version;
  if (typeof recorded === 'string' && recorded !== '') return recorded;
  if (!exists(renderedRoot)) return null;
  const dirs = fs.readdirSync(renderedRoot).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return dirs.length > 0 ? dirs[dirs.length - 1] : null;
}

export function renderAll(root, cfg, { version }) {
  const vars = { version, name: cfg.name, docsRoot: cfg.docsRoot, cli: cfg.cli };
  const settingsFile = path.join(root, SETTINGS);
  // Read first so an invalid settings.json stops the run before anything is written.
  const existingSettings = readSettings(root);
  const renderedRoot = path.join(root, RENDERED);
  const installed = installedVersion(renderedRoot, existingSettings);

  const results = [];
  const copies = [];
  for (const { src, dest } of entriesForShape(cfg.shape)) {
    const rendered = substitute(readText(path.join(TEMPLATES, src)), vars);
    const style = markerStyle(dest, rendered);
    const fresh = wrapManaged(rendered, { version, style });
    const file = path.join(root, dest);
    let next = fresh;
    let action = 'created';
    if (exists(file)) {
      const current = readText(file);
      if (!extractManaged(current, style)) {
        results.push({
          dest,
          action: 'skipped',
          warning: `${dest} exists and is not managed by slicekit; left untouched`,
        });
        continue;
      }
      const refFile = installed === null ? null : path.join(renderedRoot, installed, dest);
      if (refFile !== null && exists(refFile) && readText(refFile) !== current) {
        results.push({
          dest,
          action: 'skipped',
          warning: `${dest} was edited since slicekit wrote it; left untouched (slicekit update --force overwrites)`,
        });
        // Carry the old reference forward so the edit is still seen next time.
        copies.push([dest, readText(refFile)]);
        continue;
      }
      next =style === 'json' || style === 'frontmatter' ? fresh : replaceManaged(current, fresh.split('\n').slice(1, -2).join('\n'), { version, style });
      action = next === current ? 'unchanged' : 'updated';
    }
    if (action !== 'unchanged') writeText(file, next);
    results.push({ dest, action });
    copies.push([dest, next]);
  }

  const hooks = JSON.parse(substitute(readText(path.join(TEMPLATES, 'hooks.json')), vars));
  const merged = `${JSON.stringify(mergeSettings(existingSettings, hooks, { version, cli: cfg.cli }), null, 2)}\n`;
  const before = exists(settingsFile) ? readText(settingsFile) : null;
  if (merged !== before) writeText(settingsFile, merged);
  results.push({ dest: SETTINGS, action: before === null ? 'created' : merged === before ? 'unchanged' : 'updated' });

  if (exists(renderedRoot)) {
    for (const entry of fs.readdirSync(renderedRoot)) {
      if (entry !== version) fs.rmSync(path.join(renderedRoot, entry), { recursive: true, force: true });
    }
  }
  for (const [dest, text] of copies) writeText(path.join(renderedRoot, version, dest), text);
  return results;
}
