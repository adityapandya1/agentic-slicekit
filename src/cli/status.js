import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { exists, readText, writeText } from '../fs.js';
import { kitPaths } from '../paths.js';
import { SliceFileError, findSliceFiles, parseSliceFile } from '../slicefile.js';
import { programStage } from '../stage.js';
import { renderBuild } from '../state/build.js';
import { readSlice } from '../state/index.js';

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
    if (values.sync) {
      // Task 5 wires syncFromHost here.
      io.stderr('sync: not available yet\n');
      return 2;
    }
    if (values.write) {
      const file = kitPaths(root, cfg).build;
      const before = exists(file) ? readText(file) : '';
      const after = renderBuild(root, cfg, before);
      if (after === before) {
        io.stdout('BUILD.md unchanged\n');
      } else {
        writeText(file, after);
        io.stdout('BUILD.md updated\n');
      }
      return 0;
    }
    const list = slices(root, cfg);
    if (values.json) {
      io.stdout(`${JSON.stringify({ stage: programStage(root, cfg), slices: list }, null, 2)}\n`);
      return 0;
    }
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
