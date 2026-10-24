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

// The first runnable file for `name` in `extraDirs`, then every directory on env's PATH, with
// PATHEXT applied on win32 (and the bare name accepted). Returns its path or null. Never executes.
export function which(name, env, extraDirs = []) {
  const dirs = [...extraDirs, ...(envGet(env, 'PATH') ?? '').split(path.delimiter).filter(Boolean)];
  const exts =
    process.platform === 'win32'
      ? [...(envGet(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean), '']
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, `${name}${ext}`);
      if (runnable(file)) return file;
    }
  }
  return null;
}
