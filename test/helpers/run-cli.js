import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const binPath = path.resolve(here, '..', '..', 'bin', 'slicekit.js');

// A `slicekit` on PATH that runs this checkout, so init's probe picks it and the --version check
// answers locally. `shim: false` leaves the environment's PATH as given.
let shimDir;
function shim() {
  if (shimDir) return shimDir;
  shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-shim-'));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(shimDir, 'slicekit.cmd'), `@"${process.execPath}" "${binPath}" %*\r\n`);
  } else {
    fs.writeFileSync(path.join(shimDir, 'slicekit'), `#!/bin/sh\nexec "${process.execPath}" "${binPath}" "$@"\n`, { mode: 0o755 });
  }
  return shimDir;
}

function withShim(env) {
  const out = { ...env };
  const key = Object.keys(out).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  out[key] = [shim(), out[key]].filter(Boolean).join(path.delimiter);
  return out;
}

export function runCli(args, { cwd, stdin, env, shim: useShim = true } = {}) {
  const r = spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    input: stdin,
    env: useShim ? withShim(env ?? process.env) : (env ?? process.env),
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
