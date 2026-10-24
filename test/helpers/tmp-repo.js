import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function run(root, args) {
  execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function commit(root, message, { allowEmpty = true } = {}) {
  run(root, ['commit', ...(allowEmpty ? ['--allow-empty'] : []), '-m', message]);
}

export function makeRepo({ commits = 0, branch = 'main', files = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-repo-'));
  run(root, ['init', '-b', branch]);
  run(root, ['config', 'user.name', 'Slicekit Test']);
  run(root, ['config', 'user.email', 'test@example.com']);
  run(root, ['config', 'commit.gpgsign', 'false']);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  for (let i = 1; i <= commits; i++) commit(root, `c${i}`);
  const cleanup = () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows can hold handles briefly; the OS temp cleaner takes it.
    }
  };
  return { root, cleanup };
}
