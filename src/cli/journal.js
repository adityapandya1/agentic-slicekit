import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { appendOnlyProblems, journalBranch, journalFile, verifyJournal } from '../journal.js';

const USAGE = 'journal verify [--against <ref>] | journal show [-n 10] [--branch <b>]';
const NO_ENTRIES = 'journal: no entries\n';

// The config when there is one; otherwise the defaults the journal needs (docsRoot, defaultBranch).
function configOf(root) {
  try {
    return loadConfig(root);
  } catch {
    return { docsRoot: 'docs', defaultBranch: 'main' };
  }
}

// `slicekit journal verify [--against <ref>]` (REQ-3.8): prints every problem and exits 1 on a broken
// chain, an unexpected entry, or a committed journal file shortened or removed since the merge base with
// <ref> (default: the default branch); 0 otherwise. Never writes.
function verify(root, args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { against: { type: 'string' } }, allowPositionals: false }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  const cfg = configOf(root);
  const r = verifyJournal(root, cfg);
  const problems = [...r.problems, ...appendOnlyProblems(root, cfg, { against: values.against })];
  if (problems.length > 0) {
    io.stdout(`${problems.map((p) => p.message).join('\n')}\n`);
    return 1;
  }
  if (r.lines === 0) {
    io.stdout(NO_ENTRIES);
    return 0;
  }
  io.stdout(`journal: ${r.lines} lines in ${r.files.length} files verified\n`);
  return 0;
}

// `slicekit journal show`: the last n lines of this clone's file for one branch (default: the current one).
function show(root, args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { n: { type: 'string', short: 'n' }, branch: { type: 'string' } }, allowPositionals: false }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  const n = values.n === undefined ? 10 : Number(values.n);
  if (!Number.isInteger(n) || n < 1) {
    io.stderr(`slicekit: -n must be a positive whole number\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  let text = '';
  try {
    const file = journalFile(root, values.branch ?? journalBranch(root));
    text = file === null ? '' : fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '');
  if (lines.length === 0) {
    io.stdout(NO_ENTRIES);
    return 0;
  }
  io.stdout(`${lines.slice(-n).join('\n')}\n`);
  return 0;
}

async function run(args, io) {
  const [sub, ...rest] = args;
  if (sub === 'verify') return verify(io.cwd, rest, io);
  if (sub === 'show') return show(io.cwd, rest, io);
  io.stderr(`usage: slicekit ${USAGE}\n`);
  return 2;
}

export const journalCommand = { run, usage: USAGE };
