import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG_PATH, ConfigError } from '../config.js';
import { exists } from '../fs.js';
import { git, GitError, isRepo } from '../git.js';
import { checkCli } from '../hook-cli.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { init, knownDefaultBranch, protect } from '../init.js';
import { kitVersion } from '../render/index.js';

const USAGE =
  'init --shape <backend|fullstack|data> [--name <n>] [--docs <dir>] [--cli <command>] [--default-branch <name>] [--test <cmd>] [--lint <cmd>] [--build <cmd>] [--e2e <cmd>] [--protect]';

const OPTIONS = {
  shape: { type: 'string' },
  cli: { type: 'string' },
  'default-branch': { type: 'string' },
  name: { type: 'string' },
  docs: { type: 'string' },
  test: { type: 'string' },
  lint: { type: 'string' },
  build: { type: 'string' },
  e2e: { type: 'string' },
  protect: { type: 'boolean' },
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
    // A new config needs a default branch the repository names, or the flag (issue #87).
    const defaultBranch =
      values['default-branch'] ?? (exists(path.join(root, CONFIG_PATH)) ? undefined : knownDefaultBranch(root));
    result = init(root, {
      name: values.name ?? path.basename(root),
      shape: values.shape,
      docsRoot: normaliseDocs(values.docs),
      commands,
      cli: values.cli,
      defaultBranch,
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
  if (result.next) io.stdout(`${result.next}\n`);
  for (const warning of result.warnings) io.stderr(`slicekit: ${warning}\n`);
  // The not-installed warning already says the hooks will fail; the --version check would repeat it.
  if (!result.cliWarned) {
    const unanswered = checkCli(result.cli, { version: kitVersion(), cwd: root });
    if (unanswered) io.stderr(`slicekit: ${unanswered}\n`);
  }
  // Only with --protect does init change a host setting (REQ-3.14).
  if (values.protect) {
    let done;
    try {
      done = protect(root, { env: io.env ?? process.env });
    } catch (e) {
      if (!(e instanceof GitHostError || e instanceof ConfigError)) throw e;
      io.stderr(`slicekit: init --protect: ${e.message}\n`);
      return 1;
    }
    if (done.set.length === 0 && done.removed.length === 0) {
      io.stdout(`host rules: ${done.branch} has every rule; nothing set\n`);
    } else {
      for (const line of done.set) io.stdout(`set ${done.branch}: ${line}\n`);
      for (const check of done.removed) io.stdout(`removed ${done.branch}: required check ${check}, which no job of the generated workflow reports\n`);
      io.stdout(`host rules: ruleset slicekit applied to ${done.branch}\n`);
    }
  }
  return 0;
}

export const initCommand = { run, usage: USAGE };
