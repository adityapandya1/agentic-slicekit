import fs from 'node:fs';
import path from 'node:path';

// A file a shell could run: a regular file, executable on POSIX (win32 has no mode bit).
export function runnable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (process.platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const envGet = (env, name) => {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key ? env[key] : undefined;
};

// Suffixes tried after a name: PATHEXT (default .COM;.EXE;.BAT;.CMD) plus the bare name on win32, none elsewhere.
export function extensions(env) {
  if (process.platform !== 'win32') return [''];
  return [...(envGet(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean), ''];
}

// The first runnable file for `name` in `extraDirs`, then every directory on env's PATH, with
// PATHEXT applied on win32 (and the bare name accepted). Returns its path or null. Never executes.
export function which(name, env, extraDirs = []) {
  const dirs = [...extraDirs, ...(envGet(env, 'PATH') ?? '').split(path.delimiter).filter(Boolean)];
  for (const dir of dirs) {
    for (const ext of extensions(env)) {
      const file = path.join(dir, `${name}${ext}`);
      if (runnable(file)) return file;
    }
  }
  return null;
}
