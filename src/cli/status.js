import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { exists, readText, writeText } from '../fs.js';
import { kitPaths } from '../paths.js';
import { SliceFileError, findSliceFiles, parseSliceFile } from '../slicefile.js';
import { programStage } from '../stage.js';
import { renderBuild } from '../state/build.js';
import { readSlice } from '../state/index.js';
import { syncFromHost } from '../state/sync.js';
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';

const USAGE = 'status [--json] [--write] [--sync]';

const OPTIONS = {
  json: { type: 'boolean' },
  write: { type: 'boolean' },
  sync: { type: 'boolean' },
};

function slices(root, cfg) {
  return findSliceFiles(root, cfg).map((f) => {
    const slice = parseSliceFile(readText(f.path), f.path);
    const state = readSlice(root, cfg, slice.id);
    return { id: slice.id, state: state.state, pr: state.pr?.number ?? null, name: slice.name, phase: f.phaseId };
  });
}

async function run(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  const root = io.cwd;
  try {
    const cfg = loadConfig(root);
    let synced;
    if (values.sync) {
      const report = ({ changes, warnings }, plain) => {
        for (const c of plain ? changes : []) io.stdout(`synced ${c.id} → ${c.to} (PR #${c.pr})\n`);
        for (const w of warnings) io.stderr(`slicekit: ${w}\n`);
      };
      let result;
      try {
        result = syncFromHost(root, cfg, getHost(cfg, io.env ?? process.env));
      } catch (e) {
        // Whatever stopped the sync, every change already on disk is reported first.
        if (e?.partial) report(e.partial, true);
        if (!(e instanceof GitHostError)) throw e;
        // The host is outside the kit: gh missing, unauthenticated, unreachable.
        io.stderr(`slicekit: ${e.message}\n`);
        return 2;
      }
      // With --json, stdout stays one JSON document; the changes ride in it as `synced`.
      report(result, !values.json);
      synced = result.changes;
    }
    let build;
    if (values.write) {
      const file = kitPaths(root, cfg).build;
      const before = exists(file) ? readText(file) : '';
      const after = renderBuild(root, cfg, before);
      build = after === before ? 'unchanged' : 'updated';
      if (build === 'updated') writeText(file, after);
    }
    if (values.json) {
      // With --write the result rides in the JSON as `build`, so stdout stays one JSON document.
      const out = { stage: programStage(root, cfg), slices: slices(root, cfg), ...(build ? { build } : {}), ...(synced ? { synced } : {}) };
      io.stdout(`${JSON.stringify(out, null, 2)}\n`);
      return 0;
    }
    if (build) {
      io.stdout(`BUILD.md ${build}\n`);
      return 0;
    }
    const list = slices(root, cfg);
    for (const s of list) io.stdout(`${s.id}  ${s.state}  PR ${s.pr === null ? '-' : `#${s.pr}`}  ${s.name}\n`);
    return 0;
  } catch (e) {
    if (e instanceof ConfigError || e instanceof SliceFileError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export const statusCommand = { run, usage: USAGE };
