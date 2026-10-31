import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { GapError, addGap, closeGap, scanGaps, verifyGaps } from '../gaps.js';

const USAGE =
  'gaps scan\n' +
  '  gaps verify\n' +
  '  gaps add --class <c> --where <file>:<line> --what <text>\n' +
  '  gaps close G-<n> (--decision D-<n> | --req <REQ>)';
// Said only on a usage error; the general help gives the same rule under its options.
const DASH = '(a value that starts with "-" goes as --what=<text>, and so for every option)';

const ALLOWED = { scan: [], verify: [], add: ['class', 'where', 'what'], close: ['decision', 'req'] };
const OPTIONS = Object.fromEntries(Object.values(ALLOWED).flat().map((k) => [k, { type: 'string' }]));

const usage = (io, why) => {
  io.stderr(`${why ? `slicekit: ${why}\n` : ''}usage: slicekit ${USAGE}\n  ${DASH}\n`);
  return 2;
};

// Scans for gaps, verifies the gaps file, or writes or closes a gap row (REQ-2.4). Exit 1 on a
// file problem, a closed row or a verify finding, 2 on bad usage, bad input or an unknown ID.
async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true }));
  } catch (e) {
    return usage(io, e.message);
  }
  const [sub, ...rest] = positionals;
  const allowed = ALLOWED[sub];
  if (!allowed) return usage(io);
  const extra = Object.keys(values).filter((k) => !allowed.includes(k));
  if (extra.length > 0) return usage(io, `${sub} does not take --${extra[0]}`);
  if ((sub === 'scan' || sub === 'verify') && rest.length > 0) return usage(io);
  if (sub === 'add' && (rest.length > 0 || allowed.some((k) => values[k] === undefined))) return usage(io);
  if (sub === 'close' && (rest.length !== 1 || (values.decision === undefined) === (values.req === undefined))) {
    return usage(io, rest.length === 1 ? 'close takes exactly one of --decision and --req' : undefined);
  }
  try {
    const cfg = loadConfig(io.cwd);
    if (sub === 'scan') {
      const added = scanGaps(io.cwd, cfg).filter((g) => g.added);
      io.stdout(added.length > 0 ? added.map((g) => `${g.id} ${g.cls} ${g.what}\n`).join('') : 'no new gaps\n');
    } else if (sub === 'verify') {
      const found = verifyGaps(io.cwd, cfg);
      if (found.length > 0) {
        io.stdout(found.map((f) => `${f.where} ${f.message}\n`).join(''));
        return 1;
      }
      io.stdout('ready: gap-scan\n');
    } else if (sub === 'add') {
      const { id } = addGap(io.cwd, cfg, { cls: values.class, where: values.where, what: values.what });
      io.stdout(`${id}\n`);
    } else {
      const { id, closedBy } = closeGap(io.cwd, cfg, rest[0], values);
      io.stdout(`${id} closed by ${closedBy}\n`);
    }
    return 0;
  } catch (e) {
    if (e instanceof GapError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return e.code;
    }
    if (e instanceof ConfigError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export const gapsCommand = { run, usage: USAGE, subcommands: ['scan', 'verify', 'add', 'close'] };
