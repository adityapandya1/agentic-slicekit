import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_PATH, ConfigError, defaultConfig, loadConfig, validateConfig } from './config.js';
import { exists, listFiles, readText, writeText } from './fs.js';
import { currentBranch, git, GitError, hasCommits, isRepo } from './git.js';
import { GITHOOKS, HOOKS_PATH, hooksPathValue, isInstalledHooksPath } from './githooks.js';
import { probeCli } from './hook-cli.js';
import { kitPaths } from './paths.js';
import { kitVersion, renderAll } from './render/index.js';
import { readSettings } from './render/settings.js';
import { WORKFLOW_DRIFT, WORKFLOW_PATH, workflowState } from './workflow.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates/docs/', import.meta.url));
const GITHOOKS_DIR = fileURLToPath(new URL('../templates/githooks/', import.meta.url));
// Each ignore rule init owns, with every spelling of it that already counts as present. Missing rules
// are appended at the end, so the journal un-ignores come after any `*.log` rule and win (later rules
// win in git): journal files are committed, their locks are not.
const IGNORE_RULES = [
  { rule: '.slicekit/graph/', forms: new Set(['.slicekit/graph/', '/.slicekit/graph/', '.slicekit/graph', '/.slicekit/graph']) },
  { rule: '.slicekit/.subagent-*', forms: new Set(['.slicekit/.subagent-*', '/.slicekit/.subagent-*']) },
  // The machine's own settings (D-43), such as a local test command: never part of the project.
  { rule: '.slicekit/local.json', forms: new Set(['.slicekit/local.json', '/.slicekit/local.json']) },
  { rule: '!.slicekit/journal/', forms: new Set(['!.slicekit/journal/', '!/.slicekit/journal/']) },
  { rule: '!.slicekit/journal/*.log', forms: new Set(['!.slicekit/journal/*.log', '!/.slicekit/journal/*.log']) },
  { rule: '.slicekit/journal/*.lock', forms: new Set(['.slicekit/journal/*.lock', '/.slicekit/journal/*.lock']) },
  // Slice worktrees (REQ-2.6 step 1) live under the root and are never part of the checkout.
  { rule: '.worktrees/', forms: new Set(['.worktrees/', '/.worktrees/', '.worktrees', '/.worktrees']) },
  // The README's path is an npm install (S-28): what it installs is never part of the project. A file
  // that already has any node_modules rule keeps its own, since a line below a negation such as
  // `!node_modules/local-pkg/` would cancel it (P2/S-28 review H-1).
  { rule: 'node_modules/', forms: new Set(['node_modules/', '/node_modules/', 'node_modules', '/node_modules']), mentions: 'node_modules' },
];
// Hooks checked out with CRLF break sh (REQ-3.9).
// Intake snapshots (S-10) are stored byte for byte, so git must not convert their line endings. The
// pattern comes from kitPaths as S-10 builds it, so `./docs` and `docs` write the same line.
function attributeRules(root, cfg) {
  const intakeDir = path.relative(root, kitPaths(root, cfg).intake).split(path.sep).join('/');
  const intake = `${intakeDir}/** -text`;
  return [
    { rule: '.githooks/* text eol=lf', forms: new Set(['.githooks/* text eol=lf', '/.githooks/* text eol=lf']) },
    { rule: intake, forms: new Set([intake, `/${intake}`]) },
  ];
}
const NOT_A_REPO = 'not a git repository';
const UNBORN_PROTECTED = 'commit this scaffold with ALLOW_PROTECTED_COMMIT=1 git commit …, or start on a slice branch';

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

// Each rule is added once, when no accepted spelling of it is already a line of the file (spacing
// inside a line does not matter). Appended lines take the file's own line ending.
function ensureLines(file, rules) {
  if (!exists(file)) {
    writeText(file, rules.map(({ rule }) => `${rule}\n`).join(''));
    return 'created';
  }
  const raw = fs.readFileSync(file, 'utf8');
  const squash = (line) => line.trim().replace(/\s+/g, ' ');
  const present = new Set(raw.split(/\r?\n/).map(squash));
  const mentioned = (word) => [...present].some((l) => l.includes(word));
  const missing = rules.filter(({ forms, mentions }) => ![...forms].some((f) => present.has(squash(f))) && !(mentions && mentioned(mentions)));
  if (missing.length === 0) return 'skipped';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const sep = raw === '' || raw.endsWith('\n') ? '' : eol;
  fs.appendFileSync(file, `${sep}${missing.map(({ rule }) => `${rule}${eol}`).join('')}`);
  return 'updated';
}

// The slicekit git hooks (REQ-3.9), LF and executable. One that exists with other content is the
// team's own hook: it is never overwritten, and the warning names it. Returns the files it created.
function installHooks(paths, rel, lists, warnings) {
  const created = [];
  for (const name of GITHOOKS) {
    const abs = path.join(paths.githooks, name);
    const content = readText(path.join(GITHOOKS_DIR, name));
    if (!exists(abs)) {
      writeText(abs, content);
      fs.chmodSync(abs, 0o755);
      lists.created.push(rel(abs));
      created.push(rel(abs));
      continue;
    }
    lists.skipped.push(rel(abs));
    if (readText(abs) !== content) warnings.push(`${rel(abs)} differs from the slicekit hook; left as is`);
  }
  return created;
}

// A new file is staged 100644 on win32, where there is no mode bit; staging the hooks init created
// with +x makes the team's first commit record them executable. In an empty repository this creates
// the index; it is never a commit (D-19).
function stageHooks(root, files, warnings) {
  if (files.length === 0) return;
  try {
    git(root, ['add', '--chmod=+x', '--', ...files]);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    warnings.push(`could not stage ${files.join(', ')} as executable: ${e.stderr}`);
  }
}

// The pre-commit hook init just installed refuses the first commit of a repository whose HEAD is
// unborn on a protected branch: the line that says how to make it, or null.
function firstCommitHint(root, cfg) {
  if (hasCommits(root)) return null;
  let branch;
  try {
    branch = currentBranch(root);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
  return branch !== null && cfg.protectedBranches.includes(branch) ? UNBORN_PROTECTED : null;
}

// Points core.hooksPath at .githooks, unless it already names something else: that is left alone
// and reported. Hooks in .git/hooks stop running once the path is set, so they are named first.
function setHooksPath(root, warnings) {
  const current = hooksPathValue(root);
  if (isInstalledHooksPath(root, current)) return;
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
// One exception: a config with no cli key at all (an example project ships one, so that it names no
// one's install) takes cli from --cli, else from the probe, and is written back with it.
function resolveConfig(root, { name, shape, docsRoot, commands, cli, env }) {
  const file = path.join(root, CONFIG_PATH);
  if (exists(file)) {
    const raw = configWithoutCli(file);
    let probed = null;
    if (raw) {
      probed = cli === undefined ? probeCli(root, { env }) : { cli, warning: null };
      raw.cli = probed.cli;
    }
    const cfg = raw ?? loadConfig(root);
    for (const [field, value] of [['shape', shape], ['docsRoot', docsRoot], ['cli', cli]]) {
      if (value !== undefined && value !== cfg[field]) {
        throw new ConfigError([`config.json already sets ${field} = ${cfg[field]}; remove the flag or edit the config`]);
      }
    }
    if (!raw) return { cfg, cliWarning: null, cliFilled: false };
    const errors = validateConfig(raw);
    if (errors.length > 0) throw new ConfigError(errors);
    writeText(file, `${JSON.stringify(raw, null, 2)}\n`);
    return { cfg: loadConfig(root), cliWarning: probed.warning, cliFilled: true };
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
  return { cfg, cliWarning: probed.warning, cliFilled: false };
}

// The parsed config when it is a JSON object with no cli key; null otherwise (loadConfig then reads,
// and reports, the file as it is).
function configWithoutCli(file) {
  let raw;
  try {
    raw = JSON.parse(readText(file).replace(/^﻿/, ''));
  } catch {
    return null;
  }
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) && !Object.hasOwn(raw, 'cli') ? raw : null;
}

// M4: a cli with no path separator that is not `node <file>` is looked up on PATH, and a CI runner
// has no global slicekit, so the workflow init writes could not run it.
export function bareCliWarning(cli) {
  if (/[\\/]/.test(cli) || /^node\s/.test(cli)) return null;
  return `cli is "${cli}", a bare command, and CI has no global install, so ${WORKFLOW_PATH} cannot run it; set cli in .slicekit/config.json to a repository path or add an install step`;
}

export function init(root, { name, shape, docsRoot, commands = {}, cli, env = process.env }) {
  const { cfg, cliWarning, cliFilled } = resolveConfig(root, { name, shape, docsRoot, commands, cli, env });
  readSettings(root); // a corrupt .claude/settings.json stops init before anything is written

  const paths = kitPaths(root, cfg);
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
  const lists = { created: [], updated: cliFilled ? [rel(paths.config)] : [], skipped: [] };
  for (const [abs, content] of plan(cfg, paths)) {
    if (cliFilled && abs === paths.config) continue;
    if (exists(abs)) {
      lists.skipped.push(rel(abs));
    } else {
      writeText(abs, content);
      lists.created.push(rel(abs));
    }
  }
  lists[ensureLines(paths.gitignore, IGNORE_RULES)].push(rel(paths.gitignore));
  const attributes = path.join(root, '.gitattributes');
  lists[ensureLines(attributes, attributeRules(root, cfg))].push(rel(attributes));

  const repo = isRepo(root);
  const warnings = repo ? [] : [NOT_A_REPO];
  if (cliWarning) warnings.push(cliWarning);
  const hooks = installHooks(paths, rel, lists, warnings);
  if (repo) {
    stageHooks(root, hooks, warnings);
    setHooksPath(root, warnings);
  }
  // The CI workflow (REQ-3.11): written when absent; an existing one is the team's and stays as is.
  const workflow = workflowState(root, cfg);
  if (workflow.current === null) {
    writeText(workflow.file, workflow.expected);
    lists.created.push(WORKFLOW_PATH);
    const bare = bareCliWarning(cfg.cli);
    if (bare) warnings.push(bare);
  } else {
    lists.skipped.push(WORKFLOW_PATH);
    if (workflow.current !== workflow.expected) warnings.push(`${WORKFLOW_DRIFT}; left as is`);
  }
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
    next: repo ? firstCommitHint(root, cfg) : null,
  };
}
