// `slicekit brief start | ask | answer | done` (REQ-2.15, D-99): the brief interview. `start` prints
// the brief's path, `ask` prints `question <n>`, `answer` the brief's path, and `done` the path it
// committed and then, as its last line, the intake command that takes the brief as its source.
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { BriefError, answer, ask, done, start } from '../brief.js';
import { GitError } from '../git.js';

const SUBCOMMANDS = ['start', 'ask', 'answer', 'done'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const USAGE =
  'brief start <slug>\n' +
  '  brief ask --topic <problem|today|use-cases|out-of-scope|success-measures|constraints|unknowns> --question <q>\n' +
  '  brief answer (--answer <a> | --unknown)\n' +
  '  brief done';

const SPEC = {
  start: { options: [], positionals: 1 },
  ask: { options: ['topic', 'question'], positionals: 0 },
  answer: { options: ['answer', 'unknown'], positionals: 0 },
  done: { options: [], positionals: 0 },
};
const OPTIONS = { topic: { type: 'string' }, question: { type: 'string' }, answer: { type: 'string' }, unknown: { type: 'boolean' } };

const usage = (io, why) => {
  io.stderr(`${why ? `slicekit: ${why}\n` : ''}usage: slicekit ${USAGE}\n`);
  return 2;
};

// SLICEKIT_NOW is for tests only: it fixes the instant the session records as its start.
function clock(io) {
  const fixed = (io.env ?? process.env).SLICEKIT_NOW;
  if (fixed === undefined || fixed === '') return new Date();
  const now = new Date(fixed);
  return ISO.test(fixed) && !Number.isNaN(now.getTime()) ? now : null;
}

function perform(sub, root, cfg, values, rest, now, io) {
  if (sub === 'start') {
    io.stdout(`${start(root, cfg, { slug: rest[0], now }).file}\n`);
  } else if (sub === 'ask') {
    io.stdout(`question ${ask(root, cfg, { topic: values.topic, question: values.question }).n}\n`);
  } else if (sub === 'answer') {
    io.stdout(`${answer(root, cfg, { answer: values.answer, unknown: Boolean(values.unknown) }).file}\n`);
  } else {
    const { file } = done(root, cfg);
    io.stdout(`${file}\n/slicekit intake ${file}\n`);
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
  if (sub === 'ask' && (values.topic === undefined || values.question === undefined)) return usage(io);
  if (sub === 'answer' && (values.answer === undefined) === !values.unknown) return usage(io, 'answer takes one of --answer and --unknown');
  const now = clock(io);
  if (now === null) return usage(io, `SLICEKIT_NOW '${(io.env ?? process.env).SLICEKIT_NOW}' is not an ISO time`);
  const root = io.cwd;
  try {
    const cfg = loadConfig(root);
    perform(sub, root, cfg, values, rest, now, io);
    return 0;
  } catch (e) {
    if (e instanceof BriefError) {
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

export const briefCommand = { run, usage: USAGE, subcommands: SUBCOMMANDS };
