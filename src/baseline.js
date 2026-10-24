import fs from 'node:fs';
import path from 'node:path';

// Stub for S-04 Task 1; Task 2 replaces it with the real baseline module at this same path.
// Returns { [rule]: { [bucket]: count } } from `.slicekit/baselines/<rule>.json`. A rule with no
// file, or a file that is not a JSON object, has the baseline {}: every bucket at zero, the
// strictest reading, so a damaged baseline can only make the gate fail, never pass.
export function readBaselines(root) {
  const dir = path.join(root, '.slicekit', 'baselines');
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      data = {};
    }
    out[name.slice(0, -'.json'.length)] = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {};
  }
  return out;
}
