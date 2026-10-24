import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError } from '../config.js';
import { init } from '../init.js';

const USAGE =
  'init --shape <backend|fullstack|data> [--name <n>] [--docs <dir>] [--test <cmd>] [--lint <cmd>] [--build <cmd>] [--e2e <cmd>]';

const OPTIONS = {
  shape: { type: 'string' },
  name: { type: 'string' },
  docs: { type: 'string' },
  test: { type: 'string' },
  lint: { type: 'string' },
  build: { type: 'string' },
  e2e: { type: 'string' },
};

async function run(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  if (!values.shape) {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  const commands = {};
  for (const key of ['test', 'lint', 'build', 'e2e']) {
    if (values[key] !== undefined) commands[key] = values[key];
  }
  let result;
  try {
    result = init(io.cwd, {
      name: values.name ?? path.basename(io.cwd),
      shape: values.shape,
      docsRoot: values.docs,
      commands,
    });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    io.stderr(`slicekit: ${e.message}\n`);
    return 2;
  }
  for (const rel of result.created) io.stdout(`created ${rel}\n`);
  for (const rel of result.updated) io.stdout(`updated ${rel}\n`);
  for (const rel of result.skipped) io.stdout(`skipped ${rel}\n`);
  for (const warning of result.warnings ?? []) io.stderr(`slicekit: ${warning}\n`);
  return 0;
}

export const initCommand = { run, usage: USAGE };
