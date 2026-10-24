import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG_PATH, ConfigError } from '../config.js';
import { exists } from '../fs.js';
import { git, GitError, isRepo } from '../git.js';
import { checkCli } from '../hook-cli.js';
import { init } from '../init.js';
import { kitVersion } from '../render/index.js';

const USAGE =
  'init --shape <backend|fullstack|data> [--name <n>] [--docs <dir>] [--cli <command>] [--test <cmd>] [--lint <cmd>] [--build <cmd>] [--e2e <cmd>]';

const OPTIONS = {
  shape: { type: 'string' },
  cli: { type: 'string' },
  name: { type: 'string' },
  docs: { type: 'string' },
  test: { type: 'string' },
  lint: { type: 'string' },
  build: { type: 'string' },
  e2e: { type: 'string' },
};

function samePath(a, b) {
  const norm = (p) => {
    const real = fs.realpathSync.native(path.resolve(p));
    return process.platform === 'win32' ? real.toLowerCase() : real;
  };
  return norm(a) === norm(b);
}

// A typed `docs\` or `docs/` becomes `docs`; a hand-edited config gets no such help.
const normaliseDocs = (d) => (d === undefined ? undefined : d.replace(/\\/g, '/').replace(/\/+$/, ''));

async function run(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  const root = io.cwd;
  if (isRepo(root)) {
    let top;
    try {
      top = git(root, ['rev-parse', '--show-toplevel']);
    } catch (e) {
      if (!(e instanceof GitError)) throw e;
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    if (!samePath(top, root)) {
      io.stderr(`slicekit: run slicekit init from the repository root: ${path.resolve(top)}\n`);
      return 2;
    }
  }
  if (!values.shape && !exists(path.join(root, CONFIG_PATH))) {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  const commands = {};
  for (const key of ['test', 'lint', 'build', 'e2e']) {
    if (values[key] !== undefined) commands[key] = values[key];
  }
  let result;
  try {
    result = init(root, {
      name: values.name ?? path.basename(root),
      shape: values.shape,
      docsRoot: normaliseDocs(values.docs),
      commands,
      cli: values.cli,
      env: io.env ?? process.env,
    });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    io.stderr(`slicekit: ${e.message}\n`);
    return 2;
  }
  for (const rel of result.created) io.stdout(`created ${rel}\n`);
  for (const rel of result.updated) io.stdout(`updated ${rel}\n`);
  for (const rel of result.skipped) io.stdout(`skipped ${rel}\n`);
  io.stdout(`hooks run: ${result.cli}\n`);
  for (const warning of result.warnings) io.stderr(`slicekit: ${warning}\n`);
  // The not-installed warning already says the hooks will fail; the --version check would repeat it.
  if (!result.cliWarned) {
    const unanswered = checkCli(result.cli, { version: kitVersion(), cwd: root });
    if (unanswered) io.stderr(`slicekit: ${unanswered}\n`);
  }
  return 0;
}

export const initCommand = { run, usage: USAGE };
