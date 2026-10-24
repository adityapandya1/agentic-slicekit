// layout (03 REQ-3.7, 01 REQ-1.1, REQ-1.10): every path slicekit init lays down must exist, as the
// kind it was laid down as; and no file under .claude/ may be one the manifest ships only for
// another shape. A file under .claude/ that no manifest entry names is the team's and never a
// finding. With no .slicekit/config.json the rule is silent: there is no install to judge.
import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from '../../fs.js';
import { loadManifest } from '../../render/manifest.js';

export const id = 'layout';
export const blocking = true;
export const ratchet = false;

const CONFIG = '.slicekit/config.json';
const FILES = ['config', 'decisions', 'gaps', 'stack', 'platform', 'observability', 'runbook', 'build'];
const DIRS = ['kit', 'state', 'baselines', 'docs', 'intake', 'spec', 'contracts', 'phases', 'releases', 'githooks', 'claude'];

const toPosix = (p) => p.split(path.sep).join('/');

const kindOf = (abs) => {
  try {
    const st = fs.statSync(abs);
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other';
  } catch {
    return null;
  }
};

export function run(ctx) {
  const { root, cfg, paths } = ctx;
  if (kindOf(paths.config) !== 'file') return [];
  const out = [];
  const rel = (abs) => toPosix(path.relative(root, abs)) || '.';

  const required = [...FILES.map((k) => [k, 'file']), ...DIRS.map((k) => [k, 'dir'])];
  for (const [key, kind] of required) {
    if (kindOf(paths[key]) !== kind) {
      out.push({ file: CONFIG, line: 1, message: `${rel(paths[key])} is missing; run slicekit init` });
    }
  }

  if (kindOf(paths.claude) === 'dir') {
    const ours = new Set();
    const foreign = new Set();
    for (const e of loadManifest()) (e.shapes.includes(cfg.shape) ? ours : foreign).add(e.dest);
    for (const file of listFiles(paths.claude)) {
      const dest = `${rel(paths.claude)}/${file}`;
      if (foreign.has(dest) && !ours.has(dest)) {
        out.push({ file: dest, line: 1, message: `${dest} is not part of shape ${cfg.shape}; run slicekit update` });
      }
    }
  }
  return out;
}

export default { id, blocking, ratchet, run };
