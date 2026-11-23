// `slicekit next` (REQ-2.16, D-104): prints the one next step on its first line and the command that
// runs it on its second. It reads files only, writes none and asks no git host; a step that is a
// person's (a merge, a publish, an Open decision row, the review budget stop) is printed for the
// person and exits 0 like any other step.
import { ConfigError, loadConfig } from '../config.js';
import { SliceFileError } from '../slicefile.js';
import { nextStep, stepLines } from '../next.js';

const USAGE = 'next';

async function run(args, io) {
  if (args.length > 0) {
    io.stderr(`slicekit: next takes no arguments\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  try {
    const step = nextStep(io.cwd, loadConfig(io.cwd));
    io.stdout(`${stepLines(step).join('\n')}\n`);
    return 0;
  } catch (e) {
    if (e instanceof ConfigError || e instanceof SliceFileError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export const nextCommand = { run, usage: USAGE };
