// One lock file per guarded file: `wx` creates it or fails, so one holder at a time. A lock older than
// LOCK_STALE_MS is taken as left by a dead process and removed. The journal and the slice state use it.
import fs from 'node:fs';

export const LOCK_WAIT_MS = 10;
export const LOCK_STALE_MS = 30_000;

export const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Runs fn while holding `lock`, waiting up to budgetMs for it; then throws busy() (an Error).
export function withFileLock(lock, fn, { budgetMs, busy }) {
  const deadline = Date.now() + budgetMs;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx');
      break;
    } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lock);
      } catch {
        // the holder released it between the attempt and the stat; try again
      }
      if (Date.now() >= deadline) throw busy();
      sleep(LOCK_WAIT_MS);
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}
