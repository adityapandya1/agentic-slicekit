import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const binPath = path.resolve(here, '..', '..', 'bin', 'slicekit.js');

export function runCli(args, { cwd, stdin, env } = {}) {
  const r = spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    input: stdin,
    env: env ?? process.env,
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
