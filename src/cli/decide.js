import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { DecisionError, addDecision, settleDecision } from '../decisions.js';

const USAGE =
  'decide add (--type <T> --question <q> --answer <a> | --open [--type <T>] --question <q> --why <w> --recommendation <r>) [--who <w>] [--replaces D-<n>] [--interface <name> [--source <file>:<line>]]\n' +
  '  slicekit decide settle D-<n> --answer <a> [--type <T>] [--who <w>]\n' +
  '  (a value that starts with "-" goes as --answer=<text>, and so for every option)';

const ADD = ['type', 'question', 'answer', 'why', 'recommendation', 'who', 'replaces', 'interface', 'source', 'open'];
const SETTLE = ['answer', 'who', 'type'];
const OPTIONS = { ...Object.fromEntries(ADD.map((k) => [k, { type: 'string' }])), open: { type: 'boolean' } };

const usage = (io, why) => {
  io.stderr(`${why ? `slicekit: ${why}\n` : ''}usage: slicekit ${USAGE}\n`);
  return 2;
};

// Writes a decision row (REQ-1.4) and prints its ID. Exit 1 on a file problem or a settled row,
// 2 on bad usage or input.
async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true }));
  } catch (e) {
    return usage(io, e.message);
  }
  const [sub, ...rest] = positionals;
  const allowed = { add: ADD, settle: SETTLE }[sub];
  if (!allowed) return usage(io);
  const extra = Object.keys(values).filter((k) => !allowed.includes(k));
  if (extra.length > 0) return usage(io, `${sub} does not take --${extra[0]}`);
  if (sub === 'add' && (rest.length > 0 || (values.type === undefined && !values.open) || values.question === undefined)) return usage(io);
  if (sub === 'add' && values.source !== undefined && values.interface === undefined) return usage(io, '--source needs --interface');
  if (sub === 'settle' && (rest.length !== 1 || values.answer === undefined)) return usage(io);
  try {
    const cfg = loadConfig(io.cwd);
    const { interface: name, source, ...fields } = values;
    const { id } =
      sub === 'add'
        ? addDecision(io.cwd, cfg, { ...fields, ...(name !== undefined ? { iface: { name, source } } : {}) })
        : settleDecision(io.cwd, cfg, rest[0], values);
    io.stdout(`${id}\n`);
    return 0;
  } catch (e) {
    if (e instanceof DecisionError) {
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

export const decideCommand = { run, usage: USAGE, subcommands: ['add', 'settle'] };
