import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SHAPES } from '../config.js';

const ROOT = fileURLToPath(new URL('../../templates/claude-code/', import.meta.url));

export function loadManifest() {
  const entries = JSON.parse(fs.readFileSync(ROOT + 'manifest.json', 'utf8'));
  if (!Array.isArray(entries)) throw new Error('manifest: must be an array');
  entries.forEach((e, i) => {
    const at = `manifest[${i}]`;
    if (typeof e?.src !== 'string' || e.src === '') throw new Error(`${at}: src must be a non-empty string`);
    if (typeof e.dest !== 'string' || e.dest === '') throw new Error(`${at}: dest must be a non-empty string`);
    if (!Array.isArray(e.shapes) || e.shapes.length === 0 || !e.shapes.every((s) => SHAPES.includes(s))) {
      throw new Error(`${at}: shapes must be a non-empty array of ${SHAPES.join(', ')}`);
    }
    if (!fs.existsSync(ROOT + e.src)) throw new Error(`${at}: src not found: ${e.src}`);
  });
  return entries;
}

export function entriesForShape(shape) {
  return loadManifest().filter((e) => e.shapes.includes(shape));
}
