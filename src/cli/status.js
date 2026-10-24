import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { exists, readText, writeText } from '../fs.js';
import { kitPaths } from '../paths.js';
import { SliceFileError, findSliceFiles, parseSliceFile } from '../slicefile.js';
import { programStage } from '../stage.js';
import { renderBuild } from '../state/build.js';
import { LockError, readSlice } from '../state/index.js';
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

// The errors status reports and exits 2 on: a bad config or slice file, the host saying no, a held lock.
const expected = (e) =>
  e instanceof ConfigError || e instanceof SliceFileError || e instanceof GitHostError || e instanceof LockError;

// Under --json, stdout carries exactly one JSON document on every path:
//   success  { stage, slices, synced (with --sync), warnings, build (with --write) }
//   failure  { error, synced, warnings }, exit 2
// Without --json, changes go to stdout and warnings and errors to stderr.
async function run(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  const root = io.cwd;
  const warnings = [];
  const synced = [];
  const warn = (w) => {
    warnings.push(w);
    if (!values.json) io.stderr(`slicekit: ${w}\n`);
  };
  const record = ({ changes, warnings: ws }) => {
    for (const c of changes) {
      synced.push(c);
      if (!values.json) io.stdout(`synced ${c.id} → ${c.to} (PR #${c.pr})\n`);
    }
    for (const w of ws) warn(w);
  };
  try {
    const cfg = loadConfig(root);
    if (values.sync) {
      let result;
      try {
        result = syncFromHost(root, cfg, getHost(cfg, io.env ?? process.env, root));
      } catch (e) {
        // Whatever stopped the sync, every change already on disk is reported first.
        if (e?.partial) record(e.partial);
        throw e;
      }
      record(result);
    }
    let build;
    if (values.write) {
      const file = kitPaths(root, cfg).build;
      const before = exists(file) ? readText(file) : '';
      const after = renderBuild(root, cfg, before, { onWarning: warn });
      build = after === before ? 'unchanged' : 'updated';
      if (build === 'updated') writeText(file, after);
    }
    if (values.json) {
      const out = {
        stage: programStage(root, cfg),
        slices: slices(root, cfg),
        ...(values.sync ? { synced } : {}),
        warnings,
        ...(build ? { build } : {}),
      };
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
    if (values.json) io.stdout(`${JSON.stringify({ error: e.message, synced, warnings }, null, 2)}\n`);
    if (expected(e)) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export const statusCommand = { run, usage: USAGE };
