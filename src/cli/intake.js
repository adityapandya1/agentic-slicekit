// `slicekit intake snapshot <file|url>` (REQ-1.2): prints the snapshot's path relative to root.
// `ask`, `answer` and `done` (REQ-2.2) hold the interview: `ask` prints `question <n>`, `answer`
// the D-ID it wrote, `done` one `open: <D-ID> <question>` line per open row, or `open: none`.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { DecisionError } from '../decisions.js';
import { GitError } from '../git.js';
import { IntakeError, answer, ask, done, snapshot } from '../intake.js';

const SUBCOMMANDS = ['snapshot', 'ask', 'answer', 'done'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const USAGE =
  'intake snapshot <file|url> [--slug <s>] [--who <w>]\n' +
  '  slicekit intake ask --pass <product|platform> --topic <t> --question <q>\n' +
  '  slicekit intake answer (--answer <a> [--type <T>] | --open --why <w> --recommendation <r>) [--who <w>] [--interface <name> [--source <file>:<line>]]\n' +
  '  slicekit intake done';

// The options each subcommand takes, and the positionals it wants after its name.
const SPEC = {
  snapshot: { options: ['slug', 'who'], positionals: 1 },
  ask: { options: ['pass', 'topic', 'question'], positionals: 0 },
  answer: { options: ['answer', 'type', 'open', 'why', 'recommendation', 'who', 'interface', 'source'], positionals: 0 },
  done: { options: [], positionals: 0 },
};
const STRINGS = ['slug', 'who', 'pass', 'topic', 'question', 'answer', 'type', 'why', 'recommendation', 'interface', 'source'];
const OPTIONS = { ...Object.fromEntries(STRINGS.map((k) => [k, { type: 'string' }])), open: { type: 'boolean' } };

const usage = (io, why) => {
  io.stderr(`${why ? `slicekit: ${why}\n` : ''}usage: slicekit ${USAGE}\n`);
  return 2;
};

// SLICEKIT_NOW is for tests only: it fixes the instant a snapshot is named and stamped with, and
// the date on a decision row.
function clock(io) {
  const fixed = (io.env ?? process.env).SLICEKIT_NOW;
  if (fixed === undefined || fixed === '') return new Date();
  const now = new Date(fixed);
  return ISO.test(fixed) && !Number.isNaN(now.getTime()) ? now : null;
}

async function perform(sub, root, cfg, values, rest, now, io) {
  if (sub === 'snapshot') {
    const { file } = await snapshot(root, cfg, rest[0], { slug: values.slug, who: values.who, now });
    io.stdout(`${path.relative(root, file).split(path.sep).join('/')}\n`);
  } else if (sub === 'ask') {
    const { n } = ask(root, cfg, { pass: values.pass, topic: values.topic, question: values.question, now });
    io.stdout(`question ${n}\n`);
  } else if (sub === 'answer') {
    const { interface: name, source, ...fields } = values;
    const { id } = answer(root, cfg, { ...fields, open: Boolean(values.open), ...(name !== undefined ? { iface: { name, source } } : {}), now });
    io.stdout(`${id}\n`);
  } else {
    const { open } = done(root, cfg);
    io.stdout(open.length === 0 ? 'open: none\n' : open.map((r) => `open: ${r.id} ${r.question}\n`).join(''));
  }
}

async function run(args, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true }));
  } catch (e) {
    return usage(io, e.message);
  }
  const [sub, ...rest] = positionals;
  const spec = Object.hasOwn(SPEC, sub ?? '') ? SPEC[sub] : undefined;
  if (!spec || rest.length !== spec.positionals) return usage(io);
  const extra = Object.keys(values).filter((k) => !spec.options.includes(k));
  if (extra.length > 0) return usage(io, `${sub} does not take --${extra[0]}`);
  if (sub === 'ask' && ['pass', 'topic', 'question'].some((k) => values[k] === undefined)) return usage(io);
  if (sub === 'answer') {
    if (values.source !== undefined && values.interface === undefined) return usage(io, '--source needs --interface');
    if (!values.open && (values.why !== undefined || values.recommendation !== undefined)) {
      return usage(io, '--why and --recommendation go with --open');
    }
    if (values.open ? values.answer !== undefined || values.why === undefined || values.recommendation === undefined : values.answer === undefined) {
      return usage(io);
    }
  }
  const now = clock(io);
  if (now === null) return usage(io, `SLICEKIT_NOW '${(io.env ?? process.env).SLICEKIT_NOW}' is not an ISO time`);
  const root = io.cwd;
  try {
    const cfg = loadConfig(root);
    await perform(sub, root, cfg, values, rest, now, io);
    return 0;
  } catch (e) {
    if (e instanceof IntakeError || e instanceof DecisionError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return e.code;
    }
    if (e instanceof ConfigError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    if (e instanceof GitError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

export const intakeCommand = { run, usage: USAGE, subcommands: SUBCOMMANDS };
