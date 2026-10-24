import fs from 'node:fs';
import path from 'node:path';

export function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

export function writeText(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, s.replace(/\r\n/g, '\n'));
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export function exists(p) {
  return fs.existsSync(p);
}

export function listFiles(dir, { ext, ignore = ['node_modules', '.git'] } = {}) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignore.includes(entry.name)) walk(path.join(abs, entry.name), relPath);
      } else if (!ext || path.extname(entry.name).toLowerCase() === ext.toLowerCase()) {
        out.push(relPath);
      }
    }
  };
  walk(dir, '');
  return out.sort();
}
