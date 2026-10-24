import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { entriesForShape } from './manifest.js';
import { TEMPLATES } from './entry.js';
import { applyUpdate, planUpdate } from './update.js';

export { installedVersion, loadReference, substitute, TEMPLATES, SETTINGS, RENDERED } from './entry.js';

const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url));

export function kitVersion() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version;
}

// Plan, then apply with the rules slicekit update uses: a missing or changed file is written, a drifted
// one only with force. opts.entries and opts.templates render from another manifest; a template root
// without hooks.json renders files only (opts.settings: true forces the settings merge).
export function renderAll(root, cfg, { version, force = false, entries = entriesForShape(cfg.shape), templates = TEMPLATES, settings }) {
  const plan = planUpdate(root, cfg, { version, entries, templates, settings });
  const { written, skipped } = applyUpdate(root, cfg, plan, { version, force });
  return plan.map(({ dest, status }) => {
    const skip = skipped.find((s) => s.dest === dest);
    if (skip) return { dest, action: 'skipped', warning: skip.warning };
    if (!written.includes(dest)) return { dest, action: 'unchanged' };
    return { dest, action: status === 'missing' ? 'created' : 'updated' };
  });
}
