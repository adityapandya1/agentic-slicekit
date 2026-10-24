import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { exists } from '../fs.js';
import { kitVersion, RENDERED } from '../render/index.js';
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
  const version = kitVersion();
  const force = values.force === true;
  let plan;
  let cfg;
  try {
    cfg = loadConfig(root);
    plan = planUpdate(root, cfg, { version });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    io.stderr(`slicekit: ${e.message}\n`);
    return 2;
  }
  const pending = plan.filter((p) => p.status !== 'same');
  for (const { dest, status, diff } of pending) {
    io.stdout(`${status} ${dest}\n`);
    if (diff !== '') io.stdout(diff);
  }
  if (values.check) {
    if (!exists(path.join(root, RENDERED))) io.stdout(`${RENDERED}/ is missing; commit it so drift can be told from kit changes\n`);
    return pending.some((p) => p.status === 'drifted' || p.status === 'missing') ? 1 : 0;
  }
  if (!values.yes) {
    const writes = pending.some((p) => p.status === 'changed' || p.status === 'missing' || (p.status === 'drifted' && force));
    if (writes) io.stdout('run again with --yes to apply\n');
    return 0;
  }
  // Apply the plan that was printed.
  const { written, skipped } = applyUpdate(root, cfg, plan, { version, force });
  for (const dest of written) io.stdout(`wrote ${dest}\n`);
  for (const { warning } of skipped) io.stderr(`slicekit: ${warning}\n`);
  // Drift left in place is not success.
  return skipped.some((s) => s.status === 'drifted') ? 1 : 0;
}

export const updateCommand = { run, usage: USAGE };
