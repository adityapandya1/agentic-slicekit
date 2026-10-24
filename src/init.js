import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_PATH, ConfigError, defaultConfig, loadConfig, validateConfig } from './config.js';
import { exists, listFiles, readText, writeText } from './fs.js';
import { isRepo } from './git.js';
import { kitPaths } from './paths.js';
import { kitVersion, renderAll } from './render/index.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates/docs/', import.meta.url));
const GRAPH_RULE = '.slicekit/graph/';
const GRAPH_FORMS = new Set(['.slicekit/graph/', '/.slicekit/graph/', '.slicekit/graph', '/.slicekit/graph']);
const NOT_A_REPO = 'not a git repository';

// Each template file maps to a kitPaths destination; nothing else names a destination.
const TEMPLATE_DEST = {
  'BUILD.md': (p) => p.build,
  'decisions.md': (p) => p.decisions,
  'platform.md': (p) => p.platform,
  'observability.md': (p) => p.observability,
  'runbook.md': (p) => p.runbook,
  'spec/00-overview.md': (p) => path.join(p.spec, '00-overview.md'),
  'spec/gaps.md': (p) => p.gaps,
  'spec/stack.md': (p) => p.stack,
  'intake/.keep': (p) => path.join(p.intake, '.keep'),
  'spec/contracts/.keep': (p) => path.join(p.contracts, '.keep'),
  'phases/.keep': (p) => path.join(p.phases, '.keep'),
  'releases/.keep': (p) => path.join(p.releases, '.keep'),
};

function render(text, vars) {
  return text.replace(/\{\{(name|docsRoot|date)\}\}/g, (_, key) => vars[key]);
}

function plan(cfg, paths) {
  const vars = { name: cfg.name, docsRoot: cfg.docsRoot, date: new Date().toISOString().slice(0, 10) };
  const files = new Map();
  for (const rel of listFiles(TEMPLATES_DIR)) {
    const dest = TEMPLATE_DEST[rel];
    if (!dest) throw new Error(`init: template ${rel} has no destination in kitPaths`);
    files.set(dest(paths), render(readText(path.join(TEMPLATES_DIR, rel)), vars));
  }
  files.set(paths.config, `${JSON.stringify(cfg, null, 2)}\n`);
  files.set(path.join(paths.baselines, 'references.json'), '{}\n');
  files.set(path.join(paths.baselines, 'style.json'), '{}\n');
  files.set(path.join(paths.state, '.keep'), '');
  files.set(path.join(paths.githooks, '.keep'), '');
  return files;
}

function ensureGitignore(file) {
  if (!exists(file)) {
    writeText(file, `${GRAPH_RULE}\n`);
    return 'created';
  }
  const text = readText(file);
  if (text.split('\n').some((line) => GRAPH_FORMS.has(line.trim()))) return 'skipped';
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${sep}${GRAPH_RULE}\n`);
  return 'updated';
}

// An existing config.json is the truth: a flag may repeat its shape or docsRoot, never change them.
function resolveConfig(root, { name, shape, docsRoot, commands }) {
  if (exists(path.join(root, CONFIG_PATH))) {
    const cfg = loadConfig(root);
    for (const [field, value] of [['shape', shape], ['docsRoot', docsRoot]]) {
      if (value !== undefined && value !== cfg[field]) {
        throw new ConfigError([`config.json already sets ${field} = ${cfg[field]}; remove the flag or edit the config`]);
      }
    }
    return cfg;
  }
  const cfg = defaultConfig({ name, shape, docsRoot: docsRoot ?? 'docs', commands });
  const errors = validateConfig(cfg);
  if (errors.length > 0) throw new ConfigError(errors);
  return cfg;
}

export function init(root, { name, shape, docsRoot, commands = {} }) {
  const cfg = resolveConfig(root, { name, shape, docsRoot, commands });

  const paths = kitPaths(root, cfg);
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
  const lists = { created: [], updated: [], skipped: [] };
  for (const [abs, content] of plan(cfg, paths)) {
    if (exists(abs)) {
      lists.skipped.push(rel(abs));
    } else {
      writeText(abs, content);
      lists.created.push(rel(abs));
    }
  }
  lists[ensureGitignore(paths.gitignore)].push(rel(paths.gitignore));

  const warnings = isRepo(root) ? [] : [NOT_A_REPO];
  for (const { dest, action, warning } of renderAll(root, cfg, { version: kitVersion() })) {
    lists[action === 'unchanged' || action === 'skipped' ? 'skipped' : action].push(dest);
    if (warning) warnings.push(warning);
  }

  // core.hooksPath is S-06's to set, with its own guards; S-01 only creates .githooks/.
  return {
    created: lists.created.sort(),
    updated: lists.updated.sort(),
    skipped: lists.skipped.sort(),
    warnings,
  };
}
