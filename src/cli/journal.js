import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { journalBranch, journalFile, verifyJournal } from '../journal.js';

const USAGE = 'journal verify | journal show [-n 10] [--branch <b>]';
const NO_ENTRIES = 'journal: no entries\n';

// `slicekit journal verify` (REQ-3.8): exit 1 at the first break, 0 when every file verifies or there
// is no journal. Never writes. `slicekit journal show`: the last n lines of one branch's file.
function verify(root, io) {
  const r = verifyJournal(root);
  if (!r.ok) {
    io.stdout(`${r.message}\n`);
    return 1;
  }
  if (r.lines === 0) {
    io.stdout(NO_ENTRIES);
    return 0;
  }
  io.stdout(`journal: ${r.lines} lines in ${r.files.length} files verified\n`);
  return 0;
}

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
    text = fs.readFileSync(journalFile(root, values.branch ?? journalBranch(root)), 'utf8');
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
  if (sub === 'verify' && rest.length === 0) return verify(io.cwd, io);
  if (sub === 'show') return show(io.cwd, rest, io);
  io.stderr(`usage: slicekit ${USAGE}\n`);
  return 2;
}

export const journalCommand = { run, usage: USAGE };
