import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_PATH, ConfigError, defaultConfig, loadConfig, validateConfig } from './config.js';
import { exists, listFiles, readText, writeText } from './fs.js';
import { git, GitError, isRepo } from './git.js';
import { probeCli } from './hook-cli.js';
import { kitPaths } from './paths.js';
import { kitVersion, renderAll } from './render/index.js';
import { readSettings } from './render/settings.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates/docs/', import.meta.url));
const GITHOOKS_DIR = fileURLToPath(new URL('../templates/githooks/', import.meta.url));
const GITHOOKS = ['pre-commit', 'prepare-commit-msg'];
const HOOKS_PATH = '.githooks';
// Each ignore rule init owns, with every spelling of it that already counts as present.
const IGNORE_RULES = [
  { rule: '.slicekit/graph/', forms: new Set(['.slicekit/graph/', '/.slicekit/graph/', '.slicekit/graph', '/.slicekit/graph']) },
  { rule: '.slicekit/.subagent-*', forms: new Set(['.slicekit/.subagent-*', '/.slicekit/.subagent-*']) },
];
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

// Each rule is added once, when no accepted spelling of it is already a line of the file.
function ensureGitignore(file) {
  const lines = (rules) => rules.map(({ rule }) => `${rule}\n`).join('');
  if (!exists(file)) {
    writeText(file, lines(IGNORE_RULES));
    return 'created';
  }
  const text = readText(file);
  const present = new Set(text.split('\n').map((line) => line.trim()));
  const missing = IGNORE_RULES.filter(({ forms }) => ![...forms].some((f) => present.has(f)));
  if (missing.length === 0) return 'skipped';
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${sep}${lines(missing)}`);
  return 'updated';
}

// The two git hooks (REQ-3.9), LF and executable. One that exists with other content is the team's
// own hook: it is never overwritten, and the warning names it.
function installHooks(paths, rel, lists, warnings) {
  for (const name of GITHOOKS) {
    const abs = path.join(paths.githooks, name);
    const content = readText(path.join(GITHOOKS_DIR, name));
    if (!exists(abs)) {
      writeText(abs, content);
      fs.chmodSync(abs, 0o755);
      lists.created.push(rel(abs));
      continue;
    }
    lists.skipped.push(rel(abs));
    if (readText(abs) !== content) warnings.push(`${rel(abs)} differs from the slicekit hook; left as is`);
  }
}

const configValue = (root, key) => {
  try {
    return git(root, ['config', '--get', key]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
};

// Points core.hooksPath at .githooks, unless it already names something else: that is left alone
// and reported. Hooks in .git/hooks stop running once the path is set, so they are named first.
function setHooksPath(root, warnings) {
  const current = configValue(root, 'core.hooksPath');
  if (current === HOOKS_PATH) return;
  if (current !== null) {
    warnings.push(`core.hooksPath is ${current}; left as is, so the slicekit git hooks in ${HOOKS_PATH}/ do not run`);
    return;
  }
  const dir = path.join(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'hooks');
  const live = exists(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.endsWith('.sample'))
        .map((e) => `.git/hooks/${e.name}`)
        .sort()
    : [];
  if (live.length > 0) {
    warnings.push(`${live.join(', ')} stop running once core.hooksPath is set to ${HOOKS_PATH}; move them into ${HOOKS_PATH}/ to keep them`);
  }
  git(root, ['config', 'core.hooksPath', HOOKS_PATH]);
}

// An existing config.json is the truth: a flag may repeat its shape, docsRoot or cli, never change them.
// A new config takes cli from --cli, else from the probe (D-30); the probe's warning comes back with it.
function resolveConfig(root, { name, shape, docsRoot, commands, cli, env }) {
  if (exists(path.join(root, CONFIG_PATH))) {
    const cfg = loadConfig(root);
    for (const [field, value] of [['shape', shape], ['docsRoot', docsRoot], ['cli', cli]]) {
      if (value !== undefined && value !== cfg[field]) {
        throw new ConfigError([`config.json already sets ${field} = ${cfg[field]}; remove the flag or edit the config`]);
      }
    }
    return { cfg, cliWarning: null };
  }
  const probed = cli === undefined ? probeCli(root, { env }) : { cli, warning: null };
  const cfg = defaultConfig({
    name,
    shape,
    docsRoot: docsRoot ?? 'docs',
    commands,
    cli: probed.cli,
  });
  const errors = validateConfig(cfg);
  if (errors.length > 0) throw new ConfigError(errors);
  return { cfg, cliWarning: probed.warning };
}

export function init(root, { name, shape, docsRoot, commands = {}, cli, env = process.env }) {
  const { cfg, cliWarning } = resolveConfig(root, { name, shape, docsRoot, commands, cli, env });
  readSettings(root); // a corrupt .claude/settings.json stops init before anything is written

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

  const repo = isRepo(root);
  const warnings = repo ? [] : [NOT_A_REPO];
  if (cliWarning) warnings.push(cliWarning);
  installHooks(paths, rel, lists, warnings);
  if (repo) setHooksPath(root, warnings);
  for (const { dest, action, warning } of renderAll(root, cfg, { version: kitVersion() })) {
    lists[action === 'unchanged' || action === 'skipped' ? 'skipped' : action].push(dest);
    if (warning) warnings.push(warning);
  }

  return {
    created: lists.created.sort(),
    updated: lists.updated.sort(),
    skipped: lists.skipped.sort(),
    warnings,
    cli: cfg.cli,
    cliWarned: cliWarning !== null,
  };
}
