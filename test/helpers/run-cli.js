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

// The pull request a CI runner is building, as check --ci reads it. A test that wants an event
// passes one in env; by default the CLI under test never sees the runner's own.
export const CI_PULL_REQUEST = ['GITHUB_EVENT_PATH', 'GITHUB_HEAD_REF', 'GITHUB_BASE_REF', 'SLICEKIT_PR_TITLE', 'SLICEKIT_PR_BODY'];
function hermetic(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (CI_PULL_REQUEST.includes(k.toUpperCase())) delete out[k];
  return out;
}

export function runCli(args, { cwd, stdin, env, shim: useShim = true } = {}) {
  const base = env ?? hermetic(process.env);
  const r = spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    input: stdin,
    env: useShim ? withShim(base) : base,
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
