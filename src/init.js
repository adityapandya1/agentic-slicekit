import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, defaultConfig, validateConfig } from './config.js';
import { exists, listFiles, readText, writeText } from './fs.js';
import { git, isRepo } from './git.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates/docs/', import.meta.url));
const GRAPH_RULE = '.slicekit/graph/';
const NOT_A_REPO = 'not a git repository; git hooks were not configured';

function render(text, vars) {
  return text.replace(/\{\{(name|docsRoot|date)\}\}/g, (_, key) => vars[key]);
}

function plan(cfg) {
  const vars = { name: cfg.name, docsRoot: cfg.docsRoot, date: new Date().toISOString().slice(0, 10) };
  const files = new Map();
  for (const rel of listFiles(TEMPLATES_DIR)) {
    const dest = rel === 'BUILD.md' ? rel : `${cfg.docsRoot}/${rel}`;
    files.set(dest, render(readText(path.join(TEMPLATES_DIR, rel)), vars));
  }
  files.set('.slicekit/config.json', `${JSON.stringify(cfg, null, 2)}\n`);
  files.set('.slicekit/baselines/references.json', '{}\n');
  files.set('.slicekit/baselines/style.json', '{}\n');
  files.set('.slicekit/state/.keep', '');
  files.set('.githooks/.keep', '');
  return files;
}

function ensureGitignore(root) {
  const file = path.join(root, '.gitignore');
  if (!exists(file)) {
    writeText(file, `${GRAPH_RULE}\n`);
    return 'created';
  }
  const text = readText(file);
  if (text.split('\n').some((line) => line.trim() === GRAPH_RULE)) return 'skipped';
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${sep}${GRAPH_RULE}\n`);
  return 'skipped';
}

export function init(root, { name, shape, docsRoot = 'docs', commands = {} }) {
  const cfg = defaultConfig({ name, shape, docsRoot, commands });
  const errors = validateConfig(cfg);
  if (errors.length > 0) throw new ConfigError(errors);

  const created = [];
  const skipped = [];
  for (const [rel, content] of plan(cfg)) {
    const abs = path.join(root, rel);
    if (exists(abs)) {
      skipped.push(rel);
    } else {
      writeText(abs, content);
      created.push(rel);
    }
  }
  (ensureGitignore(root) === 'created' ? created : skipped).push('.gitignore');

  const result = { created: created.sort(), skipped: skipped.sort() };
  if (isRepo(root)) {
    git(root, ['config', 'core.hooksPath', '.githooks']);
  } else {
    result.warnings = [NOT_A_REPO];
  }
  return result;
}
