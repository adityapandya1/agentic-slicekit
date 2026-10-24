import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { kitVersion } from '../render/index.js';
import { applyUpdate, planUpdate } from '../render/update.js';

const USAGE = 'update [--yes] [--check] [--force]';

const OPTIONS = {
  yes: { type: 'boolean' },
  check: { type: 'boolean' },
  force: { type: 'boolean' },
};

async function run(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false }));
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  const root = io.cwd;
  let cfg;
  try {
    cfg = loadConfig(root);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    io.stderr(`slicekit: ${e.message}\n`);
    return 2;
  }
  const version = kitVersion();
  const plan = planUpdate(root, cfg, { version });
  const pending = plan.filter((p) => p.status !== 'same');
  for (const { dest, status, diff } of pending) {
    io.stdout(`${status} ${dest}\n`);
    if (diff !== '') io.stdout(diff);
  }
  if (values.check) return pending.some((p) => p.status === 'drifted' || p.status === 'missing') ? 1 : 0;
  if (!values.yes) {
    if (pending.length > 0) io.stdout('run again with --yes to apply\n');
    return 0;
  }
  const written = applyUpdate(root, cfg, plan, { version, force: values.force === true });
  for (const dest of written) io.stdout(`wrote ${dest}\n`);
  return 0;
}

export const updateCommand = { run, usage: USAGE };
